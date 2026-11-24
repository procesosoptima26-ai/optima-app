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
  // Tarea 11: pantallas heredadas que ESCRIBEN. Son reglas a nivel MÓDULO (sin submódulo):
  // exigen el módulo contratado (cualquier nivel), ciclo de vida que permita escribir y permiso real.
  { id: "movimientos.registro.crear", modulo: "MOVIMIENTOS", submodulo: null,
    permiso: "movimientos.crear", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: null },
  { id: "movimientos.registro.ajustar", modulo: "MOVIMIENTOS", submodulo: null,
    permiso: "movimientos.ajustar", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: null },
  { id: "inventario.stock.crear", modulo: "INVENTARIO", submodulo: null,
    permiso: "inventario.crear", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: null },
  { id: "inventario.stock.editar", modulo: "INVENTARIO", submodulo: null,
    permiso: "inventario.editarGuardado", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: null },
  // Tarea 11 (lecturas): pantallas heredadas que SOLO LEEN. Siguen funcionando en SOLO_LECTURA.
  { id: "movimientos.registro.consultar", modulo: "MOVIMIENTOS", submodulo: null,
    permiso: "movimientos.ver", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: null },
  { id: "administracion.terceros.consultar", modulo: "ADMINISTRACION", submodulo: null,
    permiso: "administracion.ver", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: null },
]);
