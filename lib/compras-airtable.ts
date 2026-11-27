/**
 * OPTIMA - Compras sugeridas: lecturas de Airtable y caché en Redis (SOLO LECTURA de Airtable).
 *
 * Para qué sirve: trae el catálogo, el stock de la sucursal, los proveedores y
 * las ventas de cada día, y guarda las ventas de días cerrados en un caché.
 *
 * Qué soluciona: junta en un solo lugar toda la red de esta función. NO escribe
 * nada en Airtable: lo único que se guarda (en Redis) son totales de ventas por
 * día, que se pueden borrar sin consecuencias (se vuelven a calcular).
 */
import { configTablaOperativa, productoDeEmpresa } from "./alcance-operativo.js";
import { ejecutarRedisReal } from "./bloqueo-ventas.js";
import { CAMPO_PACK_POR_SUCURSAL, agregarVentasDelDia, limitesDiaUtc } from "./compras-datos.js";
import type { ProductoCatalogoCompra, VentasDelDia } from "./compras-datos.js";
import type { ClaveSucursalCompras } from "./compras-cortes.js";

type Registro = { id: string; fields: Record<string, unknown> };
type Respuesta = { records?: Registro[]; offset?: string };

const REGISTRO_ID = /^rec[A-Za-z0-9]{14}$/;
const MAX_PAGINAS = 300;
const SEGUNDOS_CACHE = 30 * 24 * 3600;
const VERSION_CACHE = "v1";

function variable(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Falta configurar la variable de entorno: ${nombre}`);
  return valor;
}

function texto(valor: unknown): string {
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number") return String(valor);
  if (Array.isArray(valor)) return valor.map(texto).filter(Boolean).join(", ");
  if (valor && typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    if (typeof o.name === "string") return o.name.trim();
    if (typeof o.text === "string") return o.text.trim();
  }
  return "";
}

function ids(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === "string" && REGISTRO_ID.test(v));
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Detalle corto y seguro de un error de Airtable (tipo y mensaje, nunca datos ni claves). */
async function detalleError(respuesta: { status: number; json(): Promise<unknown> }): Promise<string> {
  let tipo = "";
  try {
    const cuerpo = (await respuesta.json()) as { error?: unknown };
    const e = cuerpo?.error;
    if (typeof e === "string") tipo = e;
    else if (e && typeof e === "object") {
      const o = e as { type?: unknown; message?: unknown };
      tipo = [o.type, o.message].filter((x): x is string => typeof x === "string").join(": ");
    }
  } catch { /* sin detalle */ }
  return `${respuesta.status}${tipo ? ` (${tipo.slice(0, 160)})` : ""}`;
}

/** Pide una página; si Airtable responde "demasiados pedidos" (429) espera y reintenta. */
async function pedirPagina(url: string, token: string, etiqueta: string): Promise<Respuesta> {
  for (let intento = 0; intento < 4; intento++) {
    const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (respuesta.status === 429) {
      await esperar(1200 * (intento + 1));
      continue;
    }
    if (!respuesta.ok) throw new Error(`No se pudo consultar Airtable (${etiqueta}): ${await detalleError(respuesta)}`);
    const dato = (await respuesta.json()) as Respuesta;
    if (!dato || !Array.isArray(dato.records)) throw new Error(`Respuesta incompleta de Airtable (${etiqueta})`);
    return dato;
  }
  throw new Error(`Airtable está limitando los pedidos (${etiqueta}); reintentá en unos segundos`);
}

async function leerPaginas(url: URL, token: string, etiqueta: string, alRegistro: (r: Registro) => void): Promise<void> {
  let offset: string | undefined;
  const vistos = new Set<string>();
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    if (offset) url.searchParams.set("offset", offset);
    const dato = await pedirPagina(url.toString(), token, etiqueta);
    for (const r of dato.records ?? []) alRegistro(r);
    if (!dato.offset) return;
    if (vistos.has(dato.offset)) throw new Error(`Paginación inconsistente en Airtable (${etiqueta})`);
    vistos.add(dato.offset);
    offset = dato.offset;
  }
  throw new Error(`La consulta excedió el límite seguro de páginas (${etiqueta})`);
}

function urlTabla(baseId: string, tabla: string, campos: readonly string[]): URL {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tabla)}`);
  url.searchParams.set("pageSize", "100");
  for (const c of campos) url.searchParams.append("fields[]", c);
  return url;
}

/** Productos de la empresa, con el pack de la sucursal como texto. */
export async function leerCatalogoCompras(
  empresaId: string,
  clavePack: ClaveSucursalCompras | null,
): Promise<ProductoCatalogoCompra[]> {
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tabla = variable("AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME");
  const campoCodigo = variable("AIRTABLE_MOVIMIENTOS_CODE_FIELD");
  const campoPack = clavePack ? CAMPO_PACK_POR_SUCURSAL[clavePack] : null;
  const campos = [campoCodigo, "NOMBRE MASTER", "PROVEEDOR", "CATEGORÍA", "EMPRESA",
    ...(campoPack ? [campoPack] : [])];
  const salida: ProductoCatalogoCompra[] = [];
  await leerPaginas(urlTabla(baseId, tabla, campos), token, "productos", (r) => {
    if (!productoDeEmpresa(r.fields, empresaId)) return;
    const codigo = texto(r.fields[campoCodigo]);
    if (!codigo) return;
    salida.push({
      id: r.id,
      codigo,
      nombre: texto(r.fields["NOMBRE MASTER"]),
      categoria: texto(r.fields["CATEGORÍA"]) || null,
      proveedorIds: ids(r.fields.PROVEEDOR),
      packTexto: campoPack ? texto(r.fields[campoPack]) || null : null,
    });
  });
  return salida;
}

