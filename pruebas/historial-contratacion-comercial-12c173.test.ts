import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGO_COMERCIAL_JERARQUICO } from "../core/catalogo-comercial-jerarquico.js";
import { MODULOS_COMERCIALES } from "../core/reglas-comerciales.js";
import { crearBorradorComercialLocal, actualizarBorradorComercialLocal } from "../core/borradores-contratacion-comercial-12c172.js";
import {
  activarVersionComercialLocal, aprobarBorradorComercialLocal,
  consultarVersionVigenteLocal, esHistorialComercialLocalValido,
  iniciarHistorialComercialLocal,
  type HistorialContratacionSimulado,
  type ResultadoHistorialSimulado,
  type ErrorHistorialSimulado,
} from "../core/historial-contratacion-comercial-12c173.js";

const EMP = 'emp_'+'a'.repeat(12);
const OTRA = 'emp_'+'b'.repeat(12);
const ADMIN = `rec${"C".repeat(14)}`;
const OTRO_ADMIN = `rec${"D".repeat(14)}`;
const CTR = "CTR-OPTIMA-001";
const V1 = "VER-OPTIMA-0001";
const V2 = "VER-OPTIMA-0002";
const V3 = "VER-OPTIMA-0003";
const T0 = "2026-11-10T13:00:00.000Z";
const T1 = "2026-11-10T14:00:00.000Z";
const T2 = "2026-11-10T15:00:00.000Z";
const T3 = "2026-11-10T16:00:00.000Z";
const T4 = "2026-11-10T17:00:00.000Z";
const T5 = "2026-11-10T18:00:00.000Z";
const T6 = "2026-11-10T19:00:00.000Z";
const T7 = "2026-11-10T20:00:00.000Z";
const IND = (submodulo: string, nivel: "ESTANDAR" | "PREMIUM" = "ESTANDAR") =>
  ({ modalidad: "SUBMODULO_INDEPENDIENTE" as const, submodulo, nivel });
const MOD = (modulo: (typeof MODULOS_COMERCIALES)[number], nivel: "ESENCIAL" | "GESTION" | "AVANZADO" | "PREMIUM" = "GESTION") =>
  ({ modalidad: "MODULO_PRINCIPAL" as const, modulo, nivel });

