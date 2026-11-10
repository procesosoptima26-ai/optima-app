import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODULOS_COMERCIALES,
  NIVELES_MODULO,
  NIVELES_SUBMODULO,
  type ContratacionComercial,
} from "../core/reglas-comerciales.js";
import {
  CATALOGO_COMERCIAL_JERARQUICO,
  CATALOGO_SUBMODULOS_CONTRATACION,
} from "../core/catalogo-comercial-jerarquico.js";
import {
  compararPropuestasComerciales,
  resumenCatalogoDeSimulacion,
  simularPropuestaComercial,
} from "../core/simulador-contratacion-comercial-12c17.js";

const principal = (modulo: (typeof MODULOS_COMERCIALES)[number], nivel: (typeof NIVELES_MODULO)[number]) =>
  ({ modalidad: "MODULO_PRINCIPAL" as const, modulo, nivel });
const individual = (submodulo: string, nivel: (typeof NIVELES_SUBMODULO)[number]) =>
  ({ modalidad: "SUBMODULO_INDEPENDIENTE" as const, submodulo, nivel });

function valida(entrada: unknown) {
  const resultado = simularPropuestaComercial(entrada);
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  assert.equal(resultado.accesoOperativoHabilitado, false);
  assert.equal(resultado.simulacion, true);
  assert.equal(resultado.cobertura.length, 29);
  return resultado;
}
function invalida(entrada: unknown) {
  const resultado = simularPropuestaComercial(entrada);
  assert.equal(resultado.ok, false, JSON.stringify(resultado));
  assert.ok(resultado.errores.length > 0);
  assert.equal(resultado.accesoOperativoHabilitado, false);
  assert.equal(resultado.simulacion, true);
  assert.equal("propuesta" in resultado, false);
  return resultado;
}

test("12C.17.1: seis módulos y 29 submódulos exactos", () => {
  assert.deepEqual(resumenCatalogoDeSimulacion(), { modulos: 6, submodulos: 29 });
  assert.equal(new Set(CATALOGO_SUBMODULOS_CONTRATACION.map(x => x.id)).size, 29);
  const esperados = [6, 6, 2, 7, 3, 5];
  MODULOS_COMERCIALES.forEach((modulo, i) => {
    assert.equal(CATALOGO_COMERCIAL_JERARQUICO.filter(c => c.moduloPadre === modulo).length, esperados[i]);
  });
});

test("12C.17.1: configuración vacía válida, sin accesos", () => {
  const resultado = valida([]);
  assert.equal(resultado.modulosCompletos, 0);
  assert.equal(resultado.submodulosIndividuales, 0);
  assert.equal(resultado.submodulosCubiertos, 0);
  assert.ok(resultado.cobertura.every(c => c.cobertura === null));
});

for (const ficha of CATALOGO_COMERCIAL_JERARQUICO) {
  for (const nivel of NIVELES_SUBMODULO) {
    test(`12C.17.1: individual ${ficha.id} ${nivel} sin acceso operativo`, () => {
      const resultado = valida([individual(ficha.id, nivel)]);
      assert.equal(resultado.submodulosIndividuales, 1);
      assert.equal(resultado.modulosCompletos, 0);
      assert.equal(resultado.submodulosCubiertos, 1);
      assert.deepEqual(resultado.cobertura.find(c => c.submodulo === ficha.id)?.cobertura,
        { modalidad: "SUBMODULO_INDEPENDIENTE", nivel });
      assert.ok(resultado.cobertura.filter(c => c.cobertura).every(c => c.submodulo === ficha.id));
    });
  }
}

for (const modulo of MODULOS_COMERCIALES) {
  for (const nivel of NIVELES_MODULO) {
    test(`12C.17.1: módulo ${modulo} ${nivel} cubre todas sus piezas`, () => {
      const resultado = valida([principal(modulo, nivel)]);
      const hijos = CATALOGO_COMERCIAL_JERARQUICO.filter(x => x.moduloPadre === modulo);
      assert.equal(resultado.modulosCompletos, 1);
      assert.equal(resultado.submodulosIndividuales, 0);
      assert.equal(resultado.submodulosCubiertos, hijos.length);
      for (const hijo of hijos) {
        assert.deepEqual(resultado.cobertura.find(x => x.submodulo === hijo.id)?.cobertura,
          { modalidad: "MODULO_PRINCIPAL", nivel });
      }
    });
  }
}

