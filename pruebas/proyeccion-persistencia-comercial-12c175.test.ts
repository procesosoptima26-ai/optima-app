import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REQUISITOS_PREVIOS_A_ESCRITURA,
  DATOS_NO_REPRESENTADOS_EN_TABLA,
  TABLA_PROYECCION_COMERCIAL,
  proyectarHistorialComercialParaPersistenciaLocal,
  compararTransicionDeHistorialLocal,
} from "../core/proyeccion-persistencia-comercial-12c175.js";
import { CATALOGO_COMERCIAL_JERARQUICO } from "../core/catalogo-comercial-jerarquico.js";
import { MODULOS_COMERCIALES, type ContratacionComercial } from "../core/reglas-comerciales.js";
import { crearBorradorComercialLocal } from "../core/borradores-contratacion-comercial-12c172.js";
import { iniciarHistorialComercialLocal, aprobarBorradorComercialLocal,
  activarVersionComercialLocal } from "../core/historial-contratacion-comercial-12c173.js";

const EMPRESA = 'emp_'+'a'.repeat(12);
const OTRA = 'emp_'+'b'.repeat(12);
const OTRO_USUARIO = "rec" + "Z".repeat(14);
const APROBADOR = "rec" + "C".repeat(14);
const ACTIVADOR = "rec" + "D".repeat(14);
const FIJO = "2026-11-10T13:00:00.000Z";
const APROBADO = "2026-11-10T14:00:00.000Z";
const ACTIVO = "2026-11-10T15:00:00.000Z";

