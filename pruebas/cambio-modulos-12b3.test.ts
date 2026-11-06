import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { leerEstadoModulos } from "../core/gestion-modulos.js";
import { ejecutarCambioModulosAuditado, ErrorCambioAuditado } from "../lib/cambio-modulos-auditado.js";
import handler from "../handlers/core/gestion-modulos.js";

const reg = (s: string) => `rec${s.repeat(14)}`;
const USUARIO = reg("U"), EMPRESA = reg("E");
const BASE = `app${"A".repeat(14)}`, TABLA = `tbl${"T".repeat(14)}`;
const ENV = ["OPTIMA_AUDIT_WRITES_ENABLED", "AIRTABLE_AUDITORIA_TABLE_ID", "AIRTABLE_USERS_BASE_ID", "AIRTABLE_TOKEN", "OPTIMA_MODULES_CHANGES_ENABLED"] as const;

type Situacion = {
  eventos: Array<Record<string, string>>;
  escrituras: number;
  opciones: string[];
  ejecutar: () => ReturnType<typeof ejecutarCambioModulosAuditado>;
};

function caso(t: { after(fn: () => void): void }, personalizar?: {
  falloEvento?: number;
  escritura?: "bien" | "falla" | "aplica_y_falla" | "omite";
  lectura?: "bien" | "falla" | "inconsistente";
  actorValido?: boolean;
}): Situacion {
  const anteriorEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  const fetchAntes = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = fetchAntes;
    for (const key of ENV) {
      const valor = anteriorEnv[key];
      if (valor === undefined) delete process.env[key];
      else process.env[key] = valor;
    }
  });
  Object.assign(process.env, {
    OPTIMA_AUDIT_WRITES_ENABLED: "true",
    AIRTABLE_AUDITORIA_TABLE_ID: TABLA,
    AIRTABLE_USERS_BASE_ID: BASE,
    AIRTABLE_TOKEN: "TOKEN_DE_PRUEBA_NO_REAL",
  });
  const situacion = { eventos: [] as Array<Record<string, string>>, escrituras: 0,
    opciones: ["USUARIO", "INVENTARIO", "REPORTES"] };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `https://api.airtable.com/v0/${BASE}/${TABLA}`);
    assert.equal(init?.method, "POST");
    const recibido = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, string> }> };
    const campos = recibido.records[0].fields;
    situacion.eventos.push(campos);
    if (personalizar?.falloEvento === situacion.eventos.length)
      return Response.json({ error: "simulado" }, { status: 503 });
    return Response.json({ records: [{ id: reg("R"), fields: {
      ID_EVENTO: campos.ID_EVENTO, OPERACION_ID: campos.OPERACION_ID,
    } }] });
  };
  const previo = leerEstadoModulos(EMPRESA, true, situacion.opciones);
  assert.equal(previo.ok, true);
  if (!previo.ok) throw new Error("Precondición de prueba inválida");
  const ejecutar = () => ejecutarCambioModulosAuditado({
    actor: personalizar?.actorValido === false
      ? { usuarioId: "invalido", usuario: "GLOBAL", tipo: "PLATAFORMA" }
      : { usuarioId: USUARIO, usuario: "OPTIMA_ADMIN", tipo: "PLATAFORMA" },
    empresaId: EMPRESA, empresaNombre: "Cliente simulado",
    modulo: "REPORTES", accion: "suspender", motivo: "Motivo técnico de prueba documentado",
    estadoAnterior: previo.estado, opcionesNuevas: ["USUARIO", "INVENTARIO"],
    escribir: async () => {
      situacion.escrituras++;
      if (personalizar?.escritura === "falla") throw new Error("Error de red ficticio");
      if (personalizar?.escritura !== "omite") situacion.opciones = ["USUARIO", "INVENTARIO"];
      if (personalizar?.escritura === "aplica_y_falla") throw new Error("Timeout ficticio tras aplicar");
    },
    releer: async () => {
      if (personalizar?.lectura === "falla") throw new Error("Lectura no disponible");
      return { activa: true, modulos: personalizar?.lectura === "inconsistente"
        ? ["USUARIO", "INVENTARIO", "CUENTAS_CORRIENTES"] : [...situacion.opciones] };
    },
  });
  return { ...situacion, get escrituras() { return situacion.escrituras; },
    get opciones() { return situacion.opciones; }, ejecutar };
}

function errorConCodigo(e: unknown, codigo: ErrorCambioAuditado["codigo"]): boolean {
  return e instanceof ErrorCambioAuditado && e.codigo === codigo &&
    /^[0-9a-f-]{36}$/.test(e.operacionId);
}

test("12B.3: éxito registra INTENTO antes del PATCH y CONFIRMADO después de verificar", async (t) => {
  const c = caso(t);
  const r = await c.ejecutar();
  assert.ok(r.operacionId);
  assert.equal(c.escrituras, 1);
  assert.deepEqual(c.eventos.map(x => x.RESULTADO), ["INTENTO", "CONFIRMADO"]);
  assert.equal(c.eventos[0].OPERACION_ID, c.eventos[1].OPERACION_ID);
  assert.notEqual(c.eventos[0].ID_EVENTO, c.eventos[1].ID_EVENTO);
  assert.deepEqual(JSON.parse(c.eventos[0].ESTADO_ANTERIOR).MODULOS_CONTRATADOS, ["USUARIO", "INVENTARIO", "REPORTES"]);
  assert.deepEqual(JSON.parse(c.eventos[1].ESTADO_NUEVO).MODULOS_CONTRATADOS, ["USUARIO", "INVENTARIO"]);
  assert.equal(c.eventos[0].ACTOR_USUARIO_ID, USUARIO);
  assert.equal(c.eventos[0].DETALLE, "INICIO");
});

