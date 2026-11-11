import { crearBorradorComercialLocal } from "../core/borradores-contratacion-comercial-12c172.js";
import { iniciarHistorialComercialLocal } from "../core/historial-contratacion-comercial-12c173.js";
import { previsualizarCambioComercialLocal, confirmarCambioComercialLocal } from "../core/flujo-confirmacion-comercial-12c174.js";

const empresaId = `rec${"A".repeat(14)}`;
const aprobador = { usuarioId: `rec${"C".repeat(14)}`, rolSimulado: "PLATAFORMA" as const,
  operacionesSimuladas: ["APROBACION" as const], simulacion: true as const };
const activador = { usuarioId: `rec${"D".repeat(14)}`, rolSimulado: "PLATAFORMA" as const,
  operacionesSimuladas: ["ACTIVACION" as const], simulacion: true as const };
const h = iniciarHistorialComercialLocal({ empresaId, idContrato: "CTR-DEMO-001" });
if (!h.ok) throw Error("No pudo iniciar historial");
const b = crearBorradorComercialLocal({ idBorrador: "BOR-DEMO-0001", empresaId, idContrato: null,
  versionBase: null, serviciosBase: [],
  serviciosPropuestos: [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" }],
  motivoCambio: "Alta simulada de Cheques", ahoraIso: "2026-11-10T13:00:00.000Z" });
if (!b.ok) throw Error("No pudo crear borrador");
const aprobar = { tipo: "APROBACION" as const, historial: h.historial, borrador: b.borrador,
  empresaId, actor: aprobador, idVersion: "VER-DEMO-0001",
  revisionHistorialEsperada: 0, ahoraIso: "2026-11-10T14:00:00.000Z" };
const vista1 = previsualizarCambioComercialLocal(aprobar);
if (!vista1.ok) throw Error(`Vista falló: ${vista1.motivo}`);
const confirmada1 = confirmarCambioComercialLocal({ solicitud: aprobar, vistaPrevia: vista1.vista,
  confirmacion: vista1.vista.fraseConfirmacion });
if (!confirmada1.ok) throw Error(`Aprobación falló: ${confirmada1.motivo}`);
const activar = { tipo: "ACTIVACION" as const, historial: confirmada1.historial, empresaId,
  actor: activador, idVersion: "VER-DEMO-0001", revisionHistorialEsperada: 1,
  ahoraIso: "2026-11-10T15:00:00.000Z" };
const vista2 = previsualizarCambioComercialLocal(activar);
if (!vista2.ok) throw Error(`Vista activación falló: ${vista2.motivo}`);
const confirmada2 = confirmarCambioComercialLocal({ solicitud: activar,
  vistaPrevia: vista2.vista, confirmacion: vista2.vista.fraseConfirmacion });
if (!confirmada2.ok) throw Error(`Activación falló: ${confirmada2.motivo}`);
console.log("OPTIMA 12C.17.4 — flujo local simulado");
console.log(`Aprobación: ${confirmada1.historial.versiones[0].estado} | Activación simulada: ${confirmada2.historial.versiones[0].estado}`);
console.log(`Revisiones: ${confirmada2.historial.revisionHistorial} | Eventos: ${confirmada2.historial.eventos.length}`);
console.log("Identidad real: NO VERIFICADA | Permisos operativos: INALTERADOS | Airtable: SIN ESCRITURAS");
