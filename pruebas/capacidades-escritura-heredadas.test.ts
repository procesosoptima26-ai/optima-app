/** Tarea 11: capacidades de ESCRITURA de las pantallas heredadas (Movimientos y Stock). */
import test from "node:test";
import assert from "node:assert/strict";
import { autorizarCapacidadOperativa } from "../core/autorizacion-comercial-operativa-12c19.js";
import { CAPACIDADES_OPERATIVAS_12C19 } from "../core/capacidades-implementadas-12c19.js";
import type { ContextoCore, Permiso } from "../core/seguridad.js";

const E = "rec" + "E".repeat(14);
const U = "rec" + "U".repeat(14);
const S = "rec" + "S".repeat(14);
const EK = "emp_" + "e".repeat(12);
const AHORA = "2026-11-24T18:00:00.000Z";
const contrato = [
  { modalidad: "MODULO_PRINCIPAL", modulo: "MOVIMIENTOS", nivel: "PREMIUM" },
  { modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESENCIAL" },
] as const;
const ctx = (): ContextoCore => ({
  usuarioId: U, activo: true,
  empresa: { id: E, clave: "TEST", activa: true, idEstable: EK },
  sucursalesAutorizadas: [{ id: S, nombre: "PRUEBA", activa: true, empresaId: E }],
  modulosEmpresa: ["MOVIMIENTOS", "INVENTARIO"], modulosUsuario: ["MOVIMIENTOS", "INVENTARIO"],
  permisos: ["movimientos.crear", "movimientos.ajustar", "inventario.crear", "inventario.editarGuardado"],
});
function deps(opts: { servicios?: unknown; permisos?: string[]; ciclo?: Record<string, unknown> } = {}) {
  return {
    async consultarContrato() { return { ok: true as const, contrato: { empresaId: EK, idContrato: "OPT-T", idVersion: "VER-T00001", numero: 1, servicios: opts.servicios ?? contrato } } as any; },
    async consultarAsignaciones() { return { ok: true as const, usuarioId: U, empresaId: E,
      permisosAsignadosUsuario: opts.permisos ?? ["movimientos.crear", "movimientos.ajustar", "inventario.crear", "inventario.editarGuardado"],
      submodulosHabilitadosUsuario: [] } as any; },
    async consultarCicloVida() { return { ok: true as const, hechos: { periodoHasta: "2027-01-01T00:00:00.000Z", suspendidoDesde: null, canceladoDesde: null, ...opts.ciclo }, revision: 1 }; },
    ahoraIso: () => AHORA,
  };
}
const CASOS: readonly [string, "MOVIMIENTOS" | "INVENTARIO", Permiso][] = [
  ["movimientos.registro.crear", "MOVIMIENTOS", "movimientos.crear"],
  ["movimientos.registro.ajustar", "MOVIMIENTOS", "movimientos.ajustar"],
  ["inventario.stock.crear", "INVENTARIO", "inventario.crear"],
  ["inventario.stock.editar", "INVENTARIO", "inventario.editarGuardado"],
];
const pedir = (c: string, m: "MOVIMIENTOS" | "INVENTARIO", p: Permiso) =>
  ({ contexto: ctx(), capacidad: c, modulo: m, permiso: p, recurso: { empresaId: E, sucursalId: S } });

test("Tarea 11: las 4 capacidades están publicadas a nivel módulo", () => {
  for (const [id, modulo, permiso] of CASOS) {
    const d = CAPACIDADES_OPERATIVAS_12C19.find((c) => c.id === id);
    assert.ok(d, id); assert.equal(d.modulo, modulo); assert.equal(d.permiso, permiso); assert.equal(d.submodulo, null);
  }
});
test("Tarea 11: con módulo contratado, ciclo ACTIVO y permiso real, se permite", async () => {
  for (const [c, m, p] of CASOS) assert.equal(await autorizarCapacidadOperativa(pedir(c, m, p), deps()), true, c);
});
test("Tarea 11: en SOLO_LECTURA (suspensión) las 4 escrituras se deniegan", async () => {
  for (const [c, m, p] of CASOS) {
    assert.equal(await autorizarCapacidadOperativa(pedir(c, m, p), deps({ ciclo: { suspendidoDesde: "2026-11-20T00:00:00.000Z" } })), false, c);
  }
});
test("Tarea 11: empresa CERRADA o con período vencido hace tiempo deniega", async () => {
  for (const [c, m, p] of CASOS) {
    assert.equal(await autorizarCapacidadOperativa(pedir(c, m, p), deps({ ciclo: { periodoHasta: "2026-01-01T00:00:00.000Z" } })), false, c);
  }
});
test("Tarea 11: sin el módulo en el contrato, o sin el permiso del usuario, deniega", async () => {
  const soloInventario = [{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESENCIAL" }];
  assert.equal(await autorizarCapacidadOperativa(pedir("movimientos.registro.crear", "MOVIMIENTOS", "movimientos.crear"), deps({ servicios: soloInventario })), false);
  assert.equal(await autorizarCapacidadOperativa(pedir("movimientos.registro.ajustar", "MOVIMIENTOS", "movimientos.ajustar"), deps({ permisos: ["movimientos.crear"] })), false);
  assert.equal(await autorizarCapacidadOperativa(pedir("inventario.stock.crear", "INVENTARIO", "inventario.crear"), deps({ servicios: [] })), false);
});
test("Tarea 11: un submódulo suelto NO habilita pantallas heredadas de nivel módulo", async () => {
  const suelto = [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "MOV_VENTAS_EGRESOS", nivel: "ESTANDAR" }];
  assert.equal(await autorizarCapacidadOperativa(pedir("movimientos.registro.crear", "MOVIMIENTOS", "movimientos.crear"), deps({ servicios: suelto })), false);
});
test("Tarea 11: una capacidad no puede usarse con otro permiso o módulo", async () => {
  assert.equal(await autorizarCapacidadOperativa(pedir("movimientos.registro.crear", "MOVIMIENTOS", "movimientos.ajustar"), deps()), false);
  assert.equal(await autorizarCapacidadOperativa(pedir("inventario.stock.crear", "MOVIMIENTOS", "movimientos.crear"), deps()), false);
});