for (const modulo of MODULOS_COMERCIALES) {
  test(`12C.17.1: exclusividad padre-hijo para ${modulo}`, () => {
    const hijo = CATALOGO_COMERCIAL_JERARQUICO.find(x => x.moduloPadre === modulo)!;
    const error = invalida([principal(modulo, "PREMIUM"), individual(hijo.id, "ESTANDAR")]);
    assert.match(error.errores.join(" "), /Incompatibilidad/);
  });
}

test("12C.17.1: veintinueve independientes sin contratar ningún padre", () => {
  const propuesta = CATALOGO_COMERCIAL_JERARQUICO.map(c => individual(c.id, "ESTANDAR"));
  const resultado = valida(propuesta);
  assert.equal(resultado.submodulosIndividuales, 29);
  assert.equal(resultado.submodulosCubiertos, 29);
  assert.equal(resultado.modulosCompletos, 0);
});

test("12C.17.1: seis principales, todos sus submódulos heredan nivel", () => {
  const resultado = valida(MODULOS_COMERCIALES.map(m => principal(m, "GESTION")));
  assert.equal(resultado.modulosCompletos, 6);
  assert.equal(resultado.submodulosCubiertos, 29);
  assert.ok(resultado.cobertura.every(c => c.cobertura?.modalidad === "MODULO_PRINCIPAL" && c.cobertura.nivel === "GESTION"));
});

test("12C.17.1: mezcla válida de modalidad principal e independientes de otro padre", () => {
  const resultado = valida([
    principal("INVENTARIO", "ESENCIAL"),
    individual("CHEQUES", "ESTANDAR"),
    individual("BANCOS", "PREMIUM"),
    principal("REPORTES", "AVANZADO"),
  ]);
  assert.equal(resultado.modulosCompletos, 2);
  assert.equal(resultado.submodulosIndividuales, 2);
  assert.equal(resultado.submodulosCubiertos, 6 + 2 + 5);
});

