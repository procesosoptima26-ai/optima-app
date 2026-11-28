import assert from "node:assert/strict";
import test from "node:test";
import {
  agruparPedido, filtrarCompras, pedidoACsv, proveedoresDisponibles, textoAviso, textoCriterio, textoDiasAlcanza, textoPedidoReal, textoStock, textoVencimiento, SIN_PROVEEDOR,
  type ItemCompra,
} from "../src/modules/movimientos/compras.js";

function item(o: Partial<ItemCompra>): ItemCompra {
  return {
    productoId: "r", codigo: "1", nombre: "Prod", categoria: null, proveedores: [], stock: 0, ventaDiaria: 1,
    diasAlcanza: 0, diasSinVender: 0, grupo: "GENERAL", grupoNombre: "General", coberturaDias: 15, factorTemporada: 1, multiplo: 6, formatoCompra: "PACK", paso: 6, necesidadReal: 12, unidadesVendidas: 30, stockVendible: 0, vencidas: 0, porVencer: 0, primerVencimiento: null, ventaMuyLenta: false, objetivo: 15, sugerido: 12,
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
  assert.match(filas[0], /;Grupo;Cobertura \(días\);Factor temporada;Avisos$/);
  assert.ok(filas[1].includes('"\'=SUMA(1)"'));
  assert.ok(filas[1].includes(";1,25;2,5;"));
});

test("textoPedidoReal: unidad exacta, caja cerrada con sobrante y coincidencia", () => {
  assert.equal(
    textoPedidoReal({ necesidadReal: 3, sugerido: 3, formatoCompra: "UNIDAD", multiplo: 12 }),
    "Necesidad real: 3 u. (el proveedor vende por unidad)",
  );
  assert.equal(
    textoPedidoReal({ necesidadReal: 3, sugerido: 12, formatoCompra: "PACK", multiplo: 12 }),
    "Necesidad real: 3 u. · se pide 12 (caja cerrada de 12, sobran 9)",
  );
  assert.equal(
    textoPedidoReal({ necesidadReal: 12, sugerido: 12, formatoCompra: "PACK", multiplo: 12 }),
    "Necesidad real: 12 u. (caja cerrada de 12)",
  );
  assert.match(textoPedidoReal({ necesidadReal: 5, sugerido: 6, formatoCompra: "MEDIO_PACK", multiplo: 12 }), /media caja \(6\) o caja de 12/);
});

test("pedidoACsv incluye necesidad real y cómo compra el proveedor", () => {
  const csv = pedidoACsv(agruparPedido([item({ proveedores: ["Alfa"], necesidadReal: 3, sugerido: 12 })]));
  const filas = csv.replace(/^\uFEFF/, "").split("\r\n");
  assert.match(filas[0], /;Pack;Necesidad real \(unidades\);Cómo compra el proveedor;Pedir \(unidades\);/);
  assert.ok(filas[1].includes(';6;3;"caja cerrada de 6";12;'));
});

test("textoVencimiento y textoStock", () => {
  assert.equal(textoVencimiento({ vencidas: 0, porVencer: 0, primerVencimiento: null }), "");
  assert.equal(textoVencimiento({ vencidas: 3, porVencer: 0, primerVencimiento: "2026-11-01" }), "3 u. vencidas (siguen en stock)");
  assert.equal(
    textoVencimiento({ vencidas: 0, porVencer: 4.5, primerVencimiento: "2026-12-02" }),
    "4,5 u. no se alcanzan a vender antes de vencer (vence desde el 02/12/2026)",
  );
  assert.match(textoVencimiento({ vencidas: 2, porVencer: 1, primerVencimiento: "2026-11-01" }), /vencidas.* · .*no se alcanzan/);
  assert.equal(textoStock({ stock: 12, stockVendible: 12 }), "Stock 12 u.");
  assert.equal(textoStock({ stock: 12, stockVendible: 8 }), "Stock 12 u. (8 vendibles)");
  assert.match(textoAviso("STOCK_VENCIDO"), /vencido/);
  assert.match(textoAviso("POR_VENCER"), /vencer/);
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

test("textoAviso: discontinuado y ya no existe el cartel de código reutilizado", () => {
  assert.match(textoAviso("DISCONTINUADO"), /Discontinuado/);
  assert.equal(textoAviso("CODIGO_REUTILIZADO"), "CODIGO_REUTILIZADO");
});

test("textoCriterio: grupo, cobertura y temporada solo cuando cambia", () => {
  assert.equal(textoCriterio({ grupoNombre: "Almacén", coberturaDias: 21, factorTemporada: 1 }), "Almacén · cubre 21 días");
  assert.equal(
    textoCriterio({ grupoNombre: "Helados y postres helados", coberturaDias: 10, factorTemporada: 1.28 }),
    "Helados y postres helados · cubre 10 días · temporada alta (×1,28)",
  );
  assert.match(textoCriterio({ grupoNombre: "Bebidas sin alcohol", coberturaDias: 14, factorTemporada: 0.7 }), /temporada baja \(×0,7\)/);
});
