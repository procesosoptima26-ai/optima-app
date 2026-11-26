/**
 * OPTIMA - Lecturas de Airtable para "Ventas por archivo" (SOLO LECTURA).
 *
 * Para qué sirve: traer lo que el plan necesita (productos por código, stock
 * de la ubicación de venta y qué ya se cargó desde el mismo archivo).
 *
 * Qué soluciona: aísla las consultas a Airtable en un solo archivo. Estas
 * funciones NO escriben nada: la carga real de movimientos usa el camino que
 * ya existe en api/movimientos.ts, con todas sus validaciones.
 */
import { configTablaOperativa, productoDeEmpresa } from "./alcance-operativo.js";
import type { ProductoCatalogo } from "./ventas-archivo-plan.js";

type RegistroAirtable = { id: string; fields: Record<string, unknown> };
type RespuestaAirtable = { records?: RegistroAirtable[]; offset?: string };

const MAX_PAGINAS = 200;
const CODIGOS_POR_CONSULTA = 30;
const REGISTRO_ID = /^rec[A-Za-z0-9]{14}$/;

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
    if (typeof o.value === "string") return o.value.trim();
  }
  return "";
}

function idsVinculados(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const ids: string[] = [];
  for (const item of valor) {
    if (typeof item === "string" && REGISTRO_ID.test(item)) ids.push(item);
    else if (item && typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      REGISTRO_ID.test((item as { id: string }).id)) ids.push((item as { id: string }).id);
  }
  return ids;
}

async function leerPaginas(
  url: URL,
  token: string,
  alRegistro: (registro: RegistroAirtable) => void,
): Promise<void> {
  let offset: string | undefined;
  const vistos = new Set<string>();
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    if (offset) url.searchParams.set("offset", offset);
    const respuesta = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!respuesta.ok) throw new Error("No se pudo consultar Airtable");
    const dato = (await respuesta.json()) as RespuestaAirtable;
    if (!dato || !Array.isArray(dato.records)) {
      throw new Error("Respuesta incompleta de Airtable");
    }
    for (const registro of dato.records) alRegistro(registro);
    if (!dato.offset) return;
    if (vistos.has(dato.offset)) throw new Error("Paginación inconsistente en Airtable");
    vistos.add(dato.offset);
    offset = dato.offset;
  }
  throw new Error("La consulta excedió el límite seguro de páginas");
}

export type ProductosPorCodigo = {
  productos: Map<string, ProductoCatalogo>;
  codigosDeOtraEmpresa: Set<string>;
};

/** Busca los códigos en el catálogo, en tandas, y separa los de la empresa y los ajenos. */
export async function buscarProductosPorCodigos(
  codigos: readonly string[],
  empresaId: string,
): Promise<ProductosPorCodigo> {
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tabla = variable("AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME");
  const campoCodigo = variable("AIRTABLE_MOVIMIENTOS_CODE_FIELD");
  const campoNombre = variable("AIRTABLE_MOVIMIENTOS_NAME_FIELD");

  const productos = new Map<string, ProductoCatalogo>();
  const ajenos = new Set<string>();

  const unicos = [...new Set(codigos)];
  for (let i = 0; i < unicos.length; i += CODIGOS_POR_CONSULTA) {
    const grupo = unicos.slice(i, i + CODIGOS_POR_CONSULTA);
    for (const c of grupo) {
      // Solo dígitos: se arma una fórmula de Airtable, nunca texto libre.
      if (!/^\d{1,20}$/.test(c)) throw new Error("Código inválido");
    }
    const formula = `OR(${grupo.map((c) => `{${campoCodigo}}=${Number(c)}`).join(",")})`;
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tabla)}`);
    url.searchParams.set("filterByFormula", formula);
    url.searchParams.set("pageSize", "100");

    await leerPaginas(url, token, (registro) => {
      const codigo = texto(registro.fields[campoCodigo]).replace(/^0+(?=\d)/, "");
      if (!codigo) return;
      if (productoDeEmpresa(registro.fields, empresaId)) {
        if (!productos.has(codigo)) {
          productos.set(codigo, {
            id: registro.id,
            nombre: texto(registro.fields[campoNombre]) ||
              texto(registro.fields["NOMBRE MASTER"]) ||
              texto(registro.fields.PRODUCTO),
          });
        }
      } else {
        ajenos.add(codigo);
      }
    });
  }
  // Si el código existe en la empresa, no se considera ajeno.
  for (const c of productos.keys()) ajenos.delete(c);
  return { productos, codigosDeOtraEmpresa: ajenos };
}

/** Stock total disponible por producto en UNA ubicación (suma de lotes con cantidad > 0). */
export async function leerStockPorProductoEnUbicacion(
  ubicacionId: string,
): Promise<Map<string, number>> {
  if (!REGISTRO_ID.test(ubicacionId)) throw new Error("Ubicación inválida");
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tabla = variable("AIRTABLE_STOCK_LOTES_TABLE_NAME");

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tabla)}`);
  url.searchParams.set("pageSize", "100");
  for (const campo of ["PRODUCTOS", "UBICACIÓN", "CANTIDAD_ACTUAL"]) {
    url.searchParams.append("fields[]", campo);
  }

  const stock = new Map<string, number>();
  await leerPaginas(url, token, (registro) => {
    if (!idsVinculados(registro.fields["UBICACIÓN"]).includes(ubicacionId)) return;
    const cantidad = Number(registro.fields.CANTIDAD_ACTUAL);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return;
    for (const productoId of idsVinculados(registro.fields.PRODUCTOS)) {
      stock.set(productoId, Math.round(((stock.get(productoId) ?? 0) + cantidad) * 1000) / 1000);
    }
  });
  return stock;
}

