import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prepararEventoAuditoria } from "../lib/auditoria-eventos.js";
import handler from "../handlers/core/conciliar-core-global.js";

const id = (s: string) => `rec${s.repeat(14)}`;
const tabla = (s: string) => `tbl${s.repeat(14)}`;
const EMP = id("E"), PLAT = id("P"), ADMIN = id("A"), SUC = id("S"), USUARIOS = tabla("U");
const EMPRESAS = tabla("E"), SUCURSALES = tabla("S"), AUD = tabla("T"), BASE = `app${"B".repeat(14)}`;
const COOKIE = "X".repeat(43);
const CLAVES = ["OPTIMA_PLATFORM_ADMIN_USER_ID", "OPTIMA_PLATFORM_COMPANY_ID",
  "OPTIMA_AUDIT_WRITES_ENABLED", "OPTIMA_CORE_AUDIT_ENFORCE_ENABLED",
  "OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED", "OPTIMA_CORE_CONCILIACION_WRITES_ENABLED",
  "AIRTABLE_USERS_BASE_ID", "AIRTABLE_USERS_TABLE_ID", "AIRTABLE_COMPANIES_TABLE_ID",
  "AIRTABLE_SUCURSALES_TABLE_ID", "AIRTABLE_AUDITORIA_TABLE_ID", "AIRTABLE_TOKEN",
  "UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN"] as const;

type Registro = { id: string; fields: Record<string, unknown> };
function simular(t: { after(fn: () => void): void }, escritura = false, lockDisponible = true) {
  const anterior = Object.fromEntries(CLAVES.map(k => [k, process.env[k]]));
  const fetchAnterior = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetchAnterior;
    for (const k of CLAVES) {
      const v = anterior[k];
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  Object.assign(process.env, {
    OPTIMA_PLATFORM_ADMIN_USER_ID: ADMIN, OPTIMA_PLATFORM_COMPANY_ID: PLAT,
    AIRTABLE_USERS_BASE_ID: BASE, AIRTABLE_USERS_TABLE_ID: USUARIOS,
    AIRTABLE_COMPANIES_TABLE_ID: EMPRESAS, AIRTABLE_SUCURSALES_TABLE_ID: SUCURSALES,
    AIRTABLE_AUDITORIA_TABLE_ID: AUD, AIRTABLE_TOKEN: "SIMULACION_SIN_ACCESO_REAL",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-ficticio.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "SIMULACION_SIN_ACCESO_REAL",
  });
  for (const k of ["OPTIMA_AUDIT_WRITES_ENABLED", "OPTIMA_CORE_AUDIT_ENFORCE_ENABLED",
    "OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED", "OPTIMA_CORE_CONCILIACION_WRITES_ENABLED"])
    if (escritura) process.env[k] = "true"; else delete process.env[k];
  const op = randomUUID();
  const preparado = prepararEventoAuditoria({ operacionId: op, actor: {
    usuarioId: id("U"), usuario: "ADMIN_CLIENTE", tipo: "CLIENTE" }, empresaId: EMP,
    empresaNombre: "Empresa simulada", modulo: "CORE", accion: "SUCURSAL_RENOMBRAR",
    recursoTipo: "SUCURSAL", recursoId: SUC, anterior: {
      ACTIVA: true, NOMBRE_SUCURSAL: "Nombre anterior", SUCURSAL_ID: SUC,
    }, nuevo: { ACTIVA: true, NOMBRE_SUCURSAL: "Nombre actual", SUCURSAL_ID: SUC },
    origen: "PANEL", motivo: "Renombrar sucursal ficticia", resultado: "INTENTO", detalle: "INICIO",
  });
  const registros: Registro[] = [{ id: id("R"), fields: { ...preparado.fields } }];
  let insertados = 0, cambios = 0, renovaciones = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "redis-ficticio.invalid") {
      const c = JSON.parse(String(init?.body)) as Array<string | number>;
      if (c[0] === "GET") return Response.json({ result: String(c[1]).startsWith("optima:version-sesion:")
        ? null : JSON.stringify({ usuarioId: ADMIN, versionSesion: 0 }) });
      if (c[0] === "SET") return Response.json({ result: lockDisponible ? "OK" : null });
      if (c[0] === "EVAL") {
        if (String(c[1]).includes("EXPIRE")) renovaciones++;
        return Response.json({ result: 1 });
      }
      throw new Error("REDIS_NO_SIMULADO");
    }
    assert.equal(url.hostname, "api.airtable.com");
    if (url.pathname.endsWith(`/${USUARIOS}/${ADMIN}`)) return Response.json({ id: ADMIN, fields: {
      ACTIVO: true, ROL: "ADMIN", EMPRESA: [PLAT], USUARIO: "PLATAFORMA", NOMBRE: "PLATAFORMA",
      SUCURSALES_AUTORIZADAS: [], SUCURSAL_PREDETERMINADA: [],
    } });
    if (url.pathname.endsWith(`/${EMPRESAS}/${PLAT}`)) return Response.json({ id: PLAT, fields: {
      ACTIVA: true, NOMBRE_COMERCIAL: "Plataforma", CLAVE_EMPRESA: "PLATAFORMA",
    } });
    if (url.pathname.endsWith(`/${EMPRESAS}/${EMP}`)) return Response.json({ id: EMP, fields: {
      ACTIVA: true, NOMBRE_COMERCIAL: "Empresa simulada", SUCURSALES: [SUC],
    } });
    if (url.pathname.endsWith(`/${SUCURSALES}/${SUC}`)) {
      if (init?.method !== "GET") { cambios++; throw new Error("PROHIBIDO_MUTAR_SUCURSAL"); }
      return Response.json({ id: SUC, fields: { EMPRESA: [EMP], NOMBRE: "Nombre actual", ACTIVA: true } });
    }
    if (url.pathname.endsWith(`/${AUD}`)) {
      if (init?.method === "GET") {
        assert.equal(url.searchParams.get("filterByFormula"), `{EMPRESA_ID}="${EMP}"`);
        return Response.json({ records: registros });
      }
      if (init?.method !== "POST") { cambios++; throw new Error("PROHIBIDO_MUTAR_HISTORIAL"); }
      insertados++;
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, string> }> };
      const f = body.records[0].fields;
      assert.equal(f.RESULTADO, "CONCILIADO");
      assert.equal(f.ACTOR_TIPO, "PLATAFORMA");
      registros.push({ id: id("Z"), fields: { ...f } });
      return Response.json({ records: [{ id: id("Z"), fields: { ID_EVENTO: f.ID_EVENTO,
        OPERACION_ID: f.OPERACION_ID } }] });
    }
    throw new Error("URL_NO_SIMULADA: " + url.pathname);
  };
  async function enviar(method: "GET" | "POST", datos: Record<string, unknown>, cookie = true) {
    let codigo = 200; let salida: Record<string, unknown> = {};
    const req = { method, cookies: cookie ? { optima_sesion: COOKIE } : {},
      query: method === "GET" ? { accion: "conciliacion_core_global", ...datos } :
        { accion: "conciliacion_core_global" },
      body: method === "POST" ? datos : {},
    } as unknown as VercelRequest;
    const res = { setHeader() { return this; }, status(c: number) { codigo = c; return this; },
      json(r: Record<string, unknown>) { salida = r; return this; } } as unknown as VercelResponse;
    await handler(req, res);
    return { codigo, salida };
  }
  return { enviar, op, get insertados() { return insertados; },
    get cambios() { return cambios; }, get renovaciones() { return renovaciones; } };
}

