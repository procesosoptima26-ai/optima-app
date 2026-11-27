/**
 * OPTIMA - Compras sugeridas (lógica pura, solo lectura).
 *
 * Para qué sirve: dado el stock actual de UNA sucursal, lo que se vendió en
 * los últimos días y los datos del producto (proveedor, pack, categoría),
 * calcula cuánto conviene comprar de cada producto.
 *
 * Qué soluciona: concentra todas las reglas de compra en un solo lugar sin
 * tocar Airtable ni el stock, así se pueden probar a fondo. La pantalla y el
 * Excel solo muestran lo que esta función devuelve.
 *
 * Reglas (acordadas con Antonella, 27-11-2026):
 * - Venta diaria = ventas de los últimos 60 días / días de esa ventana.
 * - Si el código cambió de producto (código reutilizado), solo cuentan las
 *   ventas desde la fecha de corte.
 * - Objetivo = venta diaria × días de cobertura × factor de temporada.
 * - Sugerido = objetivo − stock, redondeado HACIA ARRIBA al pack de compra.
 * - Sin ventas recientes y sin stock: se sugiere un pack, marcado como tal,
 *   para que no se pase por alto un producto que se dejó de reponer.
 * - Se excluyen bolsas y productos "Ocupado".
 */

export const VENTANA_DIAS = 60;
export const COBERTURA_GENERAL_DIAS = 15;

/** Códigos que no son mercadería comprable (bolsas). Se compara sin ceros a la izquierda. */
export const CODIGOS_EXCLUIDOS_POR_DEFECTO: readonly string[] = ["10002", "10004"];
/** Cualquier producto cuyo nombre diga "Ocupado" es un código reservado, no mercadería. */
export const NOMBRE_EXCLUIDO = /ocupad/i;

export type VentaDiaria = {
  /** Fecha de la venta, AAAA-MM-DD. */
  fecha: string;
  cantidad: number;
};

export type ProductoCompra = {
  productoId: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  proveedores: readonly string[];
  /** Pack o bulto mínimo de compra. Si falta o es inválido se usa 1 y se avisa. */
  multiplo: number | null;
  /** Stock actual sumado de todas las ubicaciones de la sucursal. */
  stock: number;
  /** Ventas de la sucursal. Se puede pasar más historia que la ventana: la función filtra. */
  ventas: readonly VentaDiaria[];
  /** Código reutilizado: solo cuentan las ventas desde esta fecha (AAAA-MM-DD). */
  cortePorCambioDeProducto?: string | null;
};

export type ParametrosCompra = {
  /** Fecha de hoy, AAAA-MM-DD. Se pasa de afuera para poder probar. */
  hoy: string;
  ventanaDias?: number;
  /** Días de cobertura por categoría; lo que no figura usa `coberturaGeneralDias`. */
  coberturaPorCategoria?: Readonly<Record<string, number>>;
  coberturaGeneralDias?: number;
  /** Factor de temporada por categoría (1 = normal); `factorGeneral` para el resto. */
  factorPorCategoria?: Readonly<Record<string, number>>;
  factorGeneral?: number;
  codigosExcluidos?: readonly string[];
};

export type AvisoCompra =
  | "SIN_VENTAS_RECIENTES"
  | "VENTAS_EN_BAJA"
  | "SIN_PACK_CARGADO"
  | "SIN_PROVEEDOR"
  | "CODIGO_REUTILIZADO";

export type ItemCompra = {
  productoId: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  proveedores: readonly string[];
  stock: number;
  ventaDiaria: number;
  /** Cuántos días alcanza el stock al ritmo actual; null si no hay ventas. */
  diasAlcanza: number | null;
  /** Días desde la última venta dentro de la historia recibida; null si no hubo. */
  diasSinVender: number | null;
  coberturaDias: number;
  factorTemporada: number;
  multiplo: number;
  objetivo: number;
  /** Unidades a comprar (múltiplo del pack); 0 si no hace falta. */
  sugerido: number;
  avisos: readonly AvisoCompra[];
};

export type ResultadoCompras = {
  items: ItemCompra[];
  /** Productos excluidos (bolsas, "Ocupado"), para poder mostrar cuántos fueron. */
  excluidos: number;
};

const MS_DIA = 86_400_000;

