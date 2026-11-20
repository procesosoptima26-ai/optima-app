/**
 * OPTIMA 12C.17.5 — Modelo de PROYECCION de persistencia (NO ESCRIBE).
 *
 * Traduce snapshots comerciales simulados a una representación descriptiva
 * compatible con los nombres de campos presentes en CONTRATACIONES_OPTIMA.
 * No contiene fetch, token, API, mutaciones, ejecución de operaciones ni
 * mecanismos de acceso operativo. Nunca debe usarse como autorización.
 *
 * IMPORTANTÍSIMO: Airtable no proporciona aquí una transacción atómica que
 * cubra varias versiones, eventos y control de concurrencia (CAS). El hash
 * no es prueba de autenticidad ni un sustituto del CAS. El plan está SIEMPRE
 * bloqueado para escritura; la etapa futura requiere un diseño adicional.
 */
import { createHash } from "node:crypto";
import {
  esHistorialComercialLocalValido,
  type HistorialContratacionSimulado,
  type VersionContratacionSimulada,
} from "./historial-contratacion-comercial-12c173.js";
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

/** Nombre actual constatado en el esquema de Base Maestra. */
export const TABLA_PROYECCION_COMERCIAL = "CONTRATACIONES_OPTIMA" as const;
export const REQUISITOS_PREVIOS_A_ESCRITURA = Object.freeze([
  "CONTROL_ATOMICO_CONCURRENCIA",
  "IDEMPOTENCIA_DURABLE",
  "HISTORIAL_EVENTOS_DURABLE",
  "BORRADORES_DURABLES_SEPARADOS",
  "AUTORIZACION_REAL_DE_SESION",
  "AUDITORIA_Y_RECUPERACION_DE_FALLOS",
  "AISLAMIENTO_PREVIEW_PRODUCCION",
] as const);
export const DATOS_NO_REPRESENTADOS_EN_TABLA = Object.freeze([
  "REVISION_HISTORIAL",
  "EVENTOS_APROBACION_ACTIVACION",
  "SUSTITUIDA_POR_ID",
  "BORRADOR_EDITABLE",
] as const);

export type CamposContratacionProyectados = Readonly<{
  ID_VERSION: string;
  ID_CONTRATO: string;
  EMPRESA: readonly string[];
  VERSION: number;
  ESTADO: "APROBADA" | "VIGENTE" | "HISTORICA";
  SERVICIOS_CONTRATADOS: string;
  MOTIVO_CAMBIO: string;
  FECHA_APROBACION: string;
  APROBADO_POR_ID: string;
  VIGENTE_DESDE?: string;
  VIGENTE_HASTA?: string;
}>;
export type FilaContratacionProyectada = Readonly<{
  claveIdVersion: string;
  campos: CamposContratacionProyectados;
  /** No se inventa un ID rec... para filas que aún no se guardaron. */
  registroAirtableId: null;
}>;
export type EventoComercialProyectado = Readonly<{
  tipo: "APROBACION" | "ACTIVACION";
  idVersion: string;
  idVersionAnterior: string | null;
  actorUsuarioId: string;
  fechaIso: string;
}>;
export type ProyeccionPersistenciaComercial = Readonly<{
  tabla: typeof TABLA_PROYECCION_COMERCIAL;
  empresaId: string;
  idContrato: string;
  revisionLocalInformativa: number;
  huellaLocalInformativa: string;
  filas: readonly FilaContratacionProyectada[];
  eventosSinAlmacenDurable: readonly EventoComercialProyectado[];
  faltantesDeEsquema: typeof DATOS_NO_REPRESENTADOS_EN_TABLA;
  bloqueosParaEscritura: typeof REQUISITOS_PREVIOS_A_ESCRITURA;
  soloProyeccion: true;
  listoParaEscribir: false;
  accesoOperativoHabilitado: false;
}>;
export type MotivoProyeccion = "SOLICITUD_INVALIDA" | "HISTORIAL_INVALIDO" |
  "EMPRESA_NO_COINCIDE" | "REVISION_DESACTUALIZADA";
export type ResultadoProyeccion =
  | Readonly<{ ok: true; plan: ProyeccionPersistenciaComercial;
      soloProyeccion: true; listoParaEscribir: false; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: MotivoProyeccion;
      soloProyeccion: true; listoParaEscribir: false; accesoOperativoHabilitado: false }>;
export type MotivoComparacion = MotivoProyeccion | "CONTRATO_NO_COINCIDE" |
  "REVISION_NO_CONSECUTIVA" | "HISTORIAL_REESCRITO" | "TRANSICION_NO_PERMITIDA";
