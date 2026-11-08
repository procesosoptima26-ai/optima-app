import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consultarContratacionVigenteAirtable,
  type ClienteLecturaHttp,
  type ConsultaContratacionesAirtable,
} from "../core/consulta-contrataciones-airtable.js";

const empresa = "rec" + "A".repeat(14);
const otraEmpresa = "rec" + "B".repeat(14);
const catalogo = [{ id: "CHEQUES", moduloPadre: "ADMINISTRACION" }] as const;
const token = "token-de-prueba-no-real";
const base = "app" + "X".repeat(14);
const tabla = "tbl" + "T".repeat(14);

function fila(numero: number, cambios: Record<string, unknown> = {}) {
  return {
    id: "rec" + String(numero).padStart(14, "0"),
    fields: {
      ID_VERSION: `EMP-v${numero}`, ID_CONTRATO: "EMP",
      EMPRESA: [empresa], VERSION: numero, ESTADO: "VIGENTE",
      SERVICIOS_CONTRATADOS: JSON.stringify([
        { modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "GESTION" },
        { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
      ]),
      CONDICIONES_ECONOMICAS: "{}",
      VIGENTE_DESDE: "2026-11-01T00:00:00.000Z",
      FECHA_APROBACION: "2026-10-31T00:00:00.000Z",
      APROBADO_POR_ID: "responsable-verificado",
      ...cambios,
    },
  };
}

function simular(
  paginas: readonly unknown[],
  esperado?: (url: URL, init: RequestInit) => void,
): { clienteHttp: ClienteLecturaHttp; llamadas: () => number } {
  let indice = 0;
  const clienteHttp: ClienteLecturaHttp = async (direccion, init) => {
    const url = new URL(direccion);
    assert.equal(url.origin, "https://api.airtable.com");
    assert.equal(url.pathname, `/v0/${base}/${tabla}`);
    assert.equal(url.searchParams.get("pageSize"), "100");
    assert.ok(url.searchParams.getAll("fields[]").includes("SERVICIOS_CONTRATADOS"));
    assert.equal(init.method, "GET");
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    assert.equal(init.body, undefined);
    esperado?.(url, init);
    const pagina = paginas[indice++];
    if (!pagina) throw Error("Página simulada inexistente");
    return { ok: true, status: 200, json: async () => pagina };
  };
  return { clienteHttp, llamadas: () => indice };
}

function opciones(clienteHttp: ClienteLecturaHttp): ConsultaContratacionesAirtable {
  return {
    empresaId: empresa, ahoraIso: "2026-11-07T20:00:00.000Z",
    catalogoSubmodulos: catalogo, baseId: base, tablaId: tabla, token, clienteHttp,
  };
}

test("12C.14.3: GET de página única sin escrituras", async () => {
  const mock = simular([{ records: [fila(1)] }]);
  const r = await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.contratacion.servicios.length, 2);
  assert.equal(mock.llamadas(), 1);
});

test("12C.14.3: reúne todas las páginas antes de decidir versión vigente", async () => {
  const mock = simular([
    { records: [fila(1, { ESTADO: "HISTORICA" })], offset: "offset-proximo" },
    { records: [fila(2), fila(3, { EMPRESA: [otraEmpresa] })] },
  ], (url) => { if (url.searchParams.has("offset")) assert.equal(url.searchParams.get("offset"), "offset-proximo"); });
  const r = await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.contratacion.version, 2);
  assert.equal(mock.llamadas(), 2);
});

test("12C.14.3: registros vacíos no dan acceso", async () => {
  const mock = simular([{ records: [{ id: fila(1).id, fields: {} }] }]);
  assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp)),
    { ok: false, motivo: "SIN_CONTRATO" });
});

test("12C.14.3: falla si falta completar la paginación", async () => {
  const mock = simular([{ records: [fila(1)], offset: "continuar" }]);
  assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp)),
    { ok: false, motivo: "LECTURA_NO_DISPONIBLE" });
  assert.equal(mock.llamadas(), 2);
});

