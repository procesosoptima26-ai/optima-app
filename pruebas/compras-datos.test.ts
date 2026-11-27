import assert from "node:assert/strict";
import test from "node:test";
import {
  agregarVentasDelDia,
  esRelevanteParaSucursal,
  ventasPorProductoDeSucursal,
  armarProductosCompra,
  clavePackDeSucursal,
  diasDeVentana,
  hoyArgentina,
  interpretarPack,
  limitesDiaUtc,
} from "../lib/compras-datos.js";

test("interpretarPack toma el primer número positivo", () => {
  assert.equal(interpretarPack("6"), 6);
  assert.equal(interpretarPack("x6"), 6);
  assert.equal(interpretarPack("12 un"), 12);
  assert.equal(interpretarPack("2,5"), 2.5);
  assert.equal(interpretarPack("0"), null);
  assert.equal(interpretarPack(""), null);
  assert.equal(interpretarPack(null), null);
  assert.equal(interpretarPack("sin dato"), null);
});

test("clavePackDeSucursal reconoce Bella Vista y Goya", () => {
  assert.equal(clavePackDeSucursal("Frioteka Bella Vista"), "BELLA");
  assert.equal(clavePackDeSucursal("GOYA"), "GOYA");
  assert.equal(clavePackDeSucursal("Otra"), null);
});

test("agregarVentasDelDia suma por sucursal y producto e ignora lo dudoso", () => {
  const sucursales = new Map([["u1", "sA"], ["u2", "sB"]]);
  const r = agregarVentasDelDia([
    { productoIds: ["p1"], ubicacionOrigenIds: ["u1"], cantidad: 2 },
    { productoIds: ["p1"], ubicacionOrigenIds: ["u1"], cantidad: 3 },
    { productoIds: ["p1"], ubicacionOrigenIds: ["u2"], cantidad: 1 },
    { productoIds: ["p1"], ubicacionOrigenIds: ["uX"], cantidad: 9 },
    { productoIds: ["p1", "p2"], ubicacionOrigenIds: ["u1"], cantidad: 9 },
    { productoIds: ["p1"], ubicacionOrigenIds: [], cantidad: 9 },
    { productoIds: ["p1"], ubicacionOrigenIds: ["u1"], cantidad: 0 },
  ], sucursales);
  assert.deepEqual(r, { sA: { p1: 5 }, sB: { p1: 1 } });
});

test("ventasPorProductoDeSucursal ordena por día y separa sucursales", () => {
  const m = ventasPorProductoDeSucursal(new Map([
    ["2026-11-10", { sA: { p1: 5 }, sB: { p1: 1 } }],
    ["2026-11-09", { sA: { p1: 2, p2: 4 } }],
  ]), "sA");
  assert.deepEqual(m.get("p1"), [{ fecha: "2026-11-09", cantidad: 2 }, { fecha: "2026-11-10", cantidad: 5 }]);
  assert.deepEqual(m.get("p2"), [{ fecha: "2026-11-09", cantidad: 4 }]);
});

test("esRelevanteParaSucursal: stock, ventas o pack", () => {
  const base = { productoId: "a", codigo: "1", nombre: "x", categoria: null, proveedores: [], multiplo: null, stock: 0, ventas: [] };
  assert.equal(esRelevanteParaSucursal(base), false);
  assert.equal(esRelevanteParaSucursal({ ...base, stock: 1 }), true);
  assert.equal(esRelevanteParaSucursal({ ...base, multiplo: 6 }), true);
  assert.equal(esRelevanteParaSucursal({ ...base, ventas: [{ fecha: "2026-11-01", cantidad: 1 }] }), true);
});

test("diasDeVentana, limitesDiaUtc y hoyArgentina", () => {
  assert.deepEqual(diasDeVentana("2026-03-02", 3), ["2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.deepEqual(limitesDiaUtc("2026-11-10"), { desde: "2026-11-10T03:00:00.000Z", hasta: "2026-11-11T03:00:00.000Z" });
  assert.equal(hoyArgentina(new Date("2026-11-27T02:00:00Z")), "2026-11-26");
  assert.throws(() => diasDeVentana("x", 3));
});

test("armarProductosCompra aplica pack, proveedores y cortes", () => {
  const base = {
    catalogo: [
      { id: "r1", codigo: "01026", nombre: "Prod", categoria: null, proveedorIds: ["p2", "p1", "p1", "px"], packTexto: "x6" },
      { id: "r2", codigo: "5", nombre: "Otro", categoria: "ALMACÉN", proveedorIds: [], packTexto: null },
    ],
    stockPorProductoId: new Map([["r1", 4]]),
    ventasPorProductoId: new Map(),
    proveedorPorId: new Map([["p1", "Zeta"], ["p2", "Alfa"]]),
  };
  const bella = armarProductosCompra({ ...base, clavePack: "BELLA" });
  assert.deepEqual(bella[0].proveedores, ["Alfa", "Zeta"]);
  assert.equal(bella[0].multiplo, 6);
  assert.equal(bella[0].stock, 4);
  assert.equal(bella[0].cortePorCambioDeProducto, "2026-07-17");
  assert.equal(bella[1].multiplo, null);
  assert.equal(bella[1].stock, 0);
  assert.equal(bella[1].cortePorCambioDeProducto, null);
  const sin = armarProductosCompra({ ...base, clavePack: null });
  assert.equal(sin[0].multiplo, null);
  assert.equal(sin[0].cortePorCambioDeProducto, null);
});
