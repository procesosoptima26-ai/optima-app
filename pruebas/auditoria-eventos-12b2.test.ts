import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  crearOperacionAuditoria,
  prepararEventoAuditoria,
  registrarEventoAuditoria,
  FalloAuditoria,
  type EntradaAuditoria,
} from "../lib/auditoria-eventos.js";

const reg = (letra: string) => `rec${letra.repeat(14)}`;
const base = `app${"A".repeat(14)}`;
const tabla = `tbl${"T".repeat(14)}`;
const claveEntorno = ["OPTIMA_AUDIT_WRITES_ENABLED", "AIRTABLE_AUDITORIA_TABLE_ID", "AIRTABLE_USERS_BASE_ID", "AIRTABLE_TOKEN"] as const;

function entrada(cambios: Partial<EntradaAuditoria> = {}): EntradaAuditoria {
  return {
    operacionId: crearOperacionAuditoria(),
    actor: { usuarioId: reg("U"), usuario: "OPTIMA_ADMIN", tipo: "PLATAFORMA" },
    empresaId: reg("E"), empresaNombre: "Empresa ficticia",
    modulo: "INVENTARIO", accion: "MODULO_SUSPENDER", recursoTipo: "EMPRESA", recursoId: reg("E"),
    anterior: { MODULOS_CONTRATADOS: ["CORE", "INVENTARIO", "REPORTES"], ACTIVA: true },
    nuevo: { MODULOS_CONTRATADOS: ["CORE", "REPORTES"], ACTIVA: true },
    motivo: "Solicitud simulada de suspensión de módulo",
    resultado: "CONFIRMADO", detalle: "CAMBIO_CONFIRMADO", origen: "PANEL",
    ...cambios,
  };
}

function aislar(t: { after(fn: () => void): void }) {
  const envAntes = Object.fromEntries(claveEntorno.map(k => [k, process.env[k]]));
  const fetchAntes = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetchAntes;
    for (const key of claveEntorno) {
      const valor = envAntes[key];
      if (valor === undefined) delete process.env[key]; else process.env[key] = valor;
    }
  });
  for (const k of claveEntorno) delete process.env[k];
  globalThis.fetch = async () => { throw new Error("RED REAL PROHIBIDA EN PRUEBAS 12B.2"); };
}

function entornoFicticio() {
  Object.assign(process.env, {
    OPTIMA_AUDIT_WRITES_ENABLED: "true", AIRTABLE_AUDITORIA_TABLE_ID: tabla,
    AIRTABLE_USERS_BASE_ID: base, AIRTABLE_TOKEN: "TOKEN_FICTICIO_SOLO_MOCK",
  });
}

function esFalloCodigo(error: unknown, codigo: FalloAuditoria["codigo"]) {
  return error instanceof FalloAuditoria && error.codigo === codigo;
}

test("12B.2: cada evento y operación usan identificadores UUID v4 nuevos", () => {
  const a = crearOperacionAuditoria(), b = crearOperacionAuditoria();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/);
  const p = prepararEventoAuditoria(entrada({ operacionId: a }));
  assert.notEqual(p.eventoId, p.operacionId);
  assert.equal(p.fields.OPERACION_ID, a);
  assert.equal(p.fields.ESQUEMA_VERSION, "1");
  assert.match(p.fields.FECHA_HORA_UTC, /^\d{4}-\d\d-\d\dT.*Z$/);
});

test("12B.2: snapshots técnicos, identidad y motivo son explícitos y acotados", () => {
  const r = prepararEventoAuditoria(entrada());
  assert.deepEqual(JSON.parse(r.fields.ESTADO_NUEVO), { MODULOS_CONTRATADOS: ["CORE", "REPORTES"], ACTIVA: true });
  assert.equal(r.fields.ACTOR_USUARIO_ID, reg("U"));
  assert.equal(r.fields.EMPRESA_ID, reg("E"));
  assert.equal(r.fields.ORIGEN, "PANEL");
  assert.equal(r.fields.RESULTADO, "CONFIRMADO");
  assert.equal(r.fields.REGISTRADO_EN, undefined);
  assert.equal(r.fields.PASSWORD_HASH, undefined);
});

test("12B.2: permite etiquetas históricas de módulos sin perder su forma original", () => {
  const historico = ["USUARIO", "CUENTAS_CORRIENTES", "CUENTAS CORRIENTES", "CONFIGURACIÓN", "AJUSTES", "AUTOMATIZACIONES E INTEGRACIONES"];
  const evento = prepararEventoAuditoria(entrada({ anterior: { MODULOS_CONTRATADOS: historico } }));
  assert.deepEqual(JSON.parse(evento.fields.ESTADO_ANTERIOR).MODULOS_CONTRATADOS, historico);
});

test("12B.2: bloquea el registro por defecto antes de cualquier conexión", async (t) => {
  aislar(t);
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw new Error("No acceder a la red"); };
  await assert.rejects(registrarEventoAuditoria(entrada()), e => esFalloCodigo(e, "NO_HABILITADA"));
  assert.equal(llamadas, 0);
});

test("12B.2: rechaza tabla/base/credenciales ausentes antes de la red", async (t) => {
  aislar(t);
  process.env.OPTIMA_AUDIT_WRITES_ENABLED = "true";
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw new Error("No acceder a la red"); };
  await assert.rejects(registrarEventoAuditoria(entrada()), e => esFalloCodigo(e, "CONFIG_INVALIDA"));
  process.env.AIRTABLE_USERS_BASE_ID = base;
  process.env.AIRTABLE_AUDITORIA_TABLE_ID = "tabla-invalida";
  process.env.AIRTABLE_TOKEN = "token-simulado";
  await assert.rejects(registrarEventoAuditoria(entrada()), e => esFalloCodigo(e, "CONFIG_INVALIDA"));
  assert.equal(llamadas, 0);
});

