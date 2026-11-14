/** Catálogo REVISIONADO de capacidades implementadas y verificables en API.
 * No basta con figurar en el catálogo comercial para permitir una función.
 * Agregar un ID exige mapear el guard del endpoint y probar autorización.
 */
import type { DefinicionCapacidadComercial } from "./acceso-comercial.js";

export const CAPACIDADES_OPERATIVAS_12C19: readonly DefinicionCapacidadComercial[] = Object.freeze([
  {
    id: "inventario.productos.consultar",
    modulo: "INVENTARIO",
    submodulo: "INV_PRODUCTOS",
    permiso: "inventario.ver",
    nivelMinimoModulo: "ESENCIAL",
    nivelMinimoSubmodulo: "ESTANDAR",
  },
]);
