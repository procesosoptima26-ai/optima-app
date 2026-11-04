import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { evaluarCambioSucursal } from "../core/control-cambios-sucursales.js";
import sucursales from "../handlers/core/sucursales.js";

const BASE = {
  perteneceEmpresa: true,
  activa: true,
  usuariosAsignados: 0,
  sucursalesActivas: 2,
  // Este valor solamente existe en datos sintéticos: NO representa una
  // comprobación efectuada sobre la Base Maestra ni sobre inventario.
  referenciasOperativasCompatibles: true,
} as const;

test("11B: bloquear cambio de sucursal ajena", () => {
  const r = evaluarCambioSucursal("renombrar", { ...BASE, perteneceEmpresa: false });
  assert.equal(r.permitido, false);
});

test("11B: rechazar cambios si hay referencias legacy sin migrar", () => {
  for (const accion of ["renombrar", "desactivar"] as const) {
    const r = evaluarCambioSucursal(accion, { ...BASE, referenciasOperativasCompatibles: false });
    assert.equal(r.permitido, false);
  }
});

test("11B: rechazar usuarios no verificados", () => {
  for (const cantidad of [null, -1, 1.1]) {
    const r = evaluarCambioSucursal("desactivar", { ...BASE, usuariosAsignados: cantidad });
    assert.equal(r.permitido, false);
  }
});

test("11B: impedir desactivar sucursal con usuarios", () => {
  assert.equal(evaluarCambioSucursal("desactivar", { ...BASE, usuariosAsignados: 1 }).permitido, false);
});

test("11B: impedir desactivar última sucursal", () => {
  assert.equal(evaluarCambioSucursal("desactivar", { ...BASE, sucursalesActivas: 1 }).permitido, false);
});

test("11B: impedir desactivar sucursal inactiva", () => {
  assert.equal(evaluarCambioSucursal("desactivar", { ...BASE, activa: false }).permitido, false);
});

test("11B: condiciones sintéticas válidas pasan solo evaluación preliminar", () => {
  assert.equal(evaluarCambioSucursal("renombrar", BASE).permitido, true);
  assert.equal(evaluarCambioSucursal("desactivar", BASE).permitido, true);
});

test("11B: PATCH y DELETE aún no escriben sucursales", async () => {
  const anterior = globalThis.fetch;
  let consultas = 0;
  globalThis.fetch = async () => { consultas++; throw new Error("No se debe llamar a servicios externos"); };
  try {
    for (const method of ["PATCH", "DELETE", "PUT"]) {
      let status = 200;
      const req = { method, query: {}, body: { accion: "desactivar" } } as unknown as VercelRequest;
      const res = {
        setHeader() { return this; },
        status(valor: number) { status = valor; return this; },
        json() { return this; },
      } as unknown as VercelResponse;
      await sucursales(req, res);
      assert.equal(status, 405);
    }
    assert.equal(consultas, 0);
  } finally {
    globalThis.fetch = anterior;
  }
});