function correcto(r: ResultadoHistorialSimulado): HistorialContratacionSimulado {
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("La simulación no se creó");
  assert.equal(r.simulacion, true);
  assert.equal(r.accesoOperativoHabilitado, false);
  assert.equal(r.historial.simulacion, true);
  assert.equal(r.historial.accesoOperativoHabilitado, false);
  assert.equal(esHistorialComercialLocalValido(r.historial), true);
  return r.historial;
}
function error(r: ResultadoHistorialSimulado, motivo: ErrorHistorialSimulado) {
  assert.equal(r.ok, false, JSON.stringify(r));
  if (r.ok) throw Error("Debió rechazarse");
  assert.equal(r.motivo, motivo);
  assert.equal(r.accesoOperativoHabilitado, false);
  assert.equal("historial" in r, false);
}
function inicio(empresaId = EMP, idContrato = CTR) {
  return correcto(iniciarHistorialComercialLocal({ empresaId, idContrato }));
}
function borradorNuevo(serviciosPropuestos: unknown = [IND("CHEQUES")]) {
  const r = crearBorradorComercialLocal({ idBorrador: "BOR-OPTIMA-001", empresaId: EMP,
    idContrato: null, versionBase: null, serviciosBase: [], serviciosPropuestos,
    motivoCambio: "Alta inicial para prueba local", ahoraIso: T0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("Borrador inválido");
  return r.borrador;
}
function borradorSiguiente(h: HistorialContratacionSimulado, propuesta: unknown = [MOD("ADMINISTRACION")]) {
  const vigente = h.versiones.find(v => v.estado === "VIGENTE");
  assert.ok(vigente, "Debe existir versión vigente");
  const r = crearBorradorComercialLocal({ idBorrador: "BOR-OPTIMA-002", empresaId: EMP,
    idContrato: CTR, versionBase: vigente.numero, serviciosBase: vigente.servicios,
    serviciosPropuestos: propuesta, motivoCambio: "Cambio comercial para versión siguiente", ahoraIso: T3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("Borrador inválido");
  return r.borrador;
}
function aprobar(h: HistorialContratacionSimulado, borrador: unknown, idVersion = V1, extra = {}) {
  return aprobarBorradorComercialLocal({ historial: h, borrador, empresaId: EMP,
    actorUsuarioId: ADMIN, idVersion, revisionHistorialEsperada: h.revisionHistorial,
    ahoraIso: idVersion === V1 ? T1 : idVersion === V2 ? T4 : T6, ...extra });
}
function activar(h: HistorialContratacionSimulado, idVersion = V1, extra = {}) {
  return activarVersionComercialLocal({ historial: h, empresaId: EMP,
    actorUsuarioId: OTRO_ADMIN, idVersion, revisionHistorialEsperada: h.revisionHistorial,
    ahoraIso: idVersion === V1 ? T2 : idVersion === V2 ? T5 : T7, ...extra });
}
function primeraAprobada() { return correcto(aprobar(inicio(), borradorNuevo())); }
function primeraVigente() { return correcto(activar(primeraAprobada())); }
function segundaAprobada() { const h = primeraVigente(); return correcto(aprobar(h, borradorSiguiente(h), V2)); }
function segundaVigente() { return correcto(activar(segundaAprobada(), V2)); }

// Cobertura transversal del catálogo: los 29 productos pueden versionarse en una propuesta válida.
for (const ficha of CATALOGO_COMERCIAL_JERARQUICO) {
  test(`12C.17.3: crea versión aprobada de ${ficha.id}, sin activar permisos`, () => {
    const h = correcto(aprobar(inicio(), borradorNuevo([IND(ficha.id, "PREMIUM")])));
    assert.equal(h.versiones[0].estado, "APROBADA");
    assert.equal(h.versiones[0].servicios[0].modalidad, "SUBMODULO_INDEPENDIENTE");
    assert.equal(h.revisionHistorial, 1);
    assert.equal(h.eventos[0].tipo, "APROBACION");
    const lectura = consultarVersionVigenteLocal({ historial: h, empresaId: EMP });
    assert.equal(lectura.ok, true);
    if (lectura.ok) assert.equal(lectura.version, null);
  });
}
for (const modulo of MODULOS_COMERCIALES) {
  test(`12C.17.3: activa una versión nueva para ${modulo} completo`, () => {
    const a = correcto(aprobar(inicio(), borradorNuevo([MOD(modulo, "ESENCIAL")])));
    const v = correcto(activar(a));
    assert.equal(v.versiones[0].estado, "VIGENTE");
    assert.equal(v.versiones[0].servicios[0].modalidad, "MODULO_PRINCIPAL");
    assert.equal(v.eventos.length, 2);
  });
}

test("12C.17.3: historial inicia vacío con revisión cero", () => {
  const h = inicio();
  assert.equal(h.revisionHistorial, 0);
  assert.deepEqual(h.versiones, []);
  assert.deepEqual(h.eventos, []);
  assert.ok(Object.isFrozen(h));
});
test("12C.17.3: aprobación es distinta de vigencia y no modifica historial anterior", () => {
  const h0 = inicio();
  const h1 = correcto(aprobar(h0, borradorNuevo()));
  assert.equal(h0.versiones.length, 0);
  assert.equal(h1.versiones[0].vigenteDesdeIso, null);
  assert.equal(h1.versiones[0].aprobadoPorId, ADMIN);
  assert.equal(h1.versiones[0].motivoCambio, "Alta inicial para prueba local");
  assert.equal(h1.revisionHistorial, 1);
});
test("12C.17.3: activación explícita crea una única vigente", () => {
  const h = primeraVigente();
  assert.equal(h.versiones.length, 1);
  assert.equal(h.versiones[0].estado, "VIGENTE");
  assert.equal(h.versiones[0].vigenteDesdeIso, T2);
  assert.equal(h.versiones[0].vigenteHastaIso, null);
  assert.equal(h.revisionHistorial, 2);
  assert.deepEqual(h.eventos.map(e => e.tipo), ["APROBACION", "ACTIVACION"]);
  assert.equal(h.eventos[1].actorUsuarioId, OTRO_ADMIN);
});
test("12C.17.3: nueva aprobación conserva la anterior vigente hasta activar", () => {
  const h = segundaAprobada();
  assert.equal(h.versiones.length, 2);
  assert.deepEqual(h.versiones.map(v => v.estado), ["VIGENTE", "APROBADA"]);
  const actual = consultarVersionVigenteLocal({ historial: h, empresaId: EMP });
  assert.equal(actual.ok, true);
  if (actual.ok) assert.equal(actual.version?.idVersion, V1);
});
test("12C.17.3: activar segunda versión convierte primera en histórica sin borrar servicios", () => {
  const h = segundaVigente();
  assert.deepEqual(h.versiones.map(v => v.estado), ["HISTORICA", "VIGENTE"]);
  assert.equal(h.versiones[0].sustituidaPorId, V2);
  assert.equal(h.versiones[0].vigenteHastaIso, T5);
  assert.deepEqual(h.versiones[0].servicios, [IND("CHEQUES")]);
  assert.deepEqual(h.versiones[1].servicios, [MOD("ADMINISTRACION")]);
  assert.equal(h.eventos[3].idVersionAnterior, V1);
  assert.equal(h.eventos[3].tipo, "ACTIVACION");
  assert.equal(h.revisionHistorial, 4);
});
test("12C.17.3: tercera versión conserva dos históricos y contador secuencial", () => {
  const h = segundaVigente();
  const b = crearBorradorComercialLocal({ idBorrador: "BOR-OPTIMA-003", empresaId: EMP,
    idContrato: CTR, versionBase: 2, serviciosBase: [MOD("ADMINISTRACION")],
    serviciosPropuestos: [MOD("ADMINISTRACION", "PREMIUM")],
    motivoCambio: "Ampliar nivel de Administración", ahoraIso: T6 });
  assert.equal(b.ok, true);
  if (!b.ok) throw Error("Borrador no esperado");
  const aprobada = correcto(aprobar(h, b.borrador, V3));
  const vigente = correcto(activar(aprobada, V3));
  assert.deepEqual(vigente.versiones.map(v => v.numero), [1, 2, 3]);
  assert.deepEqual(vigente.versiones.map(v => v.estado), ["HISTORICA", "HISTORICA", "VIGENTE"]);
  assert.equal(vigente.versiones[1].sustituidaPorId, V3);
  assert.equal(vigente.revisionHistorial, 6);
});
test("12C.17.3: repetir aprobación con revisión antigua deniega", () => {
  const h0 = inicio();
  const b = borradorNuevo();
  const h1 = correcto(aprobar(h0, b));
  error(aprobar(h1, b, V2, { revisionHistorialEsperada: 0 }), "REVISION_DESACTUALIZADA");
});
test("12C.17.3: repetir activación deniega estado anterior", () => {
  error(activar(primeraVigente(), V1), "ESTADO_INVALIDO");
});
test("12C.17.3: no permite otra aprobación mientras hay una pendiente", () => {
  const h = primeraAprobada();
  error(aprobar(h, borradorNuevo([IND("BANCOS")]), V2), "VERSION_BASE_DESACTUALIZADA");
});
test("12C.17.3: revisar la activación previa con contador viejo deniega", () => {
  const h = primeraAprobada();
  error(activar(h, V1, { revisionHistorialEsperada: 0 }), "REVISION_DESACTUALIZADA");
});
test("12C.17.3: ID de versión duplicado no genera historial nuevo", () => {
  const h = primeraVigente();
  error(aprobar(h, borradorSiguiente(h), V1), "DATOS_INVALIDOS");
});
test("12C.17.3: versión base anterior se rechaza aunque cambie el borrador", () => {
  const h = segundaVigente();
  const b = crearBorradorComercialLocal({ idBorrador: "BOR-OPTIMA-004", empresaId: EMP,
    idContrato: CTR, versionBase: 1, serviciosBase: [IND("CHEQUES")],
    serviciosPropuestos: [MOD("REPORTES")], motivoCambio: "Edición antigua desactualizada", ahoraIso: T6 });
  assert.equal(b.ok, true);
  if (!b.ok) throw Error("Borrador no válido");
  error(aprobar(h, b.borrador, V3), "VERSION_BASE_DESACTUALIZADA");
});
test("12C.17.3: snapshot base distinto del vigente se rechaza", () => {
  const h = primeraVigente();
  const b = crearBorradorComercialLocal({ idBorrador: "BOR-OPTIMA-005", empresaId: EMP,
    idContrato: CTR, versionBase: 1, serviciosBase: [IND("BANCOS")],
    serviciosPropuestos: [MOD("REPORTES")], motivoCambio: "Base distinta para edición", ahoraIso: T3 });
  assert.equal(b.ok, true);
  if (!b.ok) throw Error("Borrador no válido");
  error(aprobar(h, b.borrador, V2), "VERSION_BASE_DESACTUALIZADA");
});
test("12C.17.3: empresa del solicitante diferente deniega aprobación", () => {
  error(aprobar(inicio(), borradorNuevo(), V1, { empresaId: OTRA }), "EMPRESA_NO_COINCIDE");
});
test("12C.17.3: empresa del borrador diferente deniega aprobación", () => {
  const b = borradorNuevo();
  const falsificado = { ...b, empresaId: OTRA };
  error(aprobar(inicio(), falsificado), "EMPRESA_NO_COINCIDE");
});
test("12C.17.3: empresa diferente deniega activación", () => {
  error(activar(primeraAprobada(), V1, { empresaId: OTRA }), "EMPRESA_NO_COINCIDE");
});
test("12C.17.3: contrato diferente deniega", () => {
  const h = primeraVigente();
  const b = borradorSiguiente(h);
  error(aprobar(inicio(EMP, "CTR-OTRO-002"), b, V2), "CONTRATO_NO_COINCIDE");
});
test("12C.17.3: no permite activar versión que no existe", () => {
  error(activar(primeraAprobada(), V2), "VERSION_NO_ENCONTRADA");
});
test("12C.17.3: se rechaza activación antes de fecha de aprobación", () => {
  error(activar(primeraAprobada(), V1, { ahoraIso: T0 }), "FECHA_INVALIDA");
});
test("12C.17.3: no permite aprobación antes de editar borrador", () => {
  error(aprobar(inicio(), borradorNuevo(), V1, { ahoraIso: "2026-11-10T12:00:00.000Z" }), "FECHA_INVALIDA");
});
test("12C.17.3: no permite retroceder el reloj entre eventos", () => {
  const h = primeraVigente();
  error(aprobar(h, borradorSiguiente(h), V2, { ahoraIso: T1 }), "FECHA_INVALIDA");
});
test("12C.17.3: sin actor válido no se puede aprobar", () => {
  error(aprobar(inicio(), borradorNuevo(), V1, { actorUsuarioId: "administrador" }), "DATOS_INVALIDOS");
});
test("12C.17.3: sin actor válido no se puede activar", () => {
  error(activar(primeraAprobada(), V1, { actorUsuarioId: "otro" }), "DATOS_INVALIDOS");
});
test("12C.17.3: rechaza identificador de versión inválido", () => {
  error(aprobar(inicio(), borradorNuevo(), "bad"), "DATOS_INVALIDOS");
});
test("12C.17.3: contrato y empresa deben ser identificadores válidos", () => {
  error(iniciarHistorialComercialLocal({ empresaId: "x", idContrato: CTR }), "DATOS_INVALIDOS");
  error(iniciarHistorialComercialLocal({ empresaId: EMP, idContrato: " " }), "DATOS_INVALIDOS");
});
test("12C.17.3: claves inesperadas se rechazan", () => {
  error(iniciarHistorialComercialLocal({ empresaId: EMP, idContrato: CTR, conceder: true }), "DATOS_INVALIDOS");
  error(aprobar(inicio(), borradorNuevo(), V1, { permisos: ["todos"] }), "DATOS_INVALIDOS");
});
test("12C.17.3: no aprueba borrador descartado", () => {
  const b = borradorNuevo();
  error(aprobar(inicio(), { ...b, estado: "DESCARTADO_LOCAL" }), "BORRADOR_INVALIDO");
});
test("12C.17.3: no aprueba borrador con diferencias falsificadas", () => {
  const b = borradorNuevo();
  error(aprobar(inicio(), { ...b, diferencias: [] }), "BORRADOR_INVALIDO");
});
test("12C.17.3: no aprueba borrador con bandera operativa falsificada", () => {
  const b = borradorNuevo();
  error(aprobar(inicio(), { ...b, accesoOperativoHabilitado: true }), "BORRADOR_INVALIDO");
});
test("12C.17.3: no admite más de una versión pendiente", () => {
  const h = segundaAprobada();
  const b = borradorSiguiente(primeraVigente(), [IND("CHEQUES", "PREMIUM")]);
  error(aprobar(h, b, V3), "VERSION_PENDIENTE");
});
test("12C.17.3: no se aprueba un contrato nuevo con historia previa", () => {
  const h = primeraVigente();
  error(aprobar(h, borradorNuevo([IND("BANCOS")]), V2), "VERSION_BASE_DESACTUALIZADA");
});
test("12C.17.3: no se aprueba un contrato existente en historia vacía", () => {
  const h = inicio();
  const b = borradorSiguiente(primeraVigente());
  error(aprobar(h, b), "VERSION_BASE_DESACTUALIZADA");
});
test("12C.17.3: lectura sin versión aprobada no concede acceso", () => {
  const r = consultarVersionVigenteLocal({ historial: inicio(), empresaId: EMP });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.version, null); assert.equal(r.accesoOperativoHabilitado, false); }
});
test("12C.17.3: lectura de otra empresa se rechaza", () => {
  const r = consultarVersionVigenteLocal({ historial: primeraVigente(), empresaId: OTRA });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "EMPRESA_NO_COINCIDE");
});
test("12C.17.3: lectura devuelve copia inmutable de vigente", () => {
  const h = primeraVigente();
  const r = consultarVersionVigenteLocal({ historial: h, empresaId: EMP });
  assert.equal(r.ok, true);
  if (!r.ok || !r.version) throw Error("No hay versión vigente");
  assert.ok(Object.isFrozen(r.version));
  assert.ok(Object.isFrozen(r.version.servicios));
  assert.ok(Object.isFrozen(r.version.servicios[0]));
  assert.notEqual(r.version, h.versiones[0]);
});
test("12C.17.3: historial es inmutable tras transición", () => {
  const antes = primeraAprobada();
  const despues = correcto(activar(antes));
  assert.equal(antes.versiones[0].estado, "APROBADA");
  assert.equal(despues.versiones[0].estado, "VIGENTE");
  assert.ok(Object.isFrozen(despues.eventos));
  assert.ok(Object.isFrozen(despues.versiones[0]));
  assert.ok(Object.isFrozen(despues.versiones[0].servicios[0]));
});
test("12C.17.3: historial inválido se rechaza", () => {
  const h = primeraVigente();
  error(activar({ ...h, revisionHistorial: 999 } as HistorialContratacionSimulado, V1), "HISTORIAL_INVALIDO");
});
test("12C.17.3: historia manipulada no se considera válida", () => {
  const h = segundaVigente();
  const mal = { ...h, versiones: h.versiones.map((v, i) => i === 0 ? { ...v, sustituidaPorId: V1 } : v) };
  assert.equal(esHistorialComercialLocalValido(mal), false);
});
test("12C.17.3: eventos manipulados se rechazan", () => {
  const h = primeraVigente();
  const mal = { ...h, eventos: h.eventos.map((v, i) => i === 1 ? { ...v, actorUsuarioId: "x" } : v) };
  assert.equal(esHistorialComercialLocalValido(mal), false);
});
test("12C.17.3: no duplica coberturas ni inventa servicios", () => {
  const h = segundaVigente();
  assert.equal(h.versiones[0].servicios.length, 1);
  assert.equal(h.versiones[1].servicios.length, 1);
  assert.equal(h.versiones[1].servicios[0].modalidad, "MODULO_PRINCIPAL");
});
test("12C.17.3: fechas en UTC estrictas", () => {
  error(aprobar(inicio(), borradorNuevo(), V1, { ahoraIso: "2026-11-10T14:00:00-03:00" }), "FECHA_INVALIDA");
  error(activar(primeraAprobada(), V1, { ahoraIso: "2026-13-10T15:00:00.000Z" }), "FECHA_INVALIDA");
});
test("12C.17.3: borrador editado puede aprobarse conservando revisión local", () => {
  const b1 = borradorNuevo();
  const r = actualizarBorradorComercialLocal({ borrador: b1, empresaId: EMP,
    revisionEsperada: 1, versionBaseEsperada: null,
    serviciosPropuestos: [IND("CHEQUES", "PREMIUM")],
    motivoCambio: "Mejora del nivel propuesto", ahoraIso: T1 });
  assert.equal(r.ok, true);
  if (!r.ok) throw Error("Falló edición simulada");
  const h = correcto(aprobar(inicio(), r.borrador, V1, { ahoraIso: T2 }));
  assert.equal(h.versiones[0].servicios[0].nivel, "PREMIUM");
});
test("12C.17.3: ninguna transición toca red ni almacenamiento", () => {
  const h1 = primeraAprobada();
  const h2 = correcto(activar(h1));
  assert.equal(h2.simulacion, true);
  assert.equal(h2.accesoOperativoHabilitado, false);
  assert.equal(h2.versiones.every(v => !Object.hasOwn(v, "token")), true);
});
