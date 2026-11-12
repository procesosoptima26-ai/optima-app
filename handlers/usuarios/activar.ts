/** El empleado crea su propia contraseña mediante token de un solo uso. */
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consultarInvitacion, bloquearActivacion, liberarBloqueoActivacion, anularInvitacion, validarClaveNueva } from "../../lib/invitaciones.js";
import { activarUsuario, leerUsuario } from "../../lib/usuarios-maestros.js";
import { ErrorPuertaAuditoriaGlobal } from "../../lib/puerta-auditoria-core-global.js";
import { auditoriaCoreExigida } from "../../lib/auditoria-core-transversal.js";
import { ejecutarIdentidadAuditada, snapshotIdentidad, ErrorAuditoriaIdentidad } from "../../lib/auditoria-identidad-core.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = req.body?.password;
  if (!validarClaveNueva(password)) {
    return res.status(400).json({ ok: false, error: "Usá una contraseña de 8 a 128 caracteres, con al menos una letra, un número y un símbolo" });
  }
  let propietario: string | null = null;
  try {
    const invitacion = await consultarInvitacion(token);
    if (!invitacion) return res.status(410).json({ ok: false, error: "Invitación vencida o utilizada" });
    propietario = await bloquearActivacion(token);
    if (!propietario) return res.status(409).json({ ok: false, error: "La activación está en proceso. Reintentá en un momento." });
    const registro = await leerUsuario(invitacion.usuarioId);
    if (!registro || registro.fields.ACTIVO === true || registro.fields.PASSWORD_HASH ||
        registro.fields.Email !== invitacion.email ||
        !Array.isArray(registro.fields.EMPRESA) ||
        registro.fields.EMPRESA.length !== 1 ||
        registro.fields.EMPRESA[0] !== invitacion.empresaId) {
      return res.status(410).json({ ok: false, error: "Invitación vencida o utilizada" });
    }
    if (auditoriaCoreExigida()) {
      let hashGenerado: string | null = null;
      const operacion = await ejecutarIdentidadAuditada({
        actor: { usuarioId: "SISTEMA", usuario: "ENLACE_ACTIVACION_VERIFICADO", tipo: "SISTEMA" },
        empresaId: invitacion.empresaId, empresaNombre: "EMPRESA_VERIFICADA_POR_ENLACE",
        accion: "USUARIO_ACTIVAR", recursoTipo: "USUARIO", recursoId: invitacion.usuarioId,
        motivo: "Activación solicitada mediante enlace verificado",
        anterior: snapshotIdentidad(false, false), propuesto: snapshotIdentidad(true, true),
        escribir: async () => {
          hashGenerado = await argon2.hash(password, { type: argon2.argon2id });
          await activarUsuario(invitacion.usuarioId, hashGenerado);
          try { await anularInvitacion(token); }
          catch { console.error("La cuenta activada requiere revisar invalidación del enlace"); }
        },
        releer: async () => {
          const comprobado = await leerUsuario(invitacion.usuarioId);
          if (!comprobado || !Array.isArray(comprobado.fields.EMPRESA) ||
              comprobado.fields.EMPRESA.length !== 1 || comprobado.fields.EMPRESA[0] !== invitacion.empresaId ||
              comprobado.fields.Email !== invitacion.email) throw new Error("Cuenta no verificable");
          return { estado: snapshotIdentidad(comprobado.fields.ACTIVO === true,
            Boolean(hashGenerado && comprobado.fields.PASSWORD_HASH === hashGenerado)),
            dato: { activada: comprobado.fields.ACTIVO === true } };
        },
      });
      return res.status(200).json({ ok: true, operacionId: operacion.operacionId,
        mensaje: "Cuenta activada. Ya podés iniciar sesión." });
    }
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await activarUsuario(invitacion.usuarioId, hash);
    // Si Redis falla en este punto, ACTIVO ya impide reutilizar el enlace.
    try { await anularInvitacion(token); }
    catch (fallo) { console.error("No se pudo anular enlace de cuenta activada:", fallo); }
    return res.status(200).json({ ok: true, mensaje: "Cuenta activada. Ya podés iniciar sesión." });
  } catch (error) {
    if (error instanceof ErrorPuertaAuditoriaGlobal) {
      const conflicto = error.codigo === "INCIDENCIAS" || error.codigo === "OCUPADA";
      return res.status(conflicto ? 409 : 503).json({ ok: false,
        error: conflicto
          ? "La empresa tiene una operación auditada pendiente o en curso; revisá el historial antes de reintentar"
          : "No se pudo verificar el bloqueo preventivo de auditoría; no se ejecutaron nuevos cambios" });
    }
    if (error instanceof ErrorAuditoriaIdentidad) {
      console.error("Auditoría activación", { codigo: error.codigo, operacionId: error.operacionId });
      return res.status(503).json({ ok: false, operacionId: error.operacionId,
        puedeEstarAplicado: error.puedeEstarAplicado,
        error: "La activación no se pudo confirmar; verificá la cuenta antes de reintentar" });
    }
    console.error("Error activando invitación:", error);
    return res.status(503).json({ ok: false, error: "No se pudo completar la activación. Podés volver a intentarlo desde el mismo enlace." });
  } finally {
    if (propietario) {
      try { await liberarBloqueoActivacion(token, propietario); }
      catch (fallo) { console.error("No se pudo liberar bloqueo de activación:", fallo); }
    }
  }
}
