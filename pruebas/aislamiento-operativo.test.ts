import assert from "node:assert/strict";
import { test } from "node:test";
import { productoDeEmpresa, sucursalRealDeUbicacion, ubicacionPermitida,
  lotePermitido, movimientoPermitido, sucursalSolicitada, configTablaOperativa,
  idsVinculados, type RegistroOperativo } from "../lib/alcance-operativo.js";
import type { ContextoCore } from "../core/seguridad.js";

const empresaA = "recAAAAAAAAAAAAAA";
const empresaB = "recBBBBBBBBBBBBBB";
const sucursalA = "recCCCCCCCCCCCCCC";
const sucursalB = "recDDDDDDDDDDDDDD";
const productoCompartido = "recEEEEEEEEEEEEEE";
const productoAjeno = "recFFFFFFFFFFFFFF";
const ubicacionA = "recGGGGGGGGGGGGGG";
const ubicacionB = "recHHHHHHHHHHHHHH";

const contexto: ContextoCore = {
  usuarioId: "recJJJJJJJJJJJJJJ", activo: true,
  empresa: { id: empresaA, clave: "A", activa: true },
  sucursalesAutorizadas: [{ id: sucursalA, nombre: "GOYA", empresaId: empresaA, activa: true }],
  modulosEmpresa: ["INVENTARIO", "MOVIMIENTOS"],
  modulosUsuario: ["INVENTARIO", "MOVIMIENTOS"],
  permisos: ["inventario.ver", "movimientos.ver"],
};
const productos = new Map<string, RegistroOperativo>([
  [productoCompartido, { id: productoCompartido, fields: { EMPRESA: [empresaA, empresaB] } }],
  [productoAjeno, { id: productoAjeno, fields: { EMPRESA: [empresaB] } }],
]);
const ubicaciones = new Map<string, RegistroOperativo>([
  [ubicacionA, { id: ubicacionA, fields: { SUCURSAL: "GOYA", SUCURSAL_CORE: [sucursalA] } }],
  [ubicacionB, { id: ubicacionB, fields: { SUCURSAL: "GOYA", SUCURSAL_CORE: [sucursalB] } }],
]);

test("Un producto compartido puede pertenecer a ambas empresas", () => {
  const campos = productos.get(productoCompartido)!.fields;
  assert.equal(productoDeEmpresa(campos, empresaA), true);
  assert.equal(productoDeEmpresa(campos, empresaB), true);
  assert.equal(productoDeEmpresa(productos.get(productoAjeno)!.fields, empresaA), false);
  assert.equal(productoDeEmpresa({}, empresaA), false);
  assert.equal(idsVinculados([empresaA, empresaB])?.length, 2);
});

test("Las ubicaciones se distinguen por sucursal CORE, no por nombres iguales", () => {
  assert.equal(ubicacionPermitida(ubicaciones.get(ubicacionA)!.fields, contexto), true);
  assert.equal(ubicacionPermitida(ubicaciones.get(ubicacionB)!.fields, contexto), false);
  assert.equal(ubicacionPermitida(ubicaciones.get(ubicacionA)!.fields, contexto, sucursalB), false);
  assert.equal(sucursalRealDeUbicacion({ SUCURSAL: "GOYA" }), null);
  assert.equal(sucursalRealDeUbicacion({ SUCURSAL_CORE: [sucursalA, sucursalB] }), null);
  assert.equal(sucursalSolicitada(contexto, "goya")?.id, sucursalA);
  assert.equal(sucursalSolicitada(contexto, sucursalB), null);
});

test("Lotes: producto y ubicación tienen que pertenecer a la misma empresa", () => {
  assert.equal(lotePermitido({ PRODUCTOS: [productoCompartido], "UBICACIÓN": [ubicacionA] }, productos, ubicaciones, contexto), true);
  assert.equal(lotePermitido({ PRODUCTOS: [productoAjeno], "UBICACIÓN": [ubicacionA] }, productos, ubicaciones, contexto), false);
  assert.equal(lotePermitido({ PRODUCTOS: [productoCompartido], "UBICACIÓN": [ubicacionB] }, productos, ubicaciones, contexto), false);
  assert.equal(lotePermitido({ "UBICACIÓN": [ubicacionA] }, productos, ubicaciones, contexto), false);
});

test("Movimientos: una sola ubicación válida o ambas válidas; orígenes ajenos se rechazan", () => {
  assert.equal(movimientoPermitido({ "UBICACIÓN ORIGEN": [ubicacionA] }, ubicaciones, contexto), true);
  assert.equal(movimientoPermitido({ "UBICACIÓN ORIGEN": [ubicacionA], "UBICACIÓN DESTINO": [ubicacionB] }, ubicaciones, contexto), false);
  assert.equal(movimientoPermitido({ "UBICACIÓN DESTINO": [ubicacionB] }, ubicaciones, contexto), false);
  assert.equal(movimientoPermitido({}, ubicaciones, contexto), false);
  assert.equal(movimientoPermitido({ "UBICACIÓN ORIGEN": [ubicacionA], PRODUCTO: [] }, ubicaciones, contexto), true);
});

test("El sistema rechaza recursos con vínculos corruptos", () => {
  assert.equal(ubicacionPermitida({ SUCURSAL_CORE: [sucursalA, sucursalB] }, contexto), false);
  assert.equal(ubicacionPermitida({ SUCURSAL_CORE: ["GOYA"] }, contexto), false);
  assert.equal(productoDeEmpresa({ EMPRESA: ["FRIOTEKA"] }, empresaA), false);
  assert.equal(movimientoPermitido({ "UBICACIÓN ORIGEN": [ubicacionA, ubicacionB] }, ubicaciones, contexto), false);
});

test("No mezcla tablas operativas de otra base con la Base Maestra", () => {
  const anterior1 = process.env.AIRTABLE_USERS_BASE_ID;
  const anterior2 = process.env.AIRTABLE_MOVIMIENTOS_BASE_ID;
  const anterior3 = process.env.AIRTABLE_TOKEN;
  try {
    process.env.AIRTABLE_USERS_BASE_ID = "appBASEMAESTRAAAAA";
    process.env.AIRTABLE_MOVIMIENTOS_BASE_ID = "appOTRABASEEEEEEE";
    process.env.AIRTABLE_TOKEN = "falso";
    assert.throws(() => configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID"), /BASE MAESTRA/);
    process.env.AIRTABLE_MOVIMIENTOS_BASE_ID = process.env.AIRTABLE_USERS_BASE_ID;
    assert.equal(configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID").baseId, process.env.AIRTABLE_USERS_BASE_ID);
  } finally {
    for (const [clave, val] of [["AIRTABLE_USERS_BASE_ID", anterior1], ["AIRTABLE_MOVIMIENTOS_BASE_ID", anterior2], ["AIRTABLE_TOKEN", anterior3]] as const) {
      if (val === undefined) delete process.env[clave]; else process.env[clave] = val;
    }
  }
});
