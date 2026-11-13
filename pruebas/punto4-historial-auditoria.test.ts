/** Core P4: pruebas integradas de auditoría con Redis/Airtable falsos, sin peticiones reales. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { proyectarEventoAuditoria } from "../core/historial-auditoria-seguro.js";
import historial from "../handlers/usuarios/historial-auditoria.js";

const ID = (c: string) => "rec" + c.repeat(14);
const UUID = "12345678-1234-4123-8123-123456789abc";
const EMPRESA = ID("E");
const AJENA = ID("F");
const ADMIN = ID("A");
const SUCURSAL = ID("S");
const TOKEN = "t".repeat(43);
const URLREDIS = "https://redis-p4.invalid";
const BASE = "app" + "U".repeat(14);
const USUARIOS = "tbl" + "U".repeat(14);
const EMPRESAS = "tbl" + "E".repeat(14);
const SUCURSALES = "tbl" + "S".repeat(14);
const AUDITORIA = "tbl" + "A".repeat(14);

function row(empresaId = EMPRESA) {
  return { id: ID("R"), fields: {
    EMPRESA_ID: empresaId, OPERACION_ID: UUID, FECHA_HORA_UTC: "2026-11-13T16:30:00.000Z",
    ACTOR_USUARIO: "ADMIN", ACCION: "USUARIO_EDITAR_ACCESOS", MODULO: "CORE",
    RECURSO_TIPO: "USUARIO", RECURSO_ID: ID("X"), RESULTADO: "CONFIRMADO",
    ORIGEN: "PANEL", MOTIVO: "Actualización documentada de permisos",
    DETALLE: "CAMBIO_CONFIRMADO", ESTADO_ANTERIOR: JSON.stringify({ ACTIVA: true }),
    ESTADO_NUEVO: JSON.stringify({ ACTIVA: false }), PASSWORD_HASH: "NUNCA_RETORNAR",
    ENLACE_TOKEN: "NUNCA_RETORNAR",
  } };
}
function response() {
  const actual = { status: 200, body: null as unknown };
  const res = { setHeader() { return this; }, status(n: number) { actual.status = n; return this; },
    json(x: unknown) { actual.body = x; return this; } } as unknown as VercelResponse;
  return { actual, res };
}
function req(method: string, query: Record<string, unknown> = {}, conSesion = true) {
  return { method, query, cookies: conSesion ? { optima_sesion: TOKEN } : {} } as unknown as VercelRequest;
}
function simular(t: { after(fn: () => void): void }, respuestaAuditoria: () => Record<string, unknown>,
  adminValido = true) {
  const originalFetch = globalThis.fetch;
  const vars: Record<string, string> = {
    AIRTABLE_TOKEN: "CREDENCIAL_FICTICIA", AIRTABLE_USERS_BASE_ID: BASE,
    AIRTABLE_USERS_TABLE_ID: USUARIOS, AIRTABLE_COMPANIES_TABLE_ID: EMPRESAS,
    AIRTABLE_SUCURSALES_TABLE_ID: SUCURSALES, AIRTABLE_AUDITORIA_TABLE_ID: AUDITORIA,
    UPSTASH_REDIS_KV_REST_API_URL: URLREDIS, UPSTASH_REDIS_KV_REST_API_TOKEN: "FICTICIO",
  };
  const envAntes = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  let escrituras = 0;
  let auditorias = 0;
  const consultas: URL[] = [];
  t.after(() => { globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(envAntes)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    if (u.origin === URLREDIS && u.pathname === "/") {
      const cmd = JSON.parse(String(init?.body)) as string[];
      assert.equal(cmd[0], "GET");
      const sesion = "optima:sesion:" + createHash("sha256").update(TOKEN).digest("hex");
      if (cmd[1] === sesion) return Response.json({ result: JSON.stringify({ usuarioId: ADMIN, versionSesion: 0 }) });
      if (cmd[1] === `optima:version-sesion:${ADMIN}`) return Response.json({ result: null });
      throw new Error("Clave Redis inesperada en prueba de sesión");
    }
    assert.equal(u.hostname, "api.airtable.com");
    if (init?.method && init.method !== "GET") { escrituras++; throw new Error("Escritura no permitida"); }
    consultas.push(u);
    if (u.pathname.endsWith(`/${USUARIOS}/${ADMIN}`)) return Response.json({ id: ADMIN, fields: {
      USUARIO: "ADMIN", ROL: adminValido ? "ADMIN" : "USUARIO", ACTIVO: true, EMPRESA: [EMPRESA],
      MODULOS: ["USUARIO"], SUCURSALES_AUTORIZADAS: [SUCURSAL],
      SUCURSAL_PREDETERMINADA: [SUCURSAL], PERMISOS_USUARIOS: ["VER", "GESTIONAR USUARIOS"],
    } });
    if (u.pathname.endsWith(`/${EMPRESAS}/${EMPRESA}`)) return Response.json({ id: EMPRESA, fields: {
      ACTIVA: true, CLAVE_EMPRESA: "FRIOTEKA", NOMBRE_COMERCIAL: "Frioteka", MODULOS_CONTRATADOS: ["USUARIO"],
    } });
    if (u.pathname.endsWith(`/${SUCURSALES}/${SUCURSAL}`)) return Response.json({ id: SUCURSAL, fields: {
      ACTIVA: true, NOMBRE: "Prueba", EMPRESA: [EMPRESA],
    } });
    if (u.pathname.endsWith(`/${AUDITORIA}`)) {
      auditorias++;
      assert.equal(u.searchParams.get("filterByFormula"), `{EMPRESA_ID}="${EMPRESA}"`);
      assert.equal(u.searchParams.get("maxRecords"), "50");
      return Response.json(respuestaAuditoria());
    }
    throw new Error("Consulta no simulada: " + u.pathname);
  };
  return { get escrituras() { return escrituras; }, get auditorias() { return auditorias; }, consultas };
}

test("P4: proyección técnica sólo expone lista blanca y fecha UTC", () => {
  const e = proyectarEventoAuditoria(row(), EMPRESA);
  assert.ok(e);
  assert.equal(e.resultado, "CONFIRMADO");
  assert.equal(e.anterior?.ACTIVA, true);
  assert.equal(e.nuevo?.ACTIVA, false);
  assert.equal(Object.keys(e).includes("PASSWORD_HASH"), false);
  assert.ok(!JSON.stringify(e).includes("NUNCA_RETORNAR"));
});

test("P4: no muestra eventos de otra empresa ni estados ajenos", () => {
  assert.equal(proyectarEventoAuditoria(row(AJENA), EMPRESA), null);
  assert.equal(proyectarEventoAuditoria({ ...row(), id: "mal" }, EMPRESA), null);
  const malo = row();
  malo.fields.ESTADO_NUEVO = JSON.stringify({ PASSWORD_HASH: "x" });
  assert.equal(proyectarEventoAuditoria(malo, EMPRESA), null);
});

test("P4: rechaza evento con acción, estado o fecha incorrectos", () => {
  for (const fields of [{ RESULTADO: "NO_VALIDO" }, { FECHA_HORA_UTC: "not-date" },
    { FECHA_HORA_UTC: "2026-11-13T16:30:00.000+02:00" },
    { ACCION: "sospechosa <script>" }, { MODULO: "CORE\nINJECTED" },
    { OPERACION_ID: "no-uuid" }, { DETALLE: "TOKEN_SECRET\nINJECTED" }]) {
    assert.equal(proyectarEventoAuditoria({ ...row(), fields: { ...row().fields, ...fields } }, EMPRESA), null);
  }
});

test("P4: endpoint rechaza métodos no-GET, falta de sesión y consultas de empresa arbitraria", async (t) => {
  const mock = simular(t, () => ({ records: [] }));
  const post = response(); await historial(req("POST"), post.res);
  assert.equal(post.actual.status, 405);
  const sin = response(); await historial(req("GET", {}, false), sin.res);
  assert.equal(sin.actual.status, 401);
  const abusivo = response(); await historial(req("GET", { empresaId: AJENA }), abusivo.res);
  assert.equal(abusivo.actual.status, 400);
  assert.equal(mock.auditorias, 0);
  assert.equal(mock.escrituras, 0);
});

test("P4: ADMIN autorizado ve sólo eventos de su empresa, sin secretos ni escrituras", async (t) => {
  const mock = simular(t, () => ({ records: [row()], offset: "itrPAGE_2" }));
  const r = response(); await historial(req("GET"), r.res);
  assert.equal(r.actual.status, 200);
  const b = r.actual.body as { eventos: unknown[]; siguienteCursor: string };
  assert.equal(b.eventos.length, 1);
  assert.equal(b.siguienteCursor, "itrPAGE_2");
  assert.ok(!JSON.stringify(b).includes("NUNCA_RETORNAR"));
  assert.equal(mock.auditorias, 1);
  assert.equal(mock.escrituras, 0);
});

test("P4: si Airtable devuelve una fila ajena, niega toda la página", async (t) => {
  const mock = simular(t, () => ({ records: [row(), row(AJENA)] }));
  const r = response(); await historial(req("GET"), r.res);
  assert.equal(r.actual.status, 503);
  assert.equal((r.actual.body as { eventos?: unknown }).eventos, undefined);
  assert.equal(mock.escrituras, 0);
});

test("P4: usuario sin rol ADMIN no puede consultar auditoría", async (t) => {
  const mock = simular(t, () => ({ records: [row()] }), false);
  const r = response(); await historial(req("GET"), r.res);
  assert.equal(r.actual.status, 403);
  assert.equal(mock.auditorias, 0);
});

test("P4: cursor inválido es rechazado antes de consultar historial", async (t) => {
  const mock = simular(t, () => ({ records: [row()] }));
  const r = response(); await historial(req("GET", { cursor: "../../token" }), r.res);
  assert.equal(r.actual.status, 400);
  assert.equal(mock.auditorias, 0);
});
