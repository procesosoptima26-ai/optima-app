import assert from "node:assert/strict";
import { test } from "node:test";
import { crearInvitacion, consultarInvitacion, consumirInvitacion, validarClaveNueva } from "../lib/invitaciones.js";

const id = `rec${"A".repeat(14)}`;

test("invitación Redis almacena hash, vence y es de un solo uso", async (t) => {
  const fAnterior = globalThis.fetch;
  const a = process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const b = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  const store = new Map<string, string>();
  const comandos: unknown[][] = [];
  process.env.UPSTASH_REDIS_KV_REST_API_URL = "https://redis-prueba.invalid";
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN = "ficticio";
  t.after(() => { globalThis.fetch = fAnterior;
    if(a===undefined)delete process.env.UPSTASH_REDIS_KV_REST_API_URL;else process.env.UPSTASH_REDIS_KV_REST_API_URL=a;
    if(b===undefined)delete process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;else process.env.UPSTASH_REDIS_KV_REST_API_TOKEN=b; });
  globalThis.fetch = async (_input, init) => {
    const cmd = JSON.parse(String(init?.body)) as string[];
    comandos.push(cmd);
    const [op, key, value] = cmd;
    if (op === "SET") { store.set(key, value); return Response.json({ result: "OK" }); }
    if (op === "GET") return Response.json({ result: store.get(key) ?? null });
    if (op === "GETDEL") { const old=store.get(key)??null;store.delete(key);return Response.json({ result: old }); }
    return Response.json({ error: "comando no esperado" });
  };
  const datos = { usuarioId:id, empresaId:`rec${"B".repeat(14)}`, email:"test@example.org", tipo:"activacion" as const };
  const token = await crearInvitacion(datos);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(![...store.keys()].some(k => k.includes(token)));
  assert.ok(comandos.some((c) => c[0] === "SET" && c[3] === "EX" && c[4] === 86400));
  assert.deepEqual(await consultarInvitacion(token), datos);
  assert.deepEqual(await consumirInvitacion(token), datos);
  assert.equal(await consumirInvitacion(token), null);
  assert.equal(await consultarInvitacion(token), null);
});

test("contraseñas para activar deben tener longitud, números y letras", () => {
  assert.equal(validarClaveNueva("ClaveFicticia123"), true);
  assert.equal(validarClaveNueva("123456789012"), false);
  assert.equal(validarClaveNueva("demasiadocorta"), false);
  assert.equal(validarClaveNueva("Aa123"), false);
});
