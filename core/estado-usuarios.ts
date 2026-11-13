/** OPTIMA — Punto 2. Validación pura de cambios de estado de empleados.
 * La decisión definitiva de empresa, rol y permisos siempre la toma el servidor.
 */
import { motivoAuditoriaCore } from "../lib/auditoria-core-transversal.js";
import { versionAcceso, type DetalleEmpleado } from "./edicion-usuarios.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const VERSION = /^[a-f0-9]{64}$/;

export type SolicitudEstadoUsuario = Readonly<{
  id: string;
  activo: boolean;
  version: string;
  motivo: string;
}>;

export type ValidacionEstado =
  | { ok: true; datos: SolicitudEstadoUsuario }
  | { ok: false; error: string };

export function validarSolicitudEstado(valor: unknown): ValidacionEstado {
  if (!valor || typeof valor !== "object" || Array.isArray(valor))
    return { ok: false, error: "Solicitud inválida" };
  const v = valor as Record<string, unknown>;
  if (typeof v.id !== "string" || !ID.test(v.id) ||
      typeof v.activo !== "boolean" || typeof v.version !== "string" || !VERSION.test(v.version)) {
    return { ok: false, error: "Identificador, estado o versión inválidos" };
  }
  const motivo = motivoAuditoriaCore(v.motivo);
  if (!motivo) return { ok: false, error: "Indicá un motivo de 10 a 500 caracteres" };
  return { ok: true, datos: { id: v.id, activo: v.activo, version: v.version, motivo } };
}

/** No autorizar cuentas pendientes de invitación como si tuvieran contraseña. */
export function reactivacionValida(campos: Record<string, unknown>): boolean {
  return typeof campos.PASSWORD_HASH === "string" &&
    /^\$argon2id\$v=19\$m=/.test(campos.PASSWORD_HASH);
}

/** Requiere habilitación expresa y controles de auditoría antes de tocar usuarios reales. */
export function gestionEstadoHabilitada(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPTIMA_USERS_STATUS_ENABLED === "true" &&
    env.OPTIMA_CORE_AUDIT_ENFORCE_ENABLED === "true" &&
    env.OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED === "true" &&
    env.OPTIMA_AUDIT_WRITES_ENABLED === "true";
}

/**
 * El cambio de ACTIVO también modifica la versión optimista del empleado.
 * La auditoría debe comparar el snapshot PROYECTADO con el que Airtable
 * devolverá tras guardar, no conservar la versión anterior por accidente.
 * Función pura: no realiza escrituras ni accesos externos.
 */
export function proyectarEstadoEmpleado(
  registro: { id: string; fields: Record<string, unknown> },
  empleado: DetalleEmpleado,
  activo: boolean,
): DetalleEmpleado {
  return {
    ...empleado,
    activo,
    version: versionAcceso({
      id: registro.id,
      fields: { ...registro.fields, ACTIVO: activo },
    }),
  };
}
