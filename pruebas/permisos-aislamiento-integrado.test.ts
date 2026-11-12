/** OPTIMA: pruebas de aislamiento multiempresa con datos inventados y sin red. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { puedeRealizarAccion, type ContextoCore } from "../core/seguridad.js";
import {
  idsVinculados, productoDeEmpresa, sucursalRealDeUbicacion,
  sucursalSolicitada, ubicacionPermitida, lotePermitido, movimientoPermitido,
  type RegistroOperativo,
} from "../lib/alcance-operativo.js";

const empresa = "recAAAAAAAAAAAAAA";
const otraEmpresa = "recBBBBBBBBBBBBBB";
const principal = "recCCCCCCCCCCCCCC";
const secundaria = "recDDDDDDDDDDDDDD";
const sucursalAjena = "recEEEEEEEEEEEEEE";
const producto = "recFFFFFFFFFFFFFF";
const ubicacion = "recGGGGGGGGGGGGGG";
const otraUbicacion = "recHHHHHHHHHHHHHH";

const contexto: ContextoCore = {
  usuarioId: "recJJJJJJJJJJJJJJ", activo: true,
  empresa: { id: empresa, clave: "FICTICIA", activa: true },
  sucursalesAutorizadas: [
    { id: principal, empresaId: empresa, nombre: "Centro", activa: true },
    { id: secundaria, empresaId: empresa, nombre: "Norte", activa: true },
  ],
  modulosEmpresa: ["INVENTARIO", "MOVIMIENTOS"],
  modulosUsuario: ["INVENTARIO", "MOVIMIENTOS"],
  permisos: ["inventario.ver", "movimientos.ver", "movimientos.crear"],
};
const ubicaciones = new Map<string, RegistroOperativo>([
  [ubicacion, { id: ubicacion, fields: { SUCURSAL_CORE: [principal] } }],
  [otraUbicacion, { id: otraUbicacion, fields: { SUCURSAL_CORE: [sucursalAjena] } }],
]);
const productos = new Map<string, RegistroOperativo>([
  [producto, { id: producto, fields: { EMPRESA: [empresa] } }],
]);

test("PERMISOS: no se deducen de ADMIN ni se ignora la empresa del recurso", () => {
  assert.equal(puedeRealizarAccion(contexto, "movimientos.ver", { empresaId: empresa, sucursalId: principal }), true);
  assert.equal(puedeRealizarAccion(contexto, "movimientos.ver", { empresaId: otraEmpresa, sucursalId: principal }), false);
  assert.equal(puedeRealizarAccion(contexto, "movimientos.ver", { empresaId: empresa, sucursalId: sucursalAjena }), false);
  assert.equal(puedeRealizarAccion({ ...contexto, permisos: [] }, "movimientos.ver", { empresaId: empresa, sucursalId: principal }), false);
  assert.equal(puedeRealizarAccion({ ...contexto, modulosEmpresa: [] }, "movimientos.ver", { empresaId: empresa, sucursalId: principal }), false);
});

test("PERMISOS: una cuenta o empresa inactiva no resuelve sucursales", () => {
  assert.equal(sucursalSolicitada({ ...contexto, activo: false }, principal), null);
  assert.equal(sucursalSolicitada({ ...contexto, empresa: { ...contexto.empresa, activa: false } }, "Centro"), null);
  assert.equal(ubicacionPermitida(ubicaciones.get(ubicacion)!.fields, { ...contexto, activo: false }), false);
});

test("AISLAMIENTO: una solicitud con formato de ID no se interpreta como nombre", () => {
  const collision: ContextoCore = {
    ...contexto, sucursalesAutorizadas: [
      { id: principal, empresaId: empresa, nombre: "Centro", activa: true },
      { id: secundaria, empresaId: empresa, nombre: sucursalAjena, activa: true },
    ],
  };
  assert.equal(sucursalSolicitada(collision, sucursalAjena), null);
  assert.equal(sucursalSolicitada(collision, secundaria)?.id, secundaria);
  assert.equal(sucursalSolicitada(contexto, "centro")?.id, principal);
  assert.equal(sucursalSolicitada(contexto, "norte")?.id, secundaria);
});

test("AISLAMIENTO: nombres repetidos de sucursales no eligen arbitrariamente", () => {
  const ambiguo: ContextoCore = { ...contexto, sucursalesAutorizadas: [
    { id: principal, empresaId: empresa, nombre: "Centro", activa: true },
    { id: secundaria, empresaId: empresa, nombre: " CENTRO ", activa: true },
  ] };
  assert.equal(sucursalSolicitada(ambiguo, "centro"), null);
  assert.equal(sucursalSolicitada(ambiguo, principal)?.id, principal);
});

test("AISLAMIENTO: campos de vínculos vacíos no se ignoran en movimientos", () => {
  assert.equal(movimientoPermitido({ "UBICACIÓN DESTINO": [ubicacion] }, ubicaciones, contexto), true);
  assert.equal(movimientoPermitido({ "UBICACIÓN ORIGEN": [], "UBICACIÓN DESTINO": [ubicacion] }, ubicaciones, contexto), false);
  assert.equal(movimientoPermitido({ "UBICACIÓN ORIGEN": [ubicacion], "UBICACIÓN DESTINO": [] }, ubicaciones, contexto), false);
  assert.equal(movimientoPermitido({ "UBICACIÓN ORIGEN": [ubicacion], "UBICACIÓN DESTINO": [otraUbicacion] }, ubicaciones, contexto), false);
  assert.equal(movimientoPermitido({}, ubicaciones, contexto), false);
});

test("AISLAMIENTO: cada lote verifica producto y ubicación, no nombres", () => {
  assert.equal(lotePermitido({ PRODUCTOS: [producto], "UBICACIÓN": [ubicacion] }, productos, ubicaciones, contexto), true);
  assert.equal(lotePermitido({ PRODUCTOS: [producto], "UBICACIÓN": [] }, productos, ubicaciones, contexto), false);
  assert.equal(lotePermitido({ PRODUCTOS: [producto, producto], "UBICACIÓN": [ubicacion] }, productos, ubicaciones, contexto), false);
  assert.equal(lotePermitido({ PRODUCTOS: [producto], "UBICACIÓN": [otraUbicacion] }, productos, ubicaciones, contexto), false);
});

test("AISLAMIENTO: registros con vínculos corruptos o ajenos no autorizan", () => {
  assert.equal(productoDeEmpresa({ EMPRESA: [otraEmpresa] }, empresa), false);
  assert.equal(productoDeEmpresa({ EMPRESA: "FICTICIA" }, empresa), false);
  assert.equal(idsVinculados([empresa, { id: otraEmpresa }])?.length, 2);
  assert.equal(idsVinculados([empresa, "NO_ES_ID"]), null);
  assert.equal(sucursalRealDeUbicacion({ SUCURSAL_CORE: [principal, sucursalAjena] }), null);
  assert.equal(ubicacionPermitida({ SUCURSAL: "Centro" }, contexto), false);
});
