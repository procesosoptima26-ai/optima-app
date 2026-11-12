/** Paso 10B — consulta y edición de accesos de empleados; identidad inmutable. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { autenticarAdministrador, leerUsuario, airtableUsuarios } from "../../lib/usuarios-maestros.js";
import { construirCambiosEmpleado, leerEmpleadoEditable } from "../../core/edicion-usuarios.js";
import { snapshotAccesosEmpleado } from "../../core/snapshots-auditoria-core.js";
import { auditoriaCoreExigida, ejecutarOperacionCoreAuditada,
  motivoAuditoriaCore, ErrorAuditoriaCore } from "../../lib/auditoria-core-transversal.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
function idValido(valor: unknown): valor is string {
  return typeof valor === "string" && ID.test(valor);
}

export async function detalleEmpleado(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const admin = await autenticarAdministrador(req, res);
  if (!admin) return;
  const id = req.query.id;
  if (!idValido(id)) return res.status(400).json({ ok: false, error: "Identificador inválido" });
  try {
    const registro = await leerUsuario(id);
    const detalle = leerEmpleadoEditable(registro, admin.contexto.empresa.id,
      admin.contexto.usuarioId, admin.opciones);
    if (!detalle) return res.status(403).json({ ok: false, error: "Empleado fuera de tu alcance o con configuración pendiente de revisión" });
    return res.status(200).json({ ok: true, empleado: detalle, opciones: admin.opciones });
  } catch (error) {
    console.error("Paso 10B: error leyendo empleado", error);
    return res.status(503).json({ ok: false, error: "No se pudo consultar al empleado" });
  }
}

export async function editarEmpleado(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const admin = await autenticarAdministrador(req, res);
  if (!admin) return;

  const id = req.body?.id;
  const version = req.body?.version;
  if (!idValido(id) || typeof version !== "string" || !/^[a-f0-9]{64}$/.test(version))
    return res.status(400).json({ ok: false, error: "Datos de edición inválidos" });

  // Nunca se aceptan cambios de empresa, rol, activo, nombre ni contraseña.
  const cambios = construirCambiosEmpleado(req.body, admin.opciones);
  if (!cambios.ok) return res.status(400).json({ ok: false, error: cambios.error });
  try {
    const registro = await leerUsuario(id);
    const detalle = leerEmpleadoEditable(registro, admin.contexto.empresa.id,
      admin.contexto.usuarioId, admin.opciones);
    if (!detalle) return res.status(403).json({ ok: false, error: "Empleado fuera de tu alcance o con configuración pendiente de revisión" });
    if (detalle.version !== version)
      return res.status(409).json({ ok: false, error: "Los accesos cambiaron. Actualizá el empleado antes de guardar." });

    if (auditoriaCoreExigida()) {
      const motivo = motivoAuditoriaCore(req.body?.motivo);
      if (!motivo) return res.status(400).json({ ok: false, error: "Indicá un motivo de al menos 10 caracteres" });
      const proyectado = leerEmpleadoEditable({ id, fields: { ...registro!.fields, ...cambios.campos } },
        admin.contexto.empresa.id, admin.contexto.usuarioId, admin.opciones);
      if (!proyectado) throw new Error("Propuesta de accesos inconsistente");
      const operacion = await ejecutarOperacionCoreAuditada({
        actorId: admin.contexto.usuarioId, empresaId: admin.contexto.empresa.id,
        empresaNombre: admin.contexto.empresa.clave,
        accion: "USUARIO_EDITAR_ACCESOS", recursoTipo: "USUARIO", recursoId: id,
        motivo, anterior: snapshotAccesosEmpleado(detalle),
        propuesto: snapshotAccesosEmpleado(proyectado),
        escribir: async () => {
          const r = await airtableUsuarios("PATCH", "/" + id, { fields: cambios.campos, typecast: false });
          if (r.id !== id || !r.fields || typeof r.fields !== "object") throw new Error("PATCH sin confirmar");
        },
        releer: async () => {
          const nuevoRegistro = await leerUsuario(id);
          const nuevo = leerEmpleadoEditable(nuevoRegistro, admin.contexto.empresa.id,
            admin.contexto.usuarioId, admin.opciones);
          if (!nuevo) throw new Error("Accesos no verificables");
          return { estado: snapshotAccesosEmpleado(nuevo), dato: nuevo };
        },
      });
      return res.status(200).json({ ok: true, empleado: operacion.dato,
        operacionId: operacion.operacionId, mensaje: "Accesos actualizados y auditados" });
    }
    const resultado = await airtableUsuarios("PATCH", "/" + id, { fields: cambios.campos, typecast: false });
    if (resultado.id !== id || !resultado.fields || typeof resultado.fields !== "object") {
      throw new Error("Airtable no confirmó la actualización de accesos");
    }
    const verificado = leerEmpleadoEditable(resultado as { id: string; fields: Record<string, unknown> },
      admin.contexto.empresa.id, admin.contexto.usuarioId, admin.opciones);
    if (!verificado) throw new Error("Airtable devolvió accesos inconsistentes");
    return res.status(200).json({ ok: true, empleado: verificado, mensaje: "Accesos actualizados" });
  } catch (error) {
    if (error instanceof ErrorAuditoriaCore) {
      console.error("Core: incidente de auditoría de accesos", { codigo: error.codigo, operacionId: error.operacionId });
      return res.status(503).json({ ok: false, operacionId: error.operacionId,
        puedeEstarAplicado: error.puedeEstarAplicado,
        error: "No se confirmó íntegramente la auditoría; revisá el historial antes de reintentar" });
    }
    console.error("Paso 10B: error actualizando accesos", error);
    return res.status(503).json({ ok: false, error: "No se pudo confirmar el guardado. Verificá el empleado antes de reintentar." });
  }
}
