import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContextoCore } from "../core/seguridad.js";
import {
  diagnosticarContratacionDelCore,
  type OpcionesDiagnosticoContratacion,
} from "../core/diagnostico-contratacion-core.js";
import type { ClienteLecturaHttp } from "../core/consulta-contrataciones-airtable.js";

const empresa = "rec" + "A".repeat(14);
const ajena = "rec" + "B".repeat(14);
const baseId = "app" + "X".repeat(14);
const tablaId = "tbl" + "T".repeat(14);
const token = "ficticio-para-pruebas";
const ahoraIso = "2026-11-07T20:00:00.000Z";
const catalogoSubmodulos = [{ id: "CHEQUES", moduloPadre: "ADMINISTRACION" }] as const;

const contexto: ContextoCore = {
  usuarioId: "usuario-verificado",
  activo: true,
  empresa: { id: empresa, clave: "CLIENTE", activa: true },
  modulosEmpresa: ["INVENTARIO", "ADMINISTRACION"],
  modulosUsuario: ["INVENTARIO"],
  permisos: ["inventario.ver"],
  sucursalesAutorizadas: [{ id: "sucursal-1", empresaId: empresa, nombre: "Sucursal", activa: true }],
};

function fila(cambios: Record<string, unknown> = {}) {
  return { id: "rec" + "1".repeat(14), fields: {
    ID_VERSION: "EMP-v1", ID_CONTRATO: "EMP", EMPRESA: [empresa],
    VERSION: 1, ESTADO: "VIGENTE",
    SERVICIOS_CONTRATADOS: JSON.stringify([
      { modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "GESTION" },
      { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
    ]),
    CONDICIONES_ECONOMICAS: '{"precioPrivado":1234}',
    VIGENTE_DESDE: "2026-11-01T00:00:00.000Z",
    FECHA_APROBACION: "2026-10-30T00:00:00.000Z",
    APROBADO_POR_ID: "administrador-real",
    ...cambios,
  }};
}
function opciones(
  clienteHttp: ClienteLecturaHttp,
): OpcionesDiagnosticoContratacion {
  return { clienteHttp, baseId, tablaId, token, ahoraIso, catalogoSubmodulos };
}
function simular(registros: readonly unknown[]) {
  let llamadas = 0;
  const clienteHttp: ClienteLecturaHttp = async (url, init) => {
    llamadas++;
    const parsed = new URL(url);
    assert.equal(parsed.pathname, `/v0/${baseId}/${tablaId}`);
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    return { ok: true, status: 200, json: async () => ({ records: registros }) };
  };
  return { clienteHttp, llamadas: () => llamadas };
}

test("12C.15: consulta una versión para la empresa del Core sin habilitar operaciones", async () => {
  const mock = simular([fila()]);
  const r = await diagnosticarContratacionDelCore(contexto, opciones(mock.clienteHttp));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.empresaId, empresa);
    assert.equal(r.version, 1);
    assert.equal(r.servicios.length, 2);
    assert.equal(r.accesoOperativoHabilitado, false);
    assert.equal("condicionesEconomicas" in r, false);
    assert.equal("token" in r, false);
    assert.equal("aprobadoPorId" in r, false);
  }
  assert.equal(mock.llamadas(), 1);
});

test("12C.15: nunca permite que un empresaId adicional reemplace el del Core", async () => {
  const mock = simular([fila()]);
  const inyectadas = { ...opciones(mock.clienteHttp), empresaId: ajena };
  const r = await diagnosticarContratacionDelCore(contexto, inyectadas);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.empresaId, empresa);
});

test("12C.15: rechaza empresa inactiva antes de consultar Airtable", async () => {
  const mock = simular([fila()]);
  const r = await diagnosticarContratacionDelCore(
    { ...contexto, empresa: { ...contexto.empresa, activa: false } }, opciones(mock.clienteHttp),
  );
  assert.deepEqual(r, { ok: false, motivo: "CONTEXTO_INVALIDO", accesoOperativoHabilitado: false });
  assert.equal(mock.llamadas(), 0);
});

test("12C.15: rechaza usuario inactivo sin red", async () => {
  const mock = simular([fila()]);
  const r = await diagnosticarContratacionDelCore(
    { ...contexto, activo: false }, opciones(mock.clienteHttp),
  );
  assert.equal(r.ok, false);
  assert.equal(mock.llamadas(), 0);
});

