/** OPTIMA 12B.4.3 — consulta y conciliación manual de incidentes de módulos. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { leerTokenSesion, buscarSesion } from "../../lib/session.js";
import { leerAccesoPlataforma } from "../../core/acceso-plataforma.js";
import { leerEstadoModulos } from "../../core/gestion-modulos.js";
import { bloquearModulos, liberarModulos, renovarBloqueoModulos } from "../../lib/bloqueo-modulos.js";
import { analizarHistorialAuditoria, consultarHistorialAuditoriaEmpresa,
  ErrorConsultaAuditoria } from "../../lib/conciliacion-modulos.js";
import { diagnosticarOperacionPendiente, registrarResolucionConciliada,
  ErrorResolucionAuditoria } from "../../lib/resolucion-modulos-auditada.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Empresa = { id: string; fields: Record<string, unknown> };
function config() {
  const base = process.env.AIRTABLE_USERS_BASE_ID ?? "";
  const tabla = process.env.AIRTABLE_COMPANIES_TABLE_ID ?? "";
  const auditoria = process.env.AIRTABLE_AUDITORIA_TABLE_ID ?? "";
  const token = process.env.AIRTABLE_TOKEN ?? "";
  if (!/^app[A-Za-z0-9]{14}$/.test(base) || !/^tbl[A-Za-z0-9]{14}$/.test(tabla) ||
      !/^tbl[A-Za-z0-9]{14}$/.test(auditoria) || !token) throw new Error("CONFIG_INVALIDA");
  return { base, tabla, token };
}
async function consultarEmpresa(empresaId: string, cfg: ReturnType<typeof config>) {
  const r = await fetch(`https://api.airtable.com/v0/${cfg.base}/${cfg.tabla}/${empresaId}`, {
    method: "GET", headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("LECTURA_EMPRESA_FALLIDA");
  const dato = await r.json() as Empresa;
  if (!dato || dato.id !== empresaId || !dato.fields || typeof dato.fields !== "object" ||
      dato.fields.ACTIVA !== true || typeof dato.fields.NOMBRE_COMERCIAL !== "string" ||
      !dato.fields.NOMBRE_COMERCIAL.trim()) throw new Error("EMPRESA_INVALIDA");
  const estado = leerEstadoModulos(empresaId, true, dato.fields.MODULOS_CONTRATADOS);
  if (!estado.ok) throw new Error("MODULOS_INVALIDOS");
  return { estado: estado.estado, nombre: dato.fields.NOMBRE_COMERCIAL.trim() };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  const cookie = leerTokenSesion(req);
  if (!cookie) return res.status(401).json({ ok: false, error: "Iniciá sesión" });
  let owner: string | null = null, empresaId = "";
  try {
    const sesion = await buscarSesion(cookie);
    if (!sesion) return res.status(401).json({ ok: false, error: "Sesión vencida" });
    const admin = await leerAccesoPlataforma(sesion.usuarioId);
    if (!admin) return res.status(403).json({ ok: false, error: "Acceso exclusivo de OPTIMA" });
    const cuerpo = req.method === "POST" ? req.body : req.query;
    if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo))
      return res.status(400).json({ ok: false, error: "Solicitud inválida" });
    const permitidas = req.method === "POST"
      ? ["empresaId", "operacionId", "versionActual", "estadoDetectado", "motivo", "confirmacion"]
      : ["empresaId", "operacionId", "accion"];
    if (Object.keys(cuerpo).some(k => !permitidas.includes(k)))
      return res.status(400).json({ ok: false, error: "Campos no permitidos" });
    empresaId = cuerpo.empresaId;
    if (typeof empresaId !== "string" || !ID.test(empresaId) || empresaId === admin.empresaId)
      return res.status(400).json({ ok: false, error: "Empresa cliente inválida" });
    const operacionId = cuerpo.operacionId;
    if (operacionId !== undefined && (typeof operacionId !== "string" || !UUID.test(operacionId)))
      return res.status(400).json({ ok: false, error: "Identificador de operación inválido" });
    if (req.method === "POST") {
      if (process.env.OPTIMA_AUDIT_WRITES_ENABLED !== "true")
        return res.status(503).json({ ok: false, error: "Conciliación no habilitada" });
      if (typeof operacionId !== "string" || cuerpo.confirmacion !== "CONCILIAR" ||
          typeof cuerpo.versionActual !== "string" || !/^[a-f0-9]{64}$/.test(cuerpo.versionActual) ||
          (cuerpo.estadoDetectado !== "APLICADO" && cuerpo.estadoDetectado !== "NO_APLICADO") ||
          typeof cuerpo.motivo !== "string" || cuerpo.motivo.trim().length < 10 ||
          cuerpo.motivo.trim().length > 500)
        return res.status(400).json({ ok: false, error: "Confirmación de conciliación inválida" });
    }
    const cfg = config();
    // El mismo lock por empresa serializa conciliaciones y modificaciones comerciales.
    if (req.method === "POST") {
      owner = await bloquearModulos(empresaId);
      if (!owner) return res.status(409).json({ ok: false, error: "La empresa tiene otra operación en curso" });
    }
    const registros = await consultarHistorialAuditoriaEmpresa(empresaId);
    const historial = analizarHistorialAuditoria(empresaId, registros);
    if (historial.incidencias.some(i => i.operacionId === null))
      return res.status(409).json({ ok: false, error: "Historial corrupto: requiere revisión especializada" });
    if (operacionId === undefined) {
      return res.status(200).json({ ok: true, empresaId, bloqueada: historial.bloqueada,
        incidencias: historial.incidencias, operacionesAnalizadas: historial.operacionesAnalizadas });
    }
    const empresa = await consultarEmpresa(empresaId, cfg);
    const diagnostico = diagnosticarOperacionPendiente(empresaId, operacionId, registros, empresa.estado);
    if (req.method === "GET")
      return res.status(200).json({ ok: true, diagnostico, bloqueada: historial.bloqueada });
    if (cuerpo.versionActual !== diagnostico.versionActual ||
        cuerpo.estadoDetectado !== diagnostico.estadoDetectado)
      return res.status(409).json({ ok: false, error: "El estado cambió desde la vista previa. Actualizá y volvé a revisar" });
    // Segunda lectura y renovación del lock antes del único INSERT de conciliación.
    const nuevamente = await consultarEmpresa(empresaId, cfg);
    if (nuevamente.estado.version !== diagnostico.versionActual)
      return res.status(409).json({ ok: false, error: "La empresa cambió durante la conciliación" });
    if (!owner || !(await renovarBloqueoModulos(empresaId, owner)))
      return res.status(409).json({ ok: false, error: "Se perdió el bloqueo exclusivo. No se concilió" });
    const creado = await registrarResolucionConciliada(diagnostico,
      { usuarioId: admin.usuarioId, usuario: admin.usuario, tipo: "PLATAFORMA" },
      nuevamente.nombre, cuerpo.motivo.trim());
    // Sin confirmación de lectura, NO anunciar resolución ni hacer un segundo INSERT.
    const comprobacion = analizarHistorialAuditoria(empresaId, await consultarHistorialAuditoriaEmpresa(empresaId));
    if (comprobacion.incidencias.some(i => i.operacionId === operacionId))
      return res.status(503).json({ ok: false, operacionId,
        error: "El cierre no quedó verificado. No repitas la conciliación; revisá el historial" });
    return res.status(200).json({ ok: true, operacionId: creado.operacionId,
      estadoDetectado: diagnostico.estadoDetectado, empresaBloqueada: comprobacion.bloqueada,
      mensaje: "Conciliación registrada y verificada; no se modificaron módulos" });
  } catch (e) {
    if (e instanceof ErrorResolucionAuditoria) return res.status(409).json({ ok: false,
      error: "La operación no puede conciliarse automáticamente: " + e.codigo });
    if (e instanceof ErrorConsultaAuditoria) return res.status(503).json({ ok: false,
      error: "No se pudo verificar el historial de auditoría; no reintentes sin revisar" });
    console.error("12B.4.3: conciliación pendiente o falla", e instanceof Error ? e.name : "ERROR");
    return res.status(503).json({ ok: false,
      error: "Conciliación sin confirmar. Verificá el historial antes de cualquier reintento" });
  } finally {
    if (owner) {
      try { await liberarModulos(empresaId, owner); }
      catch (e) { console.error("12B.4.3: falló liberación de bloqueo", e); }
    }
  }
}
