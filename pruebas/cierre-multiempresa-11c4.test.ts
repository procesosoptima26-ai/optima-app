import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { construirContextoCore } from "../core/contexto.js";
import { puedeRealizarAccion } from "../core/seguridad.js";
import { leerAccesoCoreDesdeAirtable } from "../core/airtable.js";
import { leerEstadoModulos, prepararCambioModulo } from "../core/gestion-modulos.js";
import { esCuentaPlataformaConfigurada } from "../core/acceso-plataforma.js";
import consultarPlataforma from "../handlers/core/plataforma.js";
import gestionarModulos from "../handlers/core/gestion-modulos.js";

const id = (letra: string) => "rec" + letra.repeat(14);
const tabla = (letra: string) => "tbl" + letra.repeat(14);
const EMPRESA_A = id("A"), EMPRESA_B = id("B"), EMPRESA_OPTIMA = id("O");
const USUARIO_A = id("U"), ADMIN_OPTIMA = id("P");
const SUCURSAL_A = id("C"), SUCURSAL_B = id("D");
const USERS = tabla("U"), COMPANIES = tabla("E"), BRANCHES = tabla("S");
const COOKIE = "s".repeat(43);

function guardarEntorno(claves: readonly string[]) {
  const anterior = Object.fromEntries(claves.map(clave => [clave, process.env[clave]]));
  return () => {
    for (const [clave, valor] of Object.entries(anterior)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  };
}

function respuestaSimulada() {
  let status = 200;
  let body: unknown = null;
  const res = {
    setHeader() { return this; },
    status(valor: number) { status = valor; return this; },
    json(valor: unknown) { body = valor; return this; },
  } as unknown as VercelResponse;
  return { res, resultado: () => ({ status, body }) };
}

test("11C.4: una sucursal ajena y un ID de otra empresa nunca autorizan operaciones", () => {
  const contexto = construirContextoCore({
    empresa: { id: EMPRESA_A, clave: "CLIENTE_A", activa: true,
      modulosContratados: ["CORE", "INVENTARIO", "MOVIMIENTOS", "REPORTES"] },
    usuario: { id: USUARIO_A, empresaId: EMPRESA_A, activo: true,
      sucursalIds: [SUCURSAL_A],
      modulosHabilitados: ["CORE", "INVENTARIO", "MOVIMIENTOS", "REPORTES"],
      permisosAsignados: ["usuarios.ver", "inventario.ver", "movimientos.crear", "reportes.ver"] },
    sucursales: [{ id: SUCURSAL_A, empresaId: EMPRESA_A, nombre: "Sucursal A", activa: true }],
  });
  assert.equal(contexto.ok, true);
  if (!contexto.ok) return;
  const ctx = contexto.contexto;
  assert.equal(puedeRealizarAccion(ctx, "inventario.ver", { empresaId: EMPRESA_A, sucursalId: SUCURSAL_A }), true);
  assert.equal(puedeRealizarAccion(ctx, "inventario.ver", { empresaId: EMPRESA_A, sucursalId: SUCURSAL_B }), false);
  assert.equal(puedeRealizarAccion(ctx, "inventario.ver", { empresaId: EMPRESA_B, sucursalId: SUCURSAL_A }), false);
  assert.equal(puedeRealizarAccion(ctx, "inventario.ver", { empresaId: EMPRESA_A }), false);
  assert.equal(puedeRealizarAccion(ctx, "movimientos.crear", { empresaId: EMPRESA_B, sucursalId: SUCURSAL_A }), false);
  assert.equal(puedeRealizarAccion(ctx, "reportes.ver", { empresaId: EMPRESA_B }), false);
  assert.equal(puedeRealizarAccion(ctx, "usuarios.ver", { empresaId: EMPRESA_B }), false);
});

test("11C.4: un módulo suspendido pierde acceso aunque el empleado conserve su asignación", () => {
  const crear = (habilitaInventario: boolean) => construirContextoCore({
    empresa: { id: EMPRESA_A, clave: "CLIENTE_A", activa: true,
      modulosContratados: habilitaInventario ? ["CORE", "INVENTARIO", "REPORTES"] : ["CORE", "REPORTES"] },
    usuario: { id: USUARIO_A, empresaId: EMPRESA_A, activo: true,
      sucursalIds: [SUCURSAL_A], modulosHabilitados: ["CORE", "INVENTARIO", "REPORTES"],
      permisosAsignados: ["inventario.ver", "reportes.ver"] },
    sucursales: [{ id: SUCURSAL_A, empresaId: EMPRESA_A, nombre: "A", activa: true }],
  });
  const antes = crear(true), suspendido = crear(false), reactivado = crear(true);
  assert.ok(antes.ok && suspendido.ok && reactivado.ok);
  if (!antes.ok || !suspendido.ok || !reactivado.ok) return;
  assert.equal(puedeRealizarAccion(antes.contexto, "inventario.ver", { empresaId: EMPRESA_A, sucursalId: SUCURSAL_A }), true);
  assert.equal(puedeRealizarAccion(suspendido.contexto, "inventario.ver", { empresaId: EMPRESA_A, sucursalId: SUCURSAL_A }), false);
  assert.equal(suspendido.contexto.modulosUsuario.includes("INVENTARIO"), false);
  assert.equal(suspendido.contexto.permisos.includes("inventario.ver"), false);
  assert.equal(puedeRealizarAccion(suspendido.contexto, "reportes.ver", { empresaId: EMPRESA_A }), true);
  assert.equal(puedeRealizarAccion(reactivado.contexto, "inventario.ver", { empresaId: EMPRESA_A, sucursalId: SUCURSAL_A }), true);
});

test("11C.4: el contexto de sesión se recalcula desde Airtable; no usa módulos enviados por el navegador", async (t) => {
  const fetchOriginal = globalThis.fetch;
  const claves = ["AIRTABLE_USERS_BASE_ID", "AIRTABLE_USERS_TABLE_ID", "AIRTABLE_COMPANIES_TABLE_ID",
    "AIRTABLE_SUCURSALES_TABLE_ID", "AIRTABLE_TOKEN"];
  const restaurar = guardarEntorno(claves);
  Object.assign(process.env, {
    AIRTABLE_USERS_BASE_ID: "app" + "X".repeat(14), AIRTABLE_USERS_TABLE_ID: USERS,
    AIRTABLE_COMPANIES_TABLE_ID: COMPANIES, AIRTABLE_SUCURSALES_TABLE_ID: BRANCHES,
    AIRTABLE_TOKEN: "credencial-simulada",
  });
  t.after(() => { globalThis.fetch = fetchOriginal; restaurar(); });
  let activo = true, empresaActiva = true, inventarioHabilitado = true, sucursalAjena = false;
  let escrituras = 0, lecturas = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.airtable.com");
    if (init?.method && init.method !== "GET") escrituras++;
    lecturas++;
    if (url.pathname.endsWith(`/${USERS}/${USUARIO_A}`)) return Response.json({ id: USUARIO_A, fields: {
      USUARIO: "OPERADOR", NOMBRE: "Operador A", ACTIVO: activo, ROL: "USUARIO",
      EMPRESA: [EMPRESA_A], MODULOS: ["USUARIO", "INVENTARIO", "REPORTES"],
      SUCURSALES_AUTORIZADAS: [SUCURSAL_A], SUCURSAL_PREDETERMINADA: [SUCURSAL_A],
      PERMISOS_INVENTARIO: ["VER"], PERMISOS_REPORTES: ["VER"],
    } });
    if (url.pathname.endsWith(`/${COMPANIES}/${EMPRESA_A}`)) return Response.json({ id: EMPRESA_A, fields: {
      ACTIVA: empresaActiva, CLAVE_EMPRESA: "CLIENTE_A", NOMBRE_COMERCIAL: "Cliente A",
      MODULOS_CONTRATADOS: inventarioHabilitado ? ["USUARIO", "INVENTARIO", "REPORTES"] : ["USUARIO", "REPORTES"],
    } });
    if (url.pathname.endsWith(`/${BRANCHES}/${SUCURSAL_A}`)) return Response.json({ id: SUCURSAL_A, fields: {
      NOMBRE: "Sucursal A", ACTIVA: true, EMPRESA: [sucursalAjena ? EMPRESA_B : EMPRESA_A],
    } });
    throw Error("Consulta externa inesperada: " + url.pathname);
  };
  const a = await leerAccesoCoreDesdeAirtable(USUARIO_A);
  assert.equal(a.ok, true);
  if (!a.ok) return;
  assert.equal(puedeRealizarAccion(a.contexto, "inventario.ver", { empresaId: EMPRESA_A, sucursalId: SUCURSAL_A }), true);
  inventarioHabilitado = false;
  const b = await leerAccesoCoreDesdeAirtable(USUARIO_A);
  assert.equal(b.ok, true);
  if (!b.ok) return;
  assert.equal(b.contexto.modulosUsuario.includes("INVENTARIO"), false);
  assert.equal(puedeRealizarAccion(b.contexto, "inventario.ver", { empresaId: EMPRESA_A, sucursalId: SUCURSAL_A }), false);
  assert.equal(puedeRealizarAccion(b.contexto, "reportes.ver", { empresaId: EMPRESA_A }), true);
  empresaActiva = false;
  const c = await leerAccesoCoreDesdeAirtable(USUARIO_A);
  assert.equal(c.ok, false);
  empresaActiva = true;
  activo = false;
  const d = await leerAccesoCoreDesdeAirtable(USUARIO_A);
  assert.equal(d.ok, false);
  activo = true;
  sucursalAjena = true;
  const e = await leerAccesoCoreDesdeAirtable(USUARIO_A);
  assert.equal(e.ok, false);
  assert.ok(lecturas >= 8);
  assert.equal(escrituras, 0);
});

