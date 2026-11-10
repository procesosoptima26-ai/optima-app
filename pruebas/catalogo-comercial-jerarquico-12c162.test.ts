import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATALOGO_COMERCIAL_JERARQUICO,
  CATALOGO_SUBMODULOS_CONTRATACION,
  buscarSubmoduloComercial,
  submodulosDeModulo,
} from "../core/catalogo-comercial-jerarquico.js";
import {
  MODULOS_COMERCIALES,
  validarContrataciones,
  coberturaSubmodulo,
  incluyeNivelModulo,
  incluyeNivelSubmodulo,
} from "../core/reglas-comerciales.js";

const cantidades = {
  INVENTARIO: 6,
  MOVIMIENTOS: 6,
  CUENTAS_CORRIENTES: 2,
  ADMINISTRACION: 7,
  FACTURACION: 3,
  REPORTES: 5,
} as const;
const principal = (modulo: string, nivel: string) => ({ modalidad: "MODULO_PRINCIPAL", modulo, nivel });
const individual = (submodulo: string, nivel: string) => ({ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo, nivel });

test("12C.16.2: contiene 6 módulos comerciales, sin CORE vendible", () => {
  assert.equal(MODULOS_COMERCIALES.length, 6);
  assert.deepEqual(MODULOS_COMERCIALES, Object.keys(cantidades));
});

test("12C.16.2: exactamente 29 submódulos, sin duplicados", () => {
  assert.equal(CATALOGO_COMERCIAL_JERARQUICO.length, 29);
  assert.equal(new Set(CATALOGO_COMERCIAL_JERARQUICO.map(s => s.id)).size, 29);
});

test("12C.16.2: todos los IDs son válidos y los padres existen", () => {
  for (const s of CATALOGO_COMERCIAL_JERARQUICO) {
    assert.match(s.id, /^[A-Z][A-Z0-9_]{1,63}$/);
    assert.ok(MODULOS_COMERCIALES.includes(s.moduloPadre));
    assert.ok(s.id !== s.moduloPadre);
  }
});

test("12C.16.2: todos los submódulos describen ESTANDAR y PREMIUM", () => {
  for (const s of CATALOGO_COMERCIAL_JERARQUICO) {
    for (const campo of [s.nombre, s.estandar, s.premium]) {
      assert.ok(campo.trim().length >= 5);
    }
  }
});

test("12C.16.2: formato compacto exacto compatible con 12C.12", () => {
  assert.equal(CATALOGO_SUBMODULOS_CONTRATACION.length, 29);
  assert.ok(CATALOGO_SUBMODULOS_CONTRATACION.every(s => Object.keys(s).length === 2));
  assert.deepEqual(CATALOGO_SUBMODULOS_CONTRATACION.map(s => s.id),
    CATALOGO_COMERCIAL_JERARQUICO.map(s => s.id));
  assert.equal(validarContrataciones([], CATALOGO_SUBMODULOS_CONTRATACION).ok, true);
});

test("12C.16.2: mantiene IDs de CHEQUES y BANCOS previos", () => {
  assert.equal(buscarSubmoduloComercial("CHEQUES")?.moduloPadre, "ADMINISTRACION");
  assert.equal(buscarSubmoduloComercial("BANCOS")?.moduloPadre, "ADMINISTRACION");
});

test("12C.16.2: no inventa productos para historial, Core y tableros", () => {
  for (const id of ["CORE", "MOV_HISTORIAL", "REP_DASHBOARDS", "FAC_NOTAS_CREDITO", "CC_MAESTRO_CLIENTES"]) {
    assert.equal(buscarSubmoduloComercial(id), null);
  }
});

test("12C.16.2: rechazo de contrataciones desconocidas y niveles cruzados", () => {
  for (const entrada of [individual("NO_EXISTE", "ESTANDAR"),
    individual("CHEQUES", "GESTION"), principal("INVENTARIO", "ESTANDAR"),
    principal("CORE", "PREMIUM")]) {
    assert.equal(validarContrataciones([entrada], CATALOGO_SUBMODULOS_CONTRATACION).ok, false);
  }
});

test("12C.16.2: niveles de ambas modalidades preservan jerarquías independientes", () => {
  assert.equal(incluyeNivelModulo("PREMIUM", "ESENCIAL"), true);
  assert.equal(incluyeNivelModulo("ESENCIAL", "GESTION"), false);
  assert.equal(incluyeNivelSubmodulo("PREMIUM", "ESTANDAR"), true);
  assert.equal(incluyeNivelSubmodulo("ESTANDAR", "PREMIUM"), false);
});

test("12C.16.2: catálogo inmutable y motor no muta datos de entrada", () => {
  assert.equal(Object.isFrozen(CATALOGO_COMERCIAL_JERARQUICO), true);
  assert.equal(Object.isFrozen(CATALOGO_SUBMODULOS_CONTRATACION), true);
  const entradas = Object.freeze([Object.freeze(individual("CHEQUES", "ESTANDAR"))]);
  const antes = JSON.stringify(entradas);
  assert.equal(validarContrataciones(entradas, CATALOGO_SUBMODULOS_CONTRATACION).ok, true);
  assert.equal(JSON.stringify(entradas), antes);
});

for (const modulo of MODULOS_COMERCIALES) {
  test(`12C.16.2: ${modulo} agrupa sus submódulos y hereda nivel del principal`, () => {
    const submodulos = submodulosDeModulo(modulo);
    assert.equal(submodulos.length, cantidades[modulo]);
    assert.ok(submodulos.every(s => s.moduloPadre === modulo));
    const contratos = [principal(modulo, "AVANZADO")];
    const r = validarContrataciones(contratos, CATALOGO_SUBMODULOS_CONTRATACION);
    assert.equal(r.ok, true);
    for (const s of submodulos) {
      assert.deepEqual(coberturaSubmodulo(contratos, s.id, CATALOGO_SUBMODULOS_CONTRATACION),
        { modalidad: "MODULO_PRINCIPAL", nivel: "AVANZADO" });
      assert.equal(validarContrataciones([...contratos, individual(s.id, "ESTANDAR")],
        CATALOGO_SUBMODULOS_CONTRATACION).ok, false);
    }
  });
}

for (const ficha of CATALOGO_COMERCIAL_JERARQUICO) {
  test(`12C.16.2: contratación independiente ESTANDAR/PREMIUM de ${ficha.id}`, () => {
    const c = CATALOGO_SUBMODULOS_CONTRATACION;
    const estandar = [individual(ficha.id, "ESTANDAR")];
    const premium = [individual(ficha.id, "PREMIUM")];
    assert.equal(validarContrataciones(estandar, c).ok, true);
    assert.equal(validarContrataciones(premium, c).ok, true);
    assert.deepEqual(coberturaSubmodulo(estandar, ficha.id, c),
      { modalidad: "SUBMODULO_INDEPENDIENTE", nivel: "ESTANDAR" });
    assert.deepEqual(coberturaSubmodulo(premium, ficha.id, c),
      { modalidad: "SUBMODULO_INDEPENDIENTE", nivel: "PREMIUM" });
    assert.equal(validarContrataciones([...estandar, ...premium], c).ok, false);
  });
}
