/**
 * OPTIMA — Paso 11B: condiciones mínimas para futuros cambios de sucursales.
 *
 * IMPORTANTE: las variables de esta función deberán provenir de verificaciones
 * realizadas por el servidor. No confiar en valores recibidos de req.body.
 * El resultado positivo NO significa que la migración operativa esté hecha.
 * Este archivo por sí solo NO habilita escrituras ni modifica Airtable.
 */
export type EvaluacionSucursal = Readonly<{
  perteneceEmpresa: boolean;
  activa: boolean;
  usuariosAsignados: number | null;
  sucursalesActivas: number | null;
  referenciasOperativasCompatibles: boolean;
}>;

export type ResultadoEvaluacion = Readonly<{
  permitido: boolean;
  motivo: string;
}>;

export function evaluarCambioSucursal(
  accion: "renombrar" | "desactivar",
  datos: EvaluacionSucursal
): ResultadoEvaluacion {
  if (!datos.perteneceEmpresa) {
    return { permitido: false, motivo: "Sucursal fuera de la empresa" };
  }

  // La integración actual de inventario conserva referencias por nombre.
  // Mientras no se demuestre compatibilidad, toda modificación se rechaza.
  if (!datos.referenciasOperativasCompatibles) {
    return {
      permitido: false,
      motivo: "Falta verificar o migrar referencias operativas",
    };
  }

  if (datos.usuariosAsignados === null ||
      !Number.isSafeInteger(datos.usuariosAsignados) ||
      datos.usuariosAsignados < 0) {
    return {
      permitido: false,
      motivo: "No se verificaron los usuarios asignados",
    };
  }

  if (accion === "desactivar") {
    if (!datos.activa) {
      return { permitido: false, motivo: "Sucursal ya inactiva" };
    }
    if (datos.usuariosAsignados > 0) {
      return { permitido: false, motivo: "Tiene usuarios asignados" };
    }
    if (datos.sucursalesActivas === null ||
        !Number.isSafeInteger(datos.sucursalesActivas) ||
        datos.sucursalesActivas <= 1) {
      return {
        permitido: false,
        motivo: "No se puede desactivar la última sucursal activa",
      };
    }
  }

  return { permitido: true, motivo: "Validación preliminar aprobada" };
}
