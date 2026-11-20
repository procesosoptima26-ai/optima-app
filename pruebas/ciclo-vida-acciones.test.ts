/** Tarea 5.4: acciones de OPTIMA sobre el ciclo de vida (regla pura + transacción simulada). */
import test from "node:test";
import assert from "node:assert/strict";
import { calcularTransicion, aplicarAccionCicloVidaPg, motivoValido } from "../core/ciclo-vida-acciones.js";
import type { PoolPgNode183 } from "../core/adaptador-pg-node-12c183.js";
import type { HechosCicloVida } from "../core/ciclo-vida-contrato.js";

const EK = "emp_s84ng12hqeq1";
const ACTOR = "rec" + "A".repeat(14);
const AHORA = "2026-11-20T15:00:00.000Z";
const FUTURO = "2026-12-20T00:00:00.000Z";
const MOTIVO = "Renovación mensual confirmada por transferencia";
const base: HechosCicloVida = { periodoHasta: "2026-12-01T00:00:00.000Z", suspendidoDesde: null, canceladoDesde: null };

test("transición: alta inicial solo por RENOVACION", () => {
  assert.deepEqual(calcularTransicion(null, "RENOVACION", AHORA, FUTURO), { ok: true, hechos: { periodoHasta: FUTURO, suspendidoDesde: null, canceladoDesde: null } });
  for (const a of ["SUSPENSION", "LEVANTAR_SUSPENSION", "CANCELACION", "REACTIVACION"] as const) {
    assert.equal(calcularTransicion(null, a, AHORA, FUTURO).ok, false);
  }
});
test("transición: renovar extiende, nunca acorta, y no reactiva una cancelada", () => {
  assert.equal(calcularTransicion(base, "RENOVACION", AHORA, "2027-01-01T00:00:00.000Z").ok, true);
  assert.equal(calcularTransicion(base, "RENOVACION", AHORA, "2026-11-25T00:00:00.000Z").ok, false); // acorta
  assert.equal(calcularTransicion(base, "RENOVACION", AHORA, "2026-11-01T00:00:00.000Z").ok, false); // pasado
  assert.equal(calcularTransicion({ ...base, canceladoDesde: "2026-11-10T00:00:00.000Z" }, "RENOVACION", AHORA, "2027-01-01T00:00:00.000Z").ok, false);
  assert.equal(calcularTransicion(base, "RENOVACION", AHORA).ok, false); // falta la fecha
});
test("transición: suspender / levantar", () => {
  const s = calcularTransicion(base, "SUSPENSION", AHORA);
  assert.deepEqual(s, { ok: true, hechos: { ...base, suspendidoDesde: AHORA } });
  assert.equal(calcularTransicion((s as any).hechos, "SUSPENSION", AHORA).ok, false); // ya suspendida
  assert.deepEqual(calcularTransicion((s as any).hechos, "LEVANTAR_SUSPENSION", AHORA), { ok: true, hechos: base });
  assert.equal(calcularTransicion(base, "LEVANTAR_SUSPENSION", AHORA).ok, false); // no estaba suspendida
});
test("transición: cancelar y reactivar (vuelve todo a la normalidad con nuevo período)", () => {
  const c = calcularTransicion(base, "CANCELACION", AHORA) as any;
  assert.equal(c.hechos.canceladoDesde, AHORA);
  assert.equal(calcularTransicion(c.hechos, "CANCELACION", AHORA).ok, false);
  assert.equal(calcularTransicion(c.hechos, "SUSPENSION", AHORA).ok, false);
  const r = calcularTransicion(c.hechos, "REACTIVACION", AHORA, FUTURO);
  assert.deepEqual(r, { ok: true, hechos: { periodoHasta: FUTURO, suspendidoDesde: null, canceladoDesde: null } });
  assert.equal(calcularTransicion(base, "REACTIVACION", AHORA, FUTURO).ok, false); // no estaba cancelada
  assert.equal(calcularTransicion(c.hechos, "REACTIVACION", AHORA).ok, false); // sin nueva fecha
});
test("transición: fecha sobrante en acciones que no la usan, o acción inventada, se rechaza", () => {
  assert.equal(calcularTransicion(base, "SUSPENSION", AHORA, FUTURO).ok, false);
  assert.equal(calcularTransicion(base, "BORRAR" as any, AHORA).ok, false);
  assert.equal(calcularTransicion(base, "SUSPENSION", "ayer").ok, false);
});
test("motivo: 10 a 500 caracteres, sin espacios en los bordes ni caracteres de control", () => {
  assert.equal(motivoValido(MOTIVO), true);
  for (const m of ["corto", " " + MOTIVO, MOTIVO + " ", "x".repeat(501), "con\nsalto de línea", 5, null]) assert.equal(motivoValido(m), false);
});

