import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import actividad from "../handlers/actividad.js";
import login from "../handlers/login.js";
import { generarTokenSesion, guardarSesion, buscarSesion } from "../lib/session.js";

const U = `rec${"U".repeat(14)}`;
const E = `rec${"E".repeat(14)}`;
const S = `rec${"S".repeat(14)}`;
const BASE = `app${"B".repeat(14)}`;
const TABLA_USERS = `tbl${"U".repeat(14)}`;
const TABLA_EMPRESA = `tbl${"E".repeat(14)}`;
const TABLA_SUCURSALES = `tbl${"S".repeat(14)}`;
const CLAVES = ["UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN",
  "AIRTABLE_TOKEN", "AIRTABLE_USERS_BASE_ID", "AIRTABLE_USERS_TABLE_ID",
  "AIRTABLE_COMPANIES_TABLE_ID", "AIRTABLE_SUCURSALES_TABLE_ID",
  "OPTIMA_PLATFORM_ADMIN_USER_ID", "OPTIMA_PLATFORM_COMPANY_ID"] as const;

type Estado = { codigo: number; body: unknown; cookie: string };
function respuesta() {
  const estado: Estado = { codigo: 200, body: null, cookie: "" };
  const res = {
    setHeader(key: string, value: string) { if (key === "Set-Cookie") estado.cookie = value; return this; },
    status(code: number) { estado.codigo = code; return this; },
    json(body: unknown) { estado.body = body; return this; },
  } as unknown as VercelResponse;
  return { estado, res };
}

function preparar(t: { after(fn: () => void): void }, modificadores: {
  usuarioActivo?: boolean; empresaActiva?: boolean; sucursalEmpresa?: string;
  plataforma?: boolean; fallaAirtable?: boolean; duplicados?: boolean;
} = {}) {
  const original = globalThis.fetch;
  const anterior = Object.fromEntries(CLAVES.map(key => [key, process.env[key]]));
  const sesion = new Map<string, string>();
  const contadores = { expire: 0, delete: 0, consultasMaestra: 0, escriturasAirtable: 0 };
  Object.assign(process.env, {
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "TOKEN_SIMULADO",
    AIRTABLE_TOKEN: "TOKEN_SIMULADO",
    AIRTABLE_USERS_BASE_ID: BASE,
    AIRTABLE_USERS_TABLE_ID: TABLA_USERS,
    AIRTABLE_COMPANIES_TABLE_ID: TABLA_EMPRESA,
    AIRTABLE_SUCURSALES_TABLE_ID: TABLA_SUCURSALES,
  });
  delete process.env.OPTIMA_PLATFORM_ADMIN_USER_ID;
  delete process.env.OPTIMA_PLATFORM_COMPANY_ID;
  if (modificadores.plataforma) {
    process.env.OPTIMA_PLATFORM_ADMIN_USER_ID = U;
    process.env.OPTIMA_PLATFORM_COMPANY_ID = E;
  }
  t.after(() => {
    globalThis.fetch = original;
    for (const key of CLAVES) {
      const valor = anterior[key];
      if (valor === undefined) delete process.env[key]; else process.env[key] = valor;
    }
  });
  globalThis.fetch = async (entrada, opciones) => {
    const url = new URL(String(entrada));
    if (url.host === "redis-prueba.invalid") {
      assert.equal(opciones?.method, "POST");
      const [op, key, value] = JSON.parse(String(opciones?.body)) as string[];
      if (op === "GET") return Response.json({ result: sesion.get(key) ?? null });
      if (op === "SET") { sesion.set(key, value); return Response.json({ result: "OK" }); }
      if (op === "EXPIRE") { contadores.expire++; return Response.json({ result: sesion.has(key) ? 1 : 0 }); }
      if (op === "DEL") { contadores.delete++; return Response.json({ result: sesion.delete(key) ? 1 : 0 }); }
      if (op === "INCR") { const nuevo = Number(sesion.get(key) ?? "0") + 1; sesion.set(key, String(nuevo)); return Response.json({ result: nuevo }); }
      throw new Error(`Redis no simulado: ${op}`);
    }
    assert.equal(url.host, "api.airtable.com", "Nunca conectar a una URL externa");
    assert.ok(!opciones?.method || opciones.method === "GET", "Airtable debe ser solo lectura");
    if (opciones?.method && opciones.method !== "GET") contadores.escriturasAirtable++;
    contadores.consultasMaestra++;
    if (modificadores.fallaAirtable) return Response.json({ error: "SIMULADO" }, { status: 503 });
    const last = url.pathname.split("/").at(-1);
    if (last === TABLA_USERS) {
      assert.equal(url.searchParams.get("maxRecords"), "2");
      const record = { id: U, fields: { USUARIO: "DEMO", PASSWORD_HASH: "$argon2id$simulado" } };
      return Response.json({ records: modificadores.duplicados ? [record, record] : [record] });
    }
    if (last === U) return Response.json({ id: U, fields: {
      USUARIO: "DEMO", NOMBRE: "Cuenta ficticia", ROL: "USUARIO",
      ACTIVO: modificadores.usuarioActivo !== false, EMPRESA: [E],
      SUCURSALES_AUTORIZADAS: [S], SUCURSAL_PREDETERMINADA: [S], MODULOS: ["CORE", "INVENTARIO"],
    } });
    if (last === E) return Response.json({ id: E, fields: {
      ACTIVA: modificadores.empresaActiva !== false, CLAVE_EMPRESA: "EMPRESA_DEMO",
      NOMBRE_COMERCIAL: "Empresa ficticia", MODULOS_CONTRATADOS: ["CORE", "INVENTARIO"],
    } });
    if (last === S) return Response.json({ id: S, fields: {
      ACTIVA: true, NOMBRE: "Sucursal ficticia", EMPRESA: [modificadores.sucursalEmpresa ?? E],
    } });
    throw new Error(`Consulta inesperada: ${url.pathname}`);
  };
  return { sesion, contadores };
}

