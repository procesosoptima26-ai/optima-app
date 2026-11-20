/** Tarea 5.3: lectura del ciclo de vida desde PostgreSQL (con base simulada). */
import test from "node:test";
import assert from "node:assert/strict";
import { leerCicloVidaPg } from "../core/ciclo-vida-pg.js";
import type { PoolPgNode183 } from "../core/adaptador-pg-node-12c183.js";

const EK = "emp_s84ng12hqeq1";
function simular(filas: readonly Record<string, unknown>[], fallo = false) {
  const sql: string[] = [];
  let liberadas = 0;
  const pool: PoolPgNode183 = { async connect() { return {
    async query(q: string, p?: unknown[]) {
      sql.push(q);
      if (fallo && q.includes("ciclo_vida")) throw Error("BD no disponible");
      if (q.includes("set_config")) { assert.deepEqual(p, [EK]); return { rows: [{ empresa_id: EK }], rowCount: 1 }; }
      if (q.includes("FROM optima_comercial.ciclo_vida")) { assert.deepEqual(p, [EK]); return { rows: [...filas], rowCount: filas.length }; }
      return { rows: [], rowCount: 0 };
    },
    release() { liberadas++; },
  }; } };
  return { pool, sql, liberadas: () => liberadas };
}
const fila = { empresa_id: EK, revision: "4", periodo_hasta: new Date("2026-12-01T00:00:00.000Z"), suspendido_desde: null, cancelado_desde: null };

test("ciclo-vida-pg: lee los tres hechos en ISO, en transacción de solo lectura con RLS", async () => {
  const s = simular([fila]);
  const r = await leerCicloVidaPg(s.pool, EK);
  assert.deepEqual(r, { ok: true, hechos: { periodoHasta: "2026-12-01T00:00:00.000Z", suspendidoDesde: null, canceladoDesde: null }, revision: 4 });
  assert.equal(s.sql[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(s.sql.some(q => q.includes("set_config('optima.empresa_id', $1, true)")), true);
  assert.equal(s.sql.at(-1), "ROLLBACK");
  assert.equal(s.liberadas(), 1);
});
test("ciclo-vida-pg: sin registro -> SIN_REGISTRO", async () => {
  assert.deepEqual(await leerCicloVidaPg(simular([]).pool, EK), { ok: false, motivo: "SIN_REGISTRO" });
});
test("ciclo-vida-pg: dos filas, empresa ajena o fecha inválida -> INCONSISTENTE", async () => {
  assert.equal((await leerCicloVidaPg(simular([fila, fila]).pool, EK)).ok, false);
  assert.equal((await leerCicloVidaPg(simular([{ ...fila, empresa_id: "emp_otraotraotr1" }]).pool, EK)).ok, false);
  assert.equal((await leerCicloVidaPg(simular([{ ...fila, periodo_hasta: "no-es-fecha" }]).pool, EK)).ok, false);
  assert.equal((await leerCicloVidaPg(simular([{ ...fila, cancelado_desde: 123 }]).pool, EK)).ok, false);
  assert.equal((await leerCicloVidaPg(simular([{ ...fila, revision: "-1" }]).pool, EK)).ok, false);
});
test("ciclo-vida-pg: ID de empresa inválido no consulta nada", async () => {
  const s = simular([fila]);
  for (const id of ["recAAAAAAAAAAAAAA", "", "emp_MAYUS", "' OR 1=1"]) {
    assert.equal((await leerCicloVidaPg(s.pool, id)).ok, false);
  }
  assert.equal(s.sql.length, 0);
});
test("ciclo-vida-pg: BD caída -> NO_DISPONIBLE y libera la conexión", async () => {
  const s = simular([fila], true);
  assert.deepEqual(await leerCicloVidaPg(s.pool, EK), { ok: false, motivo: "NO_DISPONIBLE" });
  assert.equal(s.liberadas(), 1);
});