/** Base simulada con estado: emula las sentencias exactas del motor. */
function simular(inicial: { hechos: HechosCicloVida; revision: number } | null, falloEn?: string) {
  let fila = inicial ? { ...inicial } : null;
  const eventos: any[] = [];
  const log: string[] = [];
  let liberadas = 0;
  const pool: PoolPgNode183 = { async connect() {
    let copiaFila = fila ? { ...fila } : null, copiaEv = eventos.length;
    return {
      async query(q: string, p: unknown[] = []) {
        const k = q.trim().split(/\s+/).slice(0, 2).join(" ");
        log.push(k);
        if (falloEn && q.includes(falloEn)) throw Error("BD caída");
        if (q.includes("set_config")) return { rows: [{ empresa_id: p[0] }], rowCount: 1 };
        if (q.startsWith("BEGIN")) { copiaFila = fila ? { ...fila } : null; copiaEv = eventos.length; return { rows: [], rowCount: null }; }
        if (q.includes("FOR UPDATE")) return fila ? { rows: [{ empresa_id: EK, periodo_hasta: fila.hechos.periodoHasta === null ? null : new Date(fila.hechos.periodoHasta), suspendido_desde: fila.hechos.suspendidoDesde, cancelado_desde: fila.hechos.canceladoDesde, revision: String(fila.revision) }], rowCount: 1 } : { rows: [], rowCount: 0 };
        if (q.includes("INSERT INTO optima_comercial.ciclo_vida\n") || /INSERT INTO optima_comercial\.ciclo_vida\s*\(/.test(q)) { fila = { hechos: { periodoHasta: p[1] as any, suspendidoDesde: p[2] as any, canceladoDesde: p[3] as any }, revision: p[4] as number }; return { rows: [], rowCount: 1 }; }
        if (q.includes("UPDATE optima_comercial.ciclo_vida")) { if (!fila || fila.revision !== p[5]) return { rows: [], rowCount: 0 }; fila = { hechos: { periodoHasta: p[1] as any, suspendidoDesde: p[2] as any, canceladoDesde: p[3] as any }, revision: p[4] as number }; return { rows: [], rowCount: 1 }; }
        if (q.includes("ciclo_vida_eventos")) { eventos.push(p); return { rows: [], rowCount: 1 }; }
        if (q.startsWith("ROLLBACK")) { fila = copiaFila; eventos.length = copiaEv; return { rows: [], rowCount: null }; }
        return { rows: [], rowCount: null };
      },
      release() { liberadas++; },
    };
  } };
  return { pool, estado: () => ({ fila, eventos, log, liberadas }) };
}
const reloj = () => AHORA;

test("aplicar: alta inicial crea registro y evento con actor, motivo y fecha", async () => {
  const s = simular(null);
  const r = await aplicarAccionCicloVidaPg(s.pool, ACTOR, { empresaId: EK, accion: "RENOVACION", motivo: MOTIVO, revisionEsperada: 0, nuevoPeriodoHasta: FUTURO }, reloj);
  assert.deepEqual(r, { ok: true, revision: 1, estado: "ACTIVO", hechos: { periodoHasta: FUTURO, suspendidoDesde: null, canceladoDesde: null } });
  const e = s.estado();
  assert.equal(e.eventos.length, 1);
  assert.deepEqual(e.eventos[0].slice(0, 5), [EK, 1, "RENOVACION", ACTOR, MOTIVO]);
  assert.equal(e.eventos[0][8], AHORA);
  assert.equal(e.log.at(-1), "COMMIT");
  assert.equal(e.liberadas, 1);
});
test("aplicar: suspender sube la revisión y el estado pasa a SOLO_LECTURA", async () => {
  const s = simular({ hechos: base, revision: 3 });
  const r = await aplicarAccionCicloVidaPg(s.pool, ACTOR, { empresaId: EK, accion: "SUSPENSION", motivo: "Falta de pago de dos meses", revisionEsperada: 3 }, reloj);
  assert.equal(r.ok && r.revision, 4);
  assert.equal(r.ok && r.estado, "SOLO_LECTURA");
});
test("aplicar: revisión desactualizada NO cambia nada (dos operadores a la vez)", async () => {
  const s = simular({ hechos: base, revision: 3 });
  const r = await aplicarAccionCicloVidaPg(s.pool, ACTOR, { empresaId: EK, accion: "SUSPENSION", motivo: "Falta de pago de dos meses", revisionEsperada: 2 }, reloj);
  assert.deepEqual(r, { ok: false, motivo: "REVISION_DESACTUALIZADA" });
  assert.equal(s.estado().eventos.length, 0);
  assert.equal(s.estado().fila?.revision, 3);
  assert.equal(s.estado().liberadas, 1);
});
test("aplicar: transición inválida se rechaza y no escribe", async () => {
  const s = simular({ hechos: base, revision: 1 });
  const r = await aplicarAccionCicloVidaPg(s.pool, ACTOR, { empresaId: EK, accion: "LEVANTAR_SUSPENSION", motivo: "No estaba suspendida pero lo intento", revisionEsperada: 1 }, reloj);
  assert.deepEqual(r, { ok: false, motivo: "TRANSICION_INVALIDA" });
  assert.equal(s.estado().eventos.length, 0);
});
test("aplicar: solicitud inválida no abre conexión", async () => {
  const s = simular(null);
  const malas: any[] = [
    [ACTOR, { empresaId: "recAAAAAAAAAAAAAA", accion: "RENOVACION", motivo: MOTIVO, revisionEsperada: 0, nuevoPeriodoHasta: FUTURO }],
    ["usuario-cualquiera", { empresaId: EK, accion: "RENOVACION", motivo: MOTIVO, revisionEsperada: 0, nuevoPeriodoHasta: FUTURO }],
    [ACTOR, { empresaId: EK, accion: "RENOVACION", motivo: "corto", revisionEsperada: 0, nuevoPeriodoHasta: FUTURO }],
    [ACTOR, { empresaId: EK, accion: "RENOVACION", motivo: MOTIVO, revisionEsperada: -1, nuevoPeriodoHasta: FUTURO }],
    [ACTOR, { empresaId: EK, accion: "ELIMINAR", motivo: MOTIVO, revisionEsperada: 0 }],
  ];
  for (const [a, sol] of malas) assert.deepEqual(await aplicarAccionCicloVidaPg(s.pool, a, sol, reloj), { ok: false, motivo: "SOLICITUD_INVALIDA" });
  assert.equal(s.estado().log.length, 0);
});
test("aplicar: si la base falla a mitad, se deshace todo (ni estado ni evento)", async () => {
  const s = simular({ hechos: base, revision: 1 }, "ciclo_vida_eventos");
  const r = await aplicarAccionCicloVidaPg(s.pool, ACTOR, { empresaId: EK, accion: "CANCELACION", motivo: "El cliente pidió la baja por escrito", revisionEsperada: 1 }, reloj);
  assert.deepEqual(r, { ok: false, motivo: "ERROR_BD" });
  assert.equal(s.estado().fila?.revision, 1);
  assert.equal(s.estado().fila?.hechos.canceladoDesde, null);
  assert.equal(s.estado().eventos.length, 0);
  assert.equal(s.estado().log.includes("ROLLBACK"), true);
  assert.equal(s.estado().liberadas, 1);
});
