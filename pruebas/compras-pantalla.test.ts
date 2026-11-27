import assert from "node:assert/strict";
import test from "node:test";
import {
  agruparPedido, filtrarCompras, pedidoACsv, proveedoresDisponibles, textoAviso, textoDiasAlcanza, SIN_PROVEEDOR,
  type ItemCompra,
} from "../src/modules/movimientos/compras.js";

function item(o: Partial<ItemCompra>): ItemCompra {
  return {
    productoId: "r", codigo: "1", nombre: "Prod", categoria: null, proveedores: [], stock: 0, ventaDiaria: 1,
    diasAlcanza: 0, diasSinVender: 0, coberturaDias: 15, factorTemporada: 1, multiplo: 6, objetivo: 15, sugerido: 12,
    avisos: [], ...o,
  };
}

const LISTA = [
  item({ productoId: "a", nombre: "Queso Cremón", codigo: "1005", proveedores: ["Zeta", "Alfa"], sugerido: 12 }),
  item({ productoId: "b", nombre: "Yerba Ñandú", codigo: "20", proveedores: ["Alfa"], sugerido: 6, avisos: ["SIN_PACK_CARGADO"] }),
  item({ productoId: "c", nombre: "Suelto", codigo: "30", proveedores: [], sugerido: 1, avisos: ["SIN_PROVEEDOR"] }),
];

test("proveedoresDisponibles ordena y deja '(sin proveedor)' al final", () => {
  assert.deepEqual(proveedoresDisponibles(LISTA), ["Alfa", "Zeta", SIN_PROVEEDOR]);
});

test("filtrarCompras por proveedor, texto sin tildes y avisos", () => {
  assert.deepEqual(filtrarCompras(LISTA, { proveedor: "Alfa" }).map((i) => i.productoId), ["a", "b"]);
  assert.deepEqual(filtrarCompras(LISTA, { texto: "nandu" }).map((i) => i.productoId), ["b"]);
  assert.deepEqual(filtrarCompras(LISTA, { texto: "1005" }).map((i) => i.productoId), ["a"]);
  assert.deepEqual(filtrarCompras(LISTA, { soloConAvisos: true }).map((i) => i.productoId), ["b", "c"]);
  assert.deepEqual(filtrarCompras(LISTA, { proveedor: SIN_PROVEEDOR }).map((i) => i.productoId), ["c"]);
});

test("agruparPedido: un producto con dos proveedores aparece en ambos; totales", () => {
  const g = agruparPedido(LISTA);
  assert.deepEqual(g.map((x) => [x.proveedor, x.items.length, x.unidades]), [["Alfa", 2, 18], ["Zeta", 1, 12], [SIN_PROVEEDOR, 1, 1]]);
  assert.deepEqual(agruparPedido(LISTA, "Zeta").map((x) => x.proveedor), ["Zeta"]);
});

test("pedidoACsv: encabezado, coma decimal y protección de fórmulas", () => {
  const csv = pedidoACsv(agruparPedido([item({ nombre: "=SUMA(1)", proveedores: ["Alfa"], ventaDiaria: 1.25, diasAlcanza: 2.5, sugerido: 12 })]));
  const filas = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(filas.length, 2);
  assert.match(filas[0], /^Proveedor;Código;Producto/);
  assert.ok(filas[1].includes('"\'=SUMA(1)"'));
  assert.ok(filas[1].includes(";1,25;2,5;"));
});

test("textos de avisos y de días", () => {
  assert.match(textoAviso("SIN_PACK_CARGADO"), /pack/);
  assert.equal(textoAviso("RARO"), "RARO");
  assert.equal(textoDiasAlcanza({ diasAlcanza: null, stock: 0 }), "sin stock ni ventas");
  assert.equal(textoDiasAlcanza({ diasAlcanza: null, stock: 3 }), "sin ventas recientes");
  assert.equal(textoDiasAlcanza({ diasAlcanza: 0, stock: 0 }), "sin stock");
  assert.equal(textoDiasAlcanza({ diasAlcanza: 0.4, stock: 1 }), "menos de 1 día");
  assert.equal(textoDiasAlcanza({ diasAlcanza: 3.7, stock: 5 }), "alcanza 3 días");
});
