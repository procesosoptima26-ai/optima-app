import assert from "node:assert/strict";
import { test } from "node:test";
import { enlaceProveedorAirtable } from "../lib/compras-airtable.js";

test("el enlace al proveedor usa la base, la tabla PROVEEDORES y el id del registro", () => {
  const antes = process.env.AIRTABLE_MOVIMIENTOS_BASE_ID;
  const antesMaestra = process.env.AIRTABLE_USERS_BASE_ID;
  const antesToken = process.env.AIRTABLE_TOKEN;
  process.env.AIRTABLE_MOVIMIENTOS_BASE_ID = "appABCDEFGHIJKLMN";
  process.env.AIRTABLE_USERS_BASE_ID = "appABCDEFGHIJKLMN";
  process.env.AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || "tokenFalso";
  try {
    assert.equal(enlaceProveedorAirtable("recMCEWAk9ActnnPn"),
      "https://airtable.com/appABCDEFGHIJKLMN/tblkcbhcKll84jQoo/recMCEWAk9ActnnPn");
  } finally {
    if (antes === undefined) delete process.env.AIRTABLE_MOVIMIENTOS_BASE_ID; else process.env.AIRTABLE_MOVIMIENTOS_BASE_ID = antes;
    if (antesMaestra === undefined) delete process.env.AIRTABLE_USERS_BASE_ID; else process.env.AIRTABLE_USERS_BASE_ID = antesMaestra;
    if (antesToken === undefined) delete process.env.AIRTABLE_TOKEN;
  }
});

test("un id de proveedor inválido no genera enlace", () => {
  assert.equal(enlaceProveedorAirtable("no-es-un-id"), undefined);
});
