import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { leerEstadoModulos } from "../core/gestion-modulos.js";
import gestionarModulos from "../handlers/core/gestion-modulos.js";

const rec = (k: string) => `rec${k.repeat(14)}`;
const tbl = (k: string) => `tbl${k.repeat(14)}`;
const EMPRESA = rec("E"), PLATAFORMA = rec("P"), USUARIO = rec("U");
const TABLA_USUARIOS = tbl("U"), TABLA_EMPRESAS = tbl("E"), TABLA_AUDITORIA = tbl("T");
const BASE = `app${"X".repeat(14)}`, COOKIE = "s".repeat(43);
const opcionesIniciales = ["USUARIO", "INVENTARIO", "REPORTES"];
const opcionesFinales = ["USUARIO", "INVENTARIO"];
const viejo = leerEstadoModulos(EMPRESA, true, opcionesIniciales);
const nuevo = leerEstadoModulos(EMPRESA, true, opcionesFinales);
if (!viejo.ok || !nuevo.ok) throw new Error("Estados ficticios inválidos");
const versionInicial = viejo.estado.version, versionFinal = nuevo.estado.version;

const ENVS = [
  "OPTIMA_MODULES_CHANGES_ENABLED", "OPTIMA_AUDIT_WRITES_ENABLED", "AIRTABLE_AUDITORIA_TABLE_ID",
  "OPTIMA_PLATFORM_ADMIN_USER_ID", "OPTIMA_PLATFORM_COMPANY_ID", "AIRTABLE_USERS_BASE_ID",
  "AIRTABLE_USERS_TABLE_ID", "AIRTABLE_COMPANIES_TABLE_ID", "AIRTABLE_TOKEN",
  "UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN",
] as const;

type Escenario = "limpio" | "pendiente" | "indeterminado" | "corrupto" | "fallo_lectura" | "paginacion_infinita" | "lock_ocupado";
type Peticiones = { status: number; json: Record<string, unknown> };