test("11C.4: CORE, alias heredados, versiones y validación de cambios se conservan", () => {
  const estado = leerEstadoModulos(EMPRESA_A, true,
    ["USUARIO", "CUENTAS_CORRIENTES", "CUENTAS CORRIENTES", "CONFIGURACIÓN", "INVENTARIO"]);
  assert.equal(estado.ok, true);
  if (!estado.ok) return;
  const suspender = prepararCambioModulo(estado.estado, "CUENTAS_CORRIENTES", "suspender");
  assert.equal(suspender.ok, true);
  if (!suspender.ok) return;
  assert.deepEqual(suspender.opciones, ["USUARIO", "CONFIGURACIÓN", "INVENTARIO"]);
  const trasSuspension = leerEstadoModulos(EMPRESA_A, true, suspender.opciones);
  assert.equal(trasSuspension.ok, true);
  if (!trasSuspension.ok) return;
  assert.notEqual(trasSuspension.estado.version, estado.estado.version);
  assert.equal(prepararCambioModulo(trasSuspension.estado, "CUENTAS_CORRIENTES", "suspender").ok, false);
  const reactivar = prepararCambioModulo(trasSuspension.estado, "CUENTAS_CORRIENTES", "reactivar");
  assert.equal(reactivar.ok, true);
  if (!reactivar.ok) return;
  assert.ok(reactivar.opciones.includes("USUARIO"));
  assert.equal(prepararCambioModulo(estado.estado, "CORE", "suspender").ok, false);
  assert.equal(leerEstadoModulos(EMPRESA_A, true, ["INVENTARIO"]).ok, false);
  assert.equal(leerEstadoModulos(EMPRESA_A, true, ["USUARIO", "INVENTADO"]).ok, false);
});

