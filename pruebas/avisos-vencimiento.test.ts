import test from "node:test";
import assert from "node:assert/strict";
import { calcularAviso, claveAviso, redactarAviso } from "../core/avisos-vencimiento.js";

const HASTA = "2026-12-20T12:00:00.000Z";
const DIA = 24 * 60 * 60 * 1000;
const en = (ms: number) => new Date(Date.parse(HASTA) + ms).toISOString();
const hechos = (extra: Record<string, string | null> = {}) =>
  ({ periodoHasta: HASTA, suspendidoDesde: null, canceladoDesde: null, ...extra });
const tipo = (ahora: string, h = hechos()) => {
  const r = calcularAviso(h, ahora);
  assert.equal(r.ok, true);
  return r.ok ? (r.aviso?.tipo ?? null) : "INVALIDO";
};

test("faltando más de 15 días no hay aviso", () => assert.equal(tipo(en(-20 * DIA)), null));
test("15, 14.5 y 8 días antes: VENCE_15", () => {
  for (const d of [15, 14.5, 8]) assert.equal(tipo(en(-d * DIA)), "VENCE_15", String(d));
});
test("7 y 2 días antes: VENCE_7", () => { for (const d of [7, 6, 2]) assert.equal(tipo(en(-d * DIA)), "VENCE_7", String(d)); });
test("1 día, 1 hora y el instante exacto del vencimiento: VENCE_1", () => {
  for (const ms of [-DIA, -3600000, 0]) assert.equal(tipo(en(ms)), "VENCE_1", String(ms));
});
test("recién vencido: EN_GRACIA con 10 días hasta la fecha límite", () => {
  const r = calcularAviso(hechos(), en(3600000));
  assert.ok(r.ok && r.aviso);
  if (r.ok && r.aviso) {
    assert.equal(r.aviso.tipo, "EN_GRACIA");
    assert.equal(r.aviso.diasRestantes, 10);
    assert.equal(r.aviso.fechaLimite, en(10 * DIA));
    assert.equal(r.aviso.periodoHasta, HASTA);
  }
});
test("terminada la gracia: SOLO_LECTURA y fecha límite = fin del solo lectura", () => {
  const r = calcularAviso(hechos(), en(10 * DIA + 3600000));
  assert.ok(r.ok && r.aviso);
  if (r.ok && r.aviso) { assert.equal(r.aviso.tipo, "SOLO_LECTURA"); assert.equal(r.aviso.fechaLimite, en(40 * DIA)); }
});
test("empresa ya cerrada, suspendida, cancelada o sin fecha: no se avisa", () => {
  assert.equal(tipo(en(41 * DIA)), null);
  assert.equal(tipo(en(-10 * DIA), hechos({ suspendidoDesde: en(-20 * DIA) })), null);
  assert.equal(tipo(en(-10 * DIA), hechos({ canceladoDesde: en(-20 * DIA) })), null);
  assert.equal(tipo(en(-10 * DIA), hechos({ periodoHasta: null })), null);
});
test("datos inválidos: error, nunca un aviso", () => {
  assert.deepEqual(calcularAviso(hechos({ periodoHasta: "mañana" }), en(0)), { ok: false, motivo: "DATOS_INVALIDOS" });
  assert.deepEqual(calcularAviso(hechos(), "ayer"), { ok: false, motivo: "DATOS_INVALIDOS" });
});
test("clave anti-duplicados: depende de ambiente, empresa, período y tipo; rechaza datos malos", () => {
  const av = { tipo: "VENCE_7" as const, periodoHasta: HASTA, diasRestantes: 7, fechaLimite: HASTA };
  assert.equal(claveAviso("preview", "emp_abcdefghij12", av), `optima:aviso:preview:emp_abcdefghij12:${HASTA}:VENCE_7`);
  assert.throws(() => claveAviso("preview", "rec4tLlE2dddN2SPL", av));
  assert.throws(() => claveAviso("Preview!", "emp_abcdefghij12", av));
  assert.throws(() => claveAviso("preview", "emp_abcdefghij12", { ...av, tipo: "OTRO" as never }));
});
test("redacción: nombre y fecha, sin enlaces; el nombre no puede inyectar saltos de línea", () => {
  for (const t of ["VENCE_15", "VENCE_7", "VENCE_1", "EN_GRACIA", "SOLO_LECTURA"] as const) {
    const m = redactarAviso({ tipo: t, periodoHasta: HASTA, diasRestantes: 5, fechaLimite: HASTA }, "MORELLIS\r\nBcc: x@y.com");
    assert.ok(!m.asunto.includes("\n") && !m.asunto.includes("\r"), t);
    assert.ok(m.asunto.includes("MORELLIS"), t);
    assert.ok(/diciembre de 2026/.test(m.texto), t);
    assert.ok(!/https?:\/\//.test(m.texto), t);
  }
});
