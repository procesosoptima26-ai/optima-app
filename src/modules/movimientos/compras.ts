/**
 * Compras sugeridas: lógica de la pantalla (pura, sin red).
 * Para qué sirve: filtrar la lista por proveedor, agrupar el pedido por proveedor,
 * traducir los avisos a texto claro y armar el archivo para Excel.
 * Qué soluciona: poder probar estas reglas sin abrir la aplicación.
 */

export type AvisoCompra =
  | "SIN_VENTAS_RECIENTES"
  | "VENTAS_EN_BAJA"
  | "SIN_PACK_CARGADO"
  | "SIN_PROVEEDOR"
  | "DISCONTINUADO"
  | "STOCK_VENCIDO"
  | "POR_VENCER";

export type ItemCompra = {
  productoId: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  proveedores: readonly string[];
  stock: number;
  stockVendible: number;
  vencidas: number;
  porVencer: number;
  primerVencimiento: string | null;
  ventaDiaria: number;
  diasAlcanza: number | null;
  diasSinVender: number | null;
  grupo: string;
  grupoNombre: string;
  coberturaDias: number;
  factorTemporada: number;
  multiplo: number;
  formatoCompra: FormatoCompra;
  paso: number;
  objetivo: number;
  necesidadReal: number;
  unidadesVendidas: number;
  ventaMuyLenta: boolean;
  sugerido: number;
  avisos: readonly AvisoCompra[];
};

export type FormatoCompra = "UNIDAD" | "PACK" | "MEDIO_PACK" | "DOCENA";

export const SIN_PROVEEDOR = "(sin proveedor)";

const TEXTO_AVISO: Record<AvisoCompra, string> = {
  SIN_VENTAS_RECIENTES: "Sin ventas en 60 días: revisá si lo seguís vendiendo",
  VENTAS_EN_BAJA: "Sus ventas vienen bajando",
  SIN_PACK_CARGADO: "Falta cargar el pack: se sugiere de a 1 unidad",
  SIN_PROVEEDOR: "No tiene proveedor cargado",
  DISCONTINUADO: "Discontinuado: ya no se compra",
  STOCK_VENCIDO: "Hay stock vencido: sacalo y dalo de baja",
  POR_VENCER: "Parte del stock no se alcanza a vender antes de vencer",
};

/** Producto con stock vencido o que no alcanza a venderse antes de vencer (para la lista de riesgo). */
export type ItemRiesgo = Pick<
  ItemCompra,
  "productoId" | "codigo" | "nombre" | "proveedores" | "stock" | "stockVendible" | "vencidas" | "porVencer" | "primerVencimiento" | "ventaDiaria"
>;

function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function nUnidades(x: number): string {
  return String(Math.round(x * 10) / 10).replace(".", ",");
}

/** Texto de lo vencido y de lo que no se alcanza a vender antes de vencer; vacío si no hay nada. */
export function textoVencimiento(item: Pick<ItemCompra, "vencidas" | "porVencer" | "primerVencimiento">): string {
  const partes: string[] = [];
  if (item.vencidas > 0) partes.push(`${nUnidades(item.vencidas)} u. vencidas (siguen en stock)`);
  if (item.porVencer > 0) {
    const desde = item.primerVencimiento ? ` (vence desde el ${fechaCorta(item.primerVencimiento)})` : "";
    partes.push(`${nUnidades(item.porVencer)} u. no se alcanzan a vender antes de vencer${desde}`);
  }
  return partes.join(" · ");
}

/** "Stock 12 u." o, si parte no es vendible, "Stock 12 u. (8 vendibles)". */
export function textoStock(item: Pick<ItemCompra, "stock" | "stockVendible">): string {
  if (item.stockVendible < item.stock) return `Stock ${nUnidades(item.stock)} u. (${nUnidades(item.stockVendible)} vendibles)`;
  return `Stock ${nUnidades(item.stock)} u.`;
}

/** Texto corto de por qué se calculó así: grupo, días que cubre y ajuste por temporada. */
export function textoCriterio(item: Pick<ItemCompra, "grupoNombre" | "coberturaDias" | "factorTemporada">): string {
  const base = `${item.grupoNombre} · cubre ${Math.round(item.coberturaDias)} días`;
  const f = Math.round(item.factorTemporada * 100) / 100;
  if (f === 1) return base;
  const texto = String(f).replace(".", ",");
  return `${base} · temporada ${f > 1 ? "alta" : "baja"} (×${texto})`;
}

/** Cómo vende el proveedor, en palabras. */
export function textoFormato(formato: FormatoCompra, pack: number): string {
  const p = Math.round(pack * 100) / 100;
  switch (formato) {
    case "UNIDAD": return "se compra por unidad";
    case "PACK": return `caja cerrada de ${p}`;
    case "MEDIO_PACK": return `media caja (${Math.max(1, Math.ceil(pack / 2))}) o caja de ${p}`;
    case "DOCENA": return "de a 12 unidades";
  }
}

/**
 * Línea "pedido real": la necesidad exacta en unidades junto a lo que se pide,
 * para ver cuánto sobra por comprar en caja cerrada. Vacía si coinciden.
 */
