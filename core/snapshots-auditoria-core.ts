/** Snapshots no sensibles para auditoría; sólo reciben modelos validados por Core. */
import type { DetalleEmpleado } from "./edicion-usuarios.js";
import type { EstadoTecnicoAuditoria } from "../lib/auditoria-eventos.js";

export function snapshotAccesosEmpleado(empleado: DetalleEmpleado): EstadoTecnicoAuditoria {
  return {
    ACTIVA: empleado.activo,
    SUCURSALES: [...empleado.sucursalIds].sort(),
    SUCURSAL_PRINCIPAL: empleado.sucursalPredeterminadaId,
    MODULOS_HABILITADOS: [...empleado.modulos].sort(),
    PERMISOS: [...empleado.permisos].sort(),
    VERSION: empleado.version,
  };
}

export function snapshotSucursal(sucursal: { id?: string; nombre: string; activa: boolean }): EstadoTecnicoAuditoria {
  return {
    ACTIVA: sucursal.activa,
    NOMBRE_SUCURSAL: sucursal.nombre,
    ...(sucursal.id ? { SUCURSAL_ID: sucursal.id } : {}),
  };
}