async function sesionNueva() {
  const token = generarTokenSesion();
  await guardarSesion(token, { usuarioId: U });
  return token;
}

async function ejecutarActividad(token: string) {
  const r = respuesta();
  await actividad({ method: "POST", cookies: { optima_sesion: token } } as unknown as VercelRequest, r.res);
  return r.estado;
}

test("Sesión: actividad legítima renueva solamente una cuenta y empresa verificadas", async t => {
  const { contadores } = preparar(t);
  const token = await sesionNueva();
  const r = await ejecutarActividad(token);
  assert.equal(r.codigo, 200);
  assert.equal(contadores.expire, 1);
  assert.ok(contadores.consultasMaestra >= 3);
  assert.match(r.cookie, /HttpOnly/);
  assert.equal(contadores.escriturasAirtable, 0);
});

test("Sesión: usuario desactivado no renueva y se borra la sesión Redis", async t => {
  const { contadores } = preparar(t, { usuarioActivo: false });
  const token = await sesionNueva();
  const r = await ejecutarActividad(token);
  assert.equal(r.codigo, 401);
  assert.match(r.cookie, /Max-Age=0/);
  assert.equal(contadores.expire, 0);
  assert.equal(contadores.delete, 1);
  assert.equal(await buscarSesion(token), null);
});

test("Sesión: empresa desactivada no renueva", async t => {
  const { contadores } = preparar(t, { empresaActiva: false });
  const token = await sesionNueva();
  const r = await ejecutarActividad(token);
  assert.equal(r.codigo, 401);
  assert.equal(contadores.expire, 0);
  assert.equal(contadores.delete, 1);
});

test("Sesión: sucursal asociada a otra empresa no renueva", async t => {
  const { contadores } = preparar(t, { sucursalEmpresa: `rec${"X".repeat(14)}` });
  const token = await sesionNueva();
  const r = await ejecutarActividad(token);
  assert.equal(r.codigo, 401);
  assert.equal(contadores.expire, 0);
});

test("Sesión: candidato de plataforma inválido no pasa al Core cliente", async t => {
  const { contadores } = preparar(t, { plataforma: true });
  const token = await sesionNueva();
  const r = await ejecutarActividad(token);
  assert.equal(r.codigo, 401);
  assert.equal(contadores.expire, 0);
  assert.equal(contadores.delete, 1);
});

test("Sesión: error al consultar Base Maestra no renueva ni concede acceso", async t => {
  const { contadores } = preparar(t, { fallaAirtable: true });
  const token = await sesionNueva();
  const consola = console.error;
  console.error = () => undefined;
  try {
    const r = await ejecutarActividad(token);
    assert.equal(r.codigo, 503);
    assert.equal(contadores.expire, 0);
    assert.equal(contadores.escriturasAirtable, 0);
    assert.equal(r.cookie, "");
  } finally { console.error = consola; }
});

test("Sesión: no se renueva una cookie con sesión inexistente", async t => {
  const { contadores } = preparar(t);
  const r = await ejecutarActividad(generarTokenSesion());
  assert.equal(r.codigo, 401);
  assert.equal(contadores.consultasMaestra, 0);
  assert.equal(contadores.expire, 0);
});

test("Sesión: método incorrecto no consulta proveedores", async t => {
  const { contadores } = preparar(t);
  const r = respuesta();
  await actividad({ method: "GET" } as VercelRequest, r.res);
  assert.equal(r.estado.codigo, 405);
  assert.equal(contadores.consultasMaestra, 0);
  assert.equal(contadores.expire, 0);
});

test("Login: si la Base Maestra contiene usuarios duplicados, deniega sin crear sesión", async t => {
  const { contadores, sesion } = preparar(t, { duplicados: true });
  const r = respuesta();
  const consola = console.error;
  console.error = () => undefined;
  try {
    await login({ method: "POST", body: { usuario: "DEMO", password: "cualquiera" } } as VercelRequest, r.res);
  } finally { console.error = consola; }
  assert.equal(r.estado.codigo, 503);
  assert.equal(r.estado.cookie, "");
  assert.equal(sesion.size, 0);
  assert.equal(contadores.escriturasAirtable, 0);
});
