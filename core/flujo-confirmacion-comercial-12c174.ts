/**
 * OPTIMA 12C.17.4 — Vista previa + confirmación de contrataciones SIMULADAS.
 *
 * Este archivo es una función pura. No autentica sesiones: la identidad y los
 * permisosSimulados son DATOS DE PRUEBA suministrados por quien llama.
 * NO usarlo como guard de backend ni como interfaz de escritura real.
 *
 * El hash comprueba coherencia de la vista previa con el snapshot recibido.
 * NO es una firma ni impide una carrera concurrente entre procesos. Para una
 * API real hacen falta sesión verificada + relectura + CAS/transacción + auditoría.
 */
import { createHash } from "node:crypto";
import type { BorradorContratacionLocal } from "./borradores-contratacion-comercial-12c172.js";
import {
  activarVersionComercialLocal, aprobarBorradorComercialLocal,
  esHistorialComercialLocalValido,
  type ErrorHistorialSimulado,
  type HistorialContratacionSimulado,
  type ResultadoHistorialSimulado,
} from "./historial-contratacion-comercial-12c173.js";
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

export type OperacionComercialSimulada = "APROBACION" | "ACTIVACION";
export type ActorComercialSimulado = Readonly<{
  usuarioId: string;
  rolSimulado: "PLATAFORMA" | "USUARIO";
  operacionesSimuladas: readonly OperacionComercialSimulada[];
  simulacion: true;
}>;
type SolicitudBase = Readonly<{
  historial: HistorialContratacionSimulado;
  empresaId: string;
  actor: ActorComercialSimulado;
  idVersion: string;
  revisionHistorialEsperada: number;
  ahoraIso: string;
}>;
export type SolicitudCambioComercialLocal =
  | Readonly<SolicitudBase & { tipo: "APROBACION"; borrador: BorradorContratacionLocal }>
  | Readonly<SolicitudBase & { tipo: "ACTIVACION" }>;

export type VistaPreviaComercialLocal = Readonly<{
  tipo: OperacionComercialSimulada;
  empresaId: string;
  idContrato: string;
  idVersion: string;
  actorUsuarioId: string;
  revisionHistorial: number;
  revisionResultado: number;
  estadoResultado: "APROBADA" | "VIGENTE";
  versionAnteriorVigenteId: string | null;
  cambios: number;
  fechaIso: string;
  huellaSnapshot: string;
  fraseConfirmacion: string;
  simulacion: true;
  accesoOperativoHabilitado: false;
}>;
export type MotivoFlujoComercialLocal =
  | "DATOS_INVALIDOS" | "ACTOR_NO_AUTORIZADO_SIMULACION"
  | "SEPARACION_FUNCIONES" | "REGLA_HISTORIAL"
  | "VISTA_DESACTUALIZADA" | "CONFIRMACION_INCORRECTA";
export type ResultadoPrevisualizacionComercialLocal =
  | Readonly<{ ok: true; vista: VistaPreviaComercialLocal;
      simulacion: true; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: MotivoFlujoComercialLocal;
      causaHistorial?: ErrorHistorialSimulado;
      simulacion: true; accesoOperativoHabilitado: false }>;
export type ResultadoConfirmacionComercialLocal =
  | Readonly<{ ok: true; historial: HistorialContratacionSimulado;
      simulacion: true; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: MotivoFlujoComercialLocal;
      causaHistorial?: ErrorHistorialSimulado;
      simulacion: true; accesoOperativoHabilitado: false }>;

type ExitoEvaluacion = Readonly<{ ok: true; vista: VistaPreviaComercialLocal;
  historial: HistorialContratacionSimulado }>;
