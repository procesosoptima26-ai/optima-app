/** Etapa 1 de "Ventas por archivo": reglas del plan de carga (lógica pura). */
import test from "node:test";
import assert from "node:assert/strict";
import { planificarVentas, etiquetaArchivoVentas, ventasParaRevision, TOLERANCIA_VENTA } from "../lib/ventas-archivo-plan.js";

const cat = new Map([
  ["1", { id: "recA", nombre: "Producto A" }],
  ["2", { id: "recB", nombre: "Producto B" }],
  ["3", { id: "recC", nombre: "Producto C" }],
  ["4", { id: "recD", nombre: "Producto D" }],
]);
const base = {
  productosPorCodigo: cat,
  codigosDeOtraEmpresa: new Set<string>(["9"]),
  stockPorProductoId: new Map([["recA", 10], ["recB", 2], ["recC", 0], ["recD", 5]]),
  yaCargadosPorProductoId: new Set<string>(["recD"]),
};

test("clasifica listas, no reconocidas, sin stock, insuficiente, ya cargadas y de otra empresa", () => {
  const p = planificarVentas({
    ...base,
    lineas: [
      { codigo: "1", producto: "A", cantidad: 4 },
      { codigo: "2", producto: "B", cantidad: 5 },
      { codigo: "3", producto: "C", cantidad: 1 },
      { codigo: "4", producto: "D", cantidad: 1 },
      { codigo: "8", producto: "Nuevo", cantidad: 1 },
      { codigo: "9", producto: "Ajeno", cantidad: 1 },
    ],
  });
  assert.deepEqual(p.listas.map((v) => v.codigo), ["1"]);
  const por = Object.fromEntries(p.problemas.map((x) => [x.codigo, x.motivo]));
  assert.deepEqual(por, {
    "2": "STOCK_INSUFICIENTE", "3": "SIN_STOCK", "4": "YA_CARGADO",
    "8": "NO_RECONOCIDO", "9": "OTRA_EMPRESA",
  });
  assert.equal(p.problemas.find((x) => x.codigo === "2")?.faltante, 3);
  assert.deepEqual(p.totales, {
    productos: 6, listas: 1, noReconocidas: 2, sinStockOInsuficiente: 2,
    yaCargadas: 1, unidadesListas: 4,
  });
});

test("suma líneas repetidas del mismo código antes de decidir", () => {
  const p = planificarVentas({
    ...base,
    lineas: [
      { codigo: "1", producto: "A", cantidad: 6 },
      { codigo: "1", producto: "A", cantidad: 5 },
    ],
  });
  assert.equal(p.listas.length, 0);
  assert.equal(p.problemas[0].motivo, "STOCK_INSUFICIENTE");
  assert.equal(p.problemas[0].cantidad, 11);
  assert.equal(p.problemas[0].faltante, 1);
});

test("tolerancia del motor: hasta 0,1 de faltante se acepta; más, no", () => {
  const ok = planificarVentas({ ...base, lineas: [{ codigo: "2", producto: "B", cantidad: 2 + TOLERANCIA_VENTA }] });
  assert.equal(ok.listas.length, 1);
  const mal = planificarVentas({ ...base, lineas: [{ codigo: "2", producto: "B", cantidad: 2.11 }] });
  assert.equal(mal.listas.length, 0);
  assert.equal(mal.problemas[0].motivo, "STOCK_INSUFICIENTE");
});

test("decimales de balanza (quesos) se suman sin error de redondeo", () => {
  const p = planificarVentas({
    ...base,
    stockPorProductoId: new Map([["recA", 1]]),
    lineas: [
      { codigo: "1", producto: "Queso", cantidad: 0.36 },
      { codigo: "1", producto: "Queso", cantidad: 0.38 },
    ],
  });
  assert.equal(p.listas[0].cantidad, 0.74);
});

test("rechaza cantidades inválidas y archivos gigantes", () => {
  assert.throws(() => planificarVentas({ ...base, lineas: [{ codigo: "1", producto: "", cantidad: 0 }] }), /inválida/);
  assert.throws(() => planificarVentas({ ...base, lineas: [{ codigo: "1", producto: "", cantidad: NaN }] }), /inválida/);
  const muchas = Array.from({ length: 1001 }, (_, i) => ({ codigo: String(i + 100), producto: "", cantidad: 1 }));
  assert.throws(() => planificarVentas({ ...base, lineas: muchas }), /máximo/);
});

test("etiqueta del archivo: limpia caracteres peligrosos y exige nombre", () => {
  assert.equal(etiquetaArchivoVentas('25-11  ventas "bv".xlsx'), "Ventas archivo: 25-11 ventas bv.xlsx");
  assert.throws(() => etiquetaArchivoVentas("  "), /nombre/);
  assert.ok(etiquetaArchivoVentas("x".repeat(500)).length <= 140);
});

test("ventasParaRevision: solo sin stock e insuficiente, con producto reconocido y cantidad completa", () => {
  const p = planificarVentas({
    lineas: [
      { codigo: "1", producto: "A", cantidad: 2 },   // lista
      { codigo: "2", producto: "B", cantidad: 5 },   // insuficiente (hay 2)
      { codigo: "3", producto: "C", cantidad: 1 },   // sin stock
      { codigo: "4", producto: "D", cantidad: 1 },   // no reconocido
    ],
    productosPorCodigo: new Map([
      ["1", { id: "recA", nombre: "A" }],
      ["2", { id: "recB", nombre: "B" }],
      ["3", { id: "recC", nombre: "C" }],
    ]),
    codigosDeOtraEmpresa: new Set(),
    stockPorProductoId: new Map([["recA", 10], ["recB", 2]]),
    yaCargadosPorProductoId: new Set(),
  });
  const r = ventasParaRevision(p);
  assert.deepEqual(r.map((v) => [v.codigo, v.productoId, v.cantidad]), [
    ["2", "recB", 5],
    ["3", "recC", 1],
  ]);
  assert.deepEqual(p.listas.map((v) => v.codigo), ["1"]);
});
