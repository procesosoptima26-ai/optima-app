import assert from "node:assert/strict";
import test from "node:test";
import { aplicarEquivalenciaVenta, EQUIVALENCIAS_VENTA } from "../lib/ventas-equivalencias.js";
import {
  aplicarEquivalenciaVenta as aplicarNavegador,
  EQUIVALENCIAS_VENTA as TABLA_NAVEGADOR,
  agruparVentas,
  interpretarFilas,
} from "../src/modules/movimientos/lector-ventas-archivo.js";

test("maple x2 (1024) vale 2 maples (1023)", () => {
  assert.deepEqual(aplicarEquivalenciaVenta("1024", 3), { codigo: "1023", cantidad: 6 });
  assert.deepEqual(aplicarEquivalenciaVenta("1023", 3), { codigo: "1023", cantidad: 3 });
  assert.deepEqual(aplicarEquivalenciaVenta("7790045002123", 2), { codigo: "7790045002123", cantidad: 2 });
});

test("la tabla del navegador es igual a la del servidor", () => {
  assert.deepEqual(TABLA_NAVEGADOR, EQUIVALENCIAS_VENTA);
  for (const c of ["1024", "1023", "5"]) assert.deepEqual(aplicarNavegador(c, 4), aplicarEquivalenciaVenta(c, 4));
});

test("las equivalencias no se encadenan (el producto base no es a su vez un x2)", () => {
  for (const eq of Object.values(EQUIVALENCIAS_VENTA)) assert.equal(EQUIVALENCIAS_VENTA[eq.codigoBase], undefined);
});

test("al leer el archivo, maple y maple x2 se suman como maples", () => {
  const r = interpretarFilas([
    ["Codigo", "Producto", "Cantidad"],
    ["1023", "Huevo blanco maple", "1"],
    ["1024", "Huevo blanco maple x2", "3"],
    ["1024", "Huevo blanco maple x2", "1"],
  ]);
  assert.equal(r.errores.length, 0);
  const g = agruparVentas(r.lineas);
  assert.equal(g.length, 1);
  assert.equal(g[0].codigo, "1023");
  assert.equal(g[0].cantidad, 9);
});