test("11C.4: rutas globales y gate de escritura deniegan por defecto sin red", async (t) => {
  const fetchOriginal = globalThis.fetch;
  const claves = ["OPTIMA_PLATFORM_ADMIN_USER_ID", "OPTIMA_PLATFORM_COMPANY_ID", "OPTIMA_MODULES_CHANGES_ENABLED",
    "UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN"];
  const restaurar = guardarEntorno(claves);
  delete process.env.OPTIMA_PLATFORM_ADMIN_USER_ID;
  delete process.env.OPTIMA_PLATFORM_COMPANY_ID;
  delete process.env.OPTIMA_MODULES_CHANGES_ENABLED;
  t.after(() => { globalThis.fetch = fetchOriginal; restaurar(); });
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw Error("No se deben usar servicios externos"); };
  assert.equal(esCuentaPlataformaConfigurada(ADMIN_OPTIMA), false);
  for (const [handler, method, esperado] of [
    [consultarPlataforma, "POST", 405],
    [consultarPlataforma, "GET", 401],
    [gestionarModulos, "POST", 405],
    [gestionarModulos, "PATCH", 503],
  ] as const) {
    const { res, resultado } = respuestaSimulada();
    await handler({ method, cookies: {} } as unknown as VercelRequest, res);
    assert.equal(resultado().status, esperado);
  }
  assert.equal(llamadas, 0);
});

test("11C.4: un ADMIN cliente no pasa la API global, aun con un empresaId ajeno", async (t) => {
  const fetchOriginal = globalThis.fetch;
  const claves = ["OPTIMA_PLATFORM_ADMIN_USER_ID", "OPTIMA_PLATFORM_COMPANY_ID",
    "UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN"];
  const restaurar = guardarEntorno(claves);
  Object.assign(process.env, {
    OPTIMA_PLATFORM_ADMIN_USER_ID: ADMIN_OPTIMA, OPTIMA_PLATFORM_COMPANY_ID: EMPRESA_OPTIMA,
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid", UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
  });
  t.after(() => { globalThis.fetch = fetchOriginal; restaurar(); });
  let lecturasAirtable = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "redis-prueba.invalid") {
      const [comando, clave] = JSON.parse(String(init?.body)) as [string, string];
      assert.equal(comando, "GET");
      return Response.json({ result: clave.startsWith("optima:version-sesion:") ? null :
        JSON.stringify({ usuarioId: USUARIO_A, versionSesion: 0 }) });
    }
    lecturasAirtable++;
    throw Error("Un usuario cliente no debe consultar datos de plataforma");
  };
  const { res, resultado } = respuestaSimulada();
  await consultarPlataforma({ method: "GET", cookies: { optima_sesion: COOKIE }, query: { empresaId: EMPRESA_B } } as unknown as VercelRequest, res);
  assert.equal(resultado().status, 403);
  assert.equal(lecturasAirtable, 0);
});

