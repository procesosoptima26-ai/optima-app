/** OPTIMA 12C.17.2 — Demostración de BORRADORES EN MEMORIA, sin servicios externos. */
import {
  crearBorradorComercialLocal,
  actualizarBorradorComercialLocal,
  descartarBorradorComercialLocal,
} from "../core/borradores-contratacion-comercial-12c172.js";

const EMPRESA_FICTICIA = `rec${"D".repeat(14)}`;
const creado = crearBorradorComercialLocal({
  idBorrador: "BOR-DEMO-001", empresaId: EMPRESA_FICTICIA,
  idContrato: "CTR-DEMO-001", versionBase: 1,
  serviciosBase: [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" }],
  serviciosPropuestos: [{ modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "GESTION" }],
  motivoCambio: "Simulación de ampliación comercial", ahoraIso: "2026-11-10T13:00:00.000Z",
});
if (!creado.ok) throw Error("Demo: no se pudo crear el borrador");
const revisado = actualizarBorradorComercialLocal({
  borrador: creado.borrador, empresaId: EMPRESA_FICTICIA,
  revisionEsperada: 1, versionBaseEsperada: 1,
  serviciosPropuestos: [{ modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "AVANZADO" }],
  motivoCambio: "Cambio de nivel en simulación", ahoraIso: "2026-11-10T14:00:00.000Z",
});
if (!revisado.ok) throw Error("Demo: no se pudo revisar el borrador");
const descartado = descartarBorradorComercialLocal({
  borrador: revisado.borrador, empresaId: EMPRESA_FICTICIA,
  revisionEsperada: 2, ahoraIso: "2026-11-10T15:00:00.000Z",
});
if (!descartado.ok) throw Error("Demo: no se pudo descartar el borrador");
console.log("OPTIMA 12C.17.2 — DEMOSTRACIÓN LOCAL");
console.log(`Creado: revisión ${creado.borrador.revisionLocal}; diferencias ${creado.borrador.diferencias.length}`);
console.log(`Editado: revisión ${revisado.borrador.revisionLocal}; nivel ${revisado.borrador.serviciosPropuestos[0].nivel}`);
console.log(`Descartado: estado ${descartado.borrador.estado}; revisión ${descartado.borrador.revisionLocal}`);
console.log("Operaciones y permisos reales: DESHABILITADOS");
