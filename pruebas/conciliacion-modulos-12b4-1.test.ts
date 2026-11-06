import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  analizarHistorialAuditoria,
  consultarIncidenciasAuditoria,
  ErrorConsultaAuditoria,
} from "../lib/conciliacion-modulos.js";

const rec = (x: string) => `rec${x.repeat(14)}`;
const EMPRESA = rec("E"), OTRA = rec("Q"), USUARIO = rec("U"), BASE = `app${"A".repeat(14)}`, TABLA = `tbl${"T".repeat(14)}`;
type Registro = { id: string; fields: Record<string, unknown> };
const ANTES = JSON.stringify({ MODULOS_CONTRATADOS: ["USUARIO", "INVENTARIO", "REPORTES"], ACTIVA: true, VERSION: "a".repeat(64) });
const DESPUES = JSON.stringify({ MODULOS_CONTRATADOS: ["USUARIO", "INVENTARIO"], ACTIVA: true, VERSION: "b".repeat(64) });
function evento(resultado: string, operacionId: string, overrides: Record<string, unknown> = {}): Registro {
  return { id: rec("R"), fields: {
    ID_EVENTO: randomUUID(), OPERACION_ID: operacionId,
    EMPRESA_ID: EMPRESA, ACTOR_USUARIO_ID: USUARIO,
    ACCION: "MODULO_SUSPENDER", MODULO: "REPORTES", RECURSO_TIPO: "EMPRESA", RECURSO_ID: EMPRESA,
    RESULTADO: resultado, ESTADO_ANTERIOR: ANTES,
    ESTADO_NUEVO: resultado === "INTENTO" || resultado === "CONFIRMADO" ? DESPUES : ANTES,
    ESQUEMA_VERSION: "1", ...overrides,
  } };
}
function dos(resultado = "CONFIRMADO") {
  const id = randomUUID();
  return [evento("INTENTO", id), { ...evento(resultado, id), id: rec("S") }];
}
function aislar(t: { after(fn: () => void): void }) {
  const keys = ["AIRTABLE_USERS_BASE_ID", "AIRTABLE_AUDITORIA_TABLE_ID", "AIRTABLE_TOKEN"] as const;
  const previos = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const antes = globalThis.fetch;
  t.after(() => { globalThis.fetch = antes;
    for (const k of keys) { const v = previos[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  for (const k of keys) delete process.env[k];
  globalThis.fetch = async () => { throw new Error("Red real no permitida en pruebas"); };
}
function entornoPrueba() {
  Object.assign(process.env, { AIRTABLE_USERS_BASE_ID: BASE,
    AIRTABLE_AUDITORIA_TABLE_ID: TABLA, AIRTABLE_TOKEN: "SOLO_SIMULACION_12B4" });
}

test("12B.4.1: empresa sin eventos no presenta incidentes en historial completo", () => {
  assert.deepEqual(analizarHistorialAuditoria(EMPRESA, []), { bloqueada: false, operacionesAnalizadas: 0, incidencias: [] });
});

test("12B.4.1: INTENTO + CONFIRMADO consistente se reconoce como resuelto", () => {
  const r = analizarHistorialAuditoria(EMPRESA, dos());
  assert.equal(r.bloqueada, false); assert.equal(r.operacionesAnalizadas, 1);
});

test("12B.4.1: INTENTO + FALLIDO con estado anterior confirmado se reconoce como resuelto", () => {
  const r = analizarHistorialAuditoria(EMPRESA, dos("FALLIDO"));
  assert.equal(r.bloqueada, false); assert.equal(r.operacionesAnalizadas, 1);
});

test("12B.4.1: INTENTO sin resultado final obliga a revisar", () => {
  const r = analizarHistorialAuditoria(EMPRESA, [evento("INTENTO", randomUUID())]);
  assert.equal(r.bloqueada, true); assert.equal(r.incidencias[0]?.causa, "SIN_RESULTADO");
});

test("12B.4.1: INDETERMINADO permanece bloqueado", () => {
  const r = analizarHistorialAuditoria(EMPRESA, dos("INDETERMINADO"));
  assert.equal(r.bloqueada, true); assert.equal(r.incidencias[0]?.causa, "INDETERMINADO");
});

test("12B.4.1: CONCILIADO no desbloquea sin protocolo de verificación", () => {
  const r = analizarHistorialAuditoria(EMPRESA, dos("CONCILIADO"));
  assert.equal(r.bloqueada, true);
});

test("12B.4.1: resultado final sin INTENTO no se considera normal", () => {
  const r = analizarHistorialAuditoria(EMPRESA, [evento("CONFIRMADO", randomUUID())]);
  assert.equal(r.bloqueada, true); assert.equal(r.incidencias[0]?.causa, "SECUENCIA_INVALIDA");
});

test("12B.4.1: dos finales para la misma operación se consideran anómalos", () => {
  const registros = dos(); registros.push({ ...evento("CONFIRMADO", registros[0].fields.OPERACION_ID as string), id: rec("T") });
  assert.equal(analizarHistorialAuditoria(EMPRESA, registros).bloqueada, true);
});

test("12B.4.1: actor diferente en la misma operación no permite desbloquear", () => {
  const registros = dos(); registros[1].fields.ACTOR_USUARIO_ID = rec("X");
  assert.equal(analizarHistorialAuditoria(EMPRESA, registros).bloqueada, true);
});

test("12B.4.1: no acepta un CONFIRMADO cuyo estado no coincide con el propuesto", () => {
  const registros = dos(); registros[1].fields.ESTADO_NUEVO = ANTES;
  assert.equal(analizarHistorialAuditoria(EMPRESA, registros).bloqueada, true);
});

test("12B.4.1: error de identidad, evento duplicado o JSON corrupto bloquea", () => {
  const registros = dos(); registros[1].fields.EMPRESA_ID = OTRA;
  assert.equal(analizarHistorialAuditoria(EMPRESA, registros).bloqueada, true);
  const otros = dos(); otros[1].fields.ID_EVENTO = otros[0].fields.ID_EVENTO;
  assert.equal(analizarHistorialAuditoria(EMPRESA, otros).bloqueada, true);
  const defectuoso = dos(); defectuoso[1].fields.ESTADO_NUEVO = "{JSON roto";
  assert.equal(analizarHistorialAuditoria(EMPRESA, defectuoso).bloqueada, true);
});

test("12B.4.1: eventos de otra acción no cierran ni contaminan las operaciones de módulos", () => {
  const registros = dos(); const otro = evento("CONFIRMADO", randomUUID(), { ACCION: "USUARIO_CREAR" });
  otro.id = rec("Z"); registros.push(otro);
  const r = analizarHistorialAuditoria(EMPRESA, registros);
  assert.equal(r.bloqueada, false); assert.equal(r.operacionesAnalizadas, 1);
});

test("12B.4.1: consulta paginada usa exclusivamente GET y analiza todas las páginas", async (t) => {
  aislar(t); entornoPrueba();
  const registros = dos(); let llamadas = 0;
  globalThis.fetch = async (url, init) => {
    llamadas++; const u = new URL(String(url));
    assert.equal(init?.method, "GET");
    assert.equal(u.hostname, "api.airtable.com");
    assert.equal(u.pathname, `/v0/${BASE}/${TABLA}`);
    assert.equal(u.searchParams.get("filterByFormula"), `{EMPRESA_ID}="${EMPRESA}"`);
    assert.equal(u.searchParams.get("pageSize"), "100");
    if (llamadas === 1) { assert.equal(u.searchParams.has("offset"), false); return Response.json({ records: [registros[0]], offset: "SIGUIENTE" }); }
    assert.equal(u.searchParams.get("offset"), "SIGUIENTE");
    return Response.json({ records: [registros[1]] });
  };
  const resultado = await consultarIncidenciasAuditoria(EMPRESA);
  assert.equal(resultado.bloqueada, false); assert.equal(llamadas, 2);
});

test("12B.4.1: sin configuración falla antes de la red", async (t) => {
  aislar(t); let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw new Error("No usar red"); };
  await assert.rejects(consultarIncidenciasAuditoria(EMPRESA), (e: unknown) =>
    e instanceof ErrorConsultaAuditoria && e.codigo === "CONFIG_INVALIDA");
  assert.equal(llamadas, 0);
});

test("12B.4.1: Airtable no disponible produce error y nunca habilita cambios", async (t) => {
  aislar(t); entornoPrueba(); let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; return Response.json({ error: "simulado" }, { status: 503 }); };
  await assert.rejects(consultarIncidenciasAuditoria(EMPRESA), (e: unknown) =>
    e instanceof ErrorConsultaAuditoria && e.codigo === "LECTURA_FALLIDA");
  assert.equal(llamadas, 1);
});

test("12B.4.1: paginación que repite cursor se rechaza", async (t) => {
  aislar(t); entornoPrueba(); let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; return Response.json({ records: [], offset: "REPETIDO" }); };
  await assert.rejects(consultarIncidenciasAuditoria(EMPRESA), (e: unknown) =>
    e instanceof ErrorConsultaAuditoria && e.codigo === "PAGINACION_INVALIDA");
  assert.equal(llamadas, 2);
});

test("12B.4.1: la conexión 12B.4.2 mantiene solo lectura y ambos gates", async () => {
  const a = await readFile("handlers/core/gestion-modulos.ts", "utf8");
  assert.match(a, /OPTIMA_MODULES_CHANGES_ENABLED\s*!==\s*"true"/);
  assert.match(a, /OPTIMA_AUDIT_WRITES_ENABLED\s*!==\s*"true"/);
  assert.match(a, /consultarIncidenciasAuditoria/);
  const b = await readFile("lib/conciliacion-modulos.ts", "utf8");
  assert.match(b, /method:\s*"GET"/);
  assert.doesNotMatch(b, /method:\s*"(?:PATCH|POST|DELETE)"/);
});