type Simulacion = {
  ejecutar(): Promise<Peticiones>;
  readonly auditoriaConsultas: number;
  readonly empresaConsultas: number;
  readonly cambios: number;
  readonly auditoriaInserciones: number;
  readonly lockLiberados: number;
  readonly secuencia: readonly string[];
};
function preparar(t: { after(fn: () => void): void }, escenario: Escenario): Simulacion {
  const guardado = Object.fromEntries(ENVS.map(k => [k, process.env[k]]));
  const fetchAnterior = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetchAnterior;
    for (const k of ENVS) {
      if (guardado[k] === undefined) delete process.env[k];
      else process.env[k] = guardado[k];
    }
  });
  Object.assign(process.env, {
    OPTIMA_MODULES_CHANGES_ENABLED: "true", OPTIMA_AUDIT_WRITES_ENABLED: "true",
    AIRTABLE_AUDITORIA_TABLE_ID: TABLA_AUDITORIA, OPTIMA_PLATFORM_ADMIN_USER_ID: USUARIO,
    OPTIMA_PLATFORM_COMPANY_ID: PLATAFORMA, AIRTABLE_USERS_BASE_ID: BASE,
    AIRTABLE_USERS_TABLE_ID: TABLA_USUARIOS, AIRTABLE_COMPANIES_TABLE_ID: TABLA_EMPRESAS,
    AIRTABLE_TOKEN: "TOKEN_SOLO_MOCK", UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "TOKEN_SOLO_MOCK",
  });
  let auditoriaConsultas = 0, empresaConsultas = 0, cambios = 0, auditoriaInserciones = 0, lockLiberados = 0;
  let opcionesActuales = [...opcionesIniciales];
  const secuencia: string[] = [];
  const operacionId = randomUUID();
  const snapshotAntes = JSON.stringify({ MODULOS_CONTRATADOS: opcionesIniciales, ACTIVA: true, VERSION: versionInicial });
  const snapshotDespues = JSON.stringify({ MODULOS_CONTRATADOS: opcionesFinales, ACTIVA: true, VERSION: versionFinal });
  const baseEvento = {
    ID_EVENTO: randomUUID(), OPERACION_ID: operacionId, EMPRESA_ID: EMPRESA, ACTOR_USUARIO_ID: USUARIO,
    MODULO: "REPORTES", ACCION: "MODULO_SUSPENDER", RECURSO_TIPO: "EMPRESA", RECURSO_ID: EMPRESA,
    RESULTADO: "INTENTO", ESTADO_ANTERIOR: snapshotAntes, ESTADO_NUEVO: snapshotDespues, ESQUEMA_VERSION: "1",
  };
  const pendiente = { id: rec("X"), fields: { ...baseEvento } };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "redis-prueba.invalid") {
      const [op, key] = JSON.parse(String(init?.body)) as [string, string];
      if (op === "GET") return Response.json({ result: key.startsWith("optima:version-sesion:") ? null :
        JSON.stringify({ usuarioId: USUARIO, versionSesion: 0 }) });
      if (op === "SET") { secuencia.push("LOCK"); return Response.json({ result: escenario === "lock_ocupado" ? null : "OK" }); }
      if (op === "EVAL") { lockLiberados++; secuencia.push("UNLOCK"); return Response.json({ result: 1 }); }
      throw Error("Comando de Redis inesperado: " + op);
    }
    assert.equal(url.hostname, "api.airtable.com");
    if (url.pathname.endsWith(`/${TABLA_USUARIOS}/${USUARIO}`)) return Response.json({ id: USUARIO, fields: {
      ACTIVO: true, ROL: "ADMIN", EMPRESA: [PLATAFORMA], USUARIO: "OPTIMA_ADMIN", NOMBRE: "Admin global",
      SUCURSALES_AUTORIZADAS: [], SUCURSAL_PREDETERMINADA: [],
    } });
    if (url.pathname.endsWith(`/${TABLA_EMPRESAS}/${PLATAFORMA}`)) return Response.json({ id: PLATAFORMA, fields: {
      ACTIVA: true, NOMBRE_COMERCIAL: "OPTIMA", CLAVE_EMPRESA: "OPTIMA",
    } });
    if (url.pathname.endsWith(`/${TABLA_AUDITORIA}`)) {
      if (init?.method === "GET") {
        auditoriaConsultas++; secuencia.push("AUDIT_GET");
        assert.equal(url.searchParams.get("filterByFormula"), `{EMPRESA_ID}="${EMPRESA}"`);
        if (escenario === "fallo_lectura") return Response.json({ error: "Simulado" }, { status: 503 });
        if (escenario === "paginacion_infinita") return Response.json({ records: [], offset: "MISMO_CURSOR" });
        if (escenario === "pendiente") return Response.json({ records: [pendiente] });
        if (escenario === "indeterminado") return Response.json({ records: [pendiente, { id: rec("Y"),
          fields: { ...baseEvento, ID_EVENTO: randomUUID(), RESULTADO: "INDETERMINADO", ESTADO_NUEVO: "" } }] });
        if (escenario === "corrupto") return Response.json({ records: [{...pendiente,
          fields: {...baseEvento, ID_EVENTO:"id-falso"}}] });
        return Response.json({ records: [] });
      }
      assert.equal(init?.method, "POST");
      auditoriaInserciones++; secuencia.push("AUDIT_POST");
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, string> }> };
      const f = body.records[0].fields;
      return Response.json({ records: [{ id: rec("R"), fields: { ID_EVENTO: f.ID_EVENTO, OPERACION_ID: f.OPERACION_ID } }] });
    }
    if (url.pathname.endsWith(`/${TABLA_EMPRESAS}/${EMPRESA}`)) {
      empresaConsultas++;
      if (init?.method === "PATCH") {
        cambios++; secuencia.push("PATCH_EMPRESA");
        const body = JSON.parse(String(init.body)) as { fields: { MODULOS_CONTRATADOS: string[] } };
        assert.deepEqual(Object.keys(body.fields), ["MODULOS_CONTRATADOS"]);
        opcionesActuales = [...body.fields.MODULOS_CONTRATADOS];
      } else { assert.equal(init?.method, "GET"); secuencia.push("GET_EMPRESA"); }
      return Response.json({ id: EMPRESA, fields: {
        ACTIVA: true, NOMBRE_COMERCIAL: "Cliente simulado", CLAVE_EMPRESA: "CLIENTE",
        MODULOS_CONTRATADOS: [...opcionesActuales],
      } });
    }
    throw Error("Consulta imprevista: " + url.pathname);
  };
  async function ejecutar(): Promise<Peticiones> {
    const req = { method: "PATCH", cookies: { optima_sesion: COOKIE }, body: {
      empresaId: EMPRESA, modulo: "REPORTES", accion: "suspender",
      version: versionInicial, motivo: "Prueba ficticia de bloqueo preventivo",
    } } as unknown as VercelRequest;
    let status = 200, json: Record<string, unknown> = {};
    const res = { setHeader() { return this; }, status(n: number) { status = n; return this; },
      json(d: Record<string, unknown>) { json = d; return this; } } as unknown as VercelResponse;
    await gestionarModulos(req,res);
    return { status, json };
  }
  return { ejecutar, get auditoriaConsultas() { return auditoriaConsultas; },
    get empresaConsultas() { return empresaConsultas; }, get cambios() { return cambios; },
    get auditoriaInserciones() { return auditoriaInserciones; }, get lockLiberados() { return lockLiberados; },
    get secuencia() { return secuencia; } };
}

