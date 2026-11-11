import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGO_COMERCIAL_JERARQUICO } from "../core/catalogo-comercial-jerarquico.js";
import { MODULOS_COMERCIALES } from "../core/reglas-comerciales.js";
import { crearBorradorComercialLocal } from "../core/borradores-contratacion-comercial-12c172.js";
import {
  activarVersionComercialLocal, aprobarBorradorComercialLocal,
  esHistorialComercialLocalValido, iniciarHistorialComercialLocal,
  type HistorialContratacionSimulado,
} from "../core/historial-contratacion-comercial-12c173.js";
import {
  confirmarCambioComercialLocal, previsualizarCambioComercialLocal,
  type ActorComercialSimulado, type SolicitudCambioComercialLocal,
  type VistaPreviaComercialLocal, type MotivoFlujoComercialLocal,
} from "../core/flujo-confirmacion-comercial-12c174.js";

const EMP = `rec${"A".repeat(14)}`;
const OTRA = `rec${"B".repeat(14)}`;
const APR = `rec${"C".repeat(14)}`;
const ACT = `rec${"D".repeat(14)}`;
const V1 = "VER-OPTIMA-0001", V2 = "VER-OPTIMA-0002";
const T0 = "2026-11-10T13:00:00.000Z";
const T1 = "2026-11-10T14:00:00.000Z";
const T2 = "2026-11-10T15:00:00.000Z";
const T3 = "2026-11-10T16:00:00.000Z";
const T4 = "2026-11-10T17:00:00.000Z";
const T5 = "2026-11-10T18:00:00.000Z";
const contrato = "CTR-OPTIMA-001";
const ind = (submodulo: string, nivel: "ESTANDAR" | "PREMIUM" = "ESTANDAR") =>
  ({ modalidad: "SUBMODULO_INDEPENDIENTE" as const, submodulo, nivel });
const modulo = (modulo: (typeof MODULOS_COMERCIALES)[number], nivel: "ESENCIAL" | "GESTION" | "AVANZADO" | "PREMIUM" = "GESTION") =>
  ({ modalidad: "MODULO_PRINCIPAL" as const, modulo, nivel });
const actor = (usuarioId: string, operacionesSimuladas: ("APROBACION" | "ACTIVACION")[] = ["APROBACION", "ACTIVACION"],
  rolSimulado: "PLATAFORMA" | "USUARIO" = "PLATAFORMA"): ActorComercialSimulado =>
  ({ usuarioId, rolSimulado, operacionesSimuladas, simulacion: true });
const aprobador = actor(APR), activador = actor(ACT);