test("12C.14.3: HTTP 401, 429 y 500 deniegan sin reintentar escrituras", async () => {
  for (const status of [401, 429, 500]) {
    let llamadas = 0;
    const http: ClienteLecturaHttp = async () => {
      llamadas++;
      return { ok: false, status, json: async () => ({}) };
    };
    assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(http)),
      { ok: false, motivo: "LECTURA_NO_DISPONIBLE" });
    assert.equal(llamadas, 1);
  }
});

test("12C.14.3: excepción de red deniega", async () => {
  const http: ClienteLecturaHttp = async () => { throw Error("error secreto que no debe filtrarse"); };
  assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(http)),
    { ok: false, motivo: "LECTURA_NO_DISPONIBLE" });
});

test("12C.14.3: JSON malformado o campos faltantes no se acepta", async () => {
  for (const contenido of [{}, { records: null }, { records: [null] },
    { records: [{ id: fila(1).id }] }, { records: [fila(1)], offset: 3 }]) {
    const mock = simular([contenido]);
    assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp)),
      { ok: false, motivo: "RESPUESTA_INVALIDA" });
  }
});

test("12C.14.3: detecta offset repetido", async () => {
  const mock = simular([
    { records: [], offset: "igual" },
    { records: [], offset: "igual" },
  ]);
  assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp)),
    { ok: false, motivo: "RESPUESTA_INVALIDA" });
});

test("12C.14.3: detecta registros repetidos entre páginas", async () => {
  const mock = simular([
    { records: [fila(1)], offset: "siguiente" },
    { records: [fila(1)] },
  ]);
  assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp)),
    { ok: false, motivo: "RESPUESTA_INVALIDA" });
});

test("12C.14.3: dos vigentes son inconsistentes aunque estén en páginas distintas", async () => {
  const mock = simular([
    { records: [fila(1)], offset: "continuar" },
    { records: [fila(2)] },
  ]);
  assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp)),
    { ok: false, motivo: "INCONSISTENTE" });
});

test("12C.14.3: entrada inválida nunca consulta la red", async () => {
  let llamadas = 0;
  const http: ClienteLecturaHttp = async () => { llamadas++; throw Error("No consultar"); };
  const baseOpts = opciones(http);
  for (const invalido of [
    { ...baseOpts, baseId: "https://otro.host" },
    { ...baseOpts, tablaId: "tabla" },
    { ...baseOpts, token: "\r\nmalicioso" },
    { ...baseOpts, empresaId: "invalida" },
    { ...baseOpts, ahoraIso: "hoy" },
    { ...baseOpts, catalogoSubmodulos: [{ id: "CHEQUES", moduloPadre: "INEXISTENTE" }] as never },
  ]) {
    const r = await consultarContratacionVigenteAirtable(invalido);
    assert.equal(r.ok, false);
  }
  assert.equal(llamadas, 0);
});

test("12C.14.3: la fecha vencida no produce acceso", async () => {
  const mock = simular([{ records: [fila(1, { VIGENTE_HASTA: "2026-11-06T00:00:00.000Z" })] }]);
  assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp)),
    { ok: false, motivo: "NO_VIGENTE" });
});

test("12C.14.3: rechaza más de 50 páginas sin usar la lectura parcial", async () => {
  let llamadas = 0;
  const http: ClienteLecturaHttp = async () => {
    llamadas++;
    return { ok: true, status: 200, json: async () => ({ records: [], offset: `cursor-${llamadas}` }) };
  };
  assert.deepEqual(await consultarContratacionVigenteAirtable(opciones(http)),
    { ok: false, motivo: "CONSULTA_INCOMPLETA" });
  assert.equal(llamadas, 50);
});

test("12C.14.3: nunca envía datos de empresa en el cuerpo", async () => {
  const mock = simular([{ records: [fila(1)] }], (_url, init) => {
    assert.equal(init.body, undefined);
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
  });
  assert.equal((await consultarContratacionVigenteAirtable(opciones(mock.clienteHttp))).ok, true);
});
