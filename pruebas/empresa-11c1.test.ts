import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { catalogoParaEmpresa } from "../core/catalogo-modulos.js";
import handler from "../handlers/core/empresa.js";

const id = (x: string) => "rec" + x.repeat(14);
const tabla = (x: string) => "tbl" + x.repeat(14);
const ADMIN = id("A"), EMPRESA = id("B"), SUCURSAL = id("C"), AJENA = id("D");
const USERS = tabla("U"), COMPANIES = tabla("E"), BRANCHES = tabla("S");
const COOKIE = "s".repeat(43);

test("11C.1: catálogo completo, único y sin CORE comercial", () => {
  const catalogo = catalogoParaEmpresa(["CORE", "INVENTARIO", "INVENTARIO", "REPORTES"]);
  assert.equal(catalogo.length, 8);
  assert.equal(catalogo.some(x => x.id === "CORE"), false);
  assert.equal(new Set(catalogo.map(x => x.id)).size, catalogo.length);
  assert.equal(catalogo.find(x => x.id === "INVENTARIO")?.habilitadoEnEmpresa, true);
  assert.equal(catalogo.find(x => x.id === "REPORTES")?.habilitadoEnEmpresa, true);
  assert.equal(catalogo.find(x => x.id === "FACTURACION")?.habilitadoEnEmpresa, false);
});

test("11C.1: GET sin sesión denegado; métodos de escritura rechazados", async () => {
  let llamadas = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { llamadas++; throw new Error("No debe consultar servicios"); };
  try {
    for (const metodo of ["POST", "PATCH", "DELETE", "PUT", "GET"]) {
      const req = { method: metodo, query: { empresaId: AJENA } } as unknown as VercelRequest;
      let status = 200;
      const res = { setHeader() { return this; }, status(n: number) { status = n; return this; }, json() { return this; } } as unknown as VercelResponse;
      await handler(req, res);
      assert.equal(status, metodo === "GET" ? 401 : 405);
    }
    assert.equal(llamadas, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("11C.1: solo la empresa de la sesión; no acepta empresa ajena desde query", async (t) => {
  const anterior = globalThis.fetch;
  const env = {
    AIRTABLE_USERS_BASE_ID: "app" + "X".repeat(14), AIRTABLE_USERS_TABLE_ID: USERS,
    AIRTABLE_COMPANIES_TABLE_ID: COMPANIES, AIRTABLE_SUCURSALES_TABLE_ID: BRANCHES,
    AIRTABLE_TOKEN: "prueba-ficticia", UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "prueba-ficticia",
  };
  const previos = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    globalThis.fetch = anterior;
    for (const [k, v] of Object.entries(previos)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  let admin = true;
  let empresaActiva = true;
  let lecturasAjena = 0;
  let escriturasAirtable = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "redis-prueba.invalid") {
      const [cmd, key] = JSON.parse(String(init?.body)) as [string, string];
      assert.equal(cmd, "GET");
      return Response.json({ result: key.startsWith("optima:version-sesion:") ? null :
        JSON.stringify({ usuarioId: ADMIN, versionSesion: 0 }) });
    }
    assert.equal(url.hostname, "api.airtable.com");
    if (init?.method && init.method !== "GET") escriturasAirtable++;
    if (url.pathname.includes(AJENA)) { lecturasAjena++; throw Error("Acceso cruzado"); }
    if (url.pathname.endsWith(`/${USERS}/${ADMIN}`)) return Response.json({ id: ADMIN, fields: {
      USUARIO: "ADMIN", ROL: admin ? "ADMIN" : "USUARIO", ACTIVO: true,
      EMPRESA: [EMPRESA], MODULOS: ["USUARIO", "INVENTARIO"],
      SUCURSALES_AUTORIZADAS: [SUCURSAL], SUCURSAL_PREDETERMINADA: [SUCURSAL],
      PERMISOS_USUARIOS: ["GESTIONAR USUARIOS"], PERMISOS_INVENTARIO: ["VER"],
    } });
    if (url.pathname.endsWith(`/${COMPANIES}/${EMPRESA}`)) return Response.json({ id: EMPRESA, fields: {
      ACTIVA: empresaActiva, CLAVE_EMPRESA: "ACME", NOMBRE_COMERCIAL: "Empresa simulada",
      MODULOS_CONTRATADOS: ["USUARIO", "INVENTARIO", "CUENTAS CORRIENTES"],
    } });
    if (url.pathname.endsWith(`/${BRANCHES}/${SUCURSAL}`)) return Response.json({ id: SUCURSAL, fields: {
      NOMBRE: "Local", ACTIVA: true, EMPRESA: [EMPRESA],
    } });
    throw Error("Consulta no simulada: " + url.pathname);
  };

  async function consultar(): Promise<{ status: number; json: any }> {
    const req = { method: "GET", query: { empresaId: AJENA }, cookies: { optima_sesion: COOKIE } } as unknown as VercelRequest;
    let status = 200;
    let json: any;
    const res = { setHeader() { return this; }, status(n: number) { status = n; return this; }, json(d: any) { json = d; return this; } } as unknown as VercelResponse;
    await handler(req, res);
    return { status, json };
  }

  const correcto = await consultar();
  assert.equal(correcto.status, 200);
  assert.equal(correcto.json.empresa.id, EMPRESA);
  assert.equal(correcto.json.empresa.coreIncluido, true);
  assert.deepEqual(correcto.json.empresa.modulosContratados, ["INVENTARIO", "CUENTAS_CORRIENTES"]);
  assert.deepEqual(correcto.json.modulosUsuario, ["INVENTARIO"]);
  assert.equal(correcto.json.catalogoModulos.find((m: { id: string }) => m.id === "REPORTES").habilitadoEnEmpresa, false);
  assert.equal(lecturasAjena, 0);
  assert.equal(escriturasAirtable, 0);

  admin = false;
  const empleado = await consultar();
  assert.equal(empleado.status, 403);
  admin = true;
  empresaActiva = false;
  const inactiva = await consultar();
  assert.equal(inactiva.status, 403);
  assert.equal(escriturasAirtable, 0);
});
