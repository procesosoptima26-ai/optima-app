/** Etapa 1 de "Ventas por archivo": consultas de SOLO LECTURA a Airtable (con respuestas simuladas). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buscarProductosPorCodigos, leerStockPorProductoEnUbicacion, leerProductosYaCargados,
} from "../lib/ventas-archivo-airtable.js";

const EMP = "rec" + "E".repeat(14);
const OTRA = "rec" + "O".repeat(14);
const UBI = "rec" + "U".repeat(14);
const OTRA_UBI = "rec" + "V".repeat(14);
const P = (c: string) => "rec" + c.repeat(14);

function entorno() {
  process.env.AIRTABLE_TOKEN = "token-de-prueba";
  process.env.AIRTABLE_USERS_BASE_ID = "appBASE00000000AA";
  process.env.AIRTABLE_MOVIMIENTOS_BASE_ID = "appBASE00000000AA";
  process.env.AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME = "PRODUCTOS";
  process.env.AIRTABLE_MOVIMIENTOS_CODE_FIELD = "CÓDIGO";
  process.env.AIRTABLE_MOVIMIENTOS_NAME_FIELD = "NOMBRE MASTER";
  process.env.AIRTABLE_STOCK_LOTES_TABLE_NAME = "STOCK_LOTES";
  process.env.AIRTABLE_MOVIMIENTOS_TABLE_NAME = "MOVIMIENTOS";
}

function simular(respuestas: Array<unknown>) {
  const llamadas: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push(String(url));
    assert.equal(init?.method ?? "GET", "GET", "estas consultas nunca escriben");
    const r = respuestas.shift();
    return { ok: true, json: async () => r } as Response;
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

test("productos por código: separa los de la empresa y los ajenos, y consulta en tandas", async () => {
  entorno();
  const codigos = Array.from({ length: 31 }, (_, i) => String(1000 + i));
  const s = simular([
    { records: [
      { id: P("A"), fields: { "CÓDIGO": 1000, "NOMBRE MASTER": "Producto A", EMPRESA: [EMP] } },
      { id: P("B"), fields: { "CÓDIGO": 1001, "NOMBRE MASTER": "Ajeno", EMPRESA: [OTRA] } },
    ], offset: "pag2" },
    { records: [{ id: P("C"), fields: { "CÓDIGO": 1002, "NOMBRE MASTER": "Producto C", EMPRESA: [EMP] } }] },
    { records: [] },
  ]);
  try {
    const r = await buscarProductosPorCodigos(codigos, EMP);
    assert.equal(s.llamadas.length, 3, "30 códigos + 1 código = 2 tandas, la primera con 2 páginas");
    assert.equal(r.productos.get("1000")?.nombre, "Producto A");
    assert.equal(r.productos.get("1002")?.id, P("C"));
    assert.deepEqual([...r.codigosDeOtraEmpresa], ["1001"]);
    assert.match(new URL(s.llamadas[0]).searchParams.get("filterByFormula") ?? "",
      /OR\(\{CÓDIGO\}=1000,\{CÓDIGO\}=1001/);
  } finally { s.restaurar(); }
});

test("productos por código: un código no numérico se rechaza antes de consultar", async () => {
  entorno();
  const s = simular([]);
  try {
    await assert.rejects(buscarProductosPorCodigos(["12) OR (1=1"], EMP), /Código inválido/);
    assert.equal(s.llamadas.length, 0);
  } finally { s.restaurar(); }
});

test("stock: suma lotes con cantidad positiva SOLO de la ubicación pedida", async () => {
  entorno();
  const s = simular([{ records: [
    { id: "recL1", fields: { PRODUCTOS: [P("A")], "UBICACIÓN": [UBI], CANTIDAD_ACTUAL: 3 } },
    { id: "recL2", fields: { PRODUCTOS: [P("A")], "UBICACIÓN": [UBI], CANTIDAD_ACTUAL: 0.5 } },
    { id: "recL3", fields: { PRODUCTOS: [P("A")], "UBICACIÓN": [OTRA_UBI], CANTIDAD_ACTUAL: 99 } },
    { id: "recL4", fields: { PRODUCTOS: [P("B")], "UBICACIÓN": [UBI], CANTIDAD_ACTUAL: 0 } },
    { id: "recL5", fields: { PRODUCTOS: [P("C")], "UBICACIÓN": [UBI], CANTIDAD_ACTUAL: -2 } },
  ] }]);
  try {
    const stock = await leerStockPorProductoEnUbicacion(UBI);
    assert.equal(stock.get(P("A")), 3.5);
    assert.equal(stock.has(P("B")), false);
    assert.equal(stock.has(P("C")), false);
    await assert.rejects(leerStockPorProductoEnUbicacion("no-es-un-id"), /Ubicación inválida/);
  } finally { s.restaurar(); }
});

test("ya cargados: ignora ventas con error del motor y rechaza etiquetas peligrosas", async () => {
  entorno();
  const s = simular([{ records: [
    { id: "recM1", fields: { PRODUCTO: [P("A")] } },
    { id: "recM2", fields: { PRODUCTO: [P("B")], ERROR_MOTOR: "Stock insuficiente" } },
  ] }]);
  try {
    const ya = await leerProductosYaCargados("Ventas archivo: 25-11 bv.xlsx");
    assert.deepEqual([...ya], [P("A")]);
    assert.match(new URL(s.llamadas[0]).searchParams.get("filterByFormula") ?? "",
      /\{OBSERVACIONES\}="Ventas archivo: 25-11 bv\.xlsx"/);
    await assert.rejects(leerProductosYaCargados('x" ,1=1, "'), /Etiqueta inválida/);
  } finally { s.restaurar(); }
});
