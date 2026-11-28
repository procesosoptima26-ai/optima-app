import assert from "node:assert/strict";
import test from "node:test";
import { codigoDeBalanza } from "../lib/ventas-balanza.js";
import { codigoDeBalanza as codigoDeBalanzaNavegador } from "../src/modules/movimientos/lector-ventas-archivo.js";
import { planificarVentas } from "../lib/ventas-archivo-plan.js";
import { agruparVentas } from "../src/modules/movimientos/lector-ventas-archivo.js";

// Ejemplos reales de las ventas de Goya y Bella Vista.
const CASOS: Array<[string, string]> = [
  ["2401002000222750", "1002"], // Queso cremoso
  ["2401003000194400", "1003"], // Queso sardo
  ["2401123000679000", "1123"], // Salchicha parrillera
  ["2401714000123456", "1714"],
  ["7790045002123", "7790045002123"], // EAN normal: no se toca
  ["10004", "10004"], // código corto: no se toca
  ["2501002000222750", "2501002000222750"], // 16 dígitos pero no empieza con 24
  ["240100200022275", "240100200022275"], // 15 dígitos
  ["24010020002227500", "24010020002227500"], // 17 dígitos
  ["2400000000123456", "2400000000123456"], // código interno 00000: no es producto
];

test("etiquetas de balanza → código interno (servidor)", () => {
  for (const [entrada, esperado] of CASOS) assert.equal(codigoDeBalanza(entrada), esperado, entrada);
});

test("el navegador y el servidor aplican exactamente la misma regla", () => {
  for (const [entrada] of CASOS) assert.equal(codigoDeBalanzaNavegador(entrada), codigoDeBalanza(entrada), entrada);
});

test("convertir dos veces no cambia nada (el servidor repite lo que ya hizo el navegador)", () => {
  for (const [entrada] of CASOS) {
    const una = codigoDeBalanza(entrada);
    assert.equal(codigoDeBalanza(una), una);
  }
});

test("varias etiquetas del mismo producto se suman y descuentan stock", () => {
  const lineas = [
    { fila: 1, codigo: codigoDeBalanza("2401002000222750"), producto: "Queso cremoso", cantidad: 0.309 },
    { fila: 2, codigo: codigoDeBalanza("2401002000247500"), producto: "Queso cremoso", cantidad: 0.344 },
    { fila: 3, codigo: "1002", producto: "Queso cremoso", cantidad: 1 },
  ];
  const agrupadas = agruparVentas(lineas);
  assert.equal(agrupadas.length, 1);
  assert.equal(agrupadas[0].codigo, "1002");
  assert.equal(agrupadas[0].cantidad, 1.653);
  const plan = planificarVentas({
    lineas: agrupadas.map((l) => ({ codigo: l.codigo, producto: l.producto, cantidad: l.cantidad })),
    productosPorCodigo: new Map([["1002", { id: "recQueso", nombre: "Queso Cremigal Cremoso" }]]),
    codigosDeOtraEmpresa: new Set(),
    stockPorProductoId: new Map([["recQueso", 5]]),
    yaCargadosPorProductoId: new Set(),
  });
  assert.equal(plan.listas.length, 1);
  assert.equal(plan.listas[0].cantidad, 1.653);
  assert.equal(plan.problemas.length, 0);
});
