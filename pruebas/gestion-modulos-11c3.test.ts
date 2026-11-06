import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { leerEstadoModulos, prepararCambioModulo } from "../core/gestion-modulos.js";
import handler from "../handlers/core/gestion-modulos.js";

const id = (x: string) => "rec" + x.repeat(14);
const tabla = (x: string) => "tbl" + x.repeat(14);
const USUARIO = id("A"), PLATAFORMA = id("B"), CLIENTE = id("C");
const USUARIOS = tabla("U"), EMPRESAS = tabla("E"), AUDITORIA = tabla("T");
const COOKIE = "s".repeat(43);

test("11C.3: conserva CORE y equivalencias; suspensión no elimina otros módulos", () => {
  const r = leerEstadoModulos(CLIENTE, true, ["USUARIO", "INVENTARIO", "CUENTAS_CORRIENTES", "CUENTAS CORRIENTES", "AJUSTES"]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.estado.modulos.filter(m => m === "CUENTAS_CORRIENTES").length, 1);
  const c = prepararCambioModulo(r.estado, "CUENTAS_CORRIENTES", "suspender");
  assert.equal(c.ok, true);
  if (c.ok) assert.deepEqual(c.opciones, ["USUARIO", "INVENTARIO", "AJUSTES"]);
  assert.equal(prepararCambioModulo(r.estado, "CORE", "suspender").ok, false);
  assert.equal(leerEstadoModulos(CLIENTE, true, ["INVENTARIO"]).ok, false);
  assert.equal(leerEstadoModulos(CLIENTE, true, ["USUARIO", "MODULO_DESCONOCIDO"]).ok, false);
  const x = prepararCambioModulo(r.estado, "REPORTES", "reactivar");
  assert.equal(x.ok, true);
  if (x.ok) assert.deepEqual(x.opciones, ["USUARIO", "INVENTARIO", "CUENTAS_CORRIENTES", "CUENTAS CORRIENTES", "AJUSTES", "REPORTES"]);
});

test("11C.3: gate de escritura apagado por defecto, sin consultas externas", async () => {
  const prev = process.env.OPTIMA_MODULES_CHANGES_ENABLED;
  delete process.env.OPTIMA_MODULES_CHANGES_ENABLED;
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw Error("No debe consultar servicios"); };
  try {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const req = { method, body: {} } as unknown as VercelRequest;
      let status = 200;
      const res = { setHeader() { return this; }, status(n: number) { status = n; return this; }, json() { return this; } } as unknown as VercelResponse;
      await handler(req, res);
      assert.equal(status, method === "PATCH" ? 503 : 405);
    }
    assert.equal(llamadas, 0);
  } finally {
    globalThis.fetch = original;
    if (prev === undefined) delete process.env.OPTIMA_MODULES_CHANGES_ENABLED;
    else process.env.OPTIMA_MODULES_CHANGES_ENABLED = prev;
  }
});

