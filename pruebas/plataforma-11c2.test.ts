import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { esCuentaPlataformaConfigurada, leerAccesoPlataforma, presentarUsuarioPlataforma } from "../core/acceso-plataforma.js";
import consultarPlataforma from "../handlers/core/plataforma.js";

const id = (x: string) => "rec" + x.repeat(14);
const tabla = (x: string) => "tbl" + x.repeat(14);
const USUARIO = id("A"), EMPRESA = id("B"), OTRA = id("C"), CLIENTE = id("D");
const USERS = tabla("U"), COMPANIES = tabla("E");
const COOKIE = "s".repeat(43);

// Nunca llama a Airtable real ni a Redis real. Se mockean todas las respuestas.
test("11C.2: identidad de plataforma separada y bloqueo ante cambios de estado", async (t) => {
  const originalFetch = globalThis.fetch;
  const env = {
    OPTIMA_PLATFORM_ADMIN_USER_ID: USUARIO,
    OPTIMA_PLATFORM_COMPANY_ID: EMPRESA,
    AIRTABLE_USERS_BASE_ID: "app" + "X".repeat(14),
    AIRTABLE_USERS_TABLE_ID: USERS,
    AIRTABLE_COMPANIES_TABLE_ID: COMPANIES,
    AIRTABLE_TOKEN: "ficticio",
  };
  const antiguos = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(antiguos)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  let rol = "ADMIN";
  let empresaVinculada = EMPRESA;
  let sucursales: string[] = [];
  let activa = true;
  let empresaActiva = true;
  let escrituras = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.airtable.com");
    if (init?.method && init.method !== "GET") escrituras++;
    if (url.pathname.endsWith(`/${USERS}/${USUARIO}`)) return Response.json({ id: USUARIO, fields: {
      ACTIVO: activa, ROL: rol, EMPRESA: [empresaVinculada],
      USUARIO: "OPTIMA_ADMIN", NOMBRE: "Administración OPTIMA",
      SUCURSALES_AUTORIZADAS: sucursales, SUCURSAL_PREDETERMINADA: [],
    } });
    if (url.pathname.endsWith(`/${COMPANIES}/${EMPRESA}`)) return Response.json({ id: EMPRESA, fields: {
      ACTIVA: empresaActiva, CLAVE_EMPRESA: "OPTIMA", NOMBRE_COMERCIAL: "OPTIMA",
    } });
    throw Error("Acceso no previsto: " + url.pathname);
  };
  assert.equal(esCuentaPlataformaConfigurada(USUARIO), true);
  assert.equal(esCuentaPlataformaConfigurada(CLIENTE), false);
  assert.equal(await leerAccesoPlataforma(CLIENTE), null);
  const correcto = await leerAccesoPlataforma(USUARIO);
  assert.ok(correcto && correcto !== false);
  assert.equal(correcto.empresaId, EMPRESA);
  const publico = presentarUsuarioPlataforma(correcto);
  assert.equal(publico.rol, "PLATAFORMA");
  assert.deepEqual(publico.sucursales, []);
  assert.deepEqual(publico.modulos, []);
  assert.deepEqual(publico.permisos, []);
  rol = "USUARIO";
  assert.equal(await leerAccesoPlataforma(USUARIO), false);
  rol = "ADMIN";
  empresaVinculada = OTRA;
  assert.equal(await leerAccesoPlataforma(USUARIO), false);
  empresaVinculada = EMPRESA;
  sucursales = [id("S")];
  assert.equal(await leerAccesoPlataforma(USUARIO), false);
  sucursales = [];
  activa = false;
  assert.equal(await leerAccesoPlataforma(USUARIO), false);
  activa = true;
  empresaActiva = false;
  assert.equal(await leerAccesoPlataforma(USUARIO), false);
  assert.equal(escrituras, 0);
});

