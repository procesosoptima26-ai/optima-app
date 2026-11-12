/**
 * OPTIMA — Auditoría de identidad sobre el motor append-only existente.
 * No crea rutas ni tablas. No transmite contraseñas, hashes, enlaces ni tokens.
 * Las escrituras reales sólo pueden invocarse desde handlers autenticados o
 * desde un enlace de un solo uso VALIDADO en el servidor.
 */
import { crearOperacionAuditoria, registrarEventoAuditoria,
  type ActorAuditoria, type EntradaAuditoria, type EstadoTecnicoAuditoria } from "./auditoria-eventos.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
export type AccionIdentidad = "USUARIO_INVITAR" | "USUARIO_ACTIVAR" | "USUARIO_RESTABLECER_CLAVE";
export type FaseAuditoriaIdentidad = "AUDITORIA_INICIO" | "AUDITORIA_FINAL" |
  "OPERACION_NO_CONFIRMADA" | "OPERACION_INDETERMINADA";

export class ErrorAuditoriaIdentidad extends Error {
  constructor(public readonly codigo: FaseAuditoriaIdentidad,
    public readonly operacionId: string, public readonly puedeEstarAplicado: boolean) {
    super(codigo);
    this.name = "ErrorAuditoriaIdentidad";
  }
}

export type OperacionIdentidadAuditada<T> = Readonly<{
  actor: ActorAuditoria; // proveniente del servidor, nunca del navegador
  empresaId: string;
  empresaNombre: string;
  accion: AccionIdentidad;
  recursoTipo: "EMPRESA" | "USUARIO";
  recursoId: string;
  motivo: string; // explicación fija generada por el servidor
  anterior: EstadoTecnicoAuditoria;
  propuesto: EstadoTecnicoAuditoria;
  escribir: () => Promise<void>;
  /** Relectura desde el maestro del servidor; no confiar en respuestas del PATCH. */
  releer: () => Promise<{ estado: EstadoTecnicoAuditoria; dato: T }>;
  /** Sólo retornar true si se sabe que no hubo efectos, incluidos Redis y correo. */
  falloSinEfecto?: () => boolean;
  /** Para pruebas sin conexión a proveedores. */
  registrar?: typeof registrarEventoAuditoria;
}>;

function coincide(observado: EstadoTecnicoAuditoria | null, esperado: EstadoTecnicoAuditoria): boolean {
  if (!observado) return false;
  const o = observado as unknown as Record<string, unknown>;
  const e = esperado as unknown as Record<string, unknown>;
  return Object.keys(e).every(key => JSON.stringify(o[key]) === JSON.stringify(e[key]));
}

export async function ejecutarIdentidadAuditada<T>(p: OperacionIdentidadAuditada<T>): Promise<{
  operacionId: string; dato: T;
}> {
  const operacionId = crearOperacionAuditoria();
  if (!ID.test(p.empresaId) || !ID.test(p.recursoId) ||
      (p.actor.tipo === "SISTEMA" ? p.actor.usuarioId !== "SISTEMA" : !ID.test(p.actor.usuarioId)) ||
      !["USUARIO_INVITAR", "USUARIO_ACTIVAR", "USUARIO_RESTABLECER_CLAVE"].includes(p.accion) ||
      !p.anterior || !p.propuesto) {
    throw new ErrorAuditoriaIdentidad("AUDITORIA_INICIO", operacionId, false);
  }
  const registrar = p.registrar ?? registrarEventoAuditoria;
  const comun: Omit<EntradaAuditoria, "resultado" | "detalle" | "anterior" | "nuevo"> = {
    operacionId, actor: p.actor, empresaId: p.empresaId, empresaNombre: p.empresaNombre,
    modulo: "CORE", accion: p.accion, recursoTipo: p.recursoTipo, recursoId: p.recursoId,
    origen: "API", motivo: p.motivo,
  };
  try {
    await registrar({ ...comun, anterior: p.anterior, nuevo: p.propuesto, resultado: "INTENTO", detalle: "INICIO" });
  } catch {
    // Sin registro de INTENTO confirmado no se ejecuta la operación de negocio.
    throw new ErrorAuditoriaIdentidad("AUDITORIA_INICIO", operacionId, false);
  }
  let errorEscritura = false;
  try { await p.escribir(); } catch { errorEscritura = true; }
  let observado: Awaited<ReturnType<typeof p.releer>> | null = null;
  try { observado = await p.releer(); } catch { /* Estado incierto: no se reintenta */ }
  const confirmado = coincide(observado?.estado ?? null, p.propuesto);
  const noAplicado = errorEscritura && p.falloSinEfecto?.() === true &&
    coincide(observado?.estado ?? null, p.anterior);
  const resultado = confirmado ? "CONFIRMADO" : noAplicado ? "FALLIDO" : "INDETERMINADO";
  const detalle = confirmado ? "CAMBIO_CONFIRMADO" : noAplicado ? "CAMBIO_NO_APLICADO" : "ESTADO_INCIERTO";
  try {
    await registrar({ ...comun, anterior: p.anterior, nuevo: observado?.estado ?? null, resultado, detalle });
  } catch {
    throw new ErrorAuditoriaIdentidad("AUDITORIA_FINAL", operacionId, !noAplicado);
  }
  if (confirmado && observado) return { operacionId, dato: observado.dato };
  throw new ErrorAuditoriaIdentidad(noAplicado ? "OPERACION_NO_CONFIRMADA" : "OPERACION_INDETERMINADA",
    operacionId, !noAplicado);
}

/** Marcadores de usuario: sólo estado y rec-ID; jamás datos de autenticación. */
export function snapshotIdentidad(activa: boolean, credencialActualizada: boolean,
  extras: { usuarioAfectadoId?: string; invitacionAceptada?: boolean; sesionesRevocadas?: boolean } = {}): EstadoTecnicoAuditoria {
  return {
    ACTIVA: activa,
    CREDENCIAL_ACTUALIZADA: credencialActualizada,
    ...(extras.usuarioAfectadoId ? { USUARIO_AFECTADO_ID: extras.usuarioAfectadoId } : {}),
    ...(extras.invitacionAceptada !== undefined ? { INVITACION_ACEPTADA_POR_PROVEEDOR: extras.invitacionAceptada } : {}),
    ...(extras.sesionesRevocadas !== undefined ? { SESIONES_REVOCADAS: extras.sesionesRevocadas } : {}),
  };
}