function preparar(servicios: readonly ContratacionComercial[] = [
  { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
], empresaId = EMPRESA) {
  const inicial = iniciarHistorialComercialLocal({ empresaId, idContrato: "CTR-PRUEBA-001" });
  assert.equal(inicial.ok, true);
  const borrador = crearBorradorComercialLocal({
    idBorrador: "BOR-PRUEBA-001", empresaId, idContrato: null, versionBase: null,
    serviciosBase: [], serviciosPropuestos: servicios,
    motivoCambio: "Alta comercial de prueba", ahoraIso: FIJO,
  });
  assert.equal(borrador.ok, true);
  const aprobada = aprobarBorradorComercialLocal({
    historial: inicial.historial, borrador: borrador.borrador,
    empresaId, actorUsuarioId: APROBADOR, idVersion: "VER-PRUEBA-0001",
    revisionHistorialEsperada: 0, ahoraIso: APROBADO,
  });
  assert.equal(aprobada.ok, true);
  const activa = activarVersionComercialLocal({
    historial: aprobada.historial, empresaId, actorUsuarioId: ACTIVADOR,
    idVersion: "VER-PRUEBA-0001", revisionHistorialEsperada: 1,
    ahoraIso: ACTIVO,
  });
  assert.equal(activa.ok, true);
  return { inicial: inicial.historial, aprobada: aprobada.historial, activa: activa.historial };
}
function proyectar(historial: ReturnType<typeof preparar>["activa"],
                  empresaId = EMPRESA, revisionEsperada = historial.revisionHistorial) {
  return proyectarHistorialComercialParaPersistenciaLocal({ historial, empresaId, revisionEsperada });
}
function comparar(anterior: unknown, siguiente: unknown, empresaId = EMPRESA,
                  revisionAnteriorEsperada = 0) {
  return compararTransicionDeHistorialLocal({ anterior, siguiente, empresaId, revisionAnteriorEsperada });
}

// Proyección: verificar que NO está acoplada a una escritura real.
test("12C.17.5: el esquema verificado se llama CONTRATACIONES_OPTIMA", () => {
  assert.equal(TABLA_PROYECCION_COMERCIAL, "CONTRATACIONES_OPTIMA");
});
test("12C.17.5: los bloqueos son explícitos y nunca hay listoParaEscribir", () => {
  const r = proyectar(preparar().activa);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.listoParaEscribir, false);
  assert.equal(r.plan.soloProyeccion, true);
  assert.equal(r.plan.accesoOperativoHabilitado, false);
  assert.deepEqual(r.plan.bloqueosParaEscritura, REQUISITOS_PREVIOS_A_ESCRITURA);
  assert.ok(r.plan.bloqueosParaEscritura.includes("CONTROL_ATOMICO_CONCURRENCIA"));
  assert.ok(r.plan.bloqueosParaEscritura.includes("AISLAMIENTO_PREVIEW_PRODUCCION"));
});
test("12C.17.5: señala datos que la tabla todavía no representa", () => {
  const r = proyectar(preparar().activa);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.plan.faltantesDeEsquema, DATOS_NO_REPRESENTADOS_EN_TABLA);
  assert.ok(r.plan.faltantesDeEsquema.includes("REVISION_HISTORIAL"));
  assert.ok(r.plan.faltantesDeEsquema.includes("BORRADOR_EDITABLE"));
});
test("12C.17.5: historial vacío -> cero filas y cero eventos", () => {
  const h = preparar().inicial;
  const r = proyectar(h);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.revisionLocalInformativa, 0);
  assert.deepEqual(r.plan.filas, []);
  assert.deepEqual(r.plan.eventosSinAlmacenDurable, []);
});
test("12C.17.5: aprobación produce estado APROBADA sin vigencia", () => {
  const r = proyectar(preparar().aprobada);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.filas.length, 1);
  const fila = r.plan.filas[0];
  assert.equal(fila.campos.ESTADO, "APROBADA");
  assert.equal(Object.hasOwn(fila.campos, "VIGENTE_DESDE"), false);
  assert.equal(Object.hasOwn(fila.campos, "VIGENTE_HASTA"), false);
});
test("12C.17.5: vigencia es un segundo paso separado", () => {
  const r = proyectar(preparar().activa);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.revisionLocalInformativa, 2);
  assert.equal(r.plan.filas[0].campos.ESTADO, "VIGENTE");
  assert.equal(r.plan.filas[0].campos.VIGENTE_DESDE, ACTIVO);
  assert.equal(Object.hasOwn(r.plan.filas[0].campos, "VIGENTE_HASTA"), false);
});
test("12C.17.5: mapea nombres exactos y relación de empresa", () => {
  const r = proyectar(preparar().activa);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const { campos, claveIdVersion, registroAirtableId } = r.plan.filas[0];
  assert.equal(claveIdVersion, "VER-PRUEBA-0001");
  assert.equal(registroAirtableId, null);
  assert.deepEqual(campos.EMPRESA, [EMPRESA]);
  assert.equal(campos.ID_CONTRATO, "CTR-PRUEBA-001");
  assert.equal(campos.VERSION, 1);
  assert.equal(campos.ID_VERSION, "VER-PRUEBA-0001");
  assert.equal(campos.APROBADO_POR_ID, APROBADOR);
  assert.equal(campos.FECHA_APROBACION, APROBADO);
  assert.equal(campos.MOTIVO_CAMBIO, "Alta comercial de prueba");
});
test("12C.17.5: serializa servicios comerciales completos sin precios", () => {
  const r = proyectar(preparar().activa);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(JSON.parse(r.plan.filas[0].campos.SERVICIOS_CONTRATADOS), [
    { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
  ]);
  assert.equal(Object.hasOwn(r.plan.filas[0].campos, "CONDICIONES_ECONOMICAS"), false);
  assert.equal(Object.hasOwn(r.plan.filas[0].campos, "CONDICIONES_PARTICULARES"), false);
});
test("12C.17.5: conserva eventos pero avisa que no tienen almacén durable", () => {
  const r = proyectar(preparar().activa);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.plan.eventosSinAlmacenDurable.length, 2);
  assert.deepEqual(r.plan.eventosSinAlmacenDurable.map(e => e.tipo), ["APROBACION", "ACTIVACION"]);
  assert.equal(r.plan.eventosSinAlmacenDurable[1].actorUsuarioId, ACTIVADOR);
});
test("12C.17.5: una misma foto tiene siempre la misma huella informativa", () => {
  const h = preparar().activa;
  const a = proyectar(h), b = proyectar(h);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(a.plan.huellaLocalInformativa, b.plan.huellaLocalInformativa);
  assert.match(a.plan.huellaLocalInformativa, /^[a-f0-9]{64}$/);
});
test("12C.17.5: la huella cambia si cambia la revisión", () => {
  const h = preparar();
  const a = proyectar(h.aprobada), b = proyectar(h.activa);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.plan.huellaLocalInformativa, b.plan.huellaLocalInformativa);
});
test("12C.17.5: congela todas las filas, campos, eventos y bloqueos", () => {
  const r = proyectar(preparar().activa);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(Object.isFrozen(r.plan));
  assert.ok(Object.isFrozen(r.plan.filas));
  assert.ok(Object.isFrozen(r.plan.filas[0]));
  assert.ok(Object.isFrozen(r.plan.filas[0].campos));
  assert.ok(Object.isFrozen(r.plan.filas[0].campos.EMPRESA));
  assert.ok(Object.isFrozen(r.plan.eventosSinAlmacenDurable[0]));
});
test("12C.17.5: no devuelve tokens, ids de registro inventados ni acceso real", () => {
  const r = proyectar(preparar().activa);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const texto = JSON.stringify(r);
  for (const secreto of ["AIRTABLE_TOKEN", "Authorization", "Bearer", "registroAirtableId\":\"rec"])
    assert.equal(texto.includes(secreto), false);
  assert.equal(r.plan.listoParaEscribir, false);
});

