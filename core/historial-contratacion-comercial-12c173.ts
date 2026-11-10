/**
 * OPTIMA 12C.17.3 — Versiones e historial comercial SIMULADOS, en memoria.
 *
 * Propuesta -> aprobación simulada -> activación simulada, en pasos separados.
 * No hay red, persistencia, autenticación, Airtable ni modificación de permisos.
 * Los IDs de empresa y actor son etiquetas de simulación, NO identidad verificada.
 * Una API futura deberá obtener actor/empresa de la sesión, verificar autoridad,
 * usar operaciones atómicas y registrar auditoría durable antes de habilitar nada.
 *
 * Estados simulados: APROBADA, VIGENTE, HISTORICA. Suspensión, finalización
 * y anulación reales quedan fuera de alcance; ninguna baja borra el historial.
 */
import type { ContratacionComercial } from "./reglas-comerciales.js";
import {
  crearBorradorComercialLocal,
  type BorradorContratacionLocal,
} from "./borradores-contratacion-comercial-12c172.js";
import {
  compararPropuestasComerciales,
  simularPropuestaComercial,
} from "./simulador-contratacion-comercial-12c17.js";

export type EstadoVersionSimulada = "APROBADA" | "VIGENTE" | "HISTORICA";
export type VersionContratacionSimulada = Readonly<{
  idVersion: string;
  numero: number;
  idContrato: string;
  empresaId: string;
  estado: EstadoVersionSimulada;
  servicios: readonly ContratacionComercial[];
  motivoCambio: string;
  aprobadoPorId: string;
  aprobadoEnIso: string;
  vigenteDesdeIso: string | null;
  vigenteHastaIso: string | null;
  sustituidaPorId: string | null;
}>;
export type EventoHistorialSimulado = Readonly<{
  tipo: "APROBACION" | "ACTIVACION";
  idVersion: string;
  idVersionAnterior: string | null;
  actorUsuarioId: string;
  fechaIso: string;
}>;
export type HistorialContratacionSimulado = Readonly<{
  empresaId: string;
  idContrato: string;
  /** Contador de revisión en memoria: NO reemplaza un CAS transaccional en BD. */
  revisionHistorial: number;
  versiones: readonly VersionContratacionSimulada[];
  eventos: readonly EventoHistorialSimulado[];
  simulacion: true;
  accesoOperativoHabilitado: false;
}>;
export type ErrorHistorialSimulado =
  | "DATOS_INVALIDOS" | "HISTORIAL_INVALIDO" | "BORRADOR_INVALIDO"
  | "EMPRESA_NO_COINCIDE" | "CONTRATO_NO_COINCIDE"
  | "REVISION_DESACTUALIZADA" | "VERSION_BASE_DESACTUALIZADA"
  | "VERSION_PENDIENTE" | "VERSION_NO_ENCONTRADA" | "ESTADO_INVALIDO"
  | "FECHA_INVALIDA" | "SERVICIOS_INVALIDOS";
export type ResultadoHistorialSimulado =
  | Readonly<{ ok: true; historial: HistorialContratacionSimulado;
      simulacion: true; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: ErrorHistorialSimulado;
      simulacion: true; accesoOperativoHabilitado: false }>;
export type ResultadoVigenciaSimulada =
  | Readonly<{ ok: true; version: VersionContratacionSimulada | null;
      simulacion: true; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: ErrorHistorialSimulado;
      simulacion: true; accesoOperativoHabilitado: false }>;

