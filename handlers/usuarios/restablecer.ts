/** Restablece únicamente el hash y revoca las sesiones antiguas del usuario. */
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { validarClaveNueva } from "../../lib/invitaciones.js";
import { leerUsuario, actualizarPasswordUsuario } from "../../lib/usuarios-maestros.js";
import { consultarRecuperacion, bloquearRecuperacion, liberarRecuperacion, anularRecuperacion, huellaPassword } from "../../lib/recuperacion.js";
import { revocarSesionesUsuario } from "../../lib/session.js";
import { ErrorPuertaAuditoriaGlobal } from "../../lib/puerta-auditoria-core-global.js";
import { auditoriaCoreExigida } from "../../lib/auditoria-core-transversal.js";
import { ejecutarIdentidadAuditada, snapshotIdentidad, ErrorAuditoriaIdentidad } from "../../lib/auditoria-identidad-core.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  if (process.env.OPTIMA_PASSWORD_RESET_ENABLED !== "true")
    return res.status(503).json({ ok: false, error: "Recuperación todavía no habilitada" });
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = req.body?.password;
  if (!validarClaveNueva(password)) return res.status(400).json({ ok: false, error: "La contraseña debe tener entre 8 y 128 caracteres, una letra, un número y un símbolo" });
  let owner: string | null = null;
  try {
    const datos = await consultarRecuperacion(token);
    if (!datos) return res.status(410).json({ ok: false, error: "Enlace vencido o utilizado. Solicitá uno nuevo." });
    owner = await bloquearRecuperacion(token);
    if (!owner) return res.status(409).json({ ok: false, error: "El cambio está en proceso. Intentá de nuevo en unos momentos." });
    const actual = await leerUsuario(datos.usuarioId);
    if (!actual || actual.fields.ACTIVO !== true ||
        typeof actual.fields.Email !== "string" || actual.fields.Email.trim().toLowerCase() !== datos.email ||
        !Array.isArray(actual.fields.EMPRESA) || actual.fields.EMPRESA.length !== 1 || actual.fields.EMPRESA[0] !== datos.empresaId ||
        typeof actual.fields.PASSWORD_HASH !== "string" || !actual.fields.PASSWORD_HASH.startsWith("$argon2id$") ||
        huellaPassword(actual.fields.PASSWORD_HASH) !== datos.huellaPassword)
      return res.status(410).json({ ok: false, error: "Enlace vencido o utilizado. Solicitá uno nuevo." });
    if (auditoriaCoreExigida()) {
      let hashGenerado: string | null = null;
      let sesionesRevocadas = false;
      const operacion = await ejecutarIdentidadAuditada({
        actor: { usuarioId: "SISTEMA", usuario: "ENLACE_RECUPERACION_VERIFICADO", tipo: "SISTEMA" },
        empresaId: datos.empresaId, empresaNombre: "EMPRESA_VERIFICADA_POR_ENLACE",
        accion: "USUARIO_RESTABLECER_CLAVE", recursoTipo: "USUARIO", recursoId: datos.usuarioId,
        motivo: "Restablecimiento de clave mediante enlace verificado",
        anterior: snapshotIdentidad(true, false, { sesionesRevocadas: false }),
        propuesto: snapshotIdentidad(true, true, { sesionesRevocadas: true }),
        escribir: async () => {
          hashGenerado = await argon2.hash(password, { type: argon2.argon2id });
          await revocarSesionesUsuario(datos.usuarioId);
          sesionesRevocadas = true;
          await actualizarPasswordUsuario(datos.usuarioId, hashGenerado);
          try { await anularRecuperacion(token); }
          catch { console.error("La clave actualizada requiere revisar invalidación del enlace"); }
        },
        releer: async () => {
          const comprobado = await leerUsuario(datos.usuarioId);
          if (!comprobado || !Array.isArray(comprobado.fields.EMPRESA) ||
              comprobado.fields.EMPRESA.length !== 1 || comprobado.fields.EMPRESA[0] !== datos.empresaId ||
              typeof comprobado.fields.Email !== "string" ||
              comprobado.fields.Email.trim().toLowerCase() !== datos.email ||
              comprobado.fields.ACTIVO !== true) throw new Error("Cuenta no verificable");
          return { estado: snapshotIdentidad(true,
            Boolean(hashGenerado && comprobado.fields.PASSWORD_HASH === hashGenerado),
            { sesionesRevocadas }), dato: { actualizada: true } };
        },
        // Si se revocaron sesiones, un fallo posterior NO es ausencia de efectos.
        falloSinEfecto: () => !sesionesRevocadas,
      });
      return res.status(200).json({ ok: true, operacionId: operacion.operacionId,
        mensaje: "Contraseña actualizada. Ya podés iniciar sesión." });
    }
    const nuevoHash = await argon2.hash(password, { type: argon2.argon2id });
    // Revoca primero: ante fallo de Airtable, la contraseña anterior queda intacta,
    // pero se cerrarán las sesiones previas como medida de seguridad.
    await revocarSesionesUsuario(datos.usuarioId);
    await actualizarPasswordUsuario(datos.usuarioId, nuevoHash);
    try { await anularRecuperacion(token); }
    catch (error) { console.error("No se pudo anular enlace ya usado:", error); }
    return res.status(200).json({ ok: true, mensaje: "Contraseña actualizada. Ya podés iniciar sesión." });
  } catch (error) {
    if (error instanceof ErrorPuertaAuditoriaGlobal) {
      const conflicto = error.codigo === "INCIDENCIAS" || error.codigo === "OCUPADA";
      return res.status(conflicto ? 409 : 503).json({ ok: false,
        error: conflicto
          ? "La empresa tiene una operación auditada pendiente o en curso; revisá el historial antes de reintentar"
          : "No se pudo verificar el bloqueo preventivo de auditoría; no se ejecutaron nuevos cambios" });
    }
    if (error instanceof ErrorAuditoriaIdentidad) {
      console.error("Auditoría recuperación", { codigo: error.codigo, operacionId: error.operacionId });
      return res.status(503).json({ ok: false, operacionId: error.operacionId,
        puedeEstarAplicado: error.puedeEstarAplicado,
        error: "El cambio no se pudo confirmar; verificá la cuenta antes de solicitar otro enlace" });
    }
    console.error("Error al restablecer la contraseña:", error);
    return res.status(503).json({ ok: false, error: "No se pudo guardar el cambio. Reintentá desde el mismo enlace." });
  } finally {
    if (owner) {
      try { await liberarRecuperacion(token, owner); }
      catch (error) { console.error("Error al liberar bloqueo de recuperación:", error); }
    }
  }
}
