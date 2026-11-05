import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "../handlers/core/sucursales.js";

const id = (x: string) => "rec" + x.repeat(14);
const tabla = (x: string) => "tbl" + x.repeat(14);
const ADMIN = id("A"), EMPRESA = id("B"), BV = id("C"), GOYA = id("D");
const USERS = tabla("U"), COMPANIES = tabla("E"), BRANCHES = tabla("S");
const TOKEN = "s".repeat(43);

test("11B: renombrar por ID y desactivar solamente sucursales vacías", async (t) => {
  const oldFetch = globalThis.fetch;
  const env = {
    AIRTABLE_USERS_BASE_ID: "app" + "X".repeat(14), AIRTABLE_USERS_TABLE_ID: USERS,
    AIRTABLE_COMPANIES_TABLE_ID: COMPANIES, AIRTABLE_SUCURSALES_TABLE_ID: BRANCHES,
    AIRTABLE_TOKEN: "ficticio", UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
  };
  const oldEnv = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [k, v] of Object.entries(oldEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  let autorizado = false, asignados = false, bloqueo = false, modificaciones = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const ruta = url.pathname;
    if (url.hostname === "redis-prueba.invalid") {
      const [cmd, key] = JSON.parse(String(init?.body)) as [string, string];
      if (cmd === "GET") return Response.json({ result: key.startsWith("optima:version-sesion:") ? null :
        JSON.stringify({ usuarioId: ADMIN, versionSesion: 0 }) });
      if (cmd === "SET") { if (bloqueo) return Response.json({ result: null }); bloqueo = true; return Response.json({ result: "OK" }); }
      if (cmd === "EVAL") { bloqueo = false; return Response.json({ result: 1 }); }
      throw Error("Comando Redis no simulado");
    }
    assert.equal(url.hostname, "api.airtable.com");
    if (ruta.endsWith(`/${USERS}/${ADMIN}`)) return Response.json({ id: ADMIN, fields: {
      USUARIO: "ADMIN", ROL: "ADMIN", ACTIVO: true, EMPRESA: [EMPRESA], MODULOS: ["USUARIO"],
      SUCURSALES_AUTORIZADAS: [BV], SUCURSAL_PREDETERMINADA: [BV],
      PERMISOS_USUARIOS: ["GESTIONAR USUARIOS"],
      ...(autorizado ? { PERMISOS_SUCURSALES: ["GESTIONAR SUCURSALES"] } : {}),
    } });
    if (ruta.endsWith(`/${COMPANIES}/${EMPRESA}`)) return Response.json({ id: EMPRESA, fields: {
      ACTIVA: true, CLAVE_EMPRESA: "PRUEBA", MODULOS_CONTRATADOS: ["USUARIO"],
      SUCURSALES: [BV, GOYA],
    } });
    if (ruta.endsWith(`/${BRANCHES}/${BV}`) && init?.method === "PATCH") {
      modificaciones++;
      const datos = JSON.parse(String(init.body));
      return Response.json({ id: BV, fields: datos.fields });
    }
    if (ruta.endsWith(`/${BRANCHES}/${BV}`)) return Response.json({ id: BV, fields: {
      NOMBRE: "Bella Vista", ACTIVA: true, EMPRESA: [EMPRESA],
      ...(asignados ? { USUARIOS_AUTORIZADOS: [ADMIN] } : {}),
    } });
    if (ruta.endsWith(`/${BRANCHES}/${GOYA}`)) return Response.json({ id: GOYA, fields: {
      NOMBRE: "Goya", ACTIVA: true, EMPRESA: [EMPRESA],
    } });
    throw Error("Consulta no simulada: " + ruta);
  };

  async function solicitar(method: string, body: unknown, cookie = true): Promise<number> {
    const req = { method, query: {}, body, cookies: cookie ? { optima_sesion: TOKEN } : {} } as unknown as VercelRequest;
    let status = 200;
    const res = { setHeader() { return this; }, status(n: number) { status = n; return this; },
      json() { return this; } } as unknown as VercelResponse;
    await handler(req, res);
    return status;
  }
  assert.equal(await solicitar("PATCH", { accion: "renombrar", id: BV, nombre: "BV Centro" }, false), 401);
  assert.equal(await solicitar("PATCH", { accion: "renombrar", id: BV, nombre: "BV Centro" }), 403);
  assert.equal(modificaciones, 0);
  autorizado = true;
  assert.equal(await solicitar("PATCH", { accion: "renombrar", id: BV, nombre: "Goya" }), 400);
  assert.equal(await solicitar("PATCH", { accion: "renombrar", id: id("Z"), nombre: "BV Centro" }), 404);
  assert.equal(await solicitar("PATCH", { accion: "renombrar", id: BV, nombre: "BV Centro" }), 200);
  assert.equal(modificaciones, 1);
  asignados = true;
  assert.equal(await solicitar("DELETE", { accion: "desactivar", id: BV }), 409);
  assert.equal(modificaciones, 1);
  asignados = false;
  assert.equal(await solicitar("DELETE", { accion: "desactivar", id: BV }), 200);
  assert.equal(modificaciones, 2);
  assert.equal(bloqueo, false);
});