const ID_EMPRESA = /^rec[A-Za-z0-9]{14}$/;
const ID_CONTRATO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const ID_VERSION = /^VER-[A-Za-z0-9_-]{4,60}$/;
const CLAVES_HISTORIAL = ["empresaId", "idContrato", "revisionHistorial", "versiones", "eventos", "simulacion", "accesoOperativoHabilitado"];
const CLAVES_VERSION = ["idVersion", "numero", "idContrato", "empresaId", "estado", "servicios", "motivoCambio", "aprobadoPorId", "aprobadoEnIso", "vigenteDesdeIso", "vigenteHastaIso", "sustituidaPorId"];
const CLAVES_EVENTO = ["tipo", "idVersion", "idVersionAnterior", "actorUsuarioId", "fechaIso"];
const CLAVES_BORRADOR = ["idBorrador", "empresaId", "idContrato", "versionBase", "revisionLocal", "estado", "motivoCambio", "creadoEnIso", "actualizadoEnIso", "serviciosBase", "serviciosPropuestos", "diferencias", "simulacion", "accesoOperativoHabilitado"];

function objeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function claves(v: Record<string, unknown>, esperadas: readonly string[]): boolean {
  return Object.keys(v).length === esperadas.length && esperadas.every(k => Object.hasOwn(v, k));
}
function iso(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
    !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
}
function motivo(v: unknown): v is string {
  return typeof v === "string" && v === v.trim() && v.length >= 10 && v.length <= 500 &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v);
}
function fallo(motivo: ErrorHistorialSimulado): ResultadoHistorialSimulado {
  return Object.freeze({ ok: false, motivo, simulacion: true, accesoOperativoHabilitado: false });
}
function falloLectura(motivo: ErrorHistorialSimulado): ResultadoVigenciaSimulada {
  return Object.freeze({ ok: false, motivo, simulacion: true, accesoOperativoHabilitado: false });
}
function copiarServicios(entrada: readonly ContratacionComercial[]): readonly ContratacionComercial[] {
  return Object.freeze(entrada.map(s => Object.freeze({ ...s })));
}
function copiarVersion(v: VersionContratacionSimulada): VersionContratacionSimulada {
  return Object.freeze({ ...v, servicios: copiarServicios(v.servicios) });
}
function nuevoEstado(
  anterior: HistorialContratacionSimulado,
  versiones: readonly VersionContratacionSimulada[],
  evento: EventoHistorialSimulado,
): ResultadoHistorialSimulado {
  const historial: HistorialContratacionSimulado = Object.freeze({
    empresaId: anterior.empresaId, idContrato: anterior.idContrato,
    revisionHistorial: anterior.revisionHistorial + 1,
    versiones: Object.freeze(versiones.map(copiarVersion)),
    eventos: Object.freeze([...anterior.eventos.map(e => Object.freeze({ ...e })), Object.freeze({ ...evento })]),
    simulacion: true, accesoOperativoHabilitado: false,
  });
  return Object.freeze({ ok: true, historial, simulacion: true, accesoOperativoHabilitado: false });
}
function serviciosValidos(v: unknown): v is readonly ContratacionComercial[] {
  if (!Array.isArray(v)) return false;
  const r = simularPropuestaComercial(v);
  return r.ok && JSON.stringify(r.propuesta) === JSON.stringify(v);
}
/** Comprueba invariantes de historial, sin conferir identidad ni autenticidad. */
export function esHistorialComercialLocalValido(valor: unknown): valor is HistorialContratacionSimulado {
  if (!objeto(valor) || !claves(valor, CLAVES_HISTORIAL) ||
      typeof valor.empresaId !== "string" || !ID_EMPRESA.test(valor.empresaId) ||
      typeof valor.idContrato !== "string" || !ID_CONTRATO.test(valor.idContrato) ||
      typeof valor.revisionHistorial !== "number" || !Number.isSafeInteger(valor.revisionHistorial) ||
      valor.revisionHistorial < 0 || !Array.isArray(valor.versiones) ||
      !Array.isArray(valor.eventos) || valor.revisionHistorial !== valor.eventos.length ||
      valor.simulacion !== true || valor.accesoOperativoHabilitado !== false) return false;
  const versiones = valor.versiones as unknown[];
  const eventos = valor.eventos as unknown[];
  if (eventos.length > 2 * versiones.length) return false;
  const ids = new Set<string>();
  let vigentes = 0, pendientes = 0;
  const porId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < versiones.length; i++) {
    const v = versiones[i];
    if (!objeto(v) || !claves(v, CLAVES_VERSION) ||
        typeof v.idVersion !== "string" || !ID_VERSION.test(v.idVersion) || ids.has(v.idVersion) ||
        v.numero !== i + 1 || v.empresaId !== valor.empresaId || v.idContrato !== valor.idContrato ||
        !serviciosValidos(v.servicios) || !Array.isArray(v.servicios) || v.servicios.length === 0 ||
        !motivo(v.motivoCambio) || typeof v.aprobadoPorId !== "string" || !ID_EMPRESA.test(v.aprobadoPorId) ||
        !iso(v.aprobadoEnIso)) return false;
    ids.add(v.idVersion);
    porId.set(v.idVersion, v);
    if (v.estado === "APROBADA") {
      if (i !== versiones.length - 1 || v.vigenteDesdeIso !== null || v.vigenteHastaIso !== null ||
          v.sustituidaPorId !== null) return false;
      pendientes++;
    } else if (v.estado === "VIGENTE") {
      if (!iso(v.vigenteDesdeIso) || v.vigenteDesdeIso < v.aprobadoEnIso ||
          v.vigenteHastaIso !== null || v.sustituidaPorId !== null) return false;
      vigentes++;
    } else if (v.estado === "HISTORICA") {
      if (!iso(v.vigenteDesdeIso) || !iso(v.vigenteHastaIso) ||
          v.vigenteDesdeIso < v.aprobadoEnIso || v.vigenteHastaIso < v.vigenteDesdeIso ||
          typeof v.sustituidaPorId !== "string" || !ID_VERSION.test(v.sustituidaPorId)) return false;
    } else return false;
  }
  if (vigentes > 1 || pendientes > 1) return false;
  if (versiones.length > 0 && vigentes + pendientes === 0) return false;
  // Una versión histórica debe apuntar a su sucesora activada, no a sí misma.
  for (const v of versiones) {
    if (!objeto(v) || v.estado !== "HISTORICA") continue;
    const sucesora = porId.get(String(v.sustituidaPorId));
    if (!sucesora || typeof sucesora.numero !== "number" || sucesora.numero <= Number(v.numero) ||
        (sucesora.estado !== "VIGENTE" && sucesora.estado !== "HISTORICA") ||
        sucesora.vigenteDesdeIso !== v.vigenteHastaIso) return false;
  }
  const esperados: Array<{ tipo: "APROBACION" | "ACTIVACION"; idVersion: string; idVersionAnterior: string | null; actorUsuarioId: string; fechaIso: string }> = [];
  // Consistencia eventos/estado: cada versión se aprobó y opcionalmente activó.
  for (const v of versiones) {
    if (!objeto(v)) return false;
    esperados.push({ tipo: "APROBACION", idVersion: String(v.idVersion), idVersionAnterior: null,
      actorUsuarioId: String(v.aprobadoPorId), fechaIso: String(v.aprobadoEnIso) });
    if (v.estado !== "APROBADA") {
      const previa = versiones.find(x => objeto(x) && x.sustituidaPorId === v.idVersion);
      esperados.push({ tipo: "ACTIVACION", idVersion: String(v.idVersion),
        idVersionAnterior: previa && objeto(previa) ? String(previa.idVersion) : null,
        actorUsuarioId: "", fechaIso: String(v.vigenteDesdeIso) });
    }
  }
  if (esperados.length !== eventos.length) return false;
  // Orden de eventos puede intercalarse entre aprobaciones y activaciones;
  // para cada versión debe haber exactamente un evento de cada tipo esperado.
  const indice = new Set<string>();
  let fechaAnterior = "";
  for (const e of eventos) {
    if (!objeto(e) || !claves(e, CLAVES_EVENTO) ||
        (e.tipo !== "APROBACION" && e.tipo !== "ACTIVACION") ||
        typeof e.idVersion !== "string" || !porId.has(e.idVersion) ||
        typeof e.actorUsuarioId !== "string" || !ID_EMPRESA.test(e.actorUsuarioId) || !iso(e.fechaIso) ||
        e.fechaIso < fechaAnterior) return false;
    fechaAnterior = e.fechaIso;
    const clave = `${e.idVersion}|${e.tipo}`;
    if (indice.has(clave)) return false;
    indice.add(clave);
    const version = porId.get(e.idVersion)!;
    if (e.tipo === "APROBACION") {
      if (e.actorUsuarioId !== version.aprobadoPorId || e.fechaIso !== version.aprobadoEnIso ||
          e.idVersionAnterior !== null) return false;
    } else if (e.fechaIso !== version.vigenteDesdeIso ||
        (e.idVersionAnterior !== null && typeof e.idVersionAnterior !== "string")) return false;
  }
  for (const esperado of esperados) {
    if (!indice.has(`${esperado.idVersion}|${esperado.tipo}`)) return false;
    if (esperado.tipo === "ACTIVACION") {
      const real = eventos.find(e => objeto(e) && e.tipo === "ACTIVACION" && e.idVersion === esperado.idVersion);
      if (!objeto(real) || real.idVersionAnterior !== esperado.idVersionAnterior) return false;
    }
  }
  return true;
}