type ErrorEvaluacion = Extract<ResultadoPrevisualizacionComercialLocal, { ok: false }>;
type Evaluacion = ExitoEvaluacion | ErrorEvaluacion;
const ID = /^rec[A-Za-z0-9]{14}$/;
const ID_VERSION = /^VER-[A-Za-z0-9_-]{4,60}$/;
const CLAVES_ACTOR = ["usuarioId", "rolSimulado", "operacionesSimuladas", "simulacion"];
const BASE = ["tipo", "historial", "empresaId", "actor", "idVersion", "revisionHistorialEsperada", "ahoraIso"];
const CLAVES_VISTA = ["tipo", "empresaId", "idContrato", "idVersion", "actorUsuarioId", "revisionHistorial",
  "revisionResultado", "estadoResultado", "versionAnteriorVigenteId", "cambios", "fechaIso", "huellaSnapshot",
  "fraseConfirmacion", "simulacion", "accesoOperativoHabilitado"];
function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function clavesExactas(v: Record<string, unknown>, nombres: readonly string[]): boolean {
  return Object.keys(v).length === nombres.length && nombres.every(k => Object.hasOwn(v, k));
}
function fallo(motivo: MotivoFlujoComercialLocal, causaHistorial?: ErrorHistorialSimulado): ErrorEvaluacion {
  return Object.freeze({ ok: false, motivo,
    ...(causaHistorial ? { causaHistorial } : {}),
    simulacion: true, accesoOperativoHabilitado: false });
}
function actorValido(v: unknown): v is ActorComercialSimulado {
  return esObjeto(v) && clavesExactas(v, CLAVES_ACTOR) &&
    typeof v.usuarioId === "string" && ID.test(v.usuarioId) &&
    (v.rolSimulado === "PLATAFORMA" || v.rolSimulado === "USUARIO") &&
    Array.isArray(v.operacionesSimuladas) &&
    v.operacionesSimuladas.every(k => k === "APROBACION" || k === "ACTIVACION") &&
    new Set(v.operacionesSimuladas).size === v.operacionesSimuladas.length &&
    v.simulacion === true;
}
function solicitudValida(v: unknown): v is SolicitudCambioComercialLocal {
  if (!esObjeto(v) || (v.tipo !== "APROBACION" && v.tipo !== "ACTIVACION") ||
      !clavesExactas(v, v.tipo === "APROBACION" ? [...BASE, "borrador"] : BASE) ||
      typeof v.empresaId !== "string" || !esIdEmpresaEstable(v.empresaId) ||
      !actorValido(v.actor) || typeof v.idVersion !== "string" || !ID_VERSION.test(v.idVersion) ||
      typeof v.revisionHistorialEsperada !== "number" ||
      !Number.isSafeInteger(v.revisionHistorialEsperada) || v.revisionHistorialEsperada < 0 ||
      typeof v.ahoraIso !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.ahoraIso) ||
      Number.isNaN(Date.parse(v.ahoraIso)) || new Date(v.ahoraIso).toISOString() !== v.ahoraIso)
    return false;
  return esHistorialComercialLocalValido(v.historial);
}
function huella(v: SolicitudCambioComercialLocal): string {
  return createHash("sha256").update(JSON.stringify({
    tipo: v.tipo, historial: v.historial,
    empresaId: v.empresaId, actor: v.actor, idVersion: v.idVersion,
    revisionHistorialEsperada: v.revisionHistorialEsperada, ahoraIso: v.ahoraIso,
    ...(v.tipo === "APROBACION" ? { borrador: v.borrador } : {}),
  })).digest("hex");
}
function evaluar(entrada: unknown): Evaluacion {
  if (!solicitudValida(entrada)) return fallo("DATOS_INVALIDOS");
  const s = entrada;
  // Aun en simulación, nunca aceptar un actor sin la operación requerida.
  // Los datos del actor son falsificables y NO constituyen autenticación.
  if (s.actor.rolSimulado !== "PLATAFORMA" || !s.actor.operacionesSimuladas.includes(s.tipo))
    return fallo("ACTOR_NO_AUTORIZADO_SIMULACION");
  const anterior = s.historial.versiones.find(v => v.estado === "VIGENTE") ?? null;
  const objetivo = s.historial.versiones.find(v => v.idVersion === s.idVersion) ?? null;
  if (s.tipo === "ACTIVACION" && objetivo?.estado === "APROBADA" &&
      objetivo.aprobadoPorId === s.actor.usuarioId)
    return fallo("SEPARACION_FUNCIONES");
  let resultado: ResultadoHistorialSimulado;
  if (s.tipo === "APROBACION") {
    resultado = aprobarBorradorComercialLocal({
      historial: s.historial, borrador: s.borrador, empresaId: s.empresaId,
      actorUsuarioId: s.actor.usuarioId, idVersion: s.idVersion,
      revisionHistorialEsperada: s.revisionHistorialEsperada, ahoraIso: s.ahoraIso,
    });
  } else {
    resultado = activarVersionComercialLocal({
      historial: s.historial, empresaId: s.empresaId,
      actorUsuarioId: s.actor.usuarioId, idVersion: s.idVersion,
      revisionHistorialEsperada: s.revisionHistorialEsperada, ahoraIso: s.ahoraIso,
    });
  }
  if (!resultado.ok) return fallo("REGLA_HISTORIAL", resultado.motivo);
  const nueva = resultado.historial.versiones.find(v => v.idVersion === s.idVersion)!;
  const vista: VistaPreviaComercialLocal = Object.freeze({
    tipo: s.tipo, empresaId: s.empresaId, idContrato: s.historial.idContrato,
    idVersion: s.idVersion, actorUsuarioId: s.actor.usuarioId,
    revisionHistorial: s.historial.revisionHistorial,
    revisionResultado: resultado.historial.revisionHistorial,
    estadoResultado: s.tipo === "APROBACION" ? "APROBADA" : "VIGENTE",
    versionAnteriorVigenteId: anterior?.idVersion ?? null,
    cambios: s.tipo === "APROBACION" ? s.borrador.diferencias.length : 0,
    fechaIso: s.ahoraIso, huellaSnapshot: huella(s),
    fraseConfirmacion: `CONFIRMAR ${s.tipo} ${s.idVersion}`,
    simulacion: true, accesoOperativoHabilitado: false,
  });
  // Compilación TS también obliga a mantener los estados exactos.
  if (nueva.estado !== vista.estadoResultado) return fallo("DATOS_INVALIDOS");
  return Object.freeze({ ok: true, vista, historial: resultado.historial });
}