// Los 29 submódulos y seis principales son proyectables sin asumir capacidades implementadas.
for (const ficha of CATALOGO_COMERCIAL_JERARQUICO) {
  test(`12C.17.5: submódulo ${ficha.id} se proyecta sin acceso`, () => {
    const r = proyectar(preparar([
      { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: ficha.id, nivel: "ESTANDAR" },
    ]).activa);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(JSON.parse(r.plan.filas[0].campos.SERVICIOS_CONTRATADOS)[0].submodulo, ficha.id);
    assert.equal(r.plan.accesoOperativoHabilitado, false);
  });
}
for (const modulo of MODULOS_COMERCIALES) {
  test(`12C.17.5: módulo principal ${modulo} se proyecta sin activar submódulos`, () => {
    const r = proyectar(preparar([
      { modalidad: "MODULO_PRINCIPAL", modulo, nivel: "GESTION" },
    ]).activa);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(JSON.parse(r.plan.filas[0].campos.SERVICIOS_CONTRATADOS)[0].modulo, modulo);
    assert.equal(r.plan.listoParaEscribir, false);
  });
}

// Fallos de preparación: se rechaza todo en vez de construir un plan parcial.
const solicitudesInvalidas = [
  null, undefined, [], {}, "texto", 3, true,
  { empresaId: EMPRESA, revisionEsperada: 2 },
  { historial: preparar().activa, empresaId: EMPRESA },
  { historial: preparar().activa, empresaId: EMPRESA, revisionEsperada: 2, token: "falso" },
  { historial: preparar().activa, empresaId: "otro", revisionEsperada: 2 },
  { historial: preparar().activa, empresaId: EMPRESA, revisionEsperada: -1 },
  { historial: preparar().activa, empresaId: EMPRESA, revisionEsperada: 1.5 },
  { historial: preparar().activa, empresaId: EMPRESA, revisionEsperada: "2" },
  { historial: preparar().activa, empresaId: EMPRESA, revisionEsperada: Number.MAX_SAFE_INTEGER + 1 },
] as const;
for (const [i, invalida] of solicitudesInvalidas.entries()) {
  test(`12C.17.5: solicitud inválida ${i + 1} no produce plan`, () => {
    const r = proyectarHistorialComercialParaPersistenciaLocal(invalida);
    assert.equal(r.ok, false);
    assert.equal(r.listoParaEscribir, false);
    assert.equal(r.accesoOperativoHabilitado, false);
  });
}
test("12C.17.5: otra empresa no puede proyectar el historial", () => {
  const r = proyectar(preparar().activa, OTRA);
  assert.deepEqual(r, { ok: false, motivo: "EMPRESA_NO_COINCIDE", soloProyeccion: true,
    listoParaEscribir: false, accesoOperativoHabilitado: false });
});
test("12C.17.5: revisión local anterior no es aceptada", () => {
  const r = proyectar(preparar().activa, EMPRESA, 1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "REVISION_DESACTUALIZADA");
});
test("12C.17.5: historial falsificado o corrupto es rechazado", () => {
  const roto = { ...preparar().activa, versiones: [] };
  const r = proyectarHistorialComercialParaPersistenciaLocal({
    historial: roto, empresaId: EMPRESA, revisionEsperada: 2,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "HISTORIAL_INVALIDO");
});

// Revisión de transición: únicamente comparación de dos snapshots LOCALES.
test("12C.17.5: aprobación produce una nueva versión", () => {
  const h = preparar();
  const r = comparar(h.inicial, h.aprobada);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.tipo, "APROBACION");
  assert.equal(r.nuevasVersiones, 1);
  assert.equal(r.nuevasRevisiones, 1);
  assert.equal(r.listoParaEscribir, false);
});
test("12C.17.5: activación no agrega una versión distinta", () => {
  const h = preparar();
  const r = comparar(h.aprobada, h.activa, EMPRESA, 1);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.tipo, "ACTIVACION");
  assert.equal(r.nuevasVersiones, 0);
  assert.equal(r.accesoOperativoHabilitado, false);
});
test("12C.17.5: no admite saltar dos eventos en un solo paso", () => {
  const h = preparar();
  const r = comparar(h.inicial, h.activa);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "REVISION_NO_CONSECUTIVA");
});
test("12C.17.5: no permite comparar revisiones antiguas", () => {
  const h = preparar();
  const r = comparar(h.aprobada, h.activa, EMPRESA, 0);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "REVISION_DESACTUALIZADA");
});
test("12C.17.5: rechaza una transición que modifica el motivo aprobado", () => {
  const h = preparar();
  const mutada = JSON.parse(JSON.stringify(h.activa));
  mutada.versiones[0].motivoCambio = "Motivo alterado a posteriori";
  const r = comparar(h.aprobada, mutada, EMPRESA, 1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "HISTORIAL_REESCRITO");
});
test("12C.17.5: rechaza alterar un evento de aprobación anterior", () => {
  const h = preparar();
  const mutada = JSON.parse(JSON.stringify(h.activa));
  mutada.versiones[0].aprobadoPorId = OTRO_USUARIO;
  mutada.eventos[0].actorUsuarioId = OTRO_USUARIO;
  const r = comparar(h.aprobada, mutada, EMPRESA, 1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "HISTORIAL_REESCRITO");
});
test("12C.17.5: dos empresas distintas jamás se comparan", () => {
  const h = preparar(), otro = preparar(undefined, OTRA);
  const r = comparar(h.aprobada, otro.activa, EMPRESA, 1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "EMPRESA_NO_COINCIDE");
});
test("12C.17.5: contratos distintos no deben fusionarse", () => {
  const h = preparar();
  const otro = JSON.parse(JSON.stringify(h.activa));
  otro.idContrato = "CTR-DIFERENTE";
  otro.versiones[0].idContrato = "CTR-DIFERENTE";
  const r = comparar(h.aprobada, otro, EMPRESA, 1);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "CONTRATO_NO_COINCIDE");
});
test("12C.17.5: la comparación tampoco concede escritura o permiso", () => {
  const h = preparar();
  const r = comparar(h.inicial, h.aprobada);
  assert.equal(r.ok, true);
  assert.equal(r.listoParaEscribir, false);
  assert.equal(r.soloProyeccion, true);
});
test("12C.17.5: una comparación malformada falla cerrada", () => {
  for (const dato of [null, {}, [], { anterior: null, siguiente: null, empresaId: EMPRESA, revisionAnteriorEsperada: 0 }]) {
    const r = compararTransicionDeHistorialLocal(dato);
    assert.equal(r.ok, false);
    assert.equal(r.listoParaEscribir, false);
  }
});
