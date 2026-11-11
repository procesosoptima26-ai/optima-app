/** Ejemplo local OPTIMA 12C.17.6: sin red, sin DB, sin permisos. */
import { crearBorradorComercialLocal } from "../core/borradores-contratacion-comercial-12c172.js";
import { iniciarHistorialComercialLocal } from "../core/historial-contratacion-comercial-12c173.js";
import { previsualizarCambioComercialLocal, type SolicitudCambioComercialLocal } from "../core/flujo-confirmacion-comercial-12c174.js";
import {
  crearCoordinadorConcurrenciaComercialLocal,
  verificarIntegridadBitacoraComercialLocal,
} from "../core/coordinador-concurrencia-comercial-12c176.js";

const empresaId = `rec${"A".repeat(14)}`;
const actorA = `rec${"C".repeat(14)}`;
const T0 = "2026-11-10T13:00:00.000Z";
const T1 = "2026-11-10T14:00:00.000Z";
const inicial = iniciarHistorialComercialLocal({ empresaId, idContrato: "CTR-DEMO-12C176" });
if (!inicial.ok) throw Error(`Historial: ${inicial.motivo}`);
const creado = crearCoordinadorConcurrenciaComercialLocal(inicial.historial);
if (!creado.ok) throw Error(`Coordinador: ${creado.motivo}`);
const gestor = creado.gestor;
function propuesta(idVersion: string, submodulo: "CHEQUES" | "BANCOS", clave: string) {
  const h = gestor.consultar().historialActual;
  const b = crearBorradorComercialLocal({ idBorrador: `BOR-DEMO-${submodulo}`,
    empresaId, idContrato: null, versionBase: null, serviciosBase: [],
    serviciosPropuestos: [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo, nivel: "ESTANDAR" }],
    motivoCambio: "Alta comercial ficticia de demostración", ahoraIso: T0 });
  if (!b.ok) throw Error(`Borrador: ${b.motivo}`);
  const solicitud: SolicitudCambioComercialLocal = { tipo: "APROBACION", historial: h,
    borrador: b.borrador, empresaId, actor: { usuarioId: actorA, rolSimulado: "PLATAFORMA",
      operacionesSimuladas: ["APROBACION"], simulacion: true }, idVersion,
    revisionHistorialEsperada: h.revisionHistorial, ahoraIso: T1 };
  const previa = previsualizarCambioComercialLocal(solicitud);
  if (!previa.ok) throw Error(`Vista previa: ${previa.motivo}`);
  return { claveIdempotencia: clave, solicitud, vistaPrevia: previa.vista,
    confirmacion: previa.vista.fraseConfirmacion };
}
const uno = propuesta("VER-DEMO-0001", "CHEQUES", "OP-DEMO-PRIMERO-0001");
const dos = propuesta("VER-DEMO-0002", "BANCOS", "OP-DEMO-SEGUNDO-0002");
const primero = gestor.ejecutar(uno);
const duplicado = gestor.ejecutar(uno);
const conflicto = gestor.ejecutar(dos);
const estado = gestor.consultar();
if (!primero.ok || !duplicado.ok || !duplicado.repetida || conflicto.ok ||
    conflicto.motivo !== "REVISION_DESACTUALIZADA" ||
    estado.historialActual.revisionHistorial !== 1 || estado.bitacora.length !== 1 ||
    !verificarIntegridadBitacoraComercialLocal(estado) || estado.accesoOperativoHabilitado !== false ||
    estado.auditoriaDurable !== false || estado.concurrenciaDistribuidaGarantizada !== false)
  throw Error("Demostración de concurrencia fallida");
console.log("Primera operación: APROBADA (simulación)");
console.log("Reintento idéntico: SIN DUPLICAR");
console.log("Segunda operación sobre revisión anterior: BLOQUEADA");
console.log("Auditoría local: ÍNTEGRA; escritura real: NO HABILITADA");
console.log("RESULTADO: DEMOSTRACION OK");
