/** OPTIMA — Punto 2. Alta/baja lógica de empleado (nunca DELETE).
 * Aislado: deshabilitado por defecto y siempre exige auditoría global.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { autenticarAdministrador, leerUsuario, airtableUsuarios } from "../../lib/usuarios-maestros.js";
import { revocarSesionesUsuario } from "../../lib/session.js";
import { leerEmpleadoEditable } from "../../core/edicion-usuarios.js";
import { snapshotAccesosEmpleado } from "../../core/snapshots-auditoria-core.js";
import { gestionEstadoHabilitada, proyectarEstadoEmpleado, reactivacionValida, validarSolicitudEstado } from "../../core/estado-usuarios.js";
import { ejecutarOperacionCoreAuditada, ErrorAuditoriaCore } from "../../lib/auditoria-core-transversal.js";
import { ErrorPuertaAuditoriaGlobal } from "../../lib/puerta-auditoria-core-global.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Método no permitido" });

  const admin = await autenticarAdministrador(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, habilitado: gestionEstadoHabilitada() });
  }
  if (!gestionEstadoHabilitada()) {
    return res.status(503).json({ ok: false,
      error: "Gestión de estado deshabilitada hasta validar la auditoría integral" });
  }

  const validacion = validarSolicitudEstado(req.body);
  if (!validacion.ok) return res.status(400).json({ ok: false, error: validacion.error });
  const { id, activo, version, motivo } = validacion.datos;
  try {
    const registro = await leerUsuario(id);
    const empleado = leerEmpleadoEditable(registro, admin.contexto.empresa.id,
      admin.contexto.usuarioId, admin.opciones);
    // Protege el propio admin, ADMIN ajenos y usuarios de otras empresas.
    if (!registro || !empleado)
      return res.status(403).json({ ok: false, error: "Cuenta fuera de tu alcance" });
    if (empleado.version !== version)
      return res.status(409).json({ ok: false, error: "El estado o los accesos cambiaron. Actualizá antes de guardar." });
    if (empleado.activo === activo)
      return res.status(409).json({ ok: false, error: "La cuenta ya tiene ese estado" });
    if (activo && !reactivacionValida(registro.fields)) {
      return res.status(409).json({ ok: false,
        error: "La cuenta no tiene una contraseña activa. Usá el circuito de invitación o recuperación." });
    }

    const proyectado = proyectarEstadoEmpleado(registro, empleado, activo);
    const operacion = await ejecutarOperacionCoreAuditada({
      actorId: admin.contexto.usuarioId,
      empresaId: admin.contexto.empresa.id,
      empresaNombre: admin.contexto.empresa.clave,
      accion: activo ? "USUARIO_ACTIVAR" : "USUARIO_DESACTIVAR",
      recursoTipo: "USUARIO", recursoId: id, motivo,
      anterior: snapshotAccesosEmpleado(empleado),
      propuesto: snapshotAccesosEmpleado(proyectado),
      escribir: async () => {
        const guardado = await airtableUsuarios("PATCH", "/" + id,
          { fields: { ACTIVO: activo }, typecast: false });
        if (guardado.id !== id || !guardado.fields || typeof guardado.fields !== "object")
          throw new Error("No se confirmó el estado de la cuenta");
      },
      releer: async () => {
        const verificacion = await leerUsuario(id);
        const vigente = leerEmpleadoEditable(verificacion, admin.contexto.empresa.id,
          admin.contexto.usuarioId, admin.opciones);
        if (!vigente) throw new Error("No se pudo comprobar el estado final");
        return { estado: snapshotAccesosEmpleado(vigente), dato: vigente };
      },
    });

    // Si el estado ya se confirmó pero falla Redis, NO reintentar a ciegas.
    try { await revocarSesionesUsuario(id); }
    catch (error) {
      console.error("No se pudo revocar la sesión del usuario", { id, operacionId: operacion.operacionId, error });
      return res.status(503).json({ ok: false, operacionId: operacion.operacionId,
        puedeEstarAplicado: true,
        error: "El estado se guardó, pero no se confirmó el cierre de sesiones. Revisá antes de reintentar." });
    }

    return res.status(200).json({ ok: true, empleado: operacion.dato,
      operacionId: operacion.operacionId,
      mensaje: activo ? "Empleado activado y sesiones previas revocadas" : "Empleado desactivado y sesiones revocadas" });
  } catch (error) {
    if (error instanceof ErrorPuertaAuditoriaGlobal) {
      const pendiente = error.codigo === "INCIDENCIAS" || error.codigo === "OCUPADA";
      return res.status(pendiente ? 409 : 503).json({ ok: false,
        error: pendiente ? "Existe una operación auditada pendiente; revisá el historial"
          : "No se pudo comprobar la protección de auditoría" });
    }
    if (error instanceof ErrorAuditoriaCore) {
      return res.status(503).json({ ok: false, operacionId: error.operacionId,
        puedeEstarAplicado: error.puedeEstarAplicado,
        error: "La auditoría no confirmó el cambio. Revisá antes de reintentar." });
    }
    console.error("Error en cambio de estado de usuario", error);
    return res.status(503).json({ ok: false,
      error: "No se pudo confirmar el estado. Comprobalo antes de reintentar." });
  }
}