export function textoPedidoReal(
  item: Pick<ItemCompra, "necesidadReal" | "sugerido" | "formatoCompra" | "multiplo">,
): string {
  const n = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
  if (item.formatoCompra === "UNIDAD") return "Necesidad real: " + n(item.necesidadReal) + " u. (el proveedor vende por unidad)";
  const como = textoFormato(item.formatoCompra, item.multiplo);
  if (item.necesidadReal === item.sugerido) return "Necesidad real: " + n(item.necesidadReal) + " u. (" + como + ")";
  const sobra = Math.round((item.sugerido - item.necesidadReal) * 10) / 10;
  const resto = sobra > 0 ? ", sobran " + n(sobra) : "";
  return "Necesidad real: " + n(item.necesidadReal) + " u. · se pide " + n(item.sugerido) + " (" + como + resto + ")";
}

export function textoAviso(aviso: string): string {
  return TEXTO_AVISO[aviso as AvisoCompra] ?? aviso;
}

export function textoDiasAlcanza(item: Pick<ItemCompra, "diasAlcanza" | "stock">): string {
  if (item.diasAlcanza === null) return item.stock > 0 ? "sin ventas recientes" : "sin stock ni ventas";
  if (item.diasAlcanza <= 0) return "sin stock";
  if (item.diasAlcanza < 1) return "menos de 1 día";
  return `alcanza ${Math.floor(item.diasAlcanza)} día${Math.floor(item.diasAlcanza) === 1 ? "" : "s"}`;
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function nombresProveedor(item: Pick<ItemCompra, "proveedores">): readonly string[] {
  return item.proveedores.length > 0 ? item.proveedores : [SIN_PROVEEDOR];
}

/** Proveedores que aparecen en la lista, ordenados; "(sin proveedor)" al final. */
export function proveedoresDisponibles(items: readonly ItemCompra[]): string[] {
  const set = new Set<string>();
  for (const i of items) for (const p of nombresProveedor(i)) set.add(p);
  return [...set].sort((a, b) => {
    if (a === SIN_PROVEEDOR) return 1;
    if (b === SIN_PROVEEDOR) return -1;
    return a.localeCompare(b, "es");
  });
}

export type FiltrosCompras = { proveedor?: string; texto?: string; soloConAvisos?: boolean };

export function filtrarCompras(items: readonly ItemCompra[], f: FiltrosCompras): ItemCompra[] {
  const buscado = sinTildes((f.texto ?? "").trim());
  return items.filter((i) => {
    if (f.proveedor && !nombresProveedor(i).includes(f.proveedor)) return false;
    if (f.soloConAvisos && i.avisos.length === 0) return false;
    if (buscado && !sinTildes(`${i.nombre} ${i.codigo}`).includes(buscado)) return false;
    return true;
  });
}

export type GrupoPedido = { proveedor: string; items: ItemCompra[]; unidades: number };

/** Agrupa por proveedor; con `proveedor` devuelve solo ese. Mantiene el orden de urgencia dentro de cada grupo. */
export function agruparPedido(items: readonly ItemCompra[], proveedor?: string): GrupoPedido[] {
  const grupos = new Map<string, ItemCompra[]>();
  for (const i of items) {
    for (const p of nombresProveedor(i)) {
      if (proveedor && p !== proveedor) continue;
      const lista = grupos.get(p) ?? [];
      lista.push(i);
      grupos.set(p, lista);
    }
  }
  return [...grupos.entries()]
    .sort((a, b) => {
      if (a[0] === SIN_PROVEEDOR) return 1;
      if (b[0] === SIN_PROVEEDOR) return -1;
      return a[0].localeCompare(b[0], "es");
    })
    .map(([nombre, lista]) => ({
      proveedor: nombre,
      items: lista,
      unidades: Math.round(lista.reduce((s, i) => s + i.sugerido, 0) * 1000) / 1000,
    }));
}

function celda(valor: string): string {
  const seguro = /^[=+\-@]/.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replace(/"/g, '""')}"`;
}

function num(n: number, decimales = 1): string {
  return (Math.round(n * 10 ** decimales) / 10 ** decimales).toString().replace(".", ",");
}

/** CSV para Excel en Argentina (separador ";" y coma decimal), un pedido agrupado por proveedor. */
export function pedidoACsv(grupos: readonly GrupoPedido[]): string {
  const filas = ["Proveedor;Código;Producto;Stock actual;Stock vendible;Venta diaria;Días que alcanza;Pack;Necesidad real (unidades);Cómo compra el proveedor;Pedir (unidades);Vencidas (u.);Por vencer (u.);Grupo;Cobertura (días);Factor temporada;Avisos"];
  for (const g of grupos) {
    for (const i of g.items) {
      filas.push([
        celda(g.proveedor),
        celda(i.codigo),
        celda(i.nombre),
        num(i.stock, 2),
        num(i.stockVendible, 2),
        num(i.ventaDiaria, 2),
        i.diasAlcanza === null ? "" : num(i.diasAlcanza, 1),
        num(i.multiplo, 2),
        num(i.necesidadReal, 0),
        celda(textoFormato(i.formatoCompra, i.multiplo)),
        num(i.sugerido, 2),
        num(i.vencidas, 2),
        num(i.porVencer, 2),
        celda(i.grupoNombre),
        num(i.coberturaDias, 0),
        num(i.factorTemporada, 2),
        celda(i.avisos.map(textoAviso).join(" | ")),
      ].join(";"));
    }
  }
  return "﻿" + filas.join("\r\n");
}
