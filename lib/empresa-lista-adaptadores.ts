/** Lecturas (solo GET) para el chequeo "empresa lista". No modifican nada. */
const ID = /^rec[A-Za-z0-9]{14}$/;
type Registro = { id: string; fields: Record<string, unknown> };

function cfg() {
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
  const tabla = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim() ?? "";
  const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
  if (!/^app[A-Za-z0-9]{14}$/.test(base) || !/^tbl[A-Za-z0-9]{14}$/.test(tabla) || !token) throw new Error("Base Maestra no configurada");
  return { base, tabla, token };
}

export type FichaEmpresa = Readonly<{ activa: boolean; idEstableCrudo: unknown; opcionesModulos: unknown }>;

export async function leerFichaEmpresa(recId: string): Promise<FichaEmpresa | null> {
  if (!ID.test(recId)) return null;
  const c = cfg();
  const r = await fetch(`https://api.airtable.com/v0/${c.base}/${c.tabla}/${recId}`,
    { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) { console.error(`[empresa-lista] etapa=ficha detalle=http ${r.status}`); return null; }
  const reg = await r.json() as Registro;
  if (reg.id !== recId || !reg.fields) return null;
  return { activa: reg.fields.ACTIVA === true, idEstableCrudo: reg.fields.ID_EMPRESA_ESTABLE, opcionesModulos: reg.fields.MODULOS_CONTRATADOS };
}

/** Cuántas OTRAS empresas (distinto rec) tienen el mismo ID estable. null si no se pudo comprobar. */
export async function contarOtrasEmpresasConId(idEstable: string, recId: string): Promise<number | null> {
  try {
    const c = cfg();
    let offset: string | undefined; let repetidas = 0;
    for (let i = 0; i < 20; i++) {
      const q = new URLSearchParams({ pageSize: "100" });
      q.append("fields[]", "ID_EMPRESA_ESTABLE");
      if (offset) q.set("offset", offset);
      const r = await fetch(`https://api.airtable.com/v0/${c.base}/${c.tabla}?${q}`,
        { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const cuerpo = await r.json() as { records?: Registro[]; offset?: unknown };
      if (!Array.isArray(cuerpo.records)) return null;
      for (const reg of cuerpo.records) {
        const v = reg?.fields?.ID_EMPRESA_ESTABLE;
        if (reg.id !== recId && typeof v === "string" && v.trim() === idEstable) repetidas++;
      }
      if (typeof cuerpo.offset !== "string") return repetidas;
      offset = cuerpo.offset;
    }
    return null;
  } catch { return null; }
}