function aDia(fecha: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) throw new Error(`Fecha inválida: ${fecha}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_DIA;
}

export function sinCerosIzquierda(codigo: string): string {
  const limpio = String(codigo).trim();
  return limpio.replace(/^0+/, "") || "0";
}

function redondear(n: number, decimales = 3): number {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

/** Redondea hacia arriba al pack, tolerando errores de coma flotante (2.0000001 no sube un pack). */
export function redondearAlPack(necesidad: number, multiplo: number): number {
  if (necesidad <= 0) return 0;
  const packs = Math.ceil(redondear(necesidad / multiplo, 6));
  return packs * multiplo;
}

function ventasEnRango(ventas: readonly VentaDiaria[], desde: number, hasta: number): number {
  let total = 0;
  for (const v of ventas) {
    const d = aDia(v.fecha);
    if (d >= desde && d <= hasta && v.cantidad > 0) total += v.cantidad;
  }
  return total;
}

export function calcularComprasSugeridas(
  productos: readonly ProductoCompra[],
  parametros: ParametrosCompra
): ResultadoCompras {
  const ventana = parametros.ventanaDias ?? VENTANA_DIAS;
  const coberturaGeneral = parametros.coberturaGeneralDias ?? COBERTURA_GENERAL_DIAS;
  const factorGeneral = parametros.factorGeneral ?? 1;
  const excluidosSet = new Set(
    (parametros.codigosExcluidos ?? CODIGOS_EXCLUIDOS_POR_DEFECTO).map(sinCerosIzquierda)
  );
  const hoy = aDia(parametros.hoy);
  const inicioVentana = hoy - ventana + 1;

  const items: ItemCompra[] = [];
  let excluidos = 0;

  for (const p of productos) {
    if (excluidosSet.has(sinCerosIzquierda(p.codigo)) || NOMBRE_EXCLUIDO.test(p.nombre)) {
      excluidos += 1;
      continue;
    }

    const avisos: AvisoCompra[] = [];
    const corte = p.cortePorCambioDeProducto ? aDia(p.cortePorCambioDeProducto) : null;
    const desde = corte !== null ? Math.max(inicioVentana, corte) : inicioVentana;
    const diasEfectivos = Math.max(1, hoy - desde + 1);
    if (corte !== null) avisos.push("CODIGO_REUTILIZADO");

    const unidades = ventasEnRango(p.ventas, desde, hoy);
    const ventaDiaria = unidades / diasEfectivos;

    // Última venta (entre toda la historia recibida) para saber hace cuánto no se vende.
    let ultima: number | null = null;
    for (const v of p.ventas) {
      if (v.cantidad <= 0) continue;
      const d = aDia(v.fecha);
      if (d <= hoy && (corte === null || d >= corte) && (ultima === null || d > ultima)) ultima = d;
    }
    const diasSinVender = ultima === null ? null : hoy - ultima;

    // Ventas en baja: la última mitad de la ventana vende menos de la mitad que la primera.
    if (diasEfectivos >= 30) {
      const mitad = Math.floor(diasEfectivos / 2);
      const primera = ventasEnRango(p.ventas, desde, desde + mitad - 1);
      const segunda = ventasEnRango(p.ventas, desde + mitad, hoy);
      if (primera > 0 && segunda < primera * 0.5) avisos.push("VENTAS_EN_BAJA");
    }

    const categoria = p.categoria;
    const coberturaDias = (categoria ? parametros.coberturaPorCategoria?.[categoria] : undefined) || coberturaGeneral;
    const factorTemporada = (categoria ? parametros.factorPorCategoria?.[categoria] : undefined) ?? factorGeneral;

    const multiploValido = Number.isFinite(p.multiplo) && (p.multiplo as number) > 0;
    const multiplo = multiploValido ? (p.multiplo as number) : 1;
    if (!multiploValido) avisos.push("SIN_PACK_CARGADO");
    if (p.proveedores.length === 0) avisos.push("SIN_PROVEEDOR");

    const stock = Math.max(0, p.stock);
    const objetivo = ventaDiaria * coberturaDias * factorTemporada;
    let sugerido = redondearAlPack(redondear(objetivo - stock), multiplo);
    const diasAlcanza = ventaDiaria > 0 ? redondear(stock / ventaDiaria, 1) : null;

    if (unidades === 0) {
      avisos.push("SIN_VENTAS_RECIENTES");
      // Sin ventas y sin stock: se sugiere un pack para no perder de vista el producto.
      if (stock <= 0) sugerido = multiplo;
    }

    items.push({
      productoId: p.productoId,
      codigo: p.codigo,
      nombre: p.nombre,
      categoria,
      proveedores: p.proveedores,
      stock: redondear(stock),
      ventaDiaria: redondear(ventaDiaria),
      diasAlcanza,
      diasSinVender,
      coberturaDias,
      factorTemporada,
      multiplo,
      objetivo: redondear(objetivo),
      sugerido,
      avisos
    });
  }

  items.sort(ordenUrgencia);
  return { items, excluidos };
}

/**
 * Orden de la lista: primero lo más urgente (menos días de stock).
 * Los productos sin ventas recientes van después de los que sí rotan.
 */
export function ordenUrgencia(a: ItemCompra, b: ItemCompra): number {
  const sa = a.diasAlcanza === null ? Number.POSITIVE_INFINITY : a.diasAlcanza;
  const sb = b.diasAlcanza === null ? Number.POSITIVE_INFINITY : b.diasAlcanza;
  if (sa !== sb) return sa - sb;
  // Empate (p. ej. varios sin ventas): primero los que no tienen stock.
  if (a.stock !== b.stock) return a.stock - b.stock;
  return a.nombre.localeCompare(b.nombre, "es");
}

export type GrupoProveedor = {
  proveedor: string;
  items: ItemCompra[];
};

/**
 * Agrupa por proveedor para armar el pedido. Un producto con varios proveedores
 * aparece en cada uno (hasta que haya comparación de costos). Solo entran los
 * que hay que comprar (sugerido > 0). Si se pasa `proveedor`, devuelve solo ese.
 */
export function agruparPorProveedor(
  items: readonly ItemCompra[],
  proveedor?: string | null
): GrupoProveedor[] {
  const grupos = new Map<string, ItemCompra[]>();
  for (const item of items) {
    if (item.sugerido <= 0) continue;
    const nombres = item.proveedores.length > 0 ? item.proveedores : ["(sin proveedor)"];
    for (const nombre of nombres) {
      if (proveedor && nombre !== proveedor) continue;
      const lista = grupos.get(nombre) ?? [];
      lista.push(item);
      grupos.set(nombre, lista);
    }
  }
  return [...grupos.entries()]
    .sort((x, y) => x[0].localeCompare(y[0], "es"))
    .map(([nombre, lista]) => ({ proveedor: nombre, items: lista }));
}
