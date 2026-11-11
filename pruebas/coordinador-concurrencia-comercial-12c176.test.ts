import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGO_COMERCIAL_JERARQUICO } from "../core/catalogo-comercial-jerarquico.js";
import { MODULOS_COMERCIALES, type ContratacionComercial } from "../core/reglas-comerciales.js";
import { crearBorradorComercialLocal } from "../core/borradores-contratacion-comercial-12c172.js";
import { iniciarHistorialComercialLocal, type HistorialContratacionSimulado } from "../core/historial-contratacion-comercial-12c173.js";
import {
  previsualizarCambioComercialLocal,
  type ActorComercialSimulado, type SolicitudCambioComercialLocal,
} from "../core/flujo-confirmacion-comercial-12c174.js";
import {
  crearCoordinadorConcurrenciaComercialLocal,
  verificarIntegridadBitacoraComercialLocal,
  type GestorCoordinacionComercialLocal,
  type MotivoCoordinacionComercialLocal,
  type OperacionConIdempotenciaLocal,
  type ResultadoOperacionCoordinadaLocal,
} from "../core/coordinador-concurrencia-comercial-12c176.js";

const EMP = `rec${"A".repeat(14)}`;
const OTRA = `rec${"B".repeat(14)}`;
const APR = `rec${"C".repeat(14)}`;
const ACT = `rec${"D".repeat(14)}`;
const CTR = "CTR-OPTIMA-001";
const V1 = "VER-OPTIMA-0001";
const V2 = "VER-OPTIMA-0002";
const FECHAS = ["2026-11-10T13:00:00.000Z", "2026-11-10T14:00:00.000Z",
  "2026-11-10T15:00:00.000Z", "2026-11-10T16:00:00.000Z",
  "2026-11-10T17:00:00.000Z", "2026-11-10T18:00:00.000Z"] as const;
const servicio = (submodulo = "CHEQUES", nivel: "ESTANDAR" | "PREMIUM" = "ESTANDAR") =>
  ({ modalidad: "SUBMODULO_INDEPENDIENTE" as const, submodulo, nivel });
const modulo = (modulo: (typeof MODULOS_COMERCIALES)[number]) =>
  ({ modalidad: "MODULO_PRINCIPAL" as const, modulo, nivel: "GESTION" as const });