test("12B.4.2: INTENTO pendiente bloquea empresa sin PATCH ni nuevos eventos", async t => {
  const s = preparar(t,"pendiente"); const r = await s.ejecutar();
  assert.equal(r.status,409); assert.equal(r.json.ok,false);
  assert.equal(r.json.incidenciasPendientes,1);
  assert.equal(s.auditoriaConsultas,1); assert.equal(s.empresaConsultas,0);
  assert.equal(s.cambios,0); assert.equal(s.auditoriaInserciones,0); assert.equal(s.lockLiberados,1);
});

test("12B.4.2: INDETERMINADO también mantiene el bloqueo", async t => {
  const s=preparar(t,"indeterminado"),r=await s.ejecutar();
  assert.equal(r.status,409); assert.equal(s.cambios,0); assert.equal(s.auditoriaInserciones,0);
});

test("12B.4.2: evento corrupto impide modificar módulos", async t => {
  const s=preparar(t,"corrupto"),r=await s.ejecutar();
  assert.equal(r.status,409); assert.equal(s.cambios,0); assert.equal(s.auditoriaInserciones,0);
});

test("12B.4.2: falla de Airtable deja bloqueo seguro y libera lock temporal", async t => {
  const s=preparar(t,"fallo_lectura"),r=await s.ejecutar();
  assert.equal(r.status,503); assert.match(String(r.json.error),/historial de auditoría/i);
  assert.equal(s.cambios,0); assert.equal(s.auditoriaInserciones,0);
  assert.equal(s.empresaConsultas,0); assert.equal(s.lockLiberados,1);
});

test("12B.4.2: paginación de auditoría incompleta también falla cerrado", async t => {
  const s=preparar(t,"paginacion_infinita"),r=await s.ejecutar();
  assert.equal(r.status,503); assert.equal(s.cambios,0); assert.equal(s.auditoriaInserciones,0);
  assert.equal(s.auditoriaConsultas,2); assert.equal(s.lockLiberados,1);
});

test("12B.4.2: historial limpio permite una sola modificación auditada", async t => {
  const s=preparar(t,"limpio"),r=await s.ejecutar();
  assert.equal(r.status,200); assert.equal(r.json.ok,true);
  assert.equal(s.auditoriaConsultas,1); assert.equal(s.cambios,1); assert.equal(s.auditoriaInserciones,2);
  assert.ok(s.secuencia.indexOf("LOCK") < s.secuencia.indexOf("AUDIT_GET"));
  assert.ok(s.secuencia.indexOf("AUDIT_GET") < s.secuencia.indexOf("GET_EMPRESA"));
  assert.ok(s.secuencia.indexOf("AUDIT_GET") < s.secuencia.indexOf("AUDIT_POST"));
  assert.ok(s.secuencia.indexOf("AUDIT_POST") < s.secuencia.indexOf("PATCH_EMPRESA"));
  assert.equal(s.lockLiberados,1);
});

test("12B.4.2: lock ocupado impide siquiera consultar historial", async t => {
  const s=preparar(t,"lock_ocupado"),r=await s.ejecutar();
  assert.equal(r.status,409); assert.equal(s.auditoriaConsultas,0);
  assert.equal(s.cambios,0); assert.equal(s.auditoriaInserciones,0); assert.equal(s.lockLiberados,0);
});