/** Productos que ya tienen una VENTA cargada con esta etiqueta de archivo. */
export async function leerProductosYaCargados(etiqueta: string): Promise<Set<string>> {
  if (/["\\\u0000-\u001f]/.test(etiqueta)) throw new Error("Etiqueta inválida");
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tabla = variable("AIRTABLE_MOVIMIENTOS_TABLE_NAME");

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tabla)}`);
  url.searchParams.set("pageSize", "100");
  url.searchParams.set(
    "filterByFormula",
    `AND({OBSERVACIONES}="${etiqueta}",{MOTIVO}="VENTA")`,
  );
  url.searchParams.append("fields[]", "PRODUCTO");
  url.searchParams.append("fields[]", "ERROR_MOTOR");

  const productos = new Set<string>();
  await leerPaginas(url, token, (registro) => {
    // Una venta que el motor rechazó con error NO cuenta como cargada.
    if (texto(registro.fields.ERROR_MOTOR)) return;
    for (const id of idsVinculados(registro.fields.PRODUCTO)) productos.add(id);
  });
  return productos;
}

export type ResultadoVentas = {
  total: number;
  procesadas: number;
  pendientes: number;
  conError: Array<{ nombre: string; cantidad: number; error: string }>;
};

/** Cómo le fue al motor con las ventas cargadas desde un archivo (solo lectura). */
export async function leerResultadoVentas(etiqueta: string): Promise<ResultadoVentas> {
  if (/["\\\u0000-\u001f]/.test(etiqueta)) throw new Error("Etiqueta inválida");
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tabla = variable("AIRTABLE_MOVIMIENTOS_TABLE_NAME");

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tabla)}`);
  url.searchParams.set("pageSize", "100");
  url.searchParams.set(
    "filterByFormula",
    `AND({OBSERVACIONES}="${etiqueta}",{MOTIVO}="VENTA")`,
  );
  for (const campo of ["NOMBRE_MÁSTER", "CANTIDAD", "PROCESADO", "ERROR_MOTOR"]) {
    url.searchParams.append("fields[]", campo);
  }

  const resultado: ResultadoVentas = { total: 0, procesadas: 0, pendientes: 0, conError: [] };
  await leerPaginas(url, token, (registro) => {
    resultado.total += 1;
    const error = texto(registro.fields.ERROR_MOTOR);
    if (error) {
      resultado.conError.push({
        nombre: texto(registro.fields["NOMBRE_MÁSTER"]),
        cantidad: Number(registro.fields.CANTIDAD) || 0,
        error: error.slice(0, 300),
      });
    } else if (registro.fields.PROCESADO === true) {
      resultado.procesadas += 1;
    } else {
      resultado.pendientes += 1;
    }
  });
  return resultado;
}
