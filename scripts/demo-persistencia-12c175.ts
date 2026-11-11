/** Ejemplo de proyección documental sin llamadas de red ni escritura. */
import { crearBorradorComercialLocal } from "../core/borradores-contratacion-comercial-12c172.js";
import { iniciarHistorialComercialLocal, aprobarBorradorComercialLocal,
  activarVersionComercialLocal } from "../core/historial-contratacion-comercial-12c173.js";
import { proyectarHistorialComercialParaPersistenciaLocal,
  compararTransicionDeHistorialLocal } from "../core/proyeccion-persistencia-comercial-12c175.js";

const empresaId = "rec" + "A".repeat(14);
const aprobador = "rec" + "C".repeat(14);
const activador = "rec" + "D".repeat(14);
const inicio = iniciarHistorialComercialLocal({ empresaId, idContrato: "CTR-DEMO-175" });
if (!inicio.ok) throw new Error(inicio.motivo);
const borrador = crearBorradorComercialLocal({ idBorrador: "BOR-DEMO-175", empresaId,
  idContrato: null, versionBase: null, serviciosBase: [],
  serviciosPropuestos: [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" }],
  motivoCambio: "Prueba local de persistencia", ahoraIso: "2026-11-10T13:00:00.000Z" });
if (!borrador.ok) throw new Error(borrador.motivo);
const aprobado = aprobarBorradorComercialLocal({ historial: inicio.historial, borrador: borrador.borrador,
  empresaId, actorUsuarioId: aprobador, idVersion: "VER-DEMO-0175", revisionHistorialEsperada: 0,
  ahoraIso: "2026-11-10T14:00:00.000Z" });
if (!aprobado.ok) throw new Error(aprobado.motivo);
const activo = activarVersionComercialLocal({ historial: aprobado.historial, empresaId,
  actorUsuarioId: activador, idVersion: "VER-DEMO-0175", revisionHistorialEsperada: 1,
  ahoraIso: "2026-11-10T15:00:00.000Z" });
if (!activo.ok) throw new Error(activo.motivo);
const transicion = compararTransicionDeHistorialLocal({ anterior: aprobado.historial,
  siguiente: activo.historial, empresaId, revisionAnteriorEsperada: 1 });
if (!transicion.ok) throw new Error(transicion.motivo);
const plan = proyectarHistorialComercialParaPersistenciaLocal({
  historial: activo.historial, empresaId, revisionEsperada: 2 });
if (!plan.ok) throw new Error(plan.motivo);
if (plan.plan.listoParaEscribir !== false) throw Error("Proyección insegura");
console.log("OPTIMA 12C.17.5 — PROYECCIÓN LOCAL");
console.log(`Tabla: ${plan.plan.tabla} | Versiones: ${plan.plan.filas.length} | Eventos sin guardar: ${plan.plan.eventosSinAlmacenDurable.length}`);
console.log(`Pendientes de arquitectura: ${plan.plan.bloqueosParaEscritura.length} | Escrituras: NINGUNA`);
console.log("Airtable: SIN CONSULTAS NI CAMBIOS | Permisos reales: SIN ACTIVACIÓN");
