import assert from "node:assert/strict";
import { test } from "node:test";
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import login from "../handlers/login.js";
import session from "../handlers/session.js";

const usuarioId = `rec${"A".repeat(14)}`;
const empresaId = `rec${"B".repeat(14)}`;
const goyaId = `rec${"C".repeat(14)}`;
const bellaId = `rec${"D".repeat(14)}`;

function respuestaFalsa() {
  const estado = { status: 200, body: null as unknown, cookies: "" };
  const res = {
    setHeader(nombre: string, valor: string) {
      if (nombre === "Set-Cookie") estado.cookies = valor;
      return this;
    },
    status(codigo: number) { estado.status = codigo; return this; },
    json(cuerpo: unknown) { estado.body = cuerpo; return this; },
  } as unknown as VercelResponse;
  return { estado, res };
}

test("Core integrado: login y sesión leen empresa, sucursales y módulos contratados", async (t) => {
  const anteriorFetch = globalThis.fetch;
  const vars: Record<string, string> = {
    AIRTABLE_TOKEN: "ficticio",
    AIRTABLE_USERS_BASE_ID: "appSimulada",
    AIRTABLE_USERS_TABLE_ID: "tblUsuarios",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresas",
    AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursales",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "falso",
  };
  const anteriores = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    globalThis.fetch = anteriorFetch;
    for (const [k, v] of Object.entries(anteriores)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  const hash = await argon2.hash("clave-ficticia", { type: argon2.argon2id });
  const state = { usuarioActivo: true, empresaActiva: true, sesiones: new Map<string, string>() };
  let writesAirtable = 0;
  globalThis.fetch = async (entrada, opciones) => {
    const url = new URL(String(entrada));
    if (url.host === "redis-prueba.invalid") {
      const [comando, llave, valor] = JSON.parse(String(opciones?.body)) as string[];
      if (comando === "SET") { state.sesiones.set(llave, valor); return Response.json({ result: "OK" }); }
      if (comando === "GET") return Response.json({ result: state.sesiones.get(llave) ?? null });
      if (comando === "DEL") { const existe = state.sesiones.delete(llave); return Response.json({ result: Number(existe) }); }
      throw new Error(`Comando Redis inesperado ${comando}`);
    }
    if (url.host !== "api.airtable.com" || opciones?.method && opciones.method !== "GET") {
      writesAirtable++;
      throw new Error("No se permiten escrituras ni conexiones externas");
    }
    if (url.pathname.endsWith("/tblUsuarios")) {
      return Response.json({ records: [{ id: usuarioId, fields: {
        USUARIO: "OPERADORA", PASSWORD_HASH: hash, ACTIVO: state.usuarioActivo,
        EMPRESA: [empresaId], MODULOS: ["INVENTARIO", "MOVIMIENTOS", "ADMINISTRACION"],
        NOMBRE: "Operadora ficticia", ROL: "USUARIO",
        SUCURSAL_PREDETERMINADA: [goyaId], SUCURSALES_AUTORIZADAS: [goyaId, bellaId],
      } }] });
    }
    const registro = url.pathname.split("/").at(-1);
    if (registro === usuarioId) return Response.json({ id: usuarioId, fields: {
      USUARIO: "OPERADORA", NOMBRE: "Operadora ficticia", ROL: "USUARIO",
      ACTIVO: state.usuarioActivo, EMPRESA: [empresaId],
      MODULOS: ["INVENTARIO", "MOVIMIENTOS", "ADMINISTRACION"],
      SUCURSAL_PREDETERMINADA: [goyaId], SUCURSALES_AUTORIZADAS: [goyaId, bellaId],
    } });
    if (registro === empresaId) return Response.json({ id: empresaId, fields: {
      CLAVE_EMPRESA: "EMPRESA DEMO", NOMBRE_COMERCIAL: "Empresa Demo",
      ACTIVA: state.empresaActiva,
      MODULOS_CONTRATADOS: ["INVENTARIO", "MOVIMIENTOS"],
    } });
    if (registro === goyaId || registro === bellaId) return Response.json({ id: registro, fields: {
      NOMBRE: registro === goyaId ? "GOYA" : "BELLA VISTA",
      EMPRESA: [empresaId], ACTIVA: true,
    } });
    throw new Error(`Consulta Airtable inesperada: ${url}`);
  };

  // Ninguna cookie debe crearse con contraseña incorrecta.
  const err = respuestaFalsa();
  await login({ method: "POST", body: { usuario: "OPERADORA", password: "incorrecta" } } as VercelRequest, err.res);
  assert.equal(err.estado.status, 401);
  assert.equal(err.estado.cookies, "");

  const ok = respuestaFalsa();
  await login({ method: "POST", body: { usuario: "OPERADORA", password: "clave-ficticia" } } as VercelRequest, ok.res);
  assert.equal(ok.estado.status, 200);
  const datos = ok.estado.body as { usuario: { empresaId: string; sucursal: string; sucursales: Array<{ id: string }>; modulos: string[] } };
  assert.equal(datos.usuario.empresaId, empresaId);
  assert.equal(datos.usuario.sucursal, "GOYA");
  assert.deepEqual(datos.usuario.sucursales.map(s => s.id), [goyaId, bellaId]);
  assert.deepEqual(datos.usuario.modulos, ["INVENTARIO", "MOVIMIENTOS"]);
  assert.match(ok.estado.cookies, /HttpOnly/);
  const token = ok.estado.cookies.match(/optima_sesion=([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(token);

  const validacion = respuestaFalsa();
  await session({ method: "GET", cookies: { optima_sesion: token } } as unknown as VercelRequest, validacion.res);
  assert.equal(validacion.estado.status, 200);
  assert.equal((validacion.estado.body as { usuario: { sucursal: string } }).usuario.sucursal, "GOYA");

  // La empresa desactivada revoca también sesiones existentes.
  state.empresaActiva = false;
  const desactivada = respuestaFalsa();
  await session({ method: "GET", cookies: { optima_sesion: token } } as unknown as VercelRequest, desactivada.res);
  assert.equal(desactivada.estado.status, 401);
  assert.match(desactivada.estado.cookies, /Max-Age=0/);
  assert.equal(state.sesiones.size, 0);
  assert.equal(writesAirtable, 0);
});
