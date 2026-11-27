import assert from "node:assert/strict";
import test from "node:test";
import { juntarVentasDeVentana, type DependenciasVentas } from "../lib/compras-ventas.js";
import type { VentasDelDia } from "../lib/compras-datos.js";

function armar(opts: { cache?: Record<string, VentasDelDia>; fallan?: string[]; relojPorLlamada?: number } = {}) {
  const guardados: string[] = [];
  const leidos: string[] = [];
  let reloj = 0;
  const dep: DependenciasVentas = {
    leerDia: async (d) => {
      leidos.push(d);
      if (opts.fallan?.includes(d)) throw new Error("falla");
      return { s: { p: 1 } };
    },
    leerCache: async (dias) => new Map(Object.entries(opts.cache ?? {}).filter(([d]) => dias.includes(d))),
    guardarCache: async (d) => { guardados.push(d); },
    ahoraMs: () => (reloj += opts.relojPorLlamada ?? 0),
  };
  return { dep, guardados, leidos };
}

const DIAS = ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"];

test("usa el caché y solo pide lo que falta; hoy no se guarda", async () => {
  const { dep, guardados, leidos } = armar({ cache: { "2026-11-24": { s: { p: 9 } } } });
  const r = await juntarVentasDeVentana(DIAS, "2026-11-27", dep, { limiteMs: 1e9 });
  assert.deepEqual(r.pendientes, []);
  assert.deepEqual([...leidos].sort(), ["2026-11-25", "2026-11-26", "2026-11-27"]);
  assert.deepEqual([...guardados].sort(), ["2026-11-25", "2026-11-26"]);
  assert.equal(r.porDia.get("2026-11-24")?.s.p, 9);
});

test("si se acaba el tiempo deja pendientes en vez de colgarse", async () => {
  const { dep, leidos } = armar({ relojPorLlamada: 10 });
  const r = await juntarVentasDeVentana(DIAS, "2026-11-27", dep, { limiteMs: 25, concurrencia: 1 });
  assert.ok(leidos.length >= 1 && leidos.length < DIAS.length);
  assert.equal(r.pendientes.length, DIAS.length - leidos.length);
  assert.equal(leidos[0], "2026-11-27");
});

test("tras varios errores deja de insistir y reporta pendientes", async () => {
  const { dep } = armar({ fallan: DIAS });
  const r = await juntarVentasDeVentana(DIAS, "2026-11-27", dep, { limiteMs: 1e9, concurrencia: 1, maxErrores: 2 });
  assert.equal(r.pendientes.length, DIAS.length);
  assert.ok(r.errores >= 1 && r.errores <= 2);
});

test("con todo en caché no lee nada", async () => {
  const cache = Object.fromEntries(DIAS.slice(0, 3).map((d) => [d, {}]));
  const { dep, leidos } = armar({ cache });
  const r = await juntarVentasDeVentana(DIAS.slice(0, 3), "2026-11-27", dep, { limiteMs: 1e9 });
  assert.equal(leidos.length, 0);
  assert.deepEqual(r.pendientes, []);
});