/** Crea un registro de simulación vacío: no crea filas reales en Airtable. */
export function iniciarHistorialComercialLocal(entrada: unknown): ResultadoHistorialSimulado {
  if (!objeto(entrada) || !claves(entrada, ["empresaId", "idContrato"]) ||
      typeof entrada.empresaId !== "string" || !ID_EMPRESA.test(entrada.empresaId) ||
      typeof entrada.idContrato !== "string" || !ID_CONTRATO.test(entrada.idContrato))
    return fallo("DATOS_INVALIDOS");
  const historial: HistorialContratacionSimulado = Object.freeze({
    empresaId: entrada.empresaId, idContrato: entrada.idContrato, revisionHistorial: 0,
    versiones: Object.freeze([]), eventos: Object.freeze([]),
    simulacion: true, accesoOperativoHabilitado: false,
  });
  return Object.freeze({ ok: true, historial, simulacion: true, accesoOperativoHabilitado: false });
}

function borradorValido(v: unknown): v is BorradorContratacionLocal {
  if (!objeto(v) || !claves(v, CLAVES_BORRADOR) || v.estado !== "BORRADOR" ||
      v.simulacion !== true || v.accesoOperativoHabilitado !== false ||
      typeof v.revisionLocal !== "number" || !Number.isSafeInteger(v.revisionLocal) ||
      v.revisionLocal < 1 || !iso(v.creadoEnIso) || !iso(v.actualizadoEnIso) ||
      v.actualizadoEnIso < v.creadoEnIso || !motivo(v.motivoCambio)) return false;
  // Se vuelve a validar la propuesta completa y las diferencias de cobertura.
  const recreado = crearBorradorComercialLocal({
    idBorrador: v.idBorrador, empresaId: v.empresaId, idContrato: v.idContrato,
    versionBase: v.versionBase, serviciosBase: v.serviciosBase,
    serviciosPropuestos: v.serviciosPropuestos, motivoCambio: v.motivoCambio,
    ahoraIso: v.creadoEnIso,
  });
  return recreado.ok && JSON.stringify(recreado.borrador.diferencias) === JSON.stringify(v.diferencias) &&
    JSON.stringify(recreado.borrador.serviciosPropuestos) === JSON.stringify(v.serviciosPropuestos) &&
    JSON.stringify(recreado.borrador.serviciosBase) === JSON.stringify(v.serviciosBase);
}

