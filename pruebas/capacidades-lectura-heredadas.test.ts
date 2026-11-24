/** Tarea 11 (lecturas): capacidades de LECTURA de pantallas heredadas (Movimientos y Administración). */
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
  { modalidad: "MODULO_PRINCIPAL", modulo: "MOVIMIENTOS", nivel: "ESENCIAL" },
  { modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "ESENCIAL" },
] as const;
const PERMISOS = ["movimientos.ver", "administracion.ver"];
const ctx = (): ContextoCore => ({
  usuarioId: U, activo: true,
  empresa: { id: E, clave: "TEST", activa: true, idEstable: EK },
  sucursalesAutorizadas: [{ id: S, nombre: "PRUEBA", activa: true, empresaId: E }],
  modulosEmpresa: ["MOVIMIENTOS", "ADMINISTRACION"], modulosUsuario: ["MOVIMIENTOS", "ADMINISTRACION"],
  permisos: PERMISOS as Permiso[],
});
function deps(opts: { servicios?: unknown; permisos?: string[]; ciclo?: Record<string, unknown> } = {}) {
  return {
    async consultarContrato() { return { ok: true as const, contrato: { empresaId: EK, idContrato: "OPT-T", idVersion: "VER-T00001", numero: 1, servicios: opts.servicios ?? contrato } } as any; },
    async consultarAsignaciones() { return { ok: true as const, usuarioId: U, empresaId: E,
      permisosAsignadosUsuario: opts.permisos ?? PERMISOS, submodulosHabilitadosUsuario: [] } as any; },
    async consultarCicloVida() { return { ok: true as const, hechos: { periodoHasta: "2027-01-01T00:00:00.000Z", suspendidoDesde: null, canceladoDesde: null, ...opts.ciclo }, revision: 1 }; },
    ahoraIso: () => AHORA,
  };
}
const CASOS: readonly [string, "MOVIMIENTOS" | "ADMINISTRACION", Permiso][] = [
  ["movimientos.registro.consultar", "MOVIMIENTOS", "movimientos.ver"],
  ["administracion.terceros.consultar", "ADMINISTRACION", "administracion.ver"],
];
const pedir = (c: string, m: "MOVIMIENTOS" | "ADMINISTRACION", p: Permiso) =>
  ({ contexto: ctx(), capacidad: c, modulo: m, permiso: p, recurso: { empresaId: E, sucursalId: S } });

test("Lecturas: las 2 capacidades están publicadas a nivel módulo", () => {
  for (const [id, modulo, permiso] of CASOS) {
    const d = CAPACIDADES_OPERATIVAS_12C19.find((c) => c.id === id);
    assert.ok(d, id); assert.equal(d.modulo, modulo); assert.equal(d.permiso, permiso); assert.equal(d.submodulo, null);
  }
});
test("Lecturas: con módulo contratado, ciclo ACTIVO y permiso real, se permite", async () => {
  for (const [c, m, p] of CASOS) assert.equal(await autorizarCapacidadOperativa(pedir(c, m, p), deps()), true, c);
});
test("Lecturas: en SOLO_LECTURA (suspensión) las lecturas SIGUEN permitidas", async () => {
  for (const [c, m, p] of CASOS) {
    assert.equal(await autorizarCapacidadOperativa(pedir(c, m, p), deps({ ciclo: { suspendidoDesde: "2026-11-20T00:00:00.000Z" } })), true, c);
  }
});
test("Lecturas: empresa CERRADA (período vencido hace tiempo) deniega", async () => {
  for (const [c, m, p] of CASOS) {
    assert.equal(await autorizarCapacidadOperativa(pedir(c, m, p), deps({ ciclo: { periodoHasta: "2026-01-01T00:00:00.000Z" } })), false, c);
  }
});
test("Lecturas: sin módulo en el contrato o sin permiso del usuario, deniega", async () => {
  const soloAdmin = [{ modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "ESENCIAL" }];
  assert.equal(await autorizarCapacidadOperativa(pedir("movimientos.registro.consultar", "MOVIMIENTOS", "movimientos.ver"), deps({ servicios: soloAdmin })), false);
  assert.equal(await autorizarCapacidadOperativa(pedir("administracion.terceros.consultar", "ADMINISTRACION", "administracion.ver"), deps({ permisos: ["movimientos.ver"] })), false);
});
test("Lecturas: una capacidad no puede usarse con otro permiso o módulo", async () => {
  assert.equal(await autorizarCapacidadOperativa(pedir("movimientos.registro.consultar", "MOVIMIENTOS", "movimientos.crear"), deps()), false);
  assert.equal(await autorizarCapacidadOperativa(pedir("administracion.terceros.consultar", "MOVIMIENTOS", "movimientos.ver"), deps()), false);
});