test("12B.2: rechaza identidades, empresas, acciones y resultados inválidos", () => {
  assert.throws(() => prepararEventoAuditoria(entrada({ empresaId: reg("X").slice(0, 9) })), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
  assert.throws(() => prepararEventoAuditoria(entrada({ operacionId: "inventado" })), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
  assert.throws(() => prepararEventoAuditoria(entrada({ actor: { usuarioId: reg("U"), usuario: "U", tipo: "SISTEMA" } })), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
  assert.throws(() => prepararEventoAuditoria(entrada({ motivo: "corto" })), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
  assert.throws(() => prepararEventoAuditoria(entrada({ resultado: "PENDIENTE" as EntradaAuditoria["resultado"] })), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
  assert.throws(() => prepararEventoAuditoria(entrada({ detalle: "Bearer contraseña secreta" })), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
});

test("12B.2: nunca acepta secretos ni datos ajenos a snapshots permitidos", () => {
  const inseguro = { MODULOS_CONTRATADOS: ["INVENTARIO"], PASSWORD_HASH: "secreto" };
  assert.throws(() => prepararEventoAuditoria(entrada({ nuevo: inseguro })), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
  assert.throws(() => prepararEventoAuditoria(entrada({ anterior: { VERSION: "x" } })), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
  assert.throws(() => prepararEventoAuditoria({ ...entrada(), token: "secreto" } as EntradaAuditoria), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
  assert.throws(() => prepararEventoAuditoria(entrada({ anterior: { MODULOS_CONTRATADOS: ["TOKEN=SECRETO"] } })), e => esFalloCodigo(e, "EVENTO_INVALIDO"));
});

test("12B.2: con mocks usa exclusivamente POST insert sin PATCH ni DELETE", async (t) => {
  aislar(t); entornoFicticio();
  let llamadas = 0;
  globalThis.fetch = async (input, init) => {
    llamadas++;
    assert.equal(String(input), `https://api.airtable.com/v0/${base}/${tabla}`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer TOKEN_FICTICIO_SOLO_MOCK");
    const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, string> }>; typecast: boolean };
    assert.equal(body.typecast, false);
    assert.equal(body.records.length, 1);
    assert.equal(body.records[0].fields.EMPRESA_NOMBRE, "Empresa ficticia");
    assert.ok(!("REGISTRADO_EN" in body.records[0].fields));
    return Response.json({ records: [{ id: reg("R"), fields: {
      ID_EVENTO: body.records[0].fields.ID_EVENTO,
      OPERACION_ID: body.records[0].fields.OPERACION_ID,
    } }] });
  };
  const resultado = await registrarEventoAuditoria(entrada());
  assert.equal(resultado.registroId, reg("R"));
  assert.equal(llamadas, 1);
});

test("12B.2: un INTENTO y su CONFIRMADO comparten operación pero no evento", async (t) => {
  aislar(t); entornoFicticio();
  const recibidos: Array<Record<string, string>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, string> }> };
    const fields = body.records[0].fields;
    recibidos.push(fields);
    return Response.json({ records: [{ id: reg("R"), fields: { ID_EVENTO: fields.ID_EVENTO, OPERACION_ID: fields.OPERACION_ID } }] });
  };
  const operacionId = crearOperacionAuditoria();
  await registrarEventoAuditoria(entrada({ operacionId, resultado: "INTENTO", nuevo: null, detalle: "INICIO" }));
  await registrarEventoAuditoria(entrada({ operacionId, resultado: "CONFIRMADO", detalle: "CAMBIO_CONFIRMADO" }));
  assert.equal(recibidos.length, 2);
  assert.equal(recibidos[0].OPERACION_ID, recibidos[1].OPERACION_ID);
  assert.notEqual(recibidos[0].ID_EVENTO, recibidos[1].ID_EVENTO);
  assert.equal(recibidos[0].ESTADO_NUEVO, "");
});

test("12B.2: si Airtable falla, no reintenta por su cuenta", async (t) => {
  aislar(t); entornoFicticio();
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; return Response.json({ error: "simulado" }, { status: 503 }); };
  await assert.rejects(registrarEventoAuditoria(entrada()), e => esFalloCodigo(e, "CONFIRMACION_INCIERTA"));
  assert.equal(llamadas, 1);
});

test("12B.2: si la respuesta no confirma el UUID exacto, exige conciliación", async (t) => {
  aislar(t); entornoFicticio();
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas++;
    return Response.json({ records: [{ id: reg("R"), fields: { ID_EVENTO: randomUUID(), OPERACION_ID: randomUUID() } }] });
  };
  await assert.rejects(registrarEventoAuditoria(entrada()), e => esFalloCodigo(e, "CONFIRMACION_INCIERTA"));
  assert.equal(llamadas, 1);
});

test("12B.2: motor append-only y gate de módulos permanecen seguros con integración 12B.3", async () => {
  const fuente = await readFile("lib/auditoria-eventos.ts", "utf8");
  assert.match(fuente, /OPTIMA_AUDIT_WRITES_ENABLED\s*!==\s*"true"/);
  assert.match(fuente, /method:\s*"POST"/);
  assert.doesNotMatch(fuente, /method:\s*"(?:PATCH|DELETE)"/);
  const cambios = await readFile("handlers/core/gestion-modulos.ts", "utf8");
  assert.match(cambios, /OPTIMA_MODULES_CHANGES_ENABLED\s*!==\s*"true"/);
  assert.match(cambios, /ejecutarCambioModulosAuditado/);
  assert.match(cambios, /OPTIMA_AUDIT_WRITES_ENABLED\s*!==\s*"true"/);
});
