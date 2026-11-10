/** Demostración local: ningún contrato ni permiso real se modifica. */
import { crearBorradorComercialLocal } from "../core/borradores-contratacion-comercial-12c172.js";
import {
  iniciarHistorialComercialLocal,
  aprobarBorradorComercialLocal,
  activarVersionComercialLocal,
} from "../core/historial-contratacion-comercial-12c173.js";

const EMPRESA = `rec${"A".repeat(14)}`;
const ACTOR = `rec${"B".repeat(14)}`;
const anterior = iniciarHistorialComercialLocal({ empresaId: EMPRESA, idContrato: "CTR-DEMO-001" });
if (!anterior.ok) throw new Error(`No se pudo iniciar simulación: ${anterior.motivo}`);
const borrador = crearBorradorComercialLocal({
  idBorrador: "BOR-DEMO-001", empresaId: EMPRESA, idContrato: null,
  versionBase: null, serviciosBase: [],
  serviciosPropuestos: [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" }],
  motivoCambio: "Alta inicial del servicio Cheques", ahoraIso: "2026-11-10T13:00:00.000Z",
});
if (!borrador.ok) throw new Error(`Borrador inválido: ${borrador.motivo}`);
const aprobada = aprobarBorradorComercialLocal({ historial: anterior.historial, borrador: borrador.borrador,
  empresaId: EMPRESA, actorUsuarioId: ACTOR, idVersion: "VER-DEMO-0001",
  revisionHistorialEsperada: 0, ahoraIso: "2026-11-10T14:00:00.000Z" });
if (!aprobada.ok) throw new Error(`Aprobación local inválida: ${aprobada.motivo}`);
if (aprobada.historial.versiones[0].estado !== "APROBADA") throw new Error("Activación inesperada");
const vigente = activarVersionComercialLocal({ historial: aprobada.historial,
  empresaId: EMPRESA, actorUsuarioId: ACTOR, idVersion: "VER-DEMO-0001",
  revisionHistorialEsperada: 1, ahoraIso: "2026-11-10T15:00:00.000Z" });
if (!vigente.ok) throw new Error(`Activación local inválida: ${vigente.motivo}`);
console.log("OPTIMA 12C.17.3 — DEMOSTRACIÓN LOCAL");
console.log(`Borrador: BORRADOR → Aprobación: ${aprobada.historial.versiones[0].estado} → Simulación: ${vigente.historial.versiones[0].estado}`);
console.log(`Versiones: ${vigente.historial.versiones.length}; eventos: ${vigente.historial.eventos.length}`);
console.log("Airtable: SIN ESCRITURAS | Acceso operativo: DESHABILITADO");