/** Nombre de cada proveedor por su id. Se pide por ID de campo (no por nombre) para evitar problemas con tildes. */
const CAMPO_NOMBRE_PROVEEDOR_ID = "fldD9hvw58fzPnJZf";

export async function leerProveedores(): Promise<Map<string, string>> {
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tabla = process.env.AIRTABLE_PROVEEDORES_TABLE_NAME?.trim() || "PROVEEDORES";
  const url = urlTabla(baseId, tabla, [CAMPO_NOMBRE_PROVEEDOR_ID]);
  url.searchParams.set("returnFieldsByFieldId", "true");
  const salida = new Map<string, string>();
  await leerPaginas(url, token, "proveedores", (r) => {
    const nombre = texto(r.fields[CAMPO_NOMBRE_PROVEEDOR_ID]);
    if (nombre) salida.set(r.id, nombre);
  });
  return salida;
}

/** Stock total por producto sumando las ubicaciones indicadas (solo lotes con cantidad > 0). */
export async function leerStockDeUbicaciones(ubicacionIds: ReadonlySet<string>): Promise<Map<string, number>> {
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tabla = variable("AIRTABLE_STOCK_LOTES_TABLE_NAME");
  const stock = new Map<string, number>();
  await leerPaginas(urlTabla(baseId, tabla, ["PRODUCTOS", "UBICACIÓN", "CANTIDAD_ACTUAL"]), token, "stock", (r) => {
    if (!ids(r.fields["UBICACIÓN"]).some((u) => ubicacionIds.has(u))) return;
    const cantidad = Number(r.fields.CANTIDAD_ACTUAL);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return;
    for (const p of ids(r.fields.PRODUCTOS)) {
      stock.set(p, Math.round(((stock.get(p) ?? 0) + cantidad) * 1000) / 1000);
    }
  });
  return stock;
}

/** Ventas de UN día argentino (todas las sucursales de la base), ya sumadas. */
export async function leerVentasDelDia(
  dia: string,
  sucursalPorUbicacion: ReadonlyMap<string, string>,
): Promise<VentasDelDia> {
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tabla = variable("AIRTABLE_MOVIMIENTOS_TABLE_NAME");
  const { desde, hasta } = limitesDiaUtc(dia); // fechas ISO generadas por nosotros: sin texto libre
  const desdeMenos1s = new Date(Date.parse(desde) - 1000).toISOString();
  const url = urlTabla(baseId, tabla, ["PRODUCTO", "CANTIDAD", "UBICACIÓN ORIGEN"]);
  url.searchParams.set(
    "filterByFormula",
    `AND({MOTIVO}="VENTA",IS_AFTER({FECHA_HORA},"${desdeMenos1s}"),IS_BEFORE({FECHA_HORA},"${hasta}"))`,
  );
  const crudos: Array<{ productoIds: string[]; ubicacionOrigenIds: string[]; cantidad: number }> = [];
  await leerPaginas(url, token, `ventas ${dia}`, (r) => {
    crudos.push({
      productoIds: ids(r.fields.PRODUCTO),
      ubicacionOrigenIds: ids(r.fields["UBICACIÓN ORIGEN"]),
      cantidad: Number(r.fields.CANTIDAD),
    });
  });
  return agregarVentasDelDia(crudos, sucursalPorUbicacion);
}

function claveCache(baseId: string, dia: string): string {
  return `optima:compras:ventas:${VERSION_CACHE}:${baseId}:${dia}`;
}

/** Ventas de días ya guardados en Redis (los que no estén simplemente no aparecen). */
export async function leerCacheVentas(dias: readonly string[]): Promise<Map<string, VentasDelDia>> {
  const { baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const salida = new Map<string, VentasDelDia>();
  if (dias.length === 0) return salida;
  const respuesta = await ejecutarRedisReal(["MGET", ...dias.map((d) => claveCache(baseId, d))]);
  if (!Array.isArray(respuesta)) return salida;
  respuesta.forEach((valor, i) => {
    if (typeof valor !== "string") return;
    try {
      const dato = JSON.parse(valor) as unknown;
      if (dato && typeof dato === "object" && !Array.isArray(dato)) salida.set(dias[i], dato as VentasDelDia);
    } catch { /* un dato dañado se ignora y se vuelve a calcular */ }
  });
  return salida;
}

export async function guardarCacheVentas(dia: string, datos: VentasDelDia): Promise<void> {
  const { baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  await ejecutarRedisReal(["SET", claveCache(baseId, dia), JSON.stringify(datos), "EX", SEGUNDOS_CACHE]);
}
