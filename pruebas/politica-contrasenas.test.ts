import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { validarClaveNueva } from "../lib/invitaciones.js";
import activar from "../handlers/usuarios/activar.js";

test("Política: acepta 8-128 caracteres con letra, número y símbolo", () => {
  assert.equal(validarClaveNueva("Abcdef1!"), true);
  assert.equal(validarClaveNueva("ClaveLarga2026#"), true);
  assert.equal(validarClaveNueva("A1!" + "x".repeat(125)), true);
});

test("Política: rechaza claves incompletas y espacios como falso símbolo", () => {
  for (const valor of ["Abc1!", "Abcdef12", "abcdefgh!", "1234567!", "Abcdef12 ",
    "A1!" + "x".repeat(126), "", 123, null]) {
    assert.equal(validarClaveNueva(valor), false, `No debería aceptar: ${String(valor)}`);
  }
});

test("API: rechaza contraseña débil antes de contactar Airtable o Redis", async () => {
  const res = {
    codigo: 200,
    cuerpo: null as unknown,
    setHeader() { return this; },
    status(codigo: number) { this.codigo = codigo; return this; },
    json(cuerpo: unknown) { this.cuerpo = cuerpo; return this; },
  };
  const req = { method: "POST", body: { token: "z".repeat(43), password: "Abcdef12" } };
  await activar(req as VercelRequest, res as unknown as VercelResponse);
  assert.equal(res.codigo, 400);
  assert.match(JSON.stringify(res.cuerpo), /símbolo/);
});