test("11C.3: autorización global, versión y confirmación bajo mocks", async (t) => {
  const original = globalThis.fetch;
  const env = {
    OPTIMA_MODULES_CHANGES_ENABLED: "true",
    OPTIMA_AUDIT_WRITES_ENABLED: "true",
    AIRTABLE_AUDITORIA_TABLE_ID: AUDITORIA,
    OPTIMA_PLATFORM_ADMIN_USER_ID: USUARIO,
    OPTIMA_PLATFORM_COMPANY_ID: PLATAFORMA,
    AIRTABLE_USERS_BASE_ID: "app" + "X".repeat(14),
    AIRTABLE_USERS_TABLE_ID: USUARIOS,
    AIRTABLE_COMPANIES_TABLE_ID: EMPRESAS,
    AIRTABLE_TOKEN: "ficticio",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
  };
  const previos = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    globalThis.fetch = original;
    for (const [k, v] of Object.entries(previos)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  let sesionUsuario = USUARIO;
  let opciones = ["USUARIO", "INVENTARIO", "REPORTES"];
  let escrituras = 0;
  let locks = 0;
  const eventos: Array<Record<string, string>> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "redis-prueba.invalid") {
      const [cmd, key] = JSON.parse(String(init?.body)) as [string, string];
      if (cmd === "GET") return Response.json({ result: key.startsWith("optima:version-sesion:") ? null :
        JSON.stringify({ usuarioId: sesionUsuario, versionSesion: 0 }) });
      if (cmd === "SET") { locks++; return Response.json({ result: "OK" }); }
      if (cmd === "EVAL") return Response.json({ result: 1 });
      throw Error("Comando Redis no simulado");
    }
    assert.equal(url.hostname, "api.airtable.com");
    if (url.pathname.endsWith(`/${AUDITORIA}`) && init?.method === "POST") {
      const solicitud = JSON.parse(String(init.body)) as { records: Array<{fields: Record<string, string>}> };
      const campos = solicitud.records[0].fields;
      eventos.push(campos);
      return Response.json({ records: [{ id: id("R"), fields: {
        ID_EVENTO: campos.ID_EVENTO, OPERACION_ID: campos.OPERACION_ID,
      } }] });
    }
    if (url.pathname.endsWith(`/${USUARIOS}/${USUARIO}`)) return Response.json({ id: USUARIO, fields: {
      ACTIVO: true, ROL: "ADMIN", EMPRESA: [PLATAFORMA], USUARIO: "GLOBAL", NOMBRE: "Plataforma",
      SUCURSALES_AUTORIZADAS: [], SUCURSAL_PREDETERMINADA: [],
    } });
    if (url.pathname.endsWith(`/${EMPRESAS}/${PLATAFORMA}`)) return Response.json({ id: PLATAFORMA, fields: {
      ACTIVA: true, NOMBRE_COMERCIAL: "OPTIMA", CLAVE_EMPRESA: "OPTIMA",
    } });
    if (url.pathname.endsWith(`/${EMPRESAS}/${CLIENTE}`)) {
      if (init?.method === "PATCH") {
        escrituras++;
        const body = JSON.parse(String(init.body)) as { fields: Record<string, unknown> };
        assert.deepEqual(Object.keys(body.fields), ["MODULOS_CONTRATADOS"]);
        opciones = body.fields.MODULOS_CONTRATADOS as string[];
      }
      return Response.json({ id: CLIENTE, fields: {
        ACTIVA: true, NOMBRE_COMERCIAL: "Cliente", CLAVE_EMPRESA: "CLIENTE",
        MODULOS_CONTRATADOS: opciones,
      } });
    }
    throw Error("Consulta inesperada: " + url.pathname);
  };
  async function solicitar(body: unknown, cookie = true): Promise<{ status: number; json: any }> {
    const req = { method: "PATCH", cookies: cookie ? { optima_sesion: COOKIE } : {}, body } as unknown as VercelRequest;
    let status = 200; let json: any;
    const res = { setHeader() { return this; }, status(n: number) { status = n; return this; },
      json(d: any) { json = d; return this; } } as unknown as VercelResponse;
    await handler(req, res);
    return { status, json };
  }
  const originalEstado = leerEstadoModulos(CLIENTE, true, opciones);
  assert.equal(originalEstado.ok, true);
  if (!originalEstado.ok) return;
  const body = { empresaId: CLIENTE, accion: "suspender", modulo: "REPORTES",
    version: originalEstado.estado.version, motivo: "Decisión de prueba documentada" };
  assert.equal((await solicitar(body, false)).status, 401);
  sesionUsuario = id("Z");
  assert.equal((await solicitar(body)).status, 403);
  assert.equal(escrituras, 0);
  sesionUsuario = USUARIO;
  assert.equal((await solicitar({ ...body, empresaId: PLATAFORMA })).status, 400);
  assert.equal((await solicitar({ ...body, version: "a".repeat(64) })).status, 409);
  assert.equal((await solicitar(body)).status, 200);
  assert.equal(escrituras, 1);
  assert.deepEqual(opciones, ["USUARIO", "INVENTARIO"]);
  assert.equal((await solicitar(body)).status, 409);
  assert.equal(escrituras, 1);
  assert.deepEqual(eventos.map(e => e.RESULTADO), ["INTENTO", "CONFIRMADO"]);
  assert.equal(eventos[0].OPERACION_ID, eventos[1].OPERACION_ID);
  assert.ok(locks > 0);
});
