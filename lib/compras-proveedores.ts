/**
 * OPTIMA - Formato de compra de cada proveedor (lógica pura).
 *
 * Para qué sirve: cada proveedor vende de una forma distinta. Algunos entregan la
 * cantidad exacta que pedís (UNIDAD); otros solo venden la caja cerrada (PACK);
 * otros dejan pedir media caja o caja; y los huevos se piden de a 12.
 * Esta tabla le dice al cálculo de compras en qué "escalón" puede pedir cada proveedor.
 *
 * Qué soluciona: antes se pedía siempre la caja cerrada, aunque el proveedor vendiera
 * suelto. Eso generaba pedidos de más, y mercadería de más es mercadería que se vence.
 *
 * Fuente: planilla "Proveedores_formato_compra.xlsx" de Antonella (27-11-2026).
 * Si un proveedor no figura acá, se usa PACK (caja cerrada): es lo más conservador
 * y es lo que se hacía hasta ahora.
 */

export type FormatoCompra = "UNIDAD" | "PACK" | "MEDIO_PACK" | "DOCENA";

export const FORMATO_POR_DEFECTO: FormatoCompra = "PACK";

const TABLA: ReadonlyArray<readonly [string, FormatoCompra]> = [
  ["ALBIZZATTI", "UNIDAD"],
  ["ARCOR", "UNIDAD"],
  ["BEHR DSTRIBUCIONES", "PACK"],
  ["Belia", "UNIDAD"],
  ["Benetti", "UNIDAD"],
  ["CARBÓN", "UNIDAD"],
  ["CARBÓN FACCHINOTTI", "UNIDAD"],
  ["CARREFOUR", "UNIDAD"],
  ["CHAJARÍ MAYORISTA", "MEDIO_PACK"],
  ["CHIPALADO", "UNIDAD"],
  ["CLARG S.A.", "PACK"],
  ["COCA COLA BELLA VISTA", "PACK"],
  ["COCA COLA GOYA", "PACK"],
  ["CORCORR", "PACK"],
  ["CREMIGAL", "UNIDAD"],
  ["CUCHERMERCADO", "UNIDAD"],
  ["DAL-VA S.H.", "UNIDAD"],
  ["DELICIAS GOYA", "UNIDAD"],
  ["DIARCO", "UNIDAD"],
  ["DINPRO S.A.", "MEDIO_PACK"],
  ["DISTR. LA CHACRA", "UNIDAD"],
  ["Don Roque", "UNIDAD"],
  ["DOÑA MARTA S.R.L", "UNIDAD"],
  ["EL VIEJO ALMACÉN", "UNIDAD"],
  ["ELGORDO.COM", "UNIDAD"],
  ["ENÓPATAS", "UNIDAD"],
  ["FACOR", "UNIDAD"],
  ["FEED S.R.L", "UNIDAD"],
  ["FENOVO S.A.", "PACK"],
  ["FIAMBRERÍA LA ESTANCIA", "UNIDAD"],
  ["GALARZA", "UNIDAD"],
  ["GRUPO DESPO", "UNIDAD"],
  ["GRUPO SATIVA S.A.S", "UNIDAD"],
  ["Gustavo Plumeros", "UNIDAD"],
  ["Hermanos Pedro S.R.L.", "MEDIO_PACK"],
  ["HIELOS MOLE", "UNIDAD"],
  ["HORTICOLA LAVALLE", "UNIDAD"],
  ["HUEVOS VIOLA", "DOCENA"],
  ["HUGO ROBERTO ESPINOZA", "PACK"],
  ["HV DISTRIBUCIONES", "UNIDAD"],
  ["ILOLAY", "UNIDAD"],
  ["INGENIO GOYA - AZÚCAR", "PACK"],
  ["JOTA BE", "MEDIO_PACK"],
  ["JUGOS VERDES", "UNIDAD"],
  ["LA CORRENTINA", "UNIDAD"],
  ["LA PROVIDENCIA", "UNIDAD"],
  ["LA SERENISIMA", "UNIDAD"],
  ["LA VIRGINIA", "UNIDAD"],
  ["MAKRO", "UNIDAD"],
  ["MARIO BEHR", "PACK"],
  ["MATU DISTRIBUCIONES", "UNIDAD"],
  ["MAXICUERA", "UNIDAD"],
  ["MIEL DULCES JUSTINA", "UNIDAD"],
  ["MILKAUT BV", "UNIDAD"],
  ["MYGRA S.R.L", "UNIDAD"],
  ["ÑANGAPIRÍ", "PACK"],
  ["NICOLAS STAHRINGER", "UNIDAD"],
  ["Otros", "UNIDAD"],
  ["PANADERIA CAMBÁ", "UNIDAD"],
  ["PLAYADITO", "PACK"],
  ["R.A.N", "PACK"],
  ["Rinos S.R.L.", "UNIDAD"],
  ["SAN CAYETANO", "PACK"],
  ["Sofía", "PACK"],
  ["TERRABUSSI", "UNIDAD"],
  ["TODO DISTRIBUCIONES S.R.L", "UNIDAD"],
  ["TORAZZA", "UNIDAD"],
  ["Tres Hermanos Distribuciones S.R.L", "UNIDAD"],
];

/** Nombre comparable: sin tildes, en mayúsculas y sin espacios de más. */
export function normalizarProveedor(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const FORMATO_POR_PROVEEDOR: ReadonlyMap<string, FormatoCompra> = new Map(
  TABLA.map(([nombre, formato]) => [normalizarProveedor(nombre), formato]),
);

/** Formato de compra del proveedor; si no figura (o no hay proveedor), PACK. */
export function formatoDeProveedor(nombre: string | null | undefined): FormatoCompra {
  if (!nombre) return FORMATO_POR_DEFECTO;
  return FORMATO_POR_PROVEEDOR.get(normalizarProveedor(nombre)) ?? FORMATO_POR_DEFECTO;
}

/**
 * Escalón mínimo de compra en unidades: lo que se puede sumar de a una vez.
 * UNIDAD → 1; PACK → el pack; MEDIO_PACK → la mitad del pack (redondeada hacia arriba);
 * DOCENA → 12. `pack` es el pack cargado en Airtable (1 si falta).
 */
export function pasoDeCompra(formato: FormatoCompra, pack: number): number {
  const p = Number.isFinite(pack) && pack > 0 ? pack : 1;
  switch (formato) {
    case "UNIDAD": return 1;
    case "PACK": return p;
    case "MEDIO_PACK": return Math.max(1, Math.ceil(p / 2));
    case "DOCENA": return 12;
  }
}

/** Texto corto para mostrar cómo se compra. */
export function textoFormato(formato: FormatoCompra, pack: number): string {
  const p = Math.round(pack * 100) / 100;
  switch (formato) {
    case "UNIDAD": return "se compra por unidad";
    case "PACK": return `caja cerrada de ${p}`;
    case "MEDIO_PACK": return `media caja (${pasoDeCompra("MEDIO_PACK", pack)}) o caja de ${p}`;
    case "DOCENA": return "de a 12 unidades";
  }
}
