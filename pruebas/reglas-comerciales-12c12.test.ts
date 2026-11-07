import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODULOS_COMERCIALES,
  validarContrataciones,
  coberturaSubmodulo,
  incluyeNivelModulo,
  incluyeNivelSubmodulo,
} from "../core/reglas-comerciales.js";

// Catálogo de prueba: no es la aprobación del catálogo comercial definitivo.
const catalogo = [
  { id: "CHEQUES", moduloPadre: "ADMINISTRACION" },
  { id: "BANCOS", moduloPadre: "ADMINISTRACION" },
] as const;

const principal = (modulo: string, nivel: string) =>
  ({ modalidad: "MODULO_PRINCIPAL", modulo, nivel });
const individual = (submodulo: string, nivel: string) =>
  ({ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo, nivel });

test("12C.12: exactamente seis módulos comerciales; Core es técnico", () => {
  assert.deepEqual(MODULOS_COMERCIALES, [
    "INVENTARIO", "MOVIMIENTOS", "CUENTAS_CORRIENTES",
    "ADMINISTRACION", "FACTURACION", "REPORTES",
  ]);
  assert.equal(validarContrataciones([principal("CORE", "ESENCIAL")], catalogo).ok, false);
  assert.equal(validarContrataciones([principal("CONFIGURACION", "PREMIUM")], catalogo).ok, false);
});

test("12C.12: acepta módulos distintos con niveles propios", () => {
  const resultado = validarContrataciones([
    principal("INVENTARIO", "PREMIUM"), principal("MOVIMIENTOS", "GESTION"),
    principal("FACTURACION", "ESENCIAL"),
  ], catalogo);
  assert.equal(resultado.ok, true);
  if (resultado.ok) assert.equal(resultado.contrataciones.length, 3);
});

test("12C.12: Inventario Premium con Cheques Estándar es válido", () => {
  assert.equal(validarContrataciones([
    principal("INVENTARIO", "PREMIUM"), individual("CHEQUES", "ESTANDAR"),
  ], catalogo).ok, true);
});

test("12C.12: Cheques Estándar y Bancos Premium son compatibles", () => {
  assert.equal(validarContrataciones([
    individual("CHEQUES", "ESTANDAR"), individual("BANCOS", "PREMIUM"),
  ], catalogo).ok, true);
});

test("12C.12: bloquea módulo y submódulo superpuestos en cualquier orden", () => {
  for (const entradas of [
    [principal("ADMINISTRACION", "GESTION"), individual("CHEQUES", "PREMIUM")],
    [individual("BANCOS", "ESTANDAR"), principal("ADMINISTRACION", "PREMIUM")],
  ]) {
    const r = validarContrataciones(entradas, catalogo);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errores.join(" "), /Incompatibilidad/);
  }
});

test("12C.12: no mezcla los niveles de las dos modalidades", () => {
  assert.equal(validarContrataciones([principal("INVENTARIO", "ESTANDAR")], catalogo).ok, false);
  assert.equal(validarContrataciones([individual("CHEQUES", "AVANZADO")], catalogo).ok, false);
});

test("12C.12: rechaza contratos y servicios duplicados", () => {
  assert.equal(validarContrataciones([
    principal("INVENTARIO", "PREMIUM"), principal("INVENTARIO", "GESTION"),
  ], catalogo).ok, false);
  assert.equal(validarContrataciones([
    individual("CHEQUES", "PREMIUM"), individual("CHEQUES", "ESTANDAR"),
  ], catalogo).ok, false);
});

test("12C.12: deniega identificadores, datos y formas desconocidos", () => {
  assert.equal(validarContrataciones(null, catalogo).ok, false);
  assert.equal(validarContrataciones([null], catalogo).ok, false);
  assert.equal(validarContrataciones([principal("INEXISTENTE", "PREMIUM")], catalogo).ok, false);
  assert.equal(validarContrataciones([individual("INEXISTENTE", "PREMIUM")], catalogo).ok, false);
  assert.equal(validarContrataciones([{ ...principal("INVENTARIO", "PREMIUM"), habilitado: true }], catalogo).ok, false);
  assert.equal(validarContrataciones([{ modalidad: "OTRA", modulo: "INVENTARIO", nivel: "PREMIUM" }], catalogo).ok, false);
});

test("12C.12: valida también el catálogo confiable", () => {
  assert.equal(validarContrataciones([], [
    { id: "CHEQUES", moduloPadre: "ADMINISTRACION" },
    { id: "CHEQUES", moduloPadre: "ADMINISTRACION" },
  ]).ok, false);
  assert.equal(validarContrataciones([], [
    { id: "CHEQUES", moduloPadre: "NO_EXISTE" },
  ] as never).ok, false);
});

test("12C.12: los niveles progresivos incluyen únicamente los anteriores", () => {
  assert.equal(incluyeNivelModulo("PREMIUM", "GESTION"), true);
  assert.equal(incluyeNivelModulo("GESTION", "PREMIUM"), false);
  assert.equal(incluyeNivelModulo("ESENCIAL", "ESENCIAL"), true);
  assert.equal(incluyeNivelModulo("ESTANDAR", "ESENCIAL"), false);
  assert.equal(incluyeNivelSubmodulo("PREMIUM", "ESTANDAR"), true);
  assert.equal(incluyeNivelSubmodulo("ESTANDAR", "PREMIUM"), false);
  assert.equal(incluyeNivelSubmodulo("AVANZADO", "ESTANDAR"), false);
});

test("12C.12: un submódulo hereda el nivel del módulo principal", () => {
  assert.deepEqual(coberturaSubmodulo([
    principal("ADMINISTRACION", "AVANZADO"),
  ], "CHEQUES", catalogo), { modalidad: "MODULO_PRINCIPAL", nivel: "AVANZADO" });
  assert.deepEqual(coberturaSubmodulo([
    individual("CHEQUES", "ESTANDAR"),
  ], "CHEQUES", catalogo), { modalidad: "SUBMODULO_INDEPENDIENTE", nivel: "ESTANDAR" });
  assert.equal(coberturaSubmodulo([], "CHEQUES", catalogo), null);
  assert.equal(coberturaSubmodulo([principal("ADMINISTRACION", "PREMIUM")], "DESCONOCIDO", catalogo), null);
});

test("12C.12: nunca concede cobertura con contratos incompatibles", () => {
  assert.equal(coberturaSubmodulo([
    principal("ADMINISTRACION", "PREMIUM"), individual("CHEQUES", "ESTANDAR"),
  ], "CHEQUES", catalogo), null);
});

test("12C.12: no altera los datos originales ni crea acceso implícito", () => {
  const entradas = Object.freeze([Object.freeze(principal("INVENTARIO", "PREMIUM"))]);
  const copia = JSON.stringify(entradas);
  const resultado = validarContrataciones(entradas, catalogo);
  assert.equal(resultado.ok, true);
  assert.equal(JSON.stringify(entradas), copia);
  assert.notStrictEqual(resultado.ok && resultado.contrataciones[0], entradas[0]);
  assert.deepEqual(validarContrataciones([], catalogo), { ok: true, contrataciones: [] });
  assert.equal(coberturaSubmodulo([], "CHEQUES", catalogo), null);
});