/** Prepara una vista sin mutar historial. No concede autorización real. */
export function previsualizarCambioComercialLocal(entrada: unknown): ResultadoPrevisualizacionComercialLocal {
  const resultado = evaluar(entrada);
  if (!resultado.ok) return resultado;
  return Object.freeze({ ok: true, vista: resultado.vista,
    simulacion: true, accesoOperativoHabilitado: false });
}

/** Revalida el snapshot recibido y exige confirmación literal de la vista. */
export function confirmarCambioComercialLocal(entrada: unknown): ResultadoConfirmacionComercialLocal {
  if (!esObjeto(entrada) || !clavesExactas(entrada, ["solicitud", "vistaPrevia", "confirmacion"]) ||
      typeof entrada.confirmacion !== "string") return fallo("DATOS_INVALIDOS");
  const evaluacion = evaluar(entrada.solicitud);
  if (!evaluacion.ok) return evaluacion;
  if (!esObjeto(entrada.vistaPrevia) || !clavesExactas(entrada.vistaPrevia, CLAVES_VISTA) ||
      JSON.stringify(entrada.vistaPrevia) !== JSON.stringify(evaluacion.vista))
    return fallo("VISTA_DESACTUALIZADA");
  if (entrada.confirmacion !== evaluacion.vista.fraseConfirmacion)
    return fallo("CONFIRMACION_INCORRECTA");
  return Object.freeze({ ok: true, historial: evaluacion.historial,
    simulacion: true, accesoOperativoHabilitado: false });
}
