import assert from "node:assert/strict";
import test from "node:test";
import { analizarVencimientos } from "../lib/compras-vencimientos.js";

const HOY = "2026-11-27";
const en = (dias: number) => new Date(Date.UTC(2026, 10, 27 + dias)).toISOString().slice(0, 10);

test("lote sin fecha cuenta entero y no genera aviso", () => {
  const r = analizarVencimientos([{ cantidad: 10, vencimiento: null }], HOY, 0);
  assert.deepEqual(r, { stockVendible: 10, vencidas: 0, porVencer: 0, primerVencimiento: null });
});

test("lote vencido no cuenta como vendible y se informa", () => {
  const r = analizarVencimientos([{ cantidad: 7, vencimiento: en(-3) }, { cantidad: 5, vencimiento: null }], HOY, 1);
  assert.equal(r.stockVendible, 5);
  assert.equal(r.vencidas, 7);
  assert.equal(r.primerVencimiento, en(-3));
});

test("vence hoy: ya no se alcanza a vender nada de ese lote", () => {
  const r = analizarVencimientos([{ cantidad: 4, vencimiento: HOY }], HOY, 2);
  assert.equal(r.stockVendible, 0);
  assert.equal(r.porVencer, 4);
});

test("se vende solo lo que alcanza antes del vencimiento (ritmo × días)", () => {
  // 1 por día, vence en 10 días, hay 25: se venden 10, se pierden 15.
  const r = analizarVencimientos([{ cantidad: 25, vencimiento: en(10) }], HOY, 1);
  assert.equal(r.stockVendible, 10);
  assert.equal(r.porVencer, 15);
  assert.equal(r.primerVencimiento, en(10));
});

test("si alcanza a venderse todo, no hay aviso", () => {
  const r = analizarVencimientos([{ cantidad: 8, vencimiento: en(10) }], HOY, 1);
  assert.equal(r.stockVendible, 8);
  assert.equal(r.porVencer, 0);
  assert.equal(r.primerVencimiento, null);
});

test("primero se vende el lote que vence antes; el segundo comparte la capacidad de venta", () => {
  // 1 por día. Lote A: 6 u. vence en 5 días (se venden 5, se pierde 1). Lote B: 10 u. vence en 12 días.
  // Hasta el día 12 se venden 12 en total: 5 del A y 7 del B → B pierde 3.
  const r = analizarVencimientos(
    [{ cantidad: 10, vencimiento: en(12) }, { cantidad: 6, vencimiento: en(5) }],
    HOY, 1,
  );
  assert.equal(r.stockVendible, 12);
  assert.equal(r.porVencer, 4);
  assert.equal(r.primerVencimiento, en(5));
});

test("sin ventas, todo lo que vence dentro de 90 días está en riesgo", () => {
  const r = analizarVencimientos([{ cantidad: 3, vencimiento: en(30) }], HOY, 0);
  assert.equal(r.stockVendible, 0);
  assert.equal(r.porVencer, 3);
});

test("lo que vence en más de 90 días cuenta entero (todavía no es accionable)", () => {
  const r = analizarVencimientos([{ cantidad: 9, vencimiento: en(91) }], HOY, 0);
  assert.equal(r.stockVendible, 9);
  assert.equal(r.porVencer, 0);
});

test("ignora lotes sin cantidad y no se rompe con ritmo inválido", () => {
  const r = analizarVencimientos([{ cantidad: 0, vencimiento: en(1) }, { cantidad: 2, vencimiento: null }], HOY, Number.NaN);
  assert.equal(r.stockVendible, 2);
});
