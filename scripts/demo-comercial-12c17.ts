/** Ejemplos locales: nunca se consulta Airtable ni se cambia una contratación. */
import {
  simularPropuestaComercial,
  compararPropuestasComerciales,
} from "../core/simulador-contratacion-comercial-12c17.js";

const s1 = simularPropuestaComercial([
  { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
]);
const s2 = simularPropuestaComercial([
  { modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "GESTION" },
]);
const s3 = simularPropuestaComercial([
  { modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "GESTION" },
  { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
]);
const s4 = compararPropuestasComerciales([
  { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
], [
  { modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "GESTION" },
]);
if (!s1.ok || !s2.ok || s3.ok || !s4.ok) {
  throw Error("Los escenarios de demostración no cumplen las reglas comerciales.");
}
console.log("SIMULACIÓN LOCAL — SIN DATOS REALES");
console.log(`Cheques Estándar: VÁLIDO (${s1.submodulosCubiertos} submódulo)`);
console.log(`Administración Gestión: VÁLIDO (${s2.submodulosCubiertos} submódulos cubiertos)`);
console.log("Administración + Cheques suelto: RECHAZADO (superposición)");
console.log(`Cambio Cheques → Administración: ${s4.cambios.length} coberturas afectadas`);
console.log("Permisos y operaciones reales: NO HABILITADOS");