test("API Core: no autenticado rechaza antes de consultar servicios", async t => {
  const s = simular(t);
  assert.equal((await s.enviar("GET", { empresaId: EMP }, false)).codigo, 401);
  assert.equal(s.insertados, 0);
});

test("API Core: GET lista incidencias sin escribir", async t => {
  const s = simular(t);
  const r = await s.enviar("GET", { empresaId: EMP });
  assert.equal(r.codigo, 200);
  assert.equal((r.salida.incidencias as unknown[]).length, 1);
  assert.equal(s.insertados, 0);
});

test("API Core: GET obtiene diagnóstico de estado observado real", async t => {
  const s = simular(t);
  const r = await s.enviar("GET", { empresaId: EMP, operacionId: s.op });
  assert.equal(r.codigo, 200);
  assert.equal(r.salida.estadoDetectado, "APLICADO");
  assert.match(String(r.salida.huellaActual), /^[0-9a-f]{64}$/);
  assert.equal(r.salida.soloConsulta, true);
});

test("API Core: POST deshabilitado no registra conciliación", async t => {
  const s = simular(t);
  const r = await s.enviar("POST", { empresaId: EMP, operacionId: s.op,
    confirmacion: "CONCILIAR_CORE", motivo: "Revisión de test sin efectos",
    estadoDetectado: "APLICADO", huellaActual: "a".repeat(64),
  });
  assert.equal(r.codigo, 503);
  assert.equal(s.insertados, 0);
});

test("API Core: confirma manualmente UNA vez, solo INSERT de auditoría", async t => {
  const s = simular(t, true);
  const previo = await s.enviar("GET", { empresaId: EMP, operacionId: s.op });
  assert.equal(previo.codigo, 200);
  const datos = { empresaId: EMP, operacionId: s.op,
    confirmacion: "CONCILIAR_CORE", motivo: "Conciliación manual con prueba aislada",
    estadoDetectado: previo.salida.estadoDetectado, huellaActual: previo.salida.huellaActual };
  const r = await s.enviar("POST", datos);
  assert.equal(r.codigo, 200);
  assert.equal(r.salida.empresaBloqueada, false);
  assert.equal(s.insertados, 1);
  assert.equal(s.cambios, 0);
  assert.equal(s.renovaciones, 1);
  assert.equal((await s.enviar("POST", datos)).codigo, 409);
  assert.equal(s.insertados, 1);
});

test("API Core: lock ocupado no escribe ni reintenta", async t => {
  const s = simular(t, true, false);
  const previo = await s.enviar("GET", { empresaId: EMP, operacionId: s.op });
  const r = await s.enviar("POST", { empresaId: EMP, operacionId: s.op,
    confirmacion: "CONCILIAR_CORE", motivo: "Conciliación pendiente por lock ocupado",
    estadoDetectado: previo.salida.estadoDetectado, huellaActual: previo.salida.huellaActual });
  assert.equal(r.codigo, 409);
  assert.equal(s.insertados, 0);
});