/** Aprueba en memoria; NO activa, publica ni autoriza servicios. */
export function aprobarBorradorComercialLocal(entrada: unknown): ResultadoHistorialSimulado {
  const REQUERIDAS = ["historial", "borrador", "empresaId", "actorUsuarioId", "idVersion", "revisionHistorialEsperada", "ahoraIso"];
  if (!objeto(entrada) || !claves(entrada, REQUERIDAS) ||
      typeof entrada.empresaId !== "string" || !ID_EMPRESA.test(entrada.empresaId) ||
      typeof entrada.actorUsuarioId !== "string" || !ID_EMPRESA.test(entrada.actorUsuarioId) ||
      typeof entrada.idVersion !== "string" || !ID_VERSION.test(entrada.idVersion) ||
      typeof entrada.revisionHistorialEsperada !== "number" || !Number.isSafeInteger(entrada.revisionHistorialEsperada) ||
      entrada.revisionHistorialEsperada < 0) return fallo("DATOS_INVALIDOS");
  const h = entrada.historial;
  if (!esHistorialComercialLocalValido(h)) return fallo("HISTORIAL_INVALIDO");
  if (entrada.empresaId !== h.empresaId) return fallo("EMPRESA_NO_COINCIDE");
  if (entrada.revisionHistorialEsperada !== h.revisionHistorial) return fallo("REVISION_DESACTUALIZADA");
  if (!borradorValido(entrada.borrador)) return fallo("BORRADOR_INVALIDO");
  const b = entrada.borrador;
  if (b.empresaId !== h.empresaId) return fallo("EMPRESA_NO_COINCIDE");
  if (b.idContrato !== null && b.idContrato !== h.idContrato) return fallo("CONTRATO_NO_COINCIDE");
  if ((h.versiones.length === 0 && (b.idContrato !== null || b.versionBase !== null)) ||
      (h.versiones.length > 0 && (b.idContrato !== h.idContrato || b.versionBase === null)))
    return fallo("VERSION_BASE_DESACTUALIZADA");
  if (h.versiones.some(v => v.idVersion === entrada.idVersion)) return fallo("DATOS_INVALIDOS");
  if (h.versiones.some(v => v.estado === "APROBADA")) return fallo("VERSION_PENDIENTE");
  const activa = h.versiones.find(v => v.estado === "VIGENTE") ?? null;
  if (h.versiones.length > 0 && (!activa || b.versionBase !== activa.numero))
    return fallo("VERSION_BASE_DESACTUALIZADA");
  const iguales = compararPropuestasComerciales(activa?.servicios ?? [], b.serviciosBase);
  if (!iguales.ok || !iguales.sinCambios) return fallo("VERSION_BASE_DESACTUALIZADA");
  if (b.serviciosPropuestos.length === 0) return fallo("SERVICIOS_INVALIDOS");
  if (!iso(entrada.ahoraIso) || entrada.ahoraIso < b.actualizadoEnIso ||
      (h.eventos.length > 0 && entrada.ahoraIso < h.eventos[h.eventos.length - 1].fechaIso))
    return fallo("FECHA_INVALIDA");
  if (h.versiones.length >= Number.MAX_SAFE_INTEGER || h.revisionHistorial === Number.MAX_SAFE_INTEGER)
    return fallo("HISTORIAL_INVALIDO");
  const version: VersionContratacionSimulada = Object.freeze({
    idVersion: entrada.idVersion, numero: h.versiones.length + 1, empresaId: h.empresaId,
    idContrato: h.idContrato, estado: "APROBADA", servicios: copiarServicios(b.serviciosPropuestos),
    motivoCambio: b.motivoCambio, aprobadoPorId: entrada.actorUsuarioId,
    aprobadoEnIso: entrada.ahoraIso, vigenteDesdeIso: null, vigenteHastaIso: null,
    sustituidaPorId: null,
  });
  return nuevoEstado(h, [...h.versiones, version], {
    tipo: "APROBACION", idVersion: version.idVersion, idVersionAnterior: null,
    actorUsuarioId: entrada.actorUsuarioId, fechaIso: entrada.ahoraIso,
  });
}

