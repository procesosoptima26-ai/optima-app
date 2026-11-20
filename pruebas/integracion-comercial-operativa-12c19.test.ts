/** OPTIMA 12C.19: pruebas del guard comercial y de la consulta PostgreSQL RLS. */
import test from "node:test";
import assert from "node:assert/strict";
import { autorizarCapacidadOperativa } from "../core/autorizacion-comercial-operativa-12c19.js";
import { leerContratoOperativoPg } from "../core/contrato-vigente-pg-12c19.js";
import type { PoolPgNode183 } from "../core/adaptador-pg-node-12c183.js";
import type { ContextoCore } from "../core/seguridad.js";

const E = "rec" + "E".repeat(14);
const U = "rec" + "U".repeat(14);
const S = "rec" + "S".repeat(14);
const OTRA = "rec" + "O".repeat(14);
const EK = "emp_" + "e".repeat(12); // clave estable de empresa en Neon
const OTRAK = "emp_" + "o".repeat(12);
const F = "2026-11-13T18:00:00.000Z";
const activo = [{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESENCIAL" }] as const;
const individual = [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "INV_PRODUCTOS", nivel: "ESTANDAR" }] as const;
const contexto = (principal = true): ContextoCore => ({
  usuarioId: U, activo: true,
  empresa: { id: E, clave: "TEST", activa: true, idEstable: EK },
  sucursalesAutorizadas: [{ id: S, nombre: "PRUEBA", activa: true, empresaId: E }],
  modulosEmpresa: principal ? ["INVENTARIO"] : [],
  modulosUsuario: principal ? ["INVENTARIO"] : [],
  permisos: principal ? ["inventario.ver"] : [],
});
const peticion = (ctx = contexto()) => ({
  contexto: ctx, capacidad: "inventario.productos.consultar", modulo: "INVENTARIO" as const,
  permiso: "inventario.ver" as const, recurso: { empresaId: E, sucursalId: S },
});
function deps(contrato: unknown = activo, permisos: string[] = ["inventario.ver"], submodulos: string[] = []) {
  return {
    async consultarContrato() { return { ok: true as const, contrato: { empresaId: EK, idContrato: "OPT-TEST", idVersion: "VER-TEST01", numero: 1, servicios: contrato } } as any; },
    async consultarAsignaciones() { return { ok: true as const, usuarioId: U, empresaId: E, permisosAsignadosUsuario: permisos, submodulosHabilitadosUsuario: submodulos } as any; },
    async consultarCicloVida() { return { ok: true as const, hechos: { periodoHasta: "2027-01-01T00:00:00.000Z", suspendidoDesde: null, canceladoDesde: null }, revision: 1 }; },
    ahoraIso: () => F,
  };
}

test("12C19: módulo principal ESENCIAL + permiso servidor -> permite consulta publicada", async () => {
  assert.equal(await autorizarCapacidadOperativa(peticion(), deps()), true);
});
test("12C19: no concede prestaciones individuales sin permiso expreso", async () => {
  assert.equal(await autorizarCapacidadOperativa(peticion(contexto(false)), deps(individual)), false);
});
test("12C19: submódulo independiente y asignación expresa sí funciona", async () => {
  assert.equal(await autorizarCapacidadOperativa(peticion(contexto(false)), deps(individual, ["inventario.ver"], ["INV_PRODUCTOS"])), true);
});
test("12C19: la consulta de contrato usa el ID ESTABLE, no el código de Airtable", async () => {
  const pedidos: string[] = [];
  const d = deps();
  const ok = await autorizarCapacidadOperativa(peticion(), { ...d, consultarContrato: async (id: string) => { pedidos.push(id); return d.consultarContrato(); } });
  assert.equal(ok, true);
  assert.deepEqual(pedidos, [EK]);
});
test("12C19: empresa SIN ID estable válido deniega y NO consulta el contrato", async () => {
  for (const idEstable of [undefined, E, "emp_MAYUSCULAS1", ""]) {
    let consultas = 0;
    const d = deps();
    const ctx = { ...contexto(), empresa: { id: E, clave: "TEST", activa: true, ...(idEstable === undefined ? {} : { idEstable }) } } as ContextoCore;
    const ok = await autorizarCapacidadOperativa(peticion(ctx), { ...d, consultarContrato: async () => { consultas++; return d.consultarContrato(); } });
    assert.equal(ok, false);
    assert.equal(consultas, 0);
  }
});
test("12C19: contrato de OTRA empresa estable no habilita aunque el resto coincida", async () => {
  const d = deps();
  const ok = await autorizarCapacidadOperativa(peticion(), { ...d, consultarContrato: async () => ({ ok: true, contrato: { empresaId: OTRAK, idContrato: "OPT-X", idVersion: "VER-X00001", numero: 1, servicios: activo } } as any) });
  assert.equal(ok, false);
});
test("12C19: contrato y usuario son restricciones acumulativas", async () => {
  assert.equal(await autorizarCapacidadOperativa(peticion(), deps(activo, [])), false);
  assert.equal(await autorizarCapacidadOperativa(peticion(), deps([])), false);
  assert.equal(await autorizarCapacidadOperativa(peticion(), deps([{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "NO_EXISTE" }])), false);
});
test("12C19: empresa, sucursal, módulo, permiso y capacidad ajenos no habilitan", async () => {
  assert.equal(await autorizarCapacidadOperativa({ ...peticion(), recurso: { empresaId: OTRA, sucursalId: S } }, deps()), false);
  assert.equal(await autorizarCapacidadOperativa({ ...peticion(), recurso: { empresaId: E, sucursalId: OTRA } }, deps()), false);
  assert.equal(await autorizarCapacidadOperativa({ ...peticion(), capacidad: "inventario.inventado" }, deps()), false);
  assert.equal(await autorizarCapacidadOperativa({ ...peticion(), permiso: "inventario.crear" }, deps()), false);
  assert.equal(await autorizarCapacidadOperativa({ ...peticion(), modulo: "MOVIMIENTOS" }, deps()), false);
});
test("12C19: contrato ajeno o respuesta Airtable incoherente falla cerrado", async () => {
  const d = deps();
  assert.equal(await autorizarCapacidadOperativa(peticion(), { ...d, consultarContrato: async () => ({ ok: true, contrato: { empresaId: OTRAK, servicios: activo } } as any) }), false);
  assert.equal(await autorizarCapacidadOperativa(peticion(), { ...d, consultarAsignaciones: async () => ({ ok: true, usuarioId: U, empresaId: OTRA, permisosAsignadosUsuario: ["inventario.ver"], submodulosHabilitadosUsuario: [] } as any) }), false);
  assert.equal(await autorizarCapacidadOperativa(peticion(), { ...d, consultarContrato: async () => { throw Error("BD caída"); } }), false);
});

type Simulador = { pool: PoolPgNode183; sql: string[]; liberadas: () => number };
function simularPg(filas: readonly Record<string, unknown>[], fallo = false): Simulador {
  const sql: string[] = [];
  let liberadas = 0;
  const pool: PoolPgNode183 = { async connect() { return {
    async query(q: string, p?: unknown[]) {
      sql.push(q);
      if (fallo && q.includes("JOIN optima_comercial.versiones")) throw Error("BD no disponible");
      if (q.includes("set_config")) {
        assert.deepEqual(p, [EK]);
        return { rows: [{ empresa_id: EK }], rowCount: 1 };
      }
      if (q.includes("JOIN optima_comercial.versiones")) {
        assert.deepEqual(p, [EK]);
        return { rows: [...filas], rowCount: filas.length };
      }
      return { rows: [], rowCount: 0 };
    },
    release() { liberadas++; },
  }; } };
  return { pool, sql, liberadas: () => liberadas };
}
const fila = {
  empresa_id: EK, id_contrato: "OPT-TEST", revision: "2", id_version: "VER-TEST01",
  numero: 1, estado: "VIGENTE", servicios: activo,
  vigente_desde: "2026-11-12T15:00:00.000Z", vigente_hasta: null,
  aprobado_por_id: U, aprobado_en: "2026-11-11T15:00:00.000Z",
};
test("12C19: PostgreSQL lee una foto, parametrizada, con SET LOCAL + RLS", async () => {
  const s = simularPg([fila]);
  const r = await leerContratoOperativoPg(s.pool, EK, F);
  assert.equal(r.ok, true);
  assert.equal(s.sql[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(s.sql.some(q => q.includes("set_config('optima.empresa_id', $1, true)")), true);
  assert.equal(s.sql.some(q => q.includes("LIMIT 2")), true);
  assert.equal(s.sql.at(-1), "ROLLBACK");
  assert.equal(s.liberadas(), 1);
});
test("12C19: cero o múltiples versiones vigentes niegan todo", async () => {
  assert.equal((await leerContratoOperativoPg(simularPg([]).pool, EK, F)).ok, false);
  assert.equal((await leerContratoOperativoPg(simularPg([fila, { ...fila, id_contrato: "OTRO" }]).pool, E, F)).ok, false);
});
test("12C19: contrato futuro, vencido, empresa falsa, servicios inválidos bloquean", async () => {
  const malos = [
    { ...fila, vigente_desde: "2026-11-14T00:00:00.000Z" },
    { ...fila, vigente_hasta: "2026-11-13T17:00:00.000Z" },
    { ...fila, empresa_id: OTRAK },
    { ...fila, servicios: ["invalido"] },
  ];
  for (const f of malos) assert.equal((await leerContratoOperativoPg(simularPg([f]).pool, EK, F)).ok, false);
});
test("12C19: PG caído devuelve NO_DISPONIBLE y libera conexión", async () => {
  const s = simularPg([fila], true);
  const r = await leerContratoOperativoPg(s.pool, EK, F);
  assert.deepEqual(r, { ok: false, motivo: "NO_DISPONIBLE" });
  assert.equal(s.sql.at(-1), "ROLLBACK");
  assert.equal(s.liberadas(), 1);
});
test("12C19: un empresaId inválido se bloquea SIN consultar base", async () => {
  const s = simularPg([fila]);
  assert.equal((await leerContratoOperativoPg(s.pool, "otro", F)).ok, false);
  assert.equal(s.sql.length, 0);
});
test("12C19: el código interno de Airtable (rec...) ya no es clave válida en Neon", async () => {
  const s = simularPg([fila]);
  assert.deepEqual(await leerContratoOperativoPg(s.pool, E, F), { ok: false, motivo: "INCONSISTENTE" });
  assert.equal(s.sql.length, 0);
});

test("12C19: si falla el ROLLBACK, nunca concede acceso", async () => {
  const s = simularPg([fila]);
  const pool: PoolPgNode183 = { async connect() {
    const real = await s.pool.connect();
    return { ...real, async query(sql: string, parametros?: unknown[]) {
      if (sql === "ROLLBACK") throw Error("fin de transacción incierto");
      return real.query(sql, parametros);
    } };
  } };
  assert.deepEqual(await leerContratoOperativoPg(pool, EK, F), { ok: false, motivo: "NO_DISPONIBLE" });
  assert.equal(s.liberadas(), 1);
});

// ---- Tarea 5.3: el ciclo de vida de la empresa condiciona el acceso ----
const conCiclo = (hechos: { periodoHasta: string | null; suspendidoDesde: string | null; canceladoDesde: string | null }) =>
  ({ ...deps(), consultarCicloVida: async () => ({ ok: true as const, hechos, revision: 1 }) });
const SIN = { suspendidoDesde: null, canceladoDesde: null };
test("ciclo: ACTIVO y GRACIA permiten consultar", async () => {
  assert.equal(await autorizarCapacidadOperativa(peticion(), conCiclo({ periodoHasta: "2026-12-01T00:00:00.000Z", ...SIN })), true);
  // vencido hace 5 días (gracia = 10): sigue permitiendo
  assert.equal(await autorizarCapacidadOperativa(peticion(), conCiclo({ periodoHasta: "2026-11-08T18:00:00.000Z", ...SIN })), true);
});
test("ciclo: SOLO_LECTURA permite ver (las acciones que modifican se deniegan en estadoPermiteAccion; hoy no existe ninguna capacidad operativa de escritura)", async () => {
  const solo = conCiclo({ periodoHasta: "2026-10-20T18:00:00.000Z", ...SIN }); // vencido hace 24 días: pasó la gracia
  assert.equal(await autorizarCapacidadOperativa(peticion(), solo), true); // inventario.ver
});
test("ciclo: CERRADA deniega incluso consultar", async () => {
  assert.equal(await autorizarCapacidadOperativa(peticion(), conCiclo({ periodoHasta: "2026-01-01T00:00:00.000Z", ...SIN })), false);
  assert.equal(await autorizarCapacidadOperativa(peticion(), conCiclo({ periodoHasta: "2027-01-01T00:00:00.000Z", suspendidoDesde: null, canceladoDesde: "2026-01-01T00:00:00.000Z" })), false);
});
test("ciclo: suspendida por OPTIMA = solo lectura (consultar sí)", async () => {
  assert.equal(await autorizarCapacidadOperativa(peticion(), conCiclo({ periodoHasta: "2027-01-01T00:00:00.000Z", suspendidoDesde: "2026-11-10T00:00:00.000Z", canceladoDesde: null })), true);
});
test("ciclo: sin registro, inconsistente, error o datos inválidos deniegan", async () => {
  const d = deps();
  for (const motivo of ["SIN_REGISTRO", "INCONSISTENTE", "NO_DISPONIBLE"] as const) {
    assert.equal(await autorizarCapacidadOperativa(peticion(), { ...d, consultarCicloVida: async () => ({ ok: false as const, motivo }) }), false);
  }
  assert.equal(await autorizarCapacidadOperativa(peticion(), { ...d, consultarCicloVida: async () => { throw Error("BD caída"); } }), false);
  assert.equal(await autorizarCapacidadOperativa(peticion(), conCiclo({ periodoHasta: "mañana", ...SIN })), false);
});
test("ciclo: el ciclo se consulta con el ID ESTABLE", async () => {
  const pedidos: string[] = [];
  const d = deps();
  await autorizarCapacidadOperativa(peticion(), { ...d, consultarCicloVida: async (id: string) => { pedidos.push(id); return d.consultarCicloVida(); } });
  assert.deepEqual(pedidos, [EK]);
});
