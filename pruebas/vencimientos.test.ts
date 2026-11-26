/** Alerta de vencimientos: reglas de clasificación (lógica pura). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularVencimientos,
  diasHasta,
  hoyArgentina,
  nivelPorDias,
  vencimientosACsv,
  type LoteVencimiento,
} from "../src/modules/movimientos/vencimientos.js";

const HOY = "2026-11-26";

function lote(id: string, vencimiento: string | null, cantidad: number, extra: Partial<LoteVencimiento> = {}): LoteVencimiento {
  return {
    id,
    productoId: `p-${id}`,
    codigo: `77${id}`,
    nombreProducto: `Producto ${id}`,
    ubicacionId: "u1",
    ubicacionNombre: "BELLA VISTA | GÓNDOLA",
    vencimiento,
    cantidad,
    ...extra,
  };
}

test("diasHasta cuenta días corridos y rechaza fechas inválidas", () => {
  assert.equal(diasHasta(HOY, "2026-11-26"), 0);
  assert.equal(diasHasta(HOY, "2026-11-27"), 1);
  assert.equal(diasHasta(HOY, "2026-11-25"), -1);
  assert.equal(diasHasta(HOY, "2027-01-26"), 61);
  assert.equal(diasHasta(HOY, "2026-02-31"), null);
  assert.equal(diasHasta(HOY, "basura"), null);
});

test("los niveles se reparten en los límites exactos", () => {
  assert.equal(nivelPorDias(-1), "VENCIDO");
  assert.equal(nivelPorDias(0), "VENCE_7");
  assert.equal(nivelPorDias(7), "VENCE_7");
  assert.equal(nivelPorDias(8), "VENCE_15");
  assert.equal(nivelPorDias(15), "VENCE_15");
  assert.equal(nivelPorDias(16), "VENCE_30");
  assert.equal(nivelPorDias(30), "VENCE_30");
  assert.equal(nivelPorDias(31), "VENCE_60");
  assert.equal(nivelPorDias(60), "VENCE_60");
  assert.equal(nivelPorDias(61), "VENCE_90");
  assert.equal(nivelPorDias(90), "VENCE_90");
  assert.equal(nivelPorDias(91), null);
});

test("ignora lotes sin fecha, sin unidades o con fecha imposible; los vencidos con stock se muestran siempre", () => {
  const r = calcularVencimientos({
    hoy: HOY,
    diasAviso: 15,
    lotes: [
      lote("1", null, 5),
      lote("2", "2026-12-01", 0),
      lote("3", "2026-02-31", 4),
      lote("4", "2026-11-20", 2), // vencido
      lote("5", "2026-12-01", 3), // 5 días
      lote("6", "2027-03-01", 9), // lejano
    ],
  });
  assert.deepEqual(r.grupos.map((g) => g.nivel), ["VENCIDO", "VENCE_7"]);
  assert.equal(r.totalLotes, 2);
  assert.equal(r.totalUnidades, 5);
});

test("diasAviso recorta lo que se muestra hacia adelante", () => {
  const lotes = [lote("1", "2026-12-20", 1), lote("2", "2027-01-20", 1), lote("3", "2027-02-20", 1)];
  const r30 = calcularVencimientos({ hoy: HOY, diasAviso: 30, lotes });
  const r90 = calcularVencimientos({ hoy: HOY, diasAviso: 90, lotes });
  assert.equal(r30.totalLotes, 1);
  assert.equal(r90.totalLotes, 3);
});

test("ordena por urgencia y suma unidades con decimales sin errores de redondeo", () => {
  const r = calcularVencimientos({
    hoy: HOY,
    diasAviso: 30,
    lotes: [lote("1", "2026-12-03", 0.1), lote("2", "2026-12-01", 0.2), lote("3", "2026-12-03", 0.7)],
  });
  assert.equal(r.grupos.length, 1);
  assert.deepEqual(r.grupos[0].items.map((i) => i.id), ["2", "1", "3"]);
  assert.equal(r.grupos[0].unidades, 1);
});

test("filtra por ubicación y por texto (sin importar acentos ni mayúsculas)", () => {
  const lotes = [
    lote("1", "2026-12-01", 1, { nombreProducto: "Turrón Arcor", ubicacionId: "u1" }),
    lote("2", "2026-12-01", 1, { nombreProducto: "Yerba Playadito", ubicacionId: "u2" }),
  ];
  assert.equal(calcularVencimientos({ hoy: HOY, diasAviso: 30, lotes, ubicacionId: "u2" }).totalLotes, 1);
  assert.equal(calcularVencimientos({ hoy: HOY, diasAviso: 30, lotes, texto: "TURRON" }).totalLotes, 1);
  assert.equal(calcularVencimientos({ hoy: HOY, diasAviso: 30, lotes, texto: "nada" }).totalLotes, 0);
});

test("CSV: separador punto y coma, coma decimal y comillas escapadas", () => {
  const r = calcularVencimientos({
    hoy: HOY,
    diasAviso: 30,
    lotes: [lote("1", "2026-12-01", 0.5, { nombreProducto: 'Queso "Sardo"; entero' })],
  });
  const csv = vencimientosACsv(r.grupos);
  assert.ok(csv.startsWith("﻿Estado;Código;Producto;Ubicación;Vencimiento;Días;Cantidad"));
  assert.ok(csv.includes('"Queso ""Sardo""; entero"'));
  assert.ok(csv.includes(";2026-12-01;5;0,5"));
});

test("hoyArgentina devuelve la fecha de Argentina aunque en UTC ya sea otro día", () => {
  // 02:30 UTC del 27 = 23:30 del 26 en Argentina.
  assert.equal(hoyArgentina(new Date("2026-11-27T02:30:00Z")), "2026-11-26");
  assert.equal(hoyArgentina(new Date("2026-11-27T12:00:00Z")), "2026-11-27");
});