const casosInvalidos: ReadonlyArray<[string, unknown]> = [
  ["falta lista", undefined],
  ["no es lista", {}],
  ["valor nulo", null],
  ["contrato nulo", [null]],
  ["modalidad desconocida", [{ modalidad: "ARBITRARIA" }]],
  ["submódulo desconocido", [individual("SUBMODULO_INVENTADO", "ESTANDAR")]],
  ["módulo desconocido", [{ modalidad: "MODULO_PRINCIPAL", modulo: "NO_EXISTE", nivel: "PREMIUM" }]],
  ["submódulo con nivel de módulo", [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "GESTION" }]],
  ["módulo con nivel independiente", [{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESTANDAR" }]],
  ["submódulo duplicado", [individual("CHEQUES", "ESTANDAR"), individual("CHEQUES", "PREMIUM")]],
  ["módulo duplicado", [principal("INVENTARIO", "ESENCIAL"), principal("INVENTARIO", "PREMIUM")]],
  ["campos extra", [{ ...principal("INVENTARIO", "ESENCIAL"), permiso: "otorgar" }]],
  ["datos extra en hijo", [{ ...individual("CHEQUES", "ESTANDAR"), precio: 10 }]],
  ["nivel cambiado por minúscula", [{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "esencial" }]],
  ["entrada de texto", ["CHEQUES"]],
];
for (const [nombre, entrada] of casosInvalidos) {
  test(`12C.17.1: rechaza ${nombre}`, () => { invalida(entrada); });
}

test("12C.17.1: si una línea falla no se devuelve contratación parcial", () => {
  invalida([principal("REPORTES", "PREMIUM"), individual("INVALIDO", "ESTANDAR")]);
});

test("12C.17.1: no modifica la propuesta original ni las estructuras del catálogo", () => {
  const original: ContratacionComercial[] = [individual("CHEQUES", "ESTANDAR")];
  const snapshot = JSON.stringify(original);
  const catalogo = JSON.stringify(CATALOGO_COMERCIAL_JERARQUICO);
  const r = valida(original);
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(JSON.stringify(CATALOGO_COMERCIAL_JERARQUICO), catalogo);
  assert.notEqual(r.propuesta[0], original[0]);
  original[0] = principal("ADMINISTRACION", "PREMIUM");
  assert.deepEqual(r.propuesta[0], individual("CHEQUES", "ESTANDAR"));
});

test("12C.17.1: al subir nivel individual se registra cambio de nivel", () => {
  const r = compararPropuestasComerciales([individual("CHEQUES", "ESTANDAR")], [individual("CHEQUES", "PREMIUM")]);
  assert.equal(r.ok, true);
  assert.equal(r.cambios.length, 1);
  assert.equal(r.cambios[0].tipo, "CAMBIO_NIVEL");
  assert.equal(r.accesoOperativoHabilitado, false);
});

test("12C.17.1: pasar Cheques individual a Administración completo cambia modalidad y agrega hermanos", () => {
  const r = compararPropuestasComerciales([individual("CHEQUES", "ESTANDAR")], [principal("ADMINISTRACION", "GESTION")]);
  assert.equal(r.ok, true);
  assert.equal(r.cambios.length, 7);
  assert.equal(r.cambios.filter(c => c.tipo === "ALTA").length, 6);
  assert.equal(r.cambios.filter(c => c.tipo === "CAMBIO_MODALIDAD").length, 1);
  assert.equal(r.cambios.find(c => c.submodulo === "CHEQUES")?.tipo, "CAMBIO_MODALIDAD");
});

test("12C.17.1: volver de módulo completo a Cheques individual señala bajas", () => {
  const r = compararPropuestasComerciales([principal("ADMINISTRACION", "PREMIUM")], [individual("CHEQUES", "ESTANDAR")]);
  assert.equal(r.ok, true);
  assert.equal(r.cambios.length, 7);
  assert.equal(r.cambios.filter(c => c.tipo === "BAJA").length, 6);
  assert.equal(r.cambios.filter(c => c.tipo === "CAMBIO_MODALIDAD").length, 1);
});

test("12C.17.1: dos snapshots iguales no producen cambios", () => {
  const r = compararPropuestasComerciales([individual("CHEQUES", "ESTANDAR")], [individual("CHEQUES", "ESTANDAR")]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.cambios, []);
  assert.equal(r.sinCambios, true);
});

test("12C.17.1: el orden de la lista no genera cambios ficticios", () => {
  const a = [individual("CHEQUES", "ESTANDAR"), individual("BANCOS", "PREMIUM")];
  const r = compararPropuestasComerciales(a, [...a].reverse());
  assert.equal(r.ok, true);
  assert.equal(r.sinCambios, true);
});

test("12C.17.1: de nada a algo marca alta", () => {
  const r = compararPropuestasComerciales([], [individual("CHEQUES", "PREMIUM")]);
  assert.equal(r.ok, true);
  assert.equal(r.cambios.length, 1);
  assert.equal(r.cambios[0].tipo, "ALTA");
});

test("12C.17.1: de algo a nada marca baja, sin borrar historia", () => {
  const r = compararPropuestasComerciales([individual("CHEQUES", "PREMIUM")], []);
  assert.equal(r.ok, true);
  assert.equal(r.cambios.length, 1);
  assert.equal(r.cambios[0].tipo, "BAJA");
  assert.equal(r.accesoOperativoHabilitado, false);
  assert.equal("historial" in r, false); // esta simulación no lee ni altera versiones históricas
});

test("12C.17.1: propuesta inválida rechaza toda la comparación", () => {
  const r = compararPropuestasComerciales([], [principal("ADMINISTRACION", "ESENCIAL"), individual("CHEQUES", "ESTANDAR")]);
  assert.equal(r.ok, false);
  assert.ok(r.errores.every(e => e.startsWith("Propuesta:")));
  assert.equal(r.accesoOperativoHabilitado, false);
});

test("12C.17.1: original inválido rechaza toda la comparación", () => {
  const r = compararPropuestasComerciales([individual("INVALIDO", "ESTANDAR")], []);
  assert.equal(r.ok, false);
  assert.ok(r.errores.every(e => e.startsWith("Anterior:")));
});

test("12C.17.1: ambos inválidos explican ambos extremos", () => {
  const r = compararPropuestasComerciales(null, undefined);
  assert.equal(r.ok, false);
  assert.ok(r.errores.some(e => e.startsWith("Anterior:")));
  assert.ok(r.errores.some(e => e.startsWith("Propuesta:")));
});
