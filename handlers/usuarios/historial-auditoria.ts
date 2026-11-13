/** Historial de auditoría de empresa: sólo ADMIN real con usuarios.gestionar.
 * No recibe empresaId del cliente; las consultas externas son exclusivamente GET.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { autenticarAdministrador } from "../../lib/usuarios-maestros.js";
import { idRegistroValido, proyectarEventoAuditoria } from "../../core/historial-auditoria-seguro.js";

const BASE = /^app[A-Za-z0-9]{14}$/;
const TABLE = /^tbl[A-Za-z0-9]{14}$/;
const CURSOR = /^[A-Za-z0-9+/=_-]{1,400}$/;
const FIELDS = ["EMPRESA_ID", "OPERACION_ID", "FECHA_HORA_UTC", "ACTOR_USUARIO", "ACCION",
  "MODULO", "RECURSO_TIPO", "RECURSO_ID", "RESULTADO", "ORIGEN", "MOTIVO", "DETALLE",
  "ESTADO_ANTERIOR", "ESTADO_NUEVO"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const admin = await autenticarAdministrador(req, res);
  if (!admin) return;
  const cursorEntrada = req.query?.cursor;
  if (Object.keys(req.query ?? {}).some(k => !["accion", "cursor"].includes(k)) ||
      (cursorEntrada !== undefined && (typeof cursorEntrada !== "string" || !CURSOR.test(cursorEntrada)))) {
    return res.status(400).json({ ok: false, error: "Parámetros no permitidos" });
  }
  try {
    const base = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
    const table = process.env.AIRTABLE_AUDITORIA_TABLE_ID?.trim() ?? "";
    const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
    const empresaId = admin.contexto.empresa.id;
    if (!BASE.test(base) || !TABLE.test(table) || !token || !idRegistroValido(empresaId))
      return res.status(503).json({ ok: false, error: "Historial de auditoría no configurado" });
    const params = new URLSearchParams({ pageSize: "50", maxRecords: "50",
      filterByFormula: `{EMPRESA_ID}="${empresaId}"` });
    params.set("sort[0][field]", "FECHA_HORA_UTC");
    params.set("sort[0][direction]", "desc");
    for (const field of FIELDS) params.append("fields[]", field);
    if (typeof cursorEntrada === "string") params.set("offset", cursorEntrada);
    const url = `https://api.airtable.com/v0/${base}/${table}?${params.toString()}`;
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Lectura de auditoría falló (${response.status})`);
    const raw = await response.json() as { records?: unknown[]; offset?: unknown };
    if (!Array.isArray(raw.records) || raw.records.length > 50) throw new Error("Listado inválido");
    const eventos = raw.records.map(r => proyectarEventoAuditoria(r, empresaId));
    // Un registro que no coincida NO se oculta silenciosamente: se niega todo el resultado.
    if (eventos.some(e => !e)) throw new Error("Historial inconsistente");
    const cursor = raw.offset === undefined ? null : raw.offset;
    if (cursor !== null && (typeof cursor !== "string" || !CURSOR.test(cursor) || cursor === cursorEntrada))
      throw new Error("Paginación inválida");
    return res.status(200).json({ ok: true, eventos, siguienteCursor: cursor });
  } catch (error) {
    console.error("Historial Core no disponible", error instanceof Error ? error.name : "ERROR");
    return res.status(503).json({ ok: false, error: "No se pudo consultar el historial de auditoría" });
  }
}
