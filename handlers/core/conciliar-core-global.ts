/**
 * OPTIMA — consulta global y conciliación manual de accesos y sucursales.
 * Sólo plataforma OPTIMA, por sesión verificada. Escrituras DESACTIVADAS por defecto.
 * No reintenta ni altera USUARIOS, SUCURSALES o credenciales: sólo AUDITORIA_EVENTOS.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { leerTokenSesion, buscarSesion } from "../../lib/session.js";
import { leerAccesoPlataforma } from "../../core/acceso-plataforma.js";
import { bloquearModulos, liberarModulos, renovarBloqueoModulos } from "../../lib/bloqueo-modulos.js";
import { analizarAuditoriaGlobal } from "../../lib/conciliacion-core-global.js";
import { consultarHistorialAuditoriaEmpresa } from "../../lib/conciliacion-modulos.js";
import { diagnosticarIncidenciaCore, registrarResolucionCore,
  ErrorResolucionCoreGlobal } from "../../lib/resolucion-core-global.js";
import { leerEstadoCoreParaConciliacion } from "../../lib/lectura-conciliacion-core.js";
import type { AccionConciliableCore } from "../../lib/conciliacion-core-global.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
function habilitado(): boolean {
  return process.env.OPTIMA_CORE_CONCILIACION_WRITES_ENABLED === "true" &&
    process.env.OPTIMA_AUDIT_WRITES_ENABLED === "true" &&
    process.env.OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED === "true" &&
    process.env.OPTIMA_CORE_AUDIT_ENFORCE_ENABLED === "true";
}
async function nombreEmpresa(empresaId: string): Promise<string> {
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
  const tabla = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim() ?? "";
  const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
  if (!/^app[A-Za-z0-9]{14}$/.test(base) || !/^tbl[A-Za-z0-9]{14}$/.test(tabla) || !token)
    throw new Error("CONFIG_INVALIDA");
  const r = await fetch(`https://api.airtable.com/v0/${base}/${tabla}/${empresaId}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("EMPRESA_NO_DISPONIBLE");
  const dato = await r.json() as { id?: unknown; fields?: { ACTIVA?: unknown; NOMBRE_COMERCIAL?: unknown } };
  if (!dato || dato.id !== empresaId || dato.fields?.ACTIVA !== true ||
      typeof dato.fields.NOMBRE_COMERCIAL !== "string" || !dato.fields.NOMBRE_COMERCIAL.trim())
    throw new Error("EMPRESA_INVALIDA");
  return dato.fields.NOMBRE_COMERCIAL.trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  const cookie = leerTokenSesion(req);
  if (!cookie) return res.status(401).json({ ok: false, error: "Iniciá sesión" });
  let empresaId = "";
  let owner: string | null = null;
  try {
    const sesion = await buscarSesion(cookie);
    if (!sesion) return res.status(401).json({ ok: false, error: "Sesión vencida" });
    const admin = await leerAccesoPlataforma(sesion.usuarioId);
    if (!admin) return res.status(403).json({ ok: false, error: "Acceso exclusivo de administración OPTIMA" });
    const datos = req.method === "GET" ? req.query : req.body;
    if (!datos || typeof datos !== "object" || Array.isArray(datos))
      return res.status(400).json({ ok: false, error: "Solicitud inválida" });
    const permitidas = req.method === "GET" ? ["accion", "empresaId", "operacionId"] :
      ["empresaId", "operacionId", "estadoDetectado", "huellaActual", "motivo", "confirmacion"];
    if (Object.keys(datos).some(k => !permitidas.includes(k)))
      return res.status(400).json({ ok: false, error: "Campos no permitidos" });
    empresaId = datos.empresaId;
    const operacionId = datos.operacionId;
    if (typeof empresaId !== "string" || !ID.test(empresaId) || empresaId === admin.empresaId ||
        (operacionId !== undefined && (typeof operacionId !== "string" || !UUID.test(operacionId))))
      return res.status(400).json({ ok: false, error: "Identificadores inválidos" });
    if (req.method === "POST") {
      if (!habilitado()) return res.status(503).json({ ok: false, error: "Conciliación del Core deshabilitada" });
      if (typeof operacionId !== "string" || datos.confirmacion !== "CONCILIAR_CORE" ||
          (datos.estadoDetectado !== "APLICADO" && datos.estadoDetectado !== "NO_APLICADO") ||
          typeof datos.huellaActual !== "string" || !HEX.test(datos.huellaActual) ||
          typeof datos.motivo !== "string" || datos.motivo.trim().length < 10 ||
          datos.motivo.trim().length > 500)
        return res.status(400).json({ ok: false, error: "Confirmación inválida" });
      owner = await bloquearModulos(empresaId);
      if (!owner) return res.status(409).json({ ok: false, error: "Otra operación está en curso" });
    }
    const empresaNombre = await nombreEmpresa(empresaId);
    const registros = await consultarHistorialAuditoriaEmpresa(empresaId);
    const informe = analizarAuditoriaGlobal(empresaId, registros);
    if (informe.incidencias.some(i => i.operacionId === null))
      return res.status(409).json({ ok: false, error: "Historial inválido. Revisión especializada obligatoria" });
    if (operacionId === undefined) {
      return res.status(200).json({ ok: true, empresaId, bloqueada: informe.bloqueada,
        operacionesCore: informe.operacionesCore, operacionesModulos: informe.operacionesModulos,
        incidencias: informe.incidencias });
    }
    const inicio = registros.find(r => r.fields.OPERACION_ID === operacionId && r.fields.RESULTADO === "INTENTO");
    if (!inicio || typeof inicio.fields.ACCION !== "string" ||
        typeof inicio.fields.RECURSO_ID !== "string")
      return res.status(409).json({ ok: false, error: "Operación no verificable" });
    const permitido = ["USUARIO_EDITAR_ACCESOS", "SUCURSAL_RENOMBRAR", "SUCURSAL_DESACTIVAR"];
    if (!permitido.includes(inicio.fields.ACCION))
      return res.status(409).json({ ok: false, operacionId, codigo: "VERIFICACION_EXTERNA",
        error: "Esta operación requiere conciliación especializada y evidencia externa; permanece bloqueada" });
    const lector = () => leerEstadoCoreParaConciliacion(empresaId,
      String(inicio.fields.RECURSO_ID), inicio.fields.ACCION as AccionConciliableCore);
    const actual = await lector();
    const diagnostico = diagnosticarIncidenciaCore(empresaId, operacionId, registros, actual);
    if (req.method === "GET") return res.status(200).json({ ok: true, operacionId,
      accion: diagnostico.accion, recursoId: diagnostico.recursoId,
      estadoDetectado: diagnostico.estadoDetectado, huellaActual: diagnostico.huellaActual,
      bloqueada: informe.bloqueada, soloConsulta: !habilitado() });
    if (datos.estadoDetectado !== diagnostico.estadoDetectado || datos.huellaActual !== diagnostico.huellaActual)
      return res.status(409).json({ ok: false, error: "El estado cambió. Volvé a consultar antes de conciliar" });
    // Segundo GET de historial/maestro BAJO bloqueo, antes del único INSERT.
    const registrosNuevos = await consultarHistorialAuditoriaEmpresa(empresaId);
    const comprobado = diagnosticarIncidenciaCore(empresaId, operacionId, registrosNuevos, await lector());
    if (comprobado.huellaActual !== diagnostico.huellaActual ||
        comprobado.estadoDetectado !== diagnostico.estadoDetectado ||
        !(await renovarBloqueoModulos(empresaId, owner!)))
      return res.status(409).json({ ok: false, error: "Estado o bloqueo cambió. No se concilió" });
    const resultado = await registrarResolucionCore(comprobado, {
      usuarioId: admin.usuarioId, usuario: admin.usuario, tipo: "PLATAFORMA",
    }, empresaNombre, datos.motivo.trim());
    // Si falta confirmación de lectura, NO reintentar el INSERT por la incertidumbre.
    const final = analizarAuditoriaGlobal(empresaId, await consultarHistorialAuditoriaEmpresa(empresaId));
    if (final.incidencias.some(i => i.operacionId === operacionId))
      return res.status(503).json({ ok: false, operacionId,
        error: "Conciliación sin confirmar. No reintentes; revisá el historial" });
    return res.status(200).json({ ok: true, operacionId: resultado.operacionId,
      estadoDetectado: comprobado.estadoDetectado, empresaBloqueada: final.bloqueada,
      mensaje: "Conciliación registrada y verificada, sin reejecutar el cambio" });
  } catch (error) {
    if (error instanceof ErrorResolucionCoreGlobal)
      return res.status(409).json({ ok: false, codigo: error.codigo,
        error: "No es seguro conciliar esta operación: " + error.codigo });
    console.error("Conciliación Core: verificación no confirmada", error instanceof Error ? error.name : "ERROR");
    return res.status(503).json({ ok: false,
      error: "No se pudo confirmar la conciliación. No repitas una escritura incierta" });
  } finally {
    if (owner) {
      try { await liberarModulos(empresaId, owner); }
      catch { console.error("Conciliación Core: no se pudo liberar bloqueo"); }
    }
  }
}
