/**
 * OPTIMA - Compras sugeridas: armado de datos (lógica pura, sin red).
 *
 * Para qué sirve: junta lo que se leyó de Airtable (stock, productos, ventas)
 * en la lista que entiende el cálculo de compras, y traduce detalles propios
 * de Airtable (pack escrito como texto, fecha de creación en hora UTC).
 *
 * Qué soluciona: deja fuera de la red las reglas de armado, para probarlas a
 * fondo, y evita errores comunes (ej. "x6" como pack, ventas de la noche que
 * caen en otro día por la zona horaria).
 */
import { CORTES_POR_CAMBIO_DE_PRODUCTO, type ClaveSucursalCompras } from "./compras-cortes.js";
import { sinCerosIzquierda, type ProductoCompra, type VentaDiaria } from "./compras-sugeridas.js";
import type { LoteStock } from "./compras-vencimientos.js";

/** Datos de un producto tal como vienen del catálogo. */
export type ProductoCatalogoCompra = {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  proveedorIds: readonly string[];
  /** Texto crudo del campo "CANT. PACK" (el pack es del producto, igual para todas las sucursales). */
  packTexto: string | null;
};

/** Qué sucursal es (para los cortes por cambio de producto); null si no se reconoce. */
export function clavePackDeSucursal(nombreSucursal: string): ClaveSucursalCompras | null {
  const n = nombreSucursal.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (n.includes("BELLA")) return "BELLA";
  if (n.includes("GOYA")) return "GOYA";
  return null;
}

/** Un solo campo de pack para todas las sucursales: la caja del proveedor es la misma. */
export const CAMPO_PACK = "CANT. PACK";

/**
 * El pack se escribe a mano como texto ("6", "12", a veces "x6"). Se toma el
 * primer número positivo; si no hay uno válido devuelve null (y el cálculo usa 1 y avisa).
 */
export function interpretarPack(texto: string | null | undefined): number | null {
  if (texto === null || texto === undefined) return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(texto));
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Un producto discontinuado (ya no se compra más) se marca en Airtable escribiendo "-"
 * o la palabra "discontinuado" en el campo CANT. PACK. Un pack vacío, en cambio, significa
 * "todavía falta cargarlo".
 */
export function esDiscontinuado(texto: string | null | undefined): boolean {
  if (texto === null || texto === undefined) return false;
  const t = String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return /^[-–—]+$/.test(t) || /^discontinu/.test(t);
}

export type EntradaArmado = {
  catalogo: readonly ProductoCatalogoCompra[];
  /** Stock total de la sucursal por id de producto (suma de lotes). */
  stockPorProductoId: ReadonlyMap<string, number>;
  ventasPorProductoId: ReadonlyMap<string, readonly VentaDiaria[]>;
  /** Lotes de la sucursal por producto (con vencimiento). Opcional: sin esto todo el stock es vendible. */
  lotesPorProductoId?: ReadonlyMap<string, readonly LoteStock[]>;
  /** Nombre de cada proveedor por su id. */
  proveedorPorId: ReadonlyMap<string, string>;
  clavePack: ClaveSucursalCompras | null;
};

export function armarProductosCompra(entrada: EntradaArmado): ProductoCompra[] {
  const cortes = entrada.clavePack ? CORTES_POR_CAMBIO_DE_PRODUCTO[entrada.clavePack] : {};
  return entrada.catalogo.map((p) => {
    const proveedores = [...new Set(
      p.proveedorIds.map((id) => entrada.proveedorPorId.get(id)).filter((n): n is string => Boolean(n)),
    )].sort((a, b) => a.localeCompare(b, "es"));
    return {
      productoId: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      categoria: p.categoria,
      proveedores,
      multiplo: entrada.clavePack ? interpretarPack(p.packTexto) : null,
      discontinuado: entrada.clavePack ? esDiscontinuado(p.packTexto) : false,
      stock: entrada.stockPorProductoId.get(p.id) ?? 0,
      ventas: entrada.ventasPorProductoId.get(p.id) ?? [],
      lotes: entrada.lotesPorProductoId?.get(p.id),
      cortePorCambioDeProducto: cortes[sinCerosIzquierda(p.codigo)] ?? null,
    };
  });
}

/** Los últimos `n` días terminando en `hoy` (AAAA-MM-DD), del más viejo al más nuevo. */
export function diasDeVentana(hoy: string, n: number): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hoy);
  if (!m) throw new Error(`Fecha inválida: ${hoy}`);
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dias: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) dias.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  return dias;
}

/** Inicio (incluido) y fin (excluido) de un día argentino, como instantes ISO en UTC. */
export function limitesDiaUtc(dia: string): { desde: string; hasta: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) throw new Error(`Fecha inválida: ${dia}`);
  const inicio = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + 3 * 3_600_000;
  return { desde: new Date(inicio).toISOString(), hasta: new Date(inicio + 86_400_000).toISOString() };
}

/** Hoy en Argentina (AAAA-MM-DD) a partir de un instante. */
export function hoyArgentina(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Un producto es relevante para la sucursal si tiene stock o vendió en la ventana.
 * El pack ya no cuenta: como es el mismo para todas las sucursales, no indica que
 * la sucursal trabaje el producto, y haría aparecer cientos de productos de la otra.
 */
export function esRelevanteParaSucursal(p: ProductoCompra): boolean {
  return p.stock > 0 || p.ventas.length > 0;
}

/** Ventas de un día: sucursal (id Core) -> producto (id Airtable) -> cantidad. */
export type VentasDelDia = Record<string, Record<string, number>>;

export type RegistroVentaCruda = {
  productoIds: readonly string[];
  ubicacionOrigenIds: readonly string[];
  cantidad: number;
};

/**
 * Suma las ventas de un día por sucursal y producto. La sucursal se deduce de
 * la ubicación de origen; ventas sin ubicación reconocida se ignoran.
 */
export function agregarVentasDelDia(
  registros: readonly RegistroVentaCruda[],
  sucursalPorUbicacion: ReadonlyMap<string, string>,
): VentasDelDia {
  const salida: VentasDelDia = {};
  for (const r of registros) {
    if (!Number.isFinite(r.cantidad) || r.cantidad <= 0) continue;
    if (r.productoIds.length !== 1 || r.ubicacionOrigenIds.length !== 1) continue;
    const sucursalId = sucursalPorUbicacion.get(r.ubicacionOrigenIds[0]);
    if (!sucursalId) continue;
    const productos = (salida[sucursalId] ??= {});
    const id = r.productoIds[0];
    productos[id] = Math.round(((productos[id] ?? 0) + r.cantidad) * 1000) / 1000;
  }
  return salida;
}

/** Pasa las ventas por día de UNA sucursal a la forma que usa el cálculo. */
export function ventasPorProductoDeSucursal(
  porDia: ReadonlyMap<string, VentasDelDia>,
  sucursalId: string,
): Map<string, VentaDiaria[]> {
  const salida = new Map<string, VentaDiaria[]>();
  for (const dia of [...porDia.keys()].sort()) {
    const productos = porDia.get(dia)?.[sucursalId];
    if (!productos) continue;
    for (const [productoId, cantidad] of Object.entries(productos)) {
      const lista = salida.get(productoId) ?? [];
      lista.push({ fecha: dia, cantidad });
      salida.set(productoId, lista);
    }
  }
  return salida;
}