const actor = (usuarioId: string): ActorComercialSimulado => ({
  usuarioId, rolSimulado: "PLATAFORMA", operacionesSimuladas: ["APROBACION", "ACTIVACION"], simulacion: true,
});
function inicio(empresaId = EMP, idContrato = CTR): HistorialContratacionSimulado {
  const r = iniciarHistorialComercialLocal({ empresaId, idContrato });
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.historial;
}
function gestor(inicial: HistorialContratacionSimulado = inicio()): GestorCoordinacionComercialLocal {
  const r = crearCoordinadorConcurrenciaComercialLocal(inicial);
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.gestor;
}
function borrador(historial: HistorialContratacionSimulado, servicios: readonly ContratacionComercial[]) {
  const actual = historial.versiones.find(v => v.estado === "VIGENTE") ?? null;
  const r = crearBorradorComercialLocal({
    idBorrador: actual ? "BOR-OPTIMA-0002" : "BOR-OPTIMA-0001",
    empresaId: historial.empresaId, idContrato: actual ? historial.idContrato : null,
    versionBase: actual ? actual.numero : null, serviciosBase: actual?.servicios ?? [],
    serviciosPropuestos: servicios,
    motivoCambio: actual ? "Modificación comercial simulada" : "Alta comercial simulada",
    ahoraIso: actual ? FECHAS[3] : FECHAS[0],
  });
  if (!r.ok) throw Error(JSON.stringify(r));
  return r.borrador;
}
function aprobacion(historial: HistorialContratacionSimulado, clave = "OP-APROBACION-0001",
  servicios: readonly ContratacionComercial[] = [servicio()], version = V1): OperacionConIdempotenciaLocal {
  const s: SolicitudCambioComercialLocal = {
    tipo: "APROBACION", historial, borrador: borrador(historial, servicios),
    empresaId: historial.empresaId, actor: actor(APR), idVersion: version,
    revisionHistorialEsperada: historial.revisionHistorial,
    ahoraIso: version === V1 ? FECHAS[1] : FECHAS[4],
  };
  return operacion(s, clave);
}
function activacion(historial: HistorialContratacionSimulado, clave = "OP-ACTIVACION-0001",
  version = V1): OperacionConIdempotenciaLocal {
  const s: SolicitudCambioComercialLocal = {
    tipo: "ACTIVACION", historial, empresaId: historial.empresaId,
    actor: actor(ACT), idVersion: version,
    revisionHistorialEsperada: historial.revisionHistorial,
    ahoraIso: version === V1 ? FECHAS[2] : FECHAS[5],
  };
  return operacion(s, clave);
}
function operacion(s: SolicitudCambioComercialLocal, claveIdempotencia: string): OperacionConIdempotenciaLocal {
  const previa = previsualizarCambioComercialLocal(s);
  if (!previa.ok) throw Error(JSON.stringify(previa));
  return { claveIdempotencia, solicitud: s,
    vistaPrevia: previa.vista, confirmacion: previa.vista.fraseConfirmacion };
}
function bien(r: ResultadoOperacionCoordinadaLocal) {
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("Operación rechazada inesperadamente");
  assert.equal(r.simulacion, true);
  assert.equal(r.auditoriaDurable, false);
  assert.equal(r.accesoOperativoHabilitado, false);
  assert.equal(verificarIntegridadBitacoraComercialLocal(r.estado), true);
  return r;
}
function mal(r: ResultadoOperacionCoordinadaLocal, motivo: MotivoCoordinacionComercialLocal) {
  assert.equal(r.ok, false, JSON.stringify(r));
  if (r.ok) throw Error("La operación debió rechazarse");
  assert.equal(r.motivo, motivo);
  assert.equal(r.accesoOperativoHabilitado, false);
  assert.equal("estado" in r, false);
}
function primeraAprobada() {
  const g = gestor();
  bien(g.ejecutar(aprobacion(g.consultar().historialActual)));
  return g;
}
function primeraVigente() {
  const g = primeraAprobada();
  bien(g.ejecutar(activacion(g.consultar().historialActual)));
  return g;
}
function segundaAprobada() {
  const g = primeraVigente();
  bien(g.ejecutar(aprobacion(g.consultar().historialActual, "OP-APROBACION-0002", [modulo("ADMINISTRACION")], V2)));
  return g;
}
function segundaVigente() {
  const g = segundaAprobada();
  bien(g.ejecutar(activacion(g.consultar().historialActual, "OP-ACTIVACION-0002", V2)));
  return g;
}

for (const sub of CATALOGO_COMERCIAL_JERARQUICO) {
  test(`12C.17.6: coordina aprobación local de ${sub.id} sin permisos reales`, () => {
    const g = gestor();
    const r = bien(g.ejecutar(aprobacion(g.consultar().historialActual,
      `OP-PRUEBA-${sub.id.replaceAll("_", "-")}-0001`, [servicio(sub.id, "PREMIUM")])));
    assert.equal(r.estado.historialActual.versiones[0].estado, "APROBADA");
    assert.equal(r.estado.historialActual.versiones[0].servicios[0].modalidad, "SUBMODULO_INDEPENDIENTE");
    assert.equal(r.estado.bitacora.length, 1);
  });
}
for (const principal of MODULOS_COMERCIALES) {
  test(`12C.17.6: coordina módulo ${principal} sin activar permisos`, () => {
    const g = gestor();
    const r = bien(g.ejecutar(aprobacion(g.consultar().historialActual,
      `OP-PRUEBA-${principal}-0001`, [modulo(principal)])));
    assert.equal(r.estado.historialActual.versiones[0].estado, "APROBADA");
    assert.equal(r.estado.accesoOperativoHabilitado, false);
  });
}