function h0() {
  const r = iniciarHistorialComercialLocal({ empresaId: EMP, idContrato: contrato });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("Historial inválido");
  return r.historial;
}
function b0(servicios: unknown = [ind("CHEQUES")]) {
  const r = crearBorradorComercialLocal({ idBorrador: "BOR-OPTIMA-0001", empresaId: EMP,
    idContrato: null, versionBase: null, serviciosBase: [], serviciosPropuestos: servicios,
    motivoCambio: "Alta de servicio para simulación", ahoraIso: T0 });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("Borrador inválido");
  return r.borrador;
}
function solicitudA(servicios: unknown = [ind("CHEQUES")]): SolicitudCambioComercialLocal {
  return { tipo: "APROBACION", historial: h0(), borrador: b0(servicios), empresaId: EMP,
    actor: aprobador, idVersion: V1, revisionHistorialEsperada: 0, ahoraIso: T1 };
}
function preview(s: unknown): VistaPreviaComercialLocal {
  const r = previsualizarCambioComercialLocal(s);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("Vista previa inválida");
  assert.equal(r.accesoOperativoHabilitado, false);
  return r.vista;
}
function confirmar(s: SolicitudCambioComercialLocal) {
  const v = preview(s);
  const r = confirmarCambioComercialLocal({ solicitud: s, vistaPrevia: v, confirmacion: v.fraseConfirmacion });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("No se confirmó");
  assert.equal(r.accesoOperativoHabilitado, false);
  assert.equal(esHistorialComercialLocalValido(r.historial), true);
  return r.historial;
}
function h1A() { return confirmar(solicitudA()); }
function s1V(historial = h1A()): SolicitudCambioComercialLocal {
  return { tipo: "ACTIVACION", historial, empresaId: EMP, actor: activador,
    idVersion: V1, revisionHistorialEsperada: historial.revisionHistorial, ahoraIso: T2 };
}
function h1V() { return confirmar(s1V()); }
function b1(historial: HistorialContratacionSimulado) {
  const vigente = historial.versiones.find(v => v.estado === "VIGENTE");
  assert.ok(vigente);
  const r = crearBorradorComercialLocal({ idBorrador: "BOR-OPTIMA-0002", empresaId: EMP,
    idContrato: contrato, versionBase: vigente.numero, serviciosBase: vigente.servicios,
    serviciosPropuestos: [modulo("ADMINISTRACION")],
    motivoCambio: "Cambio a módulo completo Gestión", ahoraIso: T3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("Borrador 2 inválido");
  return r.borrador;
}
function s2A(historial = h1V()): SolicitudCambioComercialLocal {
  return { tipo: "APROBACION", historial, borrador: b1(historial), empresaId: EMP,
    actor: aprobador, idVersion: V2, revisionHistorialEsperada: historial.revisionHistorial, ahoraIso: T4 };
}
function h2A() { return confirmar(s2A()); }
function s2V(historial = h2A()): SolicitudCambioComercialLocal {
  return { tipo: "ACTIVACION", historial, empresaId: EMP, actor: activador,
    idVersion: V2, revisionHistorialEsperada: historial.revisionHistorial, ahoraIso: T5 };
}
function rechazo(r: ReturnType<typeof previsualizarCambioComercialLocal> | ReturnType<typeof confirmarCambioComercialLocal>, motivo: MotivoFlujoComercialLocal) {
  assert.equal(r.ok, false, JSON.stringify(r));
  if (r.ok) throw Error("Era obligatorio rechazar");
  assert.equal(r.motivo, motivo);
  assert.equal(r.accesoOperativoHabilitado, false);
  assert.equal("historial" in r, false);
}
function ejecutar(s: SolicitudCambioComercialLocal, frase?: string) {
  const v = preview(s);
  return confirmarCambioComercialLocal({ solicitud: s, vistaPrevia: v, confirmacion: frase ?? v.fraseConfirmacion });
}

for (const sub of CATALOGO_COMERCIAL_JERARQUICO) {
  test(`12C.17.4: previsualiza ${sub.id} sin aprobación ni escritura real`, () => {
    const s = solicitudA([ind(sub.id, "PREMIUM")]);
    const v = preview(s);
    assert.equal(v.tipo, "APROBACION");
    assert.equal(v.estadoResultado, "APROBADA");
    assert.equal(v.versionAnteriorVigenteId, null);
    assert.equal(v.revisionResultado, 1);
    assert.equal(v.cambios > 0, true);
    assert.equal(s.historial.revisionHistorial, 0);
    assert.deepEqual(s.historial.versiones, []);
    assert.equal(Object.isFrozen(v), true);
  });
}
for (const nombre of MODULOS_COMERCIALES) {
  test(`12C.17.4: aprueba sin activar módulo completo ${nombre}`, () => {
    const h = confirmar(solicitudA([modulo(nombre, "PREMIUM")]));
    assert.equal(h.versiones[0].estado, "APROBADA");
    assert.equal(h.versiones[0].servicios[0].modalidad, "MODULO_PRINCIPAL");
    assert.equal(h.versiones[0].vigenteDesdeIso, null);
    assert.equal(h.eventos.length, 1);
  });
}

test("12C.17.4: aprobación exige una frase de confirmación exacta", () => {
  const s = solicitudA();
  rechazo(ejecutar(s, "CONFIRMAR"), "CONFIRMACION_INCORRECTA");
});
test("12C.17.4: rechaza texto de confirmación con espacios", () => {
  rechazo(ejecutar(solicitudA(), `CONFIRMAR APROBACION ${V1} `), "CONFIRMACION_INCORRECTA");
});
test("12C.17.4: la aprobación confirmada NO activa permisos ni servicios", () => {
  const h = h1A();
  assert.equal(h.versiones[0].estado, "APROBADA");
  assert.equal(h.versiones[0].vigenteDesdeIso, null);
  assert.equal(h.eventos.length, 1);
  assert.equal(h.accesoOperativoHabilitado, false);
});
test("12C.17.4: la activación requiere segunda vista previa y actor distinto", () => {
  const s = s1V(), v = preview(s);
  assert.equal(v.tipo, "ACTIVACION");
  assert.equal(v.estadoResultado, "VIGENTE");
  assert.equal(v.revisionHistorial, 1);
  assert.equal(v.revisionResultado, 2);
  assert.equal(v.versionAnteriorVigenteId, null);
  const h = confirmar(s);
  assert.equal(h.versiones[0].estado, "VIGENTE");
  assert.equal(h.eventos[1].actorUsuarioId, ACT);
});
test("12C.17.4: el aprobador no puede ser su propio activador simulado", () => {
  const s = s1V();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: aprobador }), "SEPARACION_FUNCIONES");
});
test("12C.17.4: no cambia la versión anterior hasta confirmar activación", () => {
  const s = s2V();
  preview(s);
  assert.deepEqual(s.historial.versiones.map(v => v.estado), ["VIGENTE", "APROBADA"]);
});
test("12C.17.4: la segunda activación conserva el historial y la anterior histórica", () => {
  const h = confirmar(s2V());
  assert.deepEqual(h.versiones.map(v => v.estado), ["HISTORICA", "VIGENTE"]);
  assert.equal(h.versiones[0].sustituidaPorId, V2);
  assert.equal(h.versiones[0].vigenteHastaIso, T5);
  assert.deepEqual(h.versiones[0].servicios, [ind("CHEQUES")]);
  assert.deepEqual(h.versiones[1].servicios, [modulo("ADMINISTRACION")]);
  assert.deepEqual(h.eventos.map(x => x.tipo), ["APROBACION", "ACTIVACION", "APROBACION", "ACTIVACION"]);
});
test("12C.17.4: evita aprobar con actor sin permiso simulado", () => {
  const s = solicitudA();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: actor(APR, ["ACTIVACION"]) }), "ACTOR_NO_AUTORIZADO_SIMULACION");
});
test("12C.17.4: evita activar con actor sin permiso simulado", () => {
  const s = s1V();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: actor(ACT, ["APROBACION"]) }), "ACTOR_NO_AUTORIZADO_SIMULACION");
});
test("12C.17.4: rol usuario convencional sin autoridad simulada", () => {
  const s = solicitudA();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: actor(APR, ["APROBACION"], "USUARIO") }), "ACTOR_NO_AUTORIZADO_SIMULACION");
});
test("12C.17.4: sin operaciones simuladas niega", () => {
  const s = solicitudA();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: actor(APR, []) }), "ACTOR_NO_AUTORIZADO_SIMULACION");
});
test("12C.17.4: actor con permiso desconocido es inválido", () => {
  const s = solicitudA();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: { ...aprobador, operacionesSimuladas: ["TODO"] } }), "DATOS_INVALIDOS");
});
test("12C.17.4: actor con operaciones duplicadas es inválido", () => {
  const s = solicitudA();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: actor(APR, ["APROBACION", "APROBACION"]) }), "DATOS_INVALIDOS");
});
test("12C.17.4: actor sin bandera de simulación es inválido", () => {
  const s = solicitudA();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: { ...aprobador, simulacion: false } }), "DATOS_INVALIDOS");
});
test("12C.17.4: IDs de actor inválidos se rechazan", () => {
  const s = solicitudA();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: actor("operador") }), "DATOS_INVALIDOS");
});
test("12C.17.4: actor con campos adicionales se rechaza", () => {
  const s = solicitudA();
  rechazo(previsualizarCambioComercialLocal({ ...s, actor: { ...aprobador, autorizado: true } }), "DATOS_INVALIDOS");
});
test("12C.17.4: entradas ajenas entre empresas se rechazan", () => {
  const s = solicitudA();
  const r = previsualizarCambioComercialLocal({ ...s, empresaId: OTRA });
  rechazo(r, "REGLA_HISTORIAL");
  if (!r.ok) assert.equal(r.causaHistorial, "EMPRESA_NO_COINCIDE");
});
test("12C.17.4: vista previa de otra empresa no se puede confirmar", () => {
  const s = solicitudA(), vista = preview(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: s, vistaPrevia: { ...vista, empresaId: OTRA },
    confirmacion: vista.fraseConfirmacion }), "VISTA_DESACTUALIZADA");
});
test("12C.17.4: huella manipulada no se confirma", () => {
  const s = solicitudA(), vista = preview(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: s, vistaPrevia: { ...vista, huellaSnapshot: "0".repeat(64) },
    confirmacion: vista.fraseConfirmacion }), "VISTA_DESACTUALIZADA");
});
test("12C.17.4: vista previa con propiedades adicionales se rechaza", () => {
  const s = solicitudA(), vista = preview(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: s, vistaPrevia: { ...vista, permisoSuperusuario: true },
    confirmacion: vista.fraseConfirmacion }), "VISTA_DESACTUALIZADA");
});
test("12C.17.4: no se acepta vista previa de otra versión", () => {
  const s = solicitudA(), vista = preview(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: s, vistaPrevia: { ...vista, idVersion: V2 },
    confirmacion: vista.fraseConfirmacion }), "VISTA_DESACTUALIZADA");
});
test("12C.17.4: no se acepta vista previa con actor cambiado", () => {
  const s = solicitudA(), vista = preview(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: { ...s, actor: actor(ACT) }, vistaPrevia: vista,
    confirmacion: vista.fraseConfirmacion }), "VISTA_DESACTUALIZADA");
});
test("12C.17.4: no se acepta vista previa con fecha cambiada", () => {
  const s = solicitudA(), vista = preview(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: { ...s, ahoraIso: T2 }, vistaPrevia: vista,
    confirmacion: vista.fraseConfirmacion }), "VISTA_DESACTUALIZADA");
});
test("12C.17.4: no se acepta vista previa de otro borrador", () => {
  const s = solicitudA(), vista = preview(s);
  const modificado = b0([ind("BANCOS")]);
  rechazo(confirmarCambioComercialLocal({ solicitud: { ...s, borrador: modificado }, vistaPrevia: vista,
    confirmacion: vista.fraseConfirmacion }), "VISTA_DESACTUALIZADA");
});
test("12C.17.4: no se acepta vista previa con revisión desactualizada", () => {
  const s = solicitudA(), vista = preview(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: { ...s, revisionHistorialEsperada: 1 }, vistaPrevia: vista,
    confirmacion: vista.fraseConfirmacion }), "REGLA_HISTORIAL");
});
test("12C.17.4: repetir confirmación con historial actualizado se rechaza", () => {
  const s = solicitudA(), vista = preview(s);
  const nuevo = confirmar(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: { ...s, historial: nuevo }, vistaPrevia: vista,
    confirmacion: vista.fraseConfirmacion }), "REGLA_HISTORIAL");
});
test("12C.17.4: aprobación pendiente impide reaprobar otra versión", () => {
  const h = h1A();
  const r = previsualizarCambioComercialLocal({ tipo: "APROBACION", historial: h, borrador: b0(),
    empresaId: EMP, actor: aprobador, idVersion: V2, revisionHistorialEsperada: 1, ahoraIso: T2 });
  rechazo(r, "REGLA_HISTORIAL");
});
test("12C.17.4: activación sin aprobar no es válida", () => {
  const s = s1V(h0());
  rechazo(previsualizarCambioComercialLocal(s), "REGLA_HISTORIAL");
});
test("12C.17.4: activar versión inexistente no está permitido", () => {
  const s = s1V();
  rechazo(previsualizarCambioComercialLocal({ ...s, idVersion: V2 }), "REGLA_HISTORIAL");
});
test("12C.17.4: no permite volver a activar versión vigente", () => {
  const s = s1V(h1V());
  rechazo(previsualizarCambioComercialLocal(s), "REGLA_HISTORIAL");
});
test("12C.17.4: no acepta hora de activación anterior a aprobación", () => {
  const s = s1V();
  rechazo(previsualizarCambioComercialLocal({ ...s, ahoraIso: T0 }), "REGLA_HISTORIAL");
});
test("12C.17.4: rechazo de confirmación incorrecta no cambia historial", () => {
  const s = solicitudA();
  const antes = JSON.stringify(s.historial);
  rechazo(ejecutar(s, "NO CONFIRMO"), "CONFIRMACION_INCORRECTA");
  assert.equal(JSON.stringify(s.historial), antes);
});
test("12C.17.4: confirmación incompleta se rechaza", () => {
  rechazo(confirmarCambioComercialLocal({ solicitud: solicitudA() }), "DATOS_INVALIDOS");
});
test("12C.17.4: confirmación con propiedades inesperadas se rechaza", () => {
  const s = solicitudA(), vista = preview(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: s, vistaPrevia: vista, confirmacion: vista.fraseConfirmacion,
    habilitarPermisos: true }), "DATOS_INVALIDOS");
});
test("12C.17.4: confirmación mal tipada se rechaza", () => {
  const s = solicitudA(), vista = preview(s);
  rechazo(confirmarCambioComercialLocal({ solicitud: s, vistaPrevia: vista, confirmacion: 1 }), "DATOS_INVALIDOS");
});
test("12C.17.4: entrada sin historial se rechaza", () => {
  rechazo(previsualizarCambioComercialLocal({ tipo: "APROBACION" }), "DATOS_INVALIDOS");
});
test("12C.17.4: entrada nula se rechaza", () => {
  rechazo(previsualizarCambioComercialLocal(null), "DATOS_INVALIDOS");
});
test("12C.17.4: tipo de operación desconocido se rechaza", () => {
  rechazo(previsualizarCambioComercialLocal({ ...solicitudA(), tipo: "SUSPENDER" }), "DATOS_INVALIDOS");
});
test("12C.17.4: campo adicional de escritura se rechaza", () => {
  rechazo(previsualizarCambioComercialLocal({ ...solicitudA(), guardarEnAirtable: true }), "DATOS_INVALIDOS");
});
test("12C.17.4: flags de simulación permanecen forzosamente seguros", () => {
  const s = solicitudA(), vista = preview(s), r = confirmar(s);
  assert.equal(vista.simulacion, true);
  assert.equal(vista.accesoOperativoHabilitado, false);
  assert.equal(r.simulacion, true);
  assert.equal(r.accesoOperativoHabilitado, false);
  assert.equal(r.eventos.length >= 0, true);
});
test("12C.17.4: historiales anteriores y nuevos son objetos separados", () => {
  const s = solicitudA();
  const antes = JSON.stringify(s.historial);
  const nuevo = confirmar(s);
  assert.notEqual(nuevo, s.historial);
  assert.equal(JSON.stringify(s.historial), antes);
  assert.equal(Object.isFrozen(nuevo), true);
});
test("12C.17.4: evaluación con errores no obtiene historial", () => {
  const s = solicitudA();
  const r = confirmarCambioComercialLocal({ solicitud: s, vistaPrevia: null, confirmacion: "algo" });
  rechazo(r, "VISTA_DESACTUALIZADA");
});
test("12C.17.4: en modo local no hace fetch ni pide credenciales", () => {
  const s = solicitudA();
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; throw new Error("No debería acceder a red"); };
  try {
    confirmar(s);
    assert.equal(llamadas, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("12C.17.4: aprobación anterior y nueva secuencia con actores distintos", () => {
  const h = h2A();
  assert.equal(h.versiones[0].estado, "VIGENTE");
  assert.equal(h.versiones[1].estado, "APROBADA");
  const v = preview(s2V(h));
  assert.equal(v.versionAnteriorVigenteId, V1);
  assert.equal(v.estadoResultado, "VIGENTE");
});
test("12C.17.4: cambio de función entre aprobación y activación no modifica el Core", () => {
  const h = confirmar(s2V());
  assert.equal(h.accesoOperativoHabilitado, false);
  assert.equal(h.versiones.length, 2);
});