export type ResultadoComparacionProyeccion =
  | Readonly<{ ok: true; tipo: "APROBACION" | "ACTIVACION";
      nuevasVersiones: number; nuevasRevisiones: 1;
      soloProyeccion: true; listoParaEscribir: false; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: MotivoComparacion;
      soloProyeccion: true; listoParaEscribir: false; accesoOperativoHabilitado: false }>;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function clavesExactas(v: Record<string, unknown>, esperadas: readonly string[]): boolean {
  return Object.keys(v).length === esperadas.length && esperadas.every(k => Object.hasOwn(v, k));
}
function numeroRevision(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
function fallar(motivo: MotivoProyeccion): ResultadoProyeccion {
  return Object.freeze({ ok: false, motivo, soloProyeccion: true,
    listoParaEscribir: false, accesoOperativoHabilitado: false });
}
function fallarComparacion(motivo: MotivoComparacion): ResultadoComparacionProyeccion {
  return Object.freeze({ ok: false, motivo, soloProyeccion: true,
    listoParaEscribir: false, accesoOperativoHabilitado: false });
}
function camposVersion(v: VersionContratacionSimulada): CamposContratacionProyectados {
  return Object.freeze({
    ID_VERSION: v.idVersion,
    ID_CONTRATO: v.idContrato,
    EMPRESA: Object.freeze([v.empresaId]),
    VERSION: v.numero,
    ESTADO: v.estado,
    SERVICIOS_CONTRATADOS: JSON.stringify(v.servicios),
    MOTIVO_CAMBIO: v.motivoCambio,
    FECHA_APROBACION: v.aprobadoEnIso,
    APROBADO_POR_ID: v.aprobadoPorId,
    ...(v.vigenteDesdeIso === null ? {} : { VIGENTE_DESDE: v.vigenteDesdeIso }),
    ...(v.vigenteHastaIso === null ? {} : { VIGENTE_HASTA: v.vigenteHastaIso }),
  });
}
/**
 * Proyección documental para diseñar almacenamiento futuro.
 * Solamente acepta historial ya validado, empresa correcta y revisión actual.
 * Incluso si devuelve ok:true, el plan NO es una autorización de escritura.
 */
export function proyectarHistorialComercialParaPersistenciaLocal(entrada: unknown): ResultadoProyeccion {
  if (!esObjeto(entrada) || !clavesExactas(entrada, ["historial", "empresaId", "revisionEsperada"]) ||
      typeof entrada.empresaId !== "string" || !esIdEmpresaEstable(entrada.empresaId) ||
      !numeroRevision(entrada.revisionEsperada)) return fallar("SOLICITUD_INVALIDA");
  if (!esHistorialComercialLocalValido(entrada.historial)) return fallar("HISTORIAL_INVALIDO");
  const historial = entrada.historial;
  if (historial.empresaId !== entrada.empresaId) return fallar("EMPRESA_NO_COINCIDE");
  if (historial.revisionHistorial !== entrada.revisionEsperada) return fallar("REVISION_DESACTUALIZADA");
  const filas = Object.freeze(historial.versiones.map(v => Object.freeze({
    claveIdVersion: v.idVersion,
    registroAirtableId: null,
    campos: camposVersion(v),
  })));
  const eventos = Object.freeze(historial.eventos.map(e => Object.freeze({
    tipo: e.tipo, idVersion: e.idVersion, idVersionAnterior: e.idVersionAnterior,
    actorUsuarioId: e.actorUsuarioId, fechaIso: e.fechaIso,
  })));
  const huellaLocalInformativa = createHash("sha256").update(JSON.stringify({
    empresaId: historial.empresaId,
    idContrato: historial.idContrato,
    revision: historial.revisionHistorial,
    filas,
    eventos,
  })).digest("hex");
  const plan: ProyeccionPersistenciaComercial = Object.freeze({
    tabla: TABLA_PROYECCION_COMERCIAL,
    empresaId: historial.empresaId,
    idContrato: historial.idContrato,
    revisionLocalInformativa: historial.revisionHistorial,
    huellaLocalInformativa,
    filas,
    eventosSinAlmacenDurable: eventos,
    faltantesDeEsquema: DATOS_NO_REPRESENTADOS_EN_TABLA,
    bloqueosParaEscritura: REQUISITOS_PREVIOS_A_ESCRITURA,
    soloProyeccion: true,
    listoParaEscribir: false,
    accesoOperativoHabilitado: false,
  });
  return Object.freeze({ ok: true, plan, soloProyeccion: true,
    listoParaEscribir: false, accesoOperativoHabilitado: false });
}

/**
 * Comprueba que una simulación nueva sea una transición de UN paso desde el
 * historial anterior, sin reescritura de hechos (preparación conceptual CAS).
 * NO compara con Airtable: ambos snapshots son datos locales de prueba.
 */
export function compararTransicionDeHistorialLocal(entrada: unknown): ResultadoComparacionProyeccion {
  if (!esObjeto(entrada) || !clavesExactas(entrada,
      ["anterior", "siguiente", "empresaId", "revisionAnteriorEsperada"]) ||
      typeof entrada.empresaId !== "string" || !esIdEmpresaEstable(entrada.empresaId) ||
      !numeroRevision(entrada.revisionAnteriorEsperada)) return fallarComparacion("SOLICITUD_INVALIDA");
  if (!esHistorialComercialLocalValido(entrada.anterior) ||
      !esHistorialComercialLocalValido(entrada.siguiente)) return fallarComparacion("HISTORIAL_INVALIDO");
  const previo: HistorialContratacionSimulado = entrada.anterior;
  const nuevo: HistorialContratacionSimulado = entrada.siguiente;
  if (previo.empresaId !== entrada.empresaId || nuevo.empresaId !== entrada.empresaId)
    return fallarComparacion("EMPRESA_NO_COINCIDE");
  if (previo.idContrato !== nuevo.idContrato) return fallarComparacion("CONTRATO_NO_COINCIDE");
  if (previo.revisionHistorial !== entrada.revisionAnteriorEsperada)
    return fallarComparacion("REVISION_DESACTUALIZADA");
  if (nuevo.revisionHistorial !== previo.revisionHistorial + 1 ||
      nuevo.eventos.length !== previo.eventos.length + 1)
    return fallarComparacion("REVISION_NO_CONSECUTIVA");
  for (let i = 0; i < previo.eventos.length; i++) {
    if (JSON.stringify(previo.eventos[i]) !== JSON.stringify(nuevo.eventos[i]))
      return fallarComparacion("HISTORIAL_REESCRITO");
  }
  if (nuevo.versiones.length < previo.versiones.length || nuevo.versiones.length > previo.versiones.length + 1)
    return fallarComparacion("HISTORIAL_REESCRITO");
  for (let i = 0; i < previo.versiones.length; i++) {
    const antes = previo.versiones[i];
    const despues = nuevo.versiones[i];
    const datosInmutables = ["idVersion", "numero", "empresaId", "idContrato", "servicios",
      "motivoCambio", "aprobadoPorId", "aprobadoEnIso"] as const;
    if (!despues || datosInmutables.some(k => JSON.stringify(antes[k]) !== JSON.stringify(despues[k])))
      return fallarComparacion("HISTORIAL_REESCRITO");
    const sinCambios = JSON.stringify(antes) === JSON.stringify(despues);
    if (sinCambios) continue;
    const activada = antes.estado === "APROBADA" && despues.estado === "VIGENTE" &&
      antes.vigenteDesdeIso === null && antes.vigenteHastaIso === null &&
      despues.vigenteDesdeIso !== null && despues.vigenteHastaIso === null &&
      despues.sustituidaPorId === null;
    const archivada = antes.estado === "VIGENTE" && despues.estado === "HISTORICA" &&
      antes.vigenteDesdeIso === despues.vigenteDesdeIso && antes.vigenteHastaIso === null &&
      despues.vigenteHastaIso !== null && despues.sustituidaPorId !== null;
    if (!activada && !archivada) return fallarComparacion("TRANSICION_NO_PERMITIDA");
  }
  const ultimoEvento = nuevo.eventos[nuevo.eventos.length - 1];
  if (ultimoEvento.tipo === "APROBACION") {
    if (nuevo.versiones.length !== previo.versiones.length + 1 ||
        nuevo.versiones[nuevo.versiones.length - 1].estado !== "APROBADA")
      return fallarComparacion("TRANSICION_NO_PERMITIDA");
  } else if (nuevo.versiones.length !== previo.versiones.length ||
             nuevo.versiones.find(v => v.idVersion === ultimoEvento.idVersion)?.estado !== "VIGENTE") {
    return fallarComparacion("TRANSICION_NO_PERMITIDA");
  }
  return Object.freeze({ ok: true, tipo: ultimoEvento.tipo,
    nuevasVersiones: nuevo.versiones.length - previo.versiones.length,
    nuevasRevisiones: 1, soloProyeccion: true,
    listoParaEscribir: false, accesoOperativoHabilitado: false });
}
