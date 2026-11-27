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
  | "CODIGO_REUTILIZADO";

export type ItemCompra = {
  productoId: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  proveedores: readonly string[];
  stock: number;
  ventaDiaria: number;
  diasAlcanza: number | null;
  diasSinVender: number | null;
  coberturaDias: number;
  factorTemporada: number;
  multiplo: number;
  objetivo: number;
  sugerido: number;
  avisos: readonly AvisoCompra[];
};

export const SIN_PROVEEDOR = "(sin proveedor)";

const TEXTO_AVISO: Record<AvisoCompra, string> = {
  SIN_VENTAS_RECIENTES: "Sin ventas en 60 días: revisá si lo seguís vendiendo",
  VENTAS_EN_BAJA: "Sus ventas vienen bajando",
  SIN_PACK_CARGADO: "Falta cargar el pack: se sugiere de a 1 unidad",
  SIN_PROVEEDOR: "No tiene proveedor cargado",
  CODIGO_REUTILIZADO: "Código reutilizado: solo cuentan las ventas del producto actual",
};

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
  const filas = ["Proveedor;Código;Producto;Stock actual;Venta diaria;Días que alcanza;Pack;Pedir (unidades);Avisos"];
  for (const g of grupos) {
    for (const i of g.items) {
      filas.push([
        celda(g.proveedor),
        celda(i.codigo),
        celda(i.nombre),
        num(i.stock, 2),
        num(i.ventaDiaria, 2),
        i.diasAlcanza === null ? "" : num(i.diasAlcanza, 1),
        num(i.multiplo, 2),
        num(i.sugerido, 2),
        celda(i.avisos.map(textoAviso).join(" | ")),
      ].join(";"));
    }
  }
  return "﻿" + filas.join("\r\n");
}
