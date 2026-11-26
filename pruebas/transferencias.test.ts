import assert from "node:assert/strict";
import { test } from "node:test";
import {
  destinosTransferencia, validarTransferencia, esMotivoTransferencia,
  type UbicacionTransferencia,
} from "../lib/transferencias.js";
import { movimientoPermitido, type RegistroOperativo } from "../lib/alcance-operativo.js";
import type { ContextoCore } from "../core/seguridad.js";

const emp = "recAAAAAAAAAAAAAA";
const sucGoya = "recGGGGGGGGGGGGGG";
const sucBella = "recBBBBBBBBBBBBBB";
const sucVieja = "recVVVVVVVVVVVVVV";
const sucAjena = "recXXXXXXXXXXXXXX";
const u = (id: string, sucursalCoreId: string | null, nombre = id): UbicacionTransferencia =>
  ({ id, nombre, tipoUbicacion: "GÓNDOLA", sucursalCoreId });
const origenGoya = u("recO0000000000001", sucGoya);
const destBella = u("recD0000000000001", sucBella);
const destAjena = u("recD0000000000002", sucAjena);
const destGoya = u("recD0000000000003", sucGoya);
const activas = new Set([sucGoya, sucBella]);

const base = (cambios: Partial<Parameters<typeof validarTransferencia>[0]> = {}) => validarTransferencia({
  tipoMovimiento: "EGRESO", origen: origenGoya, destino: destBella,
  sucursalUsuarioId: sucGoya, sucursalesActivasEmpresaIds: activas, ...cambios,
});

test("transferencia válida a otra sucursal activa de la misma empresa", () => {
  assert.equal(base(), "");
});
test("rechaza destino de otra empresa o sucursal inactiva", () => {
  assert.match(base({ destino: destAjena }), /sucursal activa de tu empresa/);
  assert.match(base({ destino: u("recD0000000000009", sucVieja) }), /sucursal activa de tu empresa/);
  assert.match(base({ destino: u("recD0000000000008", null) }), /sucursal activa de tu empresa/);
});
test("rechaza destino en la misma sucursal, origen ajeno y datos faltantes", () => {
  assert.match(base({ destino: destGoya }), /Reposición/);
  assert.match(base({ origen: u("recO0000000000002", sucBella) }), /origen no pertenece/);
  assert.match(base({ origen: null }), /origen/);
  assert.match(base({ destino: null }), /destino/);
  assert.match(base({ tipoMovimiento: "INGRESO" }), /egreso/);
});
test("destinos: excluye origen, inactivas y sucursales sin ubicaciones", () => {
  const r = destinosTransferencia(
    [{ id: sucGoya, nombre: "GOYA", activa: true }, { id: sucBella, nombre: "BELLA VISTA", activa: true },
     { id: sucVieja, nombre: "VIEJA", activa: false }, { id: "recSINUBI0000000", nombre: "VACÍA", activa: true }],
    [origenGoya, destBella, u("recD0000000000004", sucVieja), destAjena], sucGoya);
  assert.deepEqual(r.map((d) => d.sucursalNombre), ["BELLA VISTA"]);
  assert.deepEqual(r[0].ubicaciones.map((x) => x.id), [destBella.id]);
});
test("esMotivoTransferencia", () => {
  assert.equal(esMotivoTransferencia("TRANSFERENCIA"), true);
  assert.equal(esMotivoTransferencia(" transferencia "), true);
  assert.equal(esMotivoTransferencia("VENTA"), false);
  assert.equal(esMotivoTransferencia(undefined), false);
});

const ctx = (sucId: string): ContextoCore => ({
  usuarioId: "recJJJJJJJJJJJJJJ", activo: true,
  empresa: { id: emp, clave: "A", activa: true },
  sucursalesAutorizadas: [{ id: sucId, nombre: "X", empresaId: emp, activa: true }],
  modulosEmpresa: ["MOVIMIENTOS"], modulosUsuario: ["MOVIMIENTOS"], permisos: ["movimientos.ver"],
});
const mapa = new Map<string, RegistroOperativo>([origenGoya, destBella, destAjena].map((x) =>
  [x.id, { id: x.id, fields: { SUCURSAL_CORE: x.sucursalCoreId ? [x.sucursalCoreId] : [] } }]));
const mov = (motivo: string, destino: string) => ({
  MOTIVO: motivo, "UBICACIÓN ORIGEN": [origenGoya.id], "UBICACIÓN DESTINO": [destino],
});

test("historial: la transferencia la ven quien envía y quien recibe", () => {
  assert.equal(movimientoPermitido(mov("TRANSFERENCIA", destBella.id), mapa, ctx(sucGoya)), true);
  assert.equal(movimientoPermitido(mov("TRANSFERENCIA", destBella.id), mapa, ctx(sucBella)), true);
  assert.equal(movimientoPermitido(mov("TRANSFERENCIA", destBella.id), mapa, ctx(sucBella), sucBella), true);
});
test("historial: un tercero no ve la transferencia y otros motivos siguen estrictos", () => {
  assert.equal(movimientoPermitido(mov("TRANSFERENCIA", destBella.id), mapa, ctx(sucAjena)), false);
  assert.equal(movimientoPermitido(mov("REPOSICIÓN", destBella.id), mapa, ctx(sucGoya)), false);
  assert.equal(movimientoPermitido(mov("TRANSFERENCIA", "recZZZZZZZZZZZZZZ"), mapa, ctx(sucGoya)), true);
});
