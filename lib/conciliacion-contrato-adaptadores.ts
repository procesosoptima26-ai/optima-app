/** Lectura (solo GET) de los módulos que tiene hoy una empresa en el campo viejo de Airtable. */
import { leerEstadoModulos } from "../core/gestion-modulos.js";
import type { ModuloGestionable } from "../core/gestion-modulos.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
export type ModulosLegacy = { ok: true; activa: boolean; modulos: readonly ModuloGestionable[] } | { ok: false };

export async function leerModulosLegacyEmpresa(recId: string): Promise<ModulosLegacy> {
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
  const tabla = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim() ?? "";
  const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
  if (!ID.test(recId) || !/^app[A-Za-z0-9]{14}$/.test(base) || !/^tbl[A-Za-z0-9]{14}$/.test(tabla) || !token) return { ok: false };
  const r = await fetch(`https://api.airtable.com/v0/${base}/${tabla}/${recId}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { ok: false };
  const dato = await r.json() as { id?: string; fields?: Record<string, unknown> };
  if (dato.id !== recId || !dato.fields) return { ok: false };
  const estado = leerEstadoModulos(recId, dato.fields.ACTIVA === true, dato.fields.MODULOS_CONTRATADOS);
  if (!estado.ok) return { ok: false };
  return { ok: true, activa: dato.fields.ACTIVA === true, modulos: estado.estado.modulos };
}