test("11C.2: GET plataforma aislado, paginado y sin operaciones de escritura", async (t) => {
  const originalFetch = globalThis.fetch;
  const keys = ["OPTIMA_PLATFORM_ADMIN_USER_ID", "OPTIMA_PLATFORM_COMPANY_ID", "AIRTABLE_USERS_BASE_ID",
    "AIRTABLE_USERS_TABLE_ID", "AIRTABLE_COMPANIES_TABLE_ID", "AIRTABLE_TOKEN",
    "UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN"] as const;
  const previos = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, {
    OPTIMA_PLATFORM_ADMIN_USER_ID: USUARIO,
    OPTIMA_PLATFORM_COMPANY_ID: EMPRESA,
    AIRTABLE_USERS_BASE_ID: "app" + "X".repeat(14),
    AIRTABLE_USERS_TABLE_ID: USERS,
    AIRTABLE_COMPANIES_TABLE_ID: COMPANIES,
    AIRTABLE_TOKEN: "ficticio", UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(previos)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  let idSesion = USUARIO;
  let empresasConsultadas = 0;
  let escrituras = 0;
  let empresaActiva = true;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "redis-prueba.invalid") {
      const [cmd, key] = JSON.parse(String(init?.body)) as [string, string];
      assert.equal(cmd, "GET");
      return Response.json({ result: key.startsWith("optima:version-sesion:") ? null :
        JSON.stringify({ usuarioId: idSesion, versionSesion: 0 }) });
    }
    assert.equal(url.hostname, "api.airtable.com");
    if (init?.method && init.method !== "GET") escrituras++;
    if (url.pathname.endsWith(`/${USERS}/${USUARIO}`)) return Response.json({ id: USUARIO, fields: {
      ACTIVO: true, ROL: "ADMIN", EMPRESA: [EMPRESA], USUARIO: "ADMIN_GLOBAL", NOMBRE: "Plataforma",
    } });
    if (url.pathname.endsWith(`/${COMPANIES}/${EMPRESA}`)) return Response.json({ id: EMPRESA, fields: {
      ACTIVA: empresaActiva, NOMBRE_COMERCIAL: "OPTIMA", CLAVE_EMPRESA: "OPTIMA",
    } });
    if (url.pathname.endsWith(`/${COMPANIES}`)) {
      empresasConsultadas++;
      if (url.searchParams.has("offset")) return Response.json({ records: [{ id: EMPRESA, fields: {
        NOMBRE_COMERCIAL: "OPTIMA", CLAVE_EMPRESA: "OPTIMA", ACTIVA: true, MODULOS_CONTRATADOS: ["USUARIO"],
      } }] });
      return Response.json({ records: [{ id: OTRA, fields: {
        NOMBRE_COMERCIAL: "Cliente", CLAVE_EMPRESA: "CLIENTE", ACTIVA: true,
        MODULOS_CONTRATADOS: ["INVENTARIO", "CUENTAS CORRIENTES"],
      } }], offset: "pagina2" });
    }
    throw Error("Consulta inesperada: " + url.pathname);
  };
  async function pedir(method: string, cookie: boolean): Promise<{ status: number; json: any }> {
    const req = { method, query: { empresaId: OTRA }, cookies: cookie ? { optima_sesion: COOKIE } : {} } as unknown as VercelRequest;
    let status = 200;
    let json: any;
    const res = { setHeader() { return this; }, status(n: number) { status = n; return this; }, json(value: any) { json = value; return this; } } as unknown as VercelResponse;
    await consultarPlataforma(req, res);
    return { status, json };
  }
  assert.equal((await pedir("POST", true)).status, 405);
  assert.equal((await pedir("GET", false)).status, 401);
  idSesion = CLIENTE;
  assert.equal((await pedir("GET", true)).status, 403);
  assert.equal(empresasConsultadas, 0);
  idSesion = USUARIO;
  const valido = await pedir("GET", true);
  assert.equal(valido.status, 200);
  assert.equal(valido.json.soloConsulta, true);
  assert.equal(valido.json.empresas.length, 2);
  assert.equal(valido.json.empresas.find((e: { id: string }) => e.id === OTRA).modulosHabilitados.includes("CUENTAS_CORRIENTES"), true);
  assert.equal(empresasConsultadas, 2);
  empresaActiva = false;
  assert.equal((await pedir("GET", true)).status, 403);
  assert.equal(escrituras, 0);
});
