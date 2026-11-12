/**
 * OPTIMA — Auditoría transversal del Core, fase de integración aislada.
 * Usa AUDITORIA_EVENTOS ya existente; NO crea tablas ni rutas.
 * Por defecto las API mantienen su flujo anterior; activar sólo en un entorno
 * aislado con OPTIMA_CORE_AUDIT_ENFORCE_ENABLED=true y auditoría configurada.
 * Sin idempotencia externa no hay reintentos automáticos ante resultado incierto.
 */
import {
  crearOperacionAuditoria, registrarEventoAuditoria,
  type EstadoTecnicoAuditoria, type EntradaAuditoria,
} from "./auditoria-eventos.js";
import { ejecutarConPuertaAuditoriaGlobal, type DependenciasPuertaGlobal } from "./puerta-auditoria-core-global.js";

export type SnapshotCore = EstadoTecnicoAuditoria;
export type EventoCoreAccion =
  "USUARIO_EDITAR_ACCESOS" | "SUCURSAL_CREAR" | "SUCURSAL_RENOMBRAR" | "SUCURSAL_DESACTIVAR";
export type FaseErrorCore = "AUDITORIA_INICIO" | "AUDITORIA_FINAL" |
  "CAMBIO_NO_CONFIRMADO" | "CAMBIO_INDETERMINADO";

export class ErrorAuditoriaCore extends Error {
  constructor(public readonly codigo: FaseErrorCore,
    public readonly operacionId: string, public readonly puedeEstarAplicado: boolean) {
    super(codigo);
    this.name = "ErrorAuditoriaCore";
  }
}

export function auditoriaCoreExigida(): boolean {
  return process.env.OPTIMA_CORE_AUDIT_ENFORCE_ENABLED === "true" ||
    process.env.OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED === "true";
}

export function motivoAuditoriaCore(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.trim().length < 10 || valor.trim().length > 500 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(valor)) return null;
  return valor.trim();
}

const ID = /^rec[A-Za-z0-9]{14}$/;
const ACCIONES: readonly EventoCoreAccion[] = ["USUARIO_EDITAR_ACCESOS", "SUCURSAL_CREAR",
  "SUCURSAL_RENOMBRAR", "SUCURSAL_DESACTIVAR"];

function equivalen(a: SnapshotCore | null, b: SnapshotCore): boolean {
  if (!a) return false;
  const real = a as Readonly<Record<string, unknown>>;
  const esperado = b as Readonly<Record<string, unknown>>;
  return Object.keys(esperado).every(k => JSON.stringify(real[k]) === JSON.stringify(esperado[k]));
}

export type OperacionAuditadaCore<T> = Readonly<{
  actorId: string;
  empresaId: string;
  empresaNombre: string;
  accion: EventoCoreAccion;
  recursoTipo: "EMPRESA" | "USUARIO" | "SUCURSAL";
  recursoId: string;
  motivo: string;
  anterior: SnapshotCore;
  propuesto: SnapshotCore;
  /** Nunca inyectar desde el navegador: funciones construidas por la API autenticada. */
  escribir: () => Promise<void>;
  /** Releer desde fuente canónica del servidor, NO desde la respuesta del PATCH. */
  releer: () => Promise<{ estado: SnapshotCore; dato: T }>;
  /** Únicamente para pruebas aisladas, sin acceder a proveedores. */
  registrar?: typeof registrarEventoAuditoria;
  /** Inyección de control únicamente para simulaciones aisladas. */
  controlGlobal?: DependenciasPuertaGlobal;
}>;

export async function ejecutarOperacionCoreAuditada<T>(p: OperacionAuditadaCore<T>): Promise<{
  operacionId: string; dato: T;
}> {
  const operacionId = crearOperacionAuditoria();
  if (!ID.test(p.actorId) || !ID.test(p.empresaId) || !ID.test(p.recursoId) ||
      !ACCIONES.includes(p.accion) || !motivoAuditoriaCore(p.motivo) ||
      !p.anterior || !p.propuesto) {
    throw new ErrorAuditoriaCore("AUDITORIA_INICIO", operacionId, false);
  }
  return ejecutarConPuertaAuditoriaGlobal(p.empresaId, async (renovarAntesDeEscribir) => {
  const registrar = p.registrar ?? registrarEventoAuditoria;
  const comun: Omit<EntradaAuditoria, "resultado" | "detalle" | "anterior" | "nuevo"> = {
    operacionId,
    actor: { usuarioId: p.actorId, usuario: p.actorId, tipo: "CLIENTE" },
    empresaId: p.empresaId,
    empresaNombre: p.empresaNombre,
    modulo: "CORE",
    accion: p.accion,
    recursoTipo: p.recursoTipo,
    recursoId: p.recursoId,
    origen: "PANEL",
    motivo: p.motivo,
  };
  try {
    await registrar({ ...comun, anterior: p.anterior, nuevo: p.propuesto,
      resultado: "INTENTO", detalle: "INICIO" });
  } catch {
    throw new ErrorAuditoriaCore("AUDITORIA_INICIO", operacionId, false);
  }

  let falloEscritura = false;
  try { await renovarAntesDeEscribir(); await p.escribir(); } catch { falloEscritura = true; }
  let observado: Awaited<ReturnType<typeof p.releer>> | null = null;
  try { observado = await p.releer(); } catch { /* incidencia indeterminada */ }
  const confirmado = equivalen(observado?.estado ?? null, p.propuesto);
  const noAplicado = falloEscritura && equivalen(observado?.estado ?? null, p.anterior);
  const resultado = confirmado ? "CONFIRMADO" : noAplicado ? "FALLIDO" : "INDETERMINADO";
  const detalle = confirmado ? "CAMBIO_CONFIRMADO" : noAplicado ? "CAMBIO_NO_APLICADO" : "ESTADO_INCIERTO";
  try {
    await registrar({ ...comun, anterior: p.anterior, nuevo: observado?.estado ?? null,
      resultado, detalle });
  } catch {
    throw new ErrorAuditoriaCore("AUDITORIA_FINAL", operacionId, !noAplicado);
  }
  if (confirmado && observado) return { operacionId, dato: observado.dato };
  throw new ErrorAuditoriaCore(noAplicado ? "CAMBIO_NO_CONFIRMADO" : "CAMBIO_INDETERMINADO",
    operacionId, !noAplicado);
  }, p.controlGlobal);
}
