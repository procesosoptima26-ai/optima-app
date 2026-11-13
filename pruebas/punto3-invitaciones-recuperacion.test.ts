/** P3 — pruebas simuladas: no solicita ni escribe en proveedores externos. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import activar from "../handlers/usuarios/activar.js";
import validarInvitacion from "../handlers/usuarios/validar-invitacion.js";
import invitar from "../handlers/usuarios/invitar.js";
import solicitarRecuperacion from "../handlers/usuarios/solicitar-recuperacion.js";
import restablecer from "../handlers/usuarios/restablecer.js";
import { buscarUsuarioParaRecuperacion } from "../lib/usuarios-maestros.js";

function respuesta() {
  const actual = { codigo: 200, cuerpo: null as unknown };
  const res = {
    setHeader() { return this; },
    status(codigo: number) { actual.codigo = codigo; return this; },
    json(cuerpo: unknown) { actual.cuerpo = cuerpo; return this; },
  } as unknown as VercelResponse;
  return { actual, res };
}
function peticion(body: unknown, method = "POST") {
  return { method, body, headers: {} } as VercelRequest;
}

test("P3: al estar apagadas las invitaciones, alta/validación/activación fallan sin tocar proveedores", async t => {
  const antigua = process.env.OPTIMA_INVITES_ENABLED;
  const fetchAntiguo = globalThis.fetch;
  process.env.OPTIMA_INVITES_ENABLED = "false";
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw new Error("No realizar conexiones reales en P3"); };
  t.after(() => {
    globalThis.fetch = fetchAntiguo;
    if (antigua === undefined) delete process.env.OPTIMA_INVITES_ENABLED;
    else process.env.OPTIMA_INVITES_ENABLED = antigua;
  });
  for (const handler of [invitar, validarInvitacion, activar]) {
    const r = respuesta();
    await handler(peticion({ token: "A".repeat(43), password: "ClaveValida123!" }), r.res);
    assert.equal(r.actual.codigo, 503);
  }
  assert.equal(llamadas, 0);
});

test("P3 v2: contraseña débil conserva HTTP 400 aun si invitaciones están deshabilitadas", async t => {
  const anterior = process.env.OPTIMA_INVITES_ENABLED;
  const fetchAnterior = globalThis.fetch;
  process.env.OPTIMA_INVITES_ENABLED = "false";
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw new Error("No contactar servicios externos"); };
  t.after(() => {
    globalThis.fetch = fetchAnterior;
    if (anterior === undefined) delete process.env.OPTIMA_INVITES_ENABLED;
    else process.env.OPTIMA_INVITES_ENABLED = anterior;
  });
  const r = respuesta();
  await activar(peticion({ token: "A".repeat(43), password: "Abcdef12" }), r.res);
  assert.equal(r.actual.codigo, 400);
  assert.match(JSON.stringify(r.actual.cuerpo), /símbolo/);
  assert.equal(llamadas, 0);
});

test("P3: no se altera el rechazo de métodos HTTP no permitidos", async () => {
  for (const handler of [validarInvitacion, activar]) {
    const r = respuesta();
    await handler(peticion({}, "GET"), r.res);
    assert.equal(r.actual.codigo, 405);
  }
});

test("P3: recuperación apagada no consulta servicios ni cambia sesiones", async t => {
  const vieja = process.env.OPTIMA_PASSWORD_RESET_ENABLED;
  const fetchAntiguo = globalThis.fetch;
  process.env.OPTIMA_PASSWORD_RESET_ENABLED = "false";
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw new Error("Conexión externa prohibida"); };
  t.after(() => {
    globalThis.fetch = fetchAntiguo;
    if (vieja === undefined) delete process.env.OPTIMA_PASSWORD_RESET_ENABLED;
    else process.env.OPTIMA_PASSWORD_RESET_ENABLED = vieja;
  });
  for (const handler of [solicitarRecuperacion, restablecer]) {
    const r = respuesta();
    await handler(peticion({ usuario: "EMPLEADO", email: "empleado@example.org", token: "A".repeat(43), password: "ClaveValida123!" }), r.res);
    assert.equal(r.actual.codigo, 503);
  }
  assert.equal(llamadas, 0);
});

test("P3: recuperación no elige arbitrariamente un usuario si Airtable devuelve duplicados", async t => {
  const vars = {
    AIRTABLE_USERS_BASE_ID: "appBaseSimulada",
    AIRTABLE_USERS_TABLE_ID: "tblUsuariosSimulados",
    AIRTABLE_TOKEN: "token-falso-sin-uso",
  };
  const previas = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  const fetchAntiguo = globalThis.fetch;
  Object.assign(process.env, vars);
  const id = (car: string) => "rec" + car.repeat(14);
  const campos = { ACTIVO: true, USUARIO: "EMPLEADO", Email: "empleado@example.org",
    EMPRESA: [id("E")], PASSWORD_HASH: "$argon2id$simulado-no-se-utiliza" };
  let total = 2;
  let llamadas = 0;
  globalThis.fetch = async (input, init) => {
    llamadas++;
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.airtable.com");
    assert.equal(url.searchParams.get("maxRecords"), "2");
    assert.equal(init?.method, "GET");
    return Response.json({ records: Array.from({ length: total }, (_, n) => ({ id: id(n === 0 ? "A" : "B"), fields: campos })) });
  };
  t.after(() => {
    globalThis.fetch = fetchAntiguo;
    for (const [k, valor] of Object.entries(previas)) {
      if (valor === undefined) delete process.env[k];
      else process.env[k] = valor;
    }
  });
  assert.equal(await buscarUsuarioParaRecuperacion("EMPLEADO", "empleado@example.org"), null);
  total = 1;
  assert.equal((await buscarUsuarioParaRecuperacion("EMPLEADO", "empleado@example.org"))?.id, id("A"));
  total = 0;
  assert.equal(await buscarUsuarioParaRecuperacion("EMPLEADO", "empleado@example.org"), null);
  assert.equal(llamadas, 3);
});