/** Activa *solo la simulación*; la versión anterior pasa a HISTORICA. */
export function activarVersionComercialLocal(entrada: unknown): ResultadoHistorialSimulado {
  const REQUERIDAS = ["historial", "empresaId", "actorUsuarioId", "idVersion", "revisionHistorialEsperada", "ahoraIso"];
  if (!objeto(entrada) || !claves(entrada, REQUERIDAS) ||
      typeof entrada.empresaId !== "string" || !ID_EMPRESA.test(entrada.empresaId) ||
      typeof entrada.actorUsuarioId !== "string" || !ID_EMPRESA.test(entrada.actorUsuarioId) ||
      typeof entrada.idVersion !== "string" || !ID_VERSION.test(entrada.idVersion) ||
      typeof entrada.revisionHistorialEsperada !== "number" || !Number.isSafeInteger(entrada.revisionHistorialEsperada) ||
      entrada.revisionHistorialEsperada < 0) return fallo("DATOS_INVALIDOS");
  const h = entrada.historial;
  if (!esHistorialComercialLocalValido(h)) return fallo("HISTORIAL_INVALIDO");
  if (entrada.empresaId !== h.empresaId) return fallo("EMPRESA_NO_COINCIDE");
  if (entrada.revisionHistorialEsperada !== h.revisionHistorial) return fallo("REVISION_DESACTUALIZADA");
  const v = h.versiones.find(x => x.idVersion === entrada.idVersion);
  if (!v) return fallo("VERSION_NO_ENCONTRADA");
  if (v.estado !== "APROBADA") return fallo("ESTADO_INVALIDO");
  if (!iso(entrada.ahoraIso) || entrada.ahoraIso < v.aprobadoEnIso ||
      (h.eventos.length > 0 && entrada.ahoraIso < h.eventos[h.eventos.length - 1].fechaIso))
    return fallo("FECHA_INVALIDA");
  if (h.revisionHistorial === Number.MAX_SAFE_INTEGER) return fallo("HISTORIAL_INVALIDO");
  const anterior = h.versiones.find(x => x.estado === "VIGENTE") ?? null;
  const fechaActivacion = entrada.ahoraIso as string;
  const versiones = h.versiones.map(x => {
    if (x.idVersion === v.idVersion) return { ...x, estado: "VIGENTE" as const, vigenteDesdeIso: fechaActivacion };
    if (x.estado === "VIGENTE") return { ...x, estado: "HISTORICA" as const,
      vigenteHastaIso: fechaActivacion, sustituidaPorId: v.idVersion };
    return x;
  });
  return nuevoEstado(h, versiones, {
    tipo: "ACTIVACION", idVersion: v.idVersion, idVersionAnterior: anterior?.idVersion ?? null,
    actorUsuarioId: entrada.actorUsuarioId, fechaIso: entrada.ahoraIso,
  });
}

/** Lectura local para presentar el estado; jamás es un guard de API. */
export function consultarVersionVigenteLocal(entrada: unknown): ResultadoVigenciaSimulada {
  if (!objeto(entrada) || !claves(entrada, ["historial", "empresaId"]) ||
      typeof entrada.empresaId !== "string" || !ID_EMPRESA.test(entrada.empresaId))
    return falloLectura("DATOS_INVALIDOS");
  if (!esHistorialComercialLocalValido(entrada.historial)) return falloLectura("HISTORIAL_INVALIDO");
  const h = entrada.historial;
  if (entrada.empresaId !== h.empresaId) return falloLectura("EMPRESA_NO_COINCIDE");
  const actual = h.versiones.find(v => v.estado === "VIGENTE") ?? null;
  return Object.freeze({ ok: true, version: actual ? copiarVersion(actual) : null,
    simulacion: true, accesoOperativoHabilitado: false });
}