test("11C.4: bloqueo de concurrencia impide escrituras incluso con gate habilitado en mocks", async (t) => {
  const fetchOriginal = globalThis.fetch;
  const claves = ["OPTIMA_PLATFORM_ADMIN_USER_ID", "OPTIMA_PLATFORM_COMPANY_ID", "OPTIMA_MODULES_CHANGES_ENABLED",
    "AIRTABLE_USERS_BASE_ID", "AIRTABLE_USERS_TABLE_ID", "AIRTABLE_COMPANIES_TABLE_ID", "AIRTABLE_TOKEN",
    "UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN"];
  const restaurar = guardarEntorno(claves);
  Object.assign(process.env, {
    OPTIMA_PLATFORM_ADMIN_USER_ID: ADMIN_OPTIMA, OPTIMA_PLATFORM_COMPANY_ID: EMPRESA_OPTIMA,
    OPTIMA_MODULES_CHANGES_ENABLED: "true", AIRTABLE_USERS_BASE_ID: "app" + "X".repeat(14),
    AIRTABLE_USERS_TABLE_ID: USERS, AIRTABLE_COMPANIES_TABLE_ID: COMPANIES, AIRTABLE_TOKEN: "ficticio",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid", UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
  });
  t.after(() => { globalThis.fetch = fetchOriginal; restaurar(); });
  let escriturasAirtable = 0, consultasCliente = 0, bloqueos = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "redis-prueba.invalid") {
      const [comando, clave] = JSON.parse(String(init?.body)) as [string, string];
      if (comando === "GET") return Response.json({ result: clave.startsWith("optima:version-sesion:") ? null :
        JSON.stringify({ usuarioId: ADMIN_OPTIMA, versionSesion: 0 }) });
      if (comando === "SET") { bloqueos++; return Response.json({ result: null }); }
      throw Error("Comando Redis no simulado: " + comando);
    }
    assert.equal(url.hostname, "api.airtable.com");
    if (init?.method && init.method !== "GET") escriturasAirtable++;
    if (url.pathname.endsWith(`/${USERS}/${ADMIN_OPTIMA}`)) return Response.json({ id: ADMIN_OPTIMA, fields: {
      ACTIVO: true, ROL: "ADMIN", EMPRESA: [EMPRESA_OPTIMA], USUARIO: "GLOBAL", NOMBRE: "Administración OPTIMA",
      SUCURSALES_AUTORIZADAS: [], SUCURSAL_PREDETERMINADA: [],
    } });
    if (url.pathname.endsWith(`/${COMPANIES}/${EMPRESA_OPTIMA}`)) return Response.json({ id: EMPRESA_OPTIMA, fields: {
      ACTIVA: true, NOMBRE_COMERCIAL: "OPTIMA", CLAVE_EMPRESA: "OPTIMA",
    } });
    if (url.pathname.endsWith(`/${COMPANIES}/${EMPRESA_A}`)) consultasCliente++;
    throw Error("Consulta no prevista: " + url.pathname);
  };
  const { res, resultado } = respuestaSimulada();
  const body = { empresaId: EMPRESA_A, modulo: "INVENTARIO", accion: "suspender",
    version: "a".repeat(64), motivo: "Bloqueo de concurrencia simulado" };
  await gestionarModulos({ method: "PATCH", body, cookies: { optima_sesion: COOKIE } } as unknown as VercelRequest, res);
  assert.equal(resultado().status, 409);
  assert.equal(bloqueos, 1);
  assert.equal(consultasCliente, 0);
  assert.equal(escriturasAirtable, 0);
});

test("11C.4: rutas consolidadas sin funciones adicionales de Vercel", async () => {
  const vercel = JSON.parse(await readFile("vercel.json", "utf8")) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  const mapa = new Map(vercel.rewrites.map(x => [x.source, x.destination]));
  assert.equal(mapa.get("/api/plataforma"), "/api/usuarios?accion=plataforma");
  assert.equal(mapa.get("/api/plataforma-modulos"), "/api/usuarios?accion=gestion_modulos");
  assert.equal(mapa.get("/api/empresa"), "/api/usuarios?accion=empresa");
  const handler = await readFile("handlers/core/gestion-modulos.ts", "utf8");
  assert.match(handler, /OPTIMA_MODULES_CHANGES_ENABLED\s*!==\s*"true"/);
  assert.match(handler, /leerAccesoPlataforma/);
  assert.match(handler, /bloquearModulos/);
  assert.match(handler, /MODULOS_CONTRATADOS/);
});