test("12B.3: si falla INTENTO, no se intenta la modificación", async (t) => {
  const c = caso(t, { falloEvento: 1 });
  await assert.rejects(c.ejecutar(), e => errorConCodigo(e, "AUDITORIA_INICIO") && !e.puedeEstarAplicado);
  assert.equal(c.escrituras, 0);
  assert.equal(c.eventos.length, 1);
});

test("12B.3: actor no validable bloquea escritura antes de la operación", async (t) => {
  const c = caso(t, { actorValido: false });
  await assert.rejects(c.ejecutar(), e => errorConCodigo(e, "AUDITORIA_INICIO"));
  assert.equal(c.escrituras, 0);
  assert.equal(c.eventos.length, 0);
});

test("12B.3: PATCH fallido sin modificación termina en FALLIDO", async (t) => {
  const c = caso(t, { escritura: "falla" });
  await assert.rejects(c.ejecutar(), e => errorConCodigo(e, "CAMBIO_FALLIDO") && !e.puedeEstarAplicado);
  assert.equal(c.escrituras, 1);
  assert.deepEqual(c.eventos.map(x => x.RESULTADO), ["INTENTO", "FALLIDO"]);
});

test("12B.3: error de respuesta con modificación realmente aplicada se confirma por relectura", async (t) => {
  const c = caso(t, { escritura: "aplica_y_falla" });
  await c.ejecutar();
  assert.equal(c.escrituras, 1);
  assert.deepEqual(c.eventos.map(x => x.RESULTADO), ["INTENTO", "CONFIRMADO"]);
  assert.equal(c.eventos[1].DETALLE, "CONFIRMADO_TRAS_ERROR");
});

test("12B.3: PATCH aparentemente exitoso sin cambio confirmado queda INDETERMINADO", async (t) => {
  const c = caso(t, { escritura: "omite" });
  await assert.rejects(c.ejecutar(), e => errorConCodigo(e, "CAMBIO_INDETERMINADO") && e.puedeEstarAplicado);
  assert.deepEqual(c.eventos.map(x => x.RESULTADO), ["INTENTO", "INDETERMINADO"]);
  assert.equal(c.escrituras, 1);
});

test("12B.3: lectura posterior inalcanzable genera estado INDETERMINADO", async (t) => {
  const c = caso(t, { lectura: "falla" });
  await assert.rejects(c.ejecutar(), e => errorConCodigo(e, "CAMBIO_INDETERMINADO") && e.puedeEstarAplicado);
  assert.equal(c.eventos[1].RESULTADO, "INDETERMINADO");
  assert.equal(c.eventos[1].ESTADO_NUEVO, "");
});

test("12B.3: relectura con cambio ajeno no da un éxito falso", async (t) => {
  const c = caso(t, { lectura: "inconsistente" });
  await assert.rejects(c.ejecutar(), e => errorConCodigo(e, "CAMBIO_INDETERMINADO"));
  assert.equal(c.eventos[1].RESULTADO, "INDETERMINADO");
});

test("12B.3: si falla auditoría final, no devuelve éxito ni duplica cambio", async (t) => {
  const c = caso(t, { falloEvento: 2 });
  await assert.rejects(c.ejecutar(), e => errorConCodigo(e, "AUDITORIA_FINAL") && e.puedeEstarAplicado);
  assert.equal(c.escrituras, 1);
  assert.deepEqual(c.eventos.map(x => x.RESULTADO), ["INTENTO", "CONFIRMADO"]);
});

test("12B.3: gate doble bloquea petición sin consultar servicios externos", async (t) => {
  const c = caso(t);
  process.env.OPTIMA_MODULES_CHANGES_ENABLED = "true";
  delete process.env.OPTIMA_AUDIT_WRITES_ENABLED;
  let status = 200;
  const req = { method: "PATCH", body: {} } as unknown as VercelRequest;
  const res = { setHeader() { return this; }, status(n: number) { status = n; return this; },
    json() { return this; } } as unknown as VercelResponse;
  await handler(req, res);
  assert.equal(status, 503);
  assert.equal(c.eventos.length, 0);
  assert.equal(c.escrituras, 0);
});

test("12B.3: consulta pública del panel solo habilita con tres condiciones", async () => {
  const panel = await readFile("handlers/core/plataforma.ts", "utf8");
  assert.match(panel, /OPTIMA_MODULES_CHANGES_ENABLED === "true"/);
  assert.match(panel, /OPTIMA_AUDIT_WRITES_ENABLED === "true"/);
  assert.match(panel, /AIRTABLE_AUDITORIA_TABLE_ID/);
  const cambio = await readFile("handlers/core/gestion-modulos.ts", "utf8");
  assert.match(cambio, /ejecutarCambioModulosAuditado/);
  assert.match(cambio, /ErrorCambioAuditado/);
});