test("12C.17.6: gestor empieza vacío y protege datos de simulación", () => {
  const e = gestor().consultar();
  assert.equal(e.historialActual.revisionHistorial, 0);
  assert.equal(e.bitacora.length, 0);
  assert.equal(e.simulacion, true);
  assert.equal(e.auditoriaDurable, false);
  assert.equal(e.concurrenciaDistribuidaGarantizada, false);
  assert.equal(e.accesoOperativoHabilitado, false);
  assert.equal(verificarIntegridadBitacoraComercialLocal(e), true);
});
test("12C.17.6: rechazo de historial de creación inválido", () => {
  const r = crearCoordinadorConcurrenciaComercialLocal({});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "HISTORIAL_INVALIDO");
});
test("12C.17.6: revisión se incrementa una vez por aprobación", () => {
  const g = primeraAprobada(), s = g.consultar();
  assert.equal(s.historialActual.revisionHistorial, 1);
  assert.equal(s.bitacora[0].revisionAntes, 0);
  assert.equal(s.bitacora[0].revisionDespues, 1);
  assert.equal(s.bitacora[0].tipo, "APROBACION");
});
test("12C.17.6: aprobación no activa contrato", () => {
  const s = primeraAprobada().consultar();
  assert.equal(s.historialActual.versiones[0].estado, "APROBADA");
  assert.equal(s.historialActual.versiones[0].vigenteDesdeIso, null);
});
test("12C.17.6: activación separada deja vigente la primera versión", () => {
  const s = primeraVigente().consultar();
  assert.equal(s.historialActual.revisionHistorial, 2);
  assert.equal(s.historialActual.versiones[0].estado, "VIGENTE");
  assert.deepEqual(s.bitacora.map(r => r.tipo), ["APROBACION", "ACTIVACION"]);
});
test("12C.17.6: reemplazo mantiene dos versiones y la histórica", () => {
  const s = segundaVigente().consultar();
  assert.equal(s.historialActual.revisionHistorial, 4);
  assert.deepEqual(s.historialActual.versiones.map(v => v.estado), ["HISTORICA", "VIGENTE"]);
  assert.equal(s.historialActual.versiones[0].sustituidaPorId, V2);
  assert.equal(s.bitacora.length, 4);
});
test("12C.17.6: operación repetida no agrega eventos ni revisiones", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  bien(g.ejecutar(op));
  const r = bien(g.ejecutar(op));
  assert.equal(r.repetida, true);
  assert.equal(r.revisionAplicada, 1);
  assert.equal(r.estado.historialActual.revisionHistorial, 1);
  assert.equal(r.estado.bitacora.length, 1);
});
test("12C.17.6: reintento antiguo funciona tras una segunda operación, sin volver a aplicar", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  bien(g.ejecutar(op));
  bien(g.ejecutar(activacion(g.consultar().historialActual)));
  const r = bien(g.ejecutar(op));
  assert.equal(r.repetida, true);
  assert.equal(r.revisionAplicada, 1);
  assert.equal(r.revisionActual, 2);
  assert.equal(r.estado.bitacora.length, 2);
});
test("12C.17.6: misma clave con nuevo contenido bloqueada", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  bien(g.ejecutar(op));
  const distinto = { ...op, confirmacion: "CONFIRMAR OTRA COSA" };
  mal(g.ejecutar(distinto), "CLAVE_REUTILIZADA_CON_CAMBIO");
  assert.equal(g.consultar().bitacora.length, 1);
});
test("12C.17.6: simula dos clientes con la misma revisión; el segundo se rechaza", () => {
  const g = gestor(), base = g.consultar().historialActual;
  const uno = aprobacion(base, "OP-OPERADOR-0001", [servicio("CHEQUES")]);
  const dos = aprobacion(base, "OP-OPERADOR-0002", [servicio("BANCOS")]);
  bien(g.ejecutar(uno));
  mal(g.ejecutar(dos), "REVISION_DESACTUALIZADA");
  assert.equal(g.consultar().historialActual.versiones.length, 1);
});
test("12C.17.6: reintento con clave distinta y revisión vieja rechaza", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  bien(g.ejecutar(op));
  mal(g.ejecutar({ ...op, claveIdempotencia: "OP-OTRA-CLAVE-0001" }), "REVISION_DESACTUALIZADA");
});
test("12C.17.6: snapshot alterado con la misma revisión se rechaza", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  const tamper = structuredClone(op);
  (tamper.solicitud.historial as any).empresaId = OTRA;
  mal(g.ejecutar(tamper), "SNAPSHOT_DESACTUALIZADO");
});
test("12C.17.6: empresa diferente no cruza el coordinador", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  const tamper = structuredClone(op);
  (tamper.solicitud as any).empresaId = OTRA;
  mal(g.ejecutar(tamper), "EMPRESA_NO_COINCIDE");
});
test("12C.17.6: otro contrato se rechaza", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  const tamper = structuredClone(op);
  (tamper.solicitud.historial as any).idContrato = "CTR-DISTINTO";
  mal(g.ejecutar(tamper), "CONTRATO_NO_COINCIDE");
});
test("12C.17.6: vista previa desactualizada es rechazada por flujo existente", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  mal(g.ejecutar({ ...op, vistaPrevia: { ...op.vistaPrevia, revisionHistorial: 5 } }), "FLUJO_RECHAZADO");
  assert.equal(g.consultar().historialActual.revisionHistorial, 0);
});
test("12C.17.6: confirmación incorrecta es rechazada por flujo existente", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  const r = g.ejecutar({ ...op, confirmacion: "NO" });
  mal(r, "FLUJO_RECHAZADO");
  if (!r.ok) assert.equal(r.causaFlujo, "CONFIRMACION_INCORRECTA");
});
test("12C.17.6: la separación de funciones del flujo se conserva", () => {
  const g = primeraAprobada(), h = g.consultar().historialActual;
  const solicitud: SolicitudCambioComercialLocal = {
    tipo: "ACTIVACION", historial: h, empresaId: EMP, actor: actor(APR),
    idVersion: V1, revisionHistorialEsperada: 1, ahoraIso: FECHAS[2],
  };
  const previa = previsualizarCambioComercialLocal(solicitud);
  assert.equal(previa.ok, false);
  const op = { claveIdempotencia: "OP-ACTOR-NO-PUEDE", solicitud,
    vistaPrevia: {}, confirmacion: "CONFIRMAR ACTIVACION" };
  mal(g.ejecutar(op), "FLUJO_RECHAZADO");
});
test("12C.17.6: relectura del estado entrega copias y no permite alterar el gestor", () => {
  const g = primeraVigente(), copia = g.consultar();
  (copia.historialActual.versiones[0] as any).estado = "APROBADA";
  (copia.bitacora[0] as any).huellaSolicitud = "roto";
  assert.equal(g.consultar().historialActual.versiones[0].estado, "VIGENTE");
  assert.equal(verificarIntegridadBitacoraComercialLocal(g.consultar()), true);
});
test("12C.17.6: modificar el input después de ejecutar no altera el gestor", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  bien(g.ejecutar(op));
  (op as any).confirmacion = "ROTO";
  assert.equal(g.consultar().bitacora.length, 1);
  assert.equal(verificarIntegridadBitacoraComercialLocal(g.consultar()), true);
});
test("12C.17.6: alterar auditoría exportada rompe integridad", () => {
  const s = primeraVigente().consultar();
  (s.bitacora[1] as any).revisionAntes = 15;
  assert.equal(verificarIntegridadBitacoraComercialLocal(s), false);
});
test("12C.17.6: alterar hash del último registro rompe integridad", () => {
  const s = primeraAprobada().consultar();
  (s.bitacora[0] as any).huellaRegistro = "0".repeat(64);
  assert.equal(verificarIntegridadBitacoraComercialLocal(s), false);
});
test("12C.17.6: alterar historial final rompe integridad", () => {
  const s = primeraVigente().consultar();
  (s.historialActual.eventos[1] as any).actorUsuarioId = APR;
  assert.equal(verificarIntegridadBitacoraComercialLocal(s), false);
});
test("12C.17.6: alterar versión final rompe integridad", () => {
  const s = primeraVigente().consultar();
  (s.historialActual.versiones[0] as any).motivoCambio = "Cambio malicioso";
  assert.equal(verificarIntegridadBitacoraComercialLocal(s), false);
});
test("12C.17.6: se preserva historial inicial con revisiones previas", () => {
  const g = primeraVigente(), r = gestor(g.consultar().historialActual);
  assert.equal(r.consultar().bitacora.length, 0);
  assert.equal(r.consultar().historialInicial.revisionHistorial, 2);
  assert.equal(verificarIntegridadBitacoraComercialLocal(r.consultar()), true);
  const op = aprobacion(r.consultar().historialActual, "OP-NUEVA-EPOCA-001", [modulo("ADMINISTRACION")], V2);
  bien(r.ejecutar(op));
  assert.equal(r.consultar().historialActual.revisionHistorial, 3);
});
test("12C.17.6: integridad rechaza faltantes de bitácora", () => {
  const s = primeraVigente().consultar();
  (s.bitacora as any).pop();
  assert.equal(verificarIntegridadBitacoraComercialLocal(s), false);
});
test("12C.17.6: integridad rechaza registros duplicados", () => {
  const s = primeraVigente().consultar();
  (s.bitacora as any)[1].claveIdempotencia = s.bitacora[0].claveIdempotencia;
  assert.equal(verificarIntegridadBitacoraComercialLocal(s), false);
});
test("12C.17.6: integridad rechaza cadena alterada", () => {
  const s = primeraVigente().consultar();
  (s.bitacora as any)[1].huellaAnterior = "GENESIS";
  assert.equal(verificarIntegridadBitacoraComercialLocal(s), false);
});
test("12C.17.6: integridad rechaza etiqueta de seguridad alterada", () => {
  const s = primeraVigente().consultar();
  (s as any).auditoriaDurable = true;
  assert.equal(verificarIntegridadBitacoraComercialLocal(s), false);
});
test("12C.17.6: no hay eventos nuevos tras un rechazo", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  mal(g.ejecutar({ ...op, confirmacion: "NO" }), "FLUJO_RECHAZADO");
  assert.equal(g.consultar().bitacora.length, 0);
  assert.equal(g.consultar().historialActual.revisionHistorial, 0);
});
test("12C.17.6: clave vacía rechazada sin efectos", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  mal(g.ejecutar({ ...op, claveIdempotencia: "" }), "DATOS_INVALIDOS");
  assert.equal(g.consultar().historialActual.revisionHistorial, 0);
});
test("12C.17.6: no acepta campos adicionales", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  mal(g.ejecutar({ ...op, escribirEnAirtable: true }), "DATOS_INVALIDOS");
});
test("12C.17.6: no acepta entrada circular", () => {
  const g = gestor(), op: any = aprobacion(g.consultar().historialActual);
  op.otro = op;
  mal(g.ejecutar(op), "DATOS_INVALIDOS");
});
test("12C.17.6: no acepta valores no serializables", () => {
  const g = gestor(), op = aprobacion(g.consultar().historialActual);
  mal(g.ejecutar({ ...op, confirmacion: () => "CONFIRMAR" }), "DATOS_INVALIDOS");
});
test("12C.17.6: no acepta estado de otra empresa", () => {
  const g = gestor(inicio(OTRA)), op = aprobacion(inicio(EMP));
  mal(g.ejecutar(op), "EMPRESA_NO_COINCIDE");
});
test("12C.17.6: hashes de auditoría tienen formato SHA-256", () => {
  const s = primeraVigente().consultar();
  for (const r of s.bitacora) {
    assert.match(r.huellaSolicitud, /^[a-f0-9]{64}$/);
    assert.match(r.huellaEstadoAntes, /^[a-f0-9]{64}$/);
    assert.match(r.huellaEstadoDespues, /^[a-f0-9]{64}$/);
    assert.match(r.huellaRegistro, /^[a-f0-9]{64}$/);
  }
});
