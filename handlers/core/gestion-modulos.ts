/** 11C.3 — API de cambios de habilitaciones, deshabilitada por defecto. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buscarSesion, leerTokenSesion } from "../../lib/session.js";
import { leerAccesoPlataforma } from "../../core/acceso-plataforma.js";
import { leerEstadoModulos, prepararCambioModulo } from "../../core/gestion-modulos.js";
import { bloquearModulos, liberarModulos } from "../../lib/bloqueo-modulos.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
type Registro = { id: string; fields: Record<string, unknown> };
function config() {
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim();
  const tabla = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim();
  const token = process.env.AIRTABLE_TOKEN?.trim();
  if (!base || !tabla || !token || !/^app[A-Za-z0-9]{14}$/.test(base) || !/^tbl[A-Za-z0-9]{14}$/.test(tabla))
    throw new Error("Base Maestra no configurada para cambios de módulos");
  return { base, tabla, token };
}
async function consultar(id: string, cfg: ReturnType<typeof config>): Promise<Registro> {
  const r = await fetch(`https://api.airtable.com/v0/${cfg.base}/${cfg.tabla}/${id}`, {
    method: "GET", headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (r.status === 404) throw new Error("Empresa no encontrada en Base Maestra");
  if (!r.ok) throw new Error(`No se pudo consultar empresa (${r.status})`);
  const dato = await r.json() as Registro;
  if (dato.id !== id || !dato.fields || typeof dato.fields !== "object")
    throw new Error("Empresa inválida en Base Maestra");
  return dato;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "PATCH") return res.status(405).json({ ok: false, error: "Método no permitido" });
  // Sin esta configuración no existen escrituras, incluso si el frontend fue manipulado.
  if (process.env.OPTIMA_MODULES_CHANGES_ENABLED !== "true")
    return res.status(503).json({ ok: false, error: "Gestión de módulos no habilitada" });
  const tokenSesion = leerTokenSesion(req);
  if (!tokenSesion) return res.status(401).json({ ok: false, error: "Iniciá sesión" });
  let owner: string | null = null;
  let empresaId = "";
  try {
    const sesion = await buscarSesion(tokenSesion);
    if (!sesion) return res.status(401).json({ ok: false, error: "Sesión vencida" });
    const admin = await leerAccesoPlataforma(sesion.usuarioId);
    if (!admin) return res.status(403).json({ ok: false, error: "Operación exclusiva de OPTIMA" });
    const cuerpo = req.body;
    if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo))
      return res.status(400).json({ ok: false, error: "Solicitud inválida" });
    const claves = Object.keys(cuerpo);
    if (claves.some(k => !["empresaId", "modulo", "accion", "version", "motivo"].includes(k)))
      return res.status(400).json({ ok: false, error: "La solicitud contiene campos no permitidos" });
    empresaId = cuerpo.empresaId;
    if (typeof empresaId !== "string" || !ID.test(empresaId) || empresaId === admin.empresaId)
      return res.status(400).json({ ok: false, error: "Empresa cliente inválida" });
    const motivo = cuerpo.motivo;
    if (typeof motivo !== "string" || motivo.trim().length < 10 || motivo.trim().length > 500 ||
        /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(motivo))
      return res.status(400).json({ ok: false, error: "Indicá un motivo de 10 a 500 caracteres" });
    if (typeof cuerpo.version !== "string" || !/^[a-f0-9]{64}$/.test(cuerpo.version))
      return res.status(400).json({ ok: false, error: "Versión de empresa inválida" });
    if (typeof cuerpo.modulo !== "string" || typeof cuerpo.accion !== "string")
      return res.status(400).json({ ok: false, error: "Módulo o acción inválidos" });
    const cfg = config();
    owner = await bloquearModulos(empresaId);
    if (!owner) return res.status(409).json({ ok: false, error: "Ya existe un cambio de módulos en proceso" });
    const actual = await consultar(empresaId, cfg);
    if (actual.fields.ACTIVA !== true)
      return res.status(409).json({ ok: false, error: "La empresa está inactiva" });
    const estado = leerEstadoModulos(empresaId, actual.fields.ACTIVA, actual.fields.MODULOS_CONTRATADOS);
    if (!estado.ok) return res.status(409).json({ ok: false, error: estado.error });
    if (cuerpo.version !== estado.estado.version)
      return res.status(409).json({ ok: false, error: "La configuración cambió; actualizá antes de guardar" });
    const cambio = prepararCambioModulo(estado.estado, cuerpo.modulo, cuerpo.accion);
    if (!cambio.ok) return res.status(409).json({ ok: false, error: cambio.error });
    // Segunda lectura inmediatamente antes de escribir. El bloqueo es por esta API;
    // no hay transacción atómica con ediciones externas de Airtable.
    const relectura = await consultar(empresaId, cfg);
    const comprobado = leerEstadoModulos(empresaId, relectura.fields.ACTIVA, relectura.fields.MODULOS_CONTRATADOS);
    if (!comprobado.ok || comprobado.estado.version !== estado.estado.version)
      return res.status(409).json({ ok: false, error: "Cambios simultáneos detectados; actualizá la consulta" });
    const r = await fetch(`https://api.airtable.com/v0/${cfg.base}/${cfg.tabla}/${empresaId}`, {
      method: "PATCH", headers: {
        Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json",
      }, body: JSON.stringify({ fields: { MODULOS_CONTRATADOS: cambio.opciones }, typecast: false }),
    });
    if (!r.ok) throw new Error(`Airtable rechazó cambio de módulos (${r.status})`);
    const respuesta = await r.json() as Registro;
    if (respuesta.id !== empresaId) throw new Error("Airtable no confirmó empresa de destino");
    const confirmado = await consultar(empresaId, cfg);
    const despues = leerEstadoModulos(empresaId, confirmado.fields.ACTIVA, confirmado.fields.MODULOS_CONTRATADOS);
    if (!despues.ok || JSON.stringify([...despues.estado.originales].sort()) !== JSON.stringify([...cambio.opciones].sort()))
      throw new Error("Cambio no confirmado; comprobar empresa antes de reintentar");
    // La auditoría permanente (actor, motivo, antes/después) se desarrolla en Paso 12.
    // No cambiar este gate a true antes de contar con ese registro.
    return res.status(200).json({ ok: true, empresaId, accion: cuerpo.accion,
      modulo: cuerpo.modulo, version: despues.estado.version,
      modulosHabilitados: despues.estado.modulos,
      mensaje: "Habilitaciones técnicas actualizadas" });
  } catch (error) {
    console.error("11C.3: fallo en cambio de módulos", error);
    return res.status(503).json({ ok: false, error: "No se pudo confirmar el cambio; revisá el estado antes de reintentar" });
  } finally {
    if (owner) {
      try { await liberarModulos(empresaId, owner); }
      catch (e) { console.error("11C.3: no se pudo liberar bloqueo", e); }
    }
  }
}
