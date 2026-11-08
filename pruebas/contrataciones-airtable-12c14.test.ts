import assert from "node:assert/strict";
import { test } from "node:test";
import { leerContratacionVigente } from "../core/contrataciones-airtable.js";

const empresa = "rec" + "A".repeat(14);
const ajena = "rec" + "B".repeat(14);
const NOW = "2026-11-07T20:00:00.000Z";
const catalogo = [
  { id: "CHEQUES", moduloPadre: "ADMINISTRACION" },
  { id: "BANCOS", moduloPadre: "ADMINISTRACION" },
] as const;
const servicios = [
  { modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "GESTION" },
  { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
];
function fila(n: number, cambios: Record<string, unknown> = {}) {
  return {
    id: "rec" + String(n).padStart(14, "0"),
    fields: {
      ID_VERSION: `OPTIMA-ABC-v${n}`,
      ID_CONTRATO: "OPTIMA-ABC",
      EMPRESA: [empresa],
      VERSION: n,
      ESTADO: "VIGENTE",
      SERVICIOS_CONTRATADOS: JSON.stringify(servicios),
      CONDICIONES_ECONOMICAS: "{}",
      VIGENTE_DESDE: "2026-11-01T00:00:00.000Z",
      FECHA_APROBACION: "2026-10-31T00:00:00.000Z",
      APROBADO_POR_ID: "usuario-interno",
      ...cambios,
    },
  };
}
function leer(filas: unknown, id: unknown = empresa, ahora: unknown = NOW) {
  return leerContratacionVigente(filas, id, catalogo, ahora);
}

test("12C.14.2: interpreta una versión vigente con dos modalidades", () => {
  const resultado = leer([fila(1)]);
  assert.equal(resultado.ok, true);
  if (resultado.ok) {
    assert.equal(resultado.contratacion.version, 1);
    assert.equal(resultado.contratacion.servicios.length, 2);
    assert.equal(resultado.contratacion.condicionesEconomicas, "{}");
  }
});

test("12C.14.2: acepta selecciones Airtable con objeto name y vínculos por ID", () => {
  const resultado = leer([fila(1, { ESTADO: { name: "VIGENTE" }, EMPRESA: [{ id: empresa }] })]);
  assert.equal(resultado.ok, true);
});

test("12C.14.2: ignora filas sin empresa y versiones de otra empresa", () => {
  const resultado = leer([{ id: "rec" + "C".repeat(14), fields: {} },
    fila(4, { EMPRESA: [ajena] }), fila(1)]);
  assert.equal(resultado.ok, true);
});

test("12C.14.2: sin empresa consultada o sin versión activa no concede contratos", () => {
  assert.deepEqual(leer([]), { ok: false, motivo: "SIN_CONTRATO" });
  assert.deepEqual(leer([fila(1, { ESTADO: "APROBADA" })]), { ok: false, motivo: "NO_VIGENTE" });
});

test("12C.14.2: conserva histórica y selecciona única vigente", () => {
  const r = leer([fila(1, { ESTADO: "HISTORICA" }), fila(2)]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.contratacion.version, 2);
});

test("12C.14.2: rechaza dos versiones vigentes", () => {
  assert.deepEqual(leer([fila(1), fila(2)]), { ok: false, motivo: "INCONSISTENTE" });
});

test("12C.14.2: rechaza versiones repetidas e ID_VERSION duplicado", () => {
  assert.equal(leer([fila(1, { ESTADO: "HISTORICA" }), fila(2, { VERSION: 1 })]).ok, false);
  assert.equal(leer([fila(1, { ESTADO: "HISTORICA" }), fila(2, { ID_VERSION: "OPTIMA-ABC-v1" })]).ok, false);
});

test("12C.14.2: rechaza dos contratos distintos para una empresa", () => {
  assert.equal(leer([fila(1, { ESTADO: "HISTORICA" }), fila(2, { ID_CONTRATO: "OTRO" })]).ok, false);
});

test("12C.14.2: vencimiento y entrada en vigencia se comprueban", () => {
  assert.deepEqual(leer([fila(1, { VIGENTE_DESDE: "2026-11-08T00:00:00.000Z" })]),
    { ok: false, motivo: "NO_VIGENTE" });
  assert.deepEqual(leer([fila(1, { VIGENTE_HASTA: NOW })]),
    { ok: false, motivo: "NO_VIGENTE" });
  assert.deepEqual(leer([fila(1, { VIGENTE_HASTA: "2026-10-25T00:00:00Z" })]),
    { ok: false, motivo: "INCONSISTENTE" });
});

test("12C.14.2: requiere aprobación verificable en fecha", () => {
  assert.equal(leer([fila(1, { APROBADO_POR_ID: "" })]).ok, false);
  assert.equal(leer([fila(1, { FECHA_APROBACION: "2026-11-12T00:00:00Z" })]).ok, false);
});

test("12C.14.2: detecta JSON roto, desconocido o superpuesto", () => {
  assert.equal(leer([fila(1, { SERVICIOS_CONTRATADOS: "[" })]).ok, false);
  assert.equal(leer([fila(1, { SERVICIOS_CONTRATADOS: JSON.stringify([
    { modalidad: "MODULO_PRINCIPAL", modulo: "IGNORADO", nivel: "PREMIUM" },
  ]) })]).ok, false);
  assert.equal(leer([fila(1, { SERVICIOS_CONTRATADOS: JSON.stringify([
    { modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "GESTION" },
    { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
  ]) })]).ok, false);
});

test("12C.14.2: error de ortografía en campo crítico falla cerrado", () => {
  const f = fila(1);
  const { SERVICIOS_CONTRATADOS: _, ...resto } = f.fields;
  void _;
  assert.deepEqual(leer([{ ...f, fields: { ...resto, SERIVCIOS_CONTRATADOS: "[]" } }]),
    { ok: false, motivo: "INCONSISTENTE" });
});

test("12C.14.2: rechaza vínculo de varias empresas y estado desconocido", () => {
  assert.equal(leer([fila(1, { EMPRESA: [empresa, ajena] })]).ok, false);
  assert.equal(leer([fila(1, { ESTADO: "PENDIENTE" })]).ok, false);
});

test("12C.14.2: no altera registros recibidos", () => {
  const entrada = Object.freeze([Object.freeze(fila(1))]);
  const antes = JSON.stringify(entrada);
  assert.equal(leer(entrada).ok, true);
  assert.equal(JSON.stringify(entrada), antes);
});