test("12C.15: rechaza usuario sin identidad", async () => {
  const mock = simular([fila()]);
  const r = await diagnosticarContratacionDelCore(
    { ...contexto, usuarioId: " " }, opciones(mock.clienteHttp),
  );
  assert.equal(r.ok, false);
  assert.equal(mock.llamadas(), 0);
});

test("12C.15: rechaza empresaId inválida", async () => {
  const mock = simular([fila()]);
  const r = await diagnosticarContratacionDelCore(
    { ...contexto, empresa: { ...contexto.empresa, id: "empresa-invalida" } }, opciones(mock.clienteHttp),
  );
  assert.equal(r.ok, false);
  assert.equal(mock.llamadas(), 0);
});

test("12C.15: tres registros vacíos no constituyen un contrato vigente", async () => {
  const mock = simular([1, 2, 3].map(i => ({ id: `rec${String(i).repeat(14)}`, fields: {} })));
  const r = await diagnosticarContratacionDelCore(contexto, opciones(mock.clienteHttp));
  assert.deepEqual(r, { ok: false, motivo: "SIN_CONTRATO", accesoOperativoHabilitado: false });
});

test("12C.15: no usa un contrato de otra empresa", async () => {
  const mock = simular([fila({ EMPRESA: [ajena] })]);
  const r = await diagnosticarContratacionDelCore(contexto, opciones(mock.clienteHttp));
  assert.deepEqual(r, { ok: false, motivo: "SIN_CONTRATO", accesoOperativoHabilitado: false });
});

test("12C.15: un estado sin vigencia no concede acceso", async () => {
  const mock = simular([fila({ ESTADO: "APROBADA" })]);
  const r = await diagnosticarContratacionDelCore(contexto, opciones(mock.clienteHttp));
  assert.deepEqual(r, { ok: false, motivo: "NO_VIGENTE", accesoOperativoHabilitado: false });
});

test("12C.15: servicios incompatibles deniegan la lectura", async () => {
  const mock = simular([fila({ SERVICIOS_CONTRATADOS: JSON.stringify([
    { modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "ESENCIAL" },
    { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "PREMIUM" },
  ]) })]);
  const r = await diagnosticarContratacionDelCore(contexto, opciones(mock.clienteHttp));
  assert.deepEqual(r, { ok: false, motivo: "INCONSISTENTE", accesoOperativoHabilitado: false });
});

test("12C.15: dos versiones vigentes no se interpretan como válidas", async () => {
  const segunda = { ...fila(), id: "rec" + "2".repeat(14), fields: {
    ...fila().fields, ID_VERSION: "EMP-v2", VERSION: 2,
  }};
  const mock = simular([fila(), segunda]);
  const r = await diagnosticarContratacionDelCore(contexto, opciones(mock.clienteHttp));
  assert.deepEqual(r, { ok: false, motivo: "INCONSISTENTE", accesoOperativoHabilitado: false });
});

test("12C.15: sin configuración de Airtable no se consulta la red", async () => {
  const mock = simular([fila()]);
  const r = await diagnosticarContratacionDelCore(contexto, { ...opciones(mock.clienteHttp), token: " " });
  assert.deepEqual(r, { ok: false, motivo: "CONFIGURACION_INVALIDA", accesoOperativoHabilitado: false });
  assert.equal(mock.llamadas(), 0);
});

test("12C.15: propagación de error de red sin filtrar credenciales", async () => {
  const clienteHttp: ClienteLecturaHttp = async () => { throw new Error("SECRETO-INVENTADO"); };
  const r = await diagnosticarContratacionDelCore(contexto, opciones(clienteHttp));
  assert.deepEqual(r, { ok: false, motivo: "LECTURA_NO_DISPONIBLE", accesoOperativoHabilitado: false });
  assert.equal(JSON.stringify(r).includes("SECRETO"), false);
});

test("12C.15: la consulta no cambia entradas originales", async () => {
  const origen = Object.freeze([Object.freeze(fila())]);
  const mock = simular(origen);
  const antes = JSON.stringify(contexto);
  await diagnosticarContratacionDelCore(contexto, opciones(mock.clienteHttp));
  assert.equal(JSON.stringify(contexto), antes);
});
