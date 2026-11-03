
/**
 * Adaptador de compatibilidad para las pantallas actuales.
 * La fuente única de permisos está en core/seguridad.ts.
 * El servidor verificará los permisos efectivos con puedeRealizarAccion.
 */
export type { RolUsuario, Permiso } from "../../core/seguridad.js";
export { tienePermiso, esAdmin } from "../../core/seguridad.js";
