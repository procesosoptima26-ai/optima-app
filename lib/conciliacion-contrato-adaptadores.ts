/** Lectura (solo GET) de los módulos que tiene hoy una empresa en el campo viejo de Airtable. */
import { normalizarNombreModulo } from "../core/alta-usuarios.js";
import type { ModuloGestionable } from "../core/gestion-modulos.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
export type ModulosLegacy = { ok: true; activa: boolean; modulos: readonly ModuloGestionable[] } | { ok: false };

/**
 * Convierte las opciones del campo viejo a módulos. A diferencia del cambio de módulos, un informe
 * de lectura NO exige que figure CORE/USUARIO: solo exige que no haya opciones desconocidas.
 */
export function modulosDesdeCampoViejo(valor: unknown): readonly ModuloGestionable[] | null {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor) || !valor.every((v) => typeof v === "string")) return null;
  const salida = new Set<ModuloGestionable>();
  for (const opcion of valor as string[]) {
    const m = normalizarNombreModulo(opcion);
    if (m === null) return null;
    if (m !== "CORE") salida.add(m);
  }
  return [...salida];
}

export async function leerModulosLegacyEmpresa(recId: string): Promise<ModulosLegacy> {
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
  const tabla = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim() ?? "";
  const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
  if (!ID.test(recId) || !/^app[A-Za-z0-9]{14}$/.test(base) || !/^tbl[A-Za-z0-9]{14}$/.test(tabla) || !token) {
    console.error("[conciliacion-modulos] etapa=configuracion detalle=faltan variables de Airtable");
    return { ok: false };
  }
  const r = await fetch(`https://api.airtable.com/v0/${base}/${tabla}/${recId}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) { console.error(`[conciliacion-modulos] etapa=airtable detalle=http ${r.status}`); return { ok: false }; }
  const dato = await r.json() as { id?: string; fields?: Record<string, unknown> };
  if (dato.id !== recId || !dato.fields) { console.error("[conciliacion-modulos] etapa=airtable detalle=registro inválido"); return { ok: false }; }
  const modulos = modulosDesdeCampoViejo(dato.fields.MODULOS_CONTRATADOS);
  if (modulos === null) { console.error("[conciliacion-modulos] etapa=modulos detalle=opcion desconocida"); return { ok: false }; }
  return { ok: true, activa: dato.fields.ACTIVA === true, modulos };
}
