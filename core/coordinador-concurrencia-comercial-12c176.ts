/**
 * OPTIMA 12C.17.6 — Coordinador de concurrencia e idempotencia SOLO LOCAL.
 *
 * Coordina llamadas SINCRONICAS en una única instancia de Node, en memoria.
 * NO protege procesos distintos ni funciones serverless, NO es un CAS de BD,
 * NO persiste, NO firma auditorías, NO autentica personas, NO toca Airtable,
 * NO otorga permisos y NO sustituye una transacción durable.
 *
 * Integra las reglas reales del flujo simulado 12C.17.4 y los invariantes de
 * transición de 12C.17.5. Hash SHA-256 = detección de cambios accidentales,
 * NO prueba de autenticidad. El registro de rechazos debe diseñarse en backend.
 */
import { createHash } from "node:crypto";
import {
  confirmarCambioComercialLocal,
  type SolicitudCambioComercialLocal,
  type VistaPreviaComercialLocal,
  type MotivoFlujoComercialLocal,
} from "./flujo-confirmacion-comercial-12c174.js";
import {
  esHistorialComercialLocalValido,
  type HistorialContratacionSimulado,
} from "./historial-contratacion-comercial-12c173.js";
import { compararTransicionDeHistorialLocal } from "./proyeccion-persistencia-comercial-12c175.js";

export type OperacionConIdempotenciaLocal = Readonly<{
  claveIdempotencia: string;
  solicitud: SolicitudCambioComercialLocal;
  vistaPrevia: VistaPreviaComercialLocal;
  confirmacion: string;
}>;
export type RegistroAuditoriaComercialLocal = Readonly<{
  claveIdempotencia: string;
  huellaSolicitud: string;
  empresaId: string;
  idContrato: string;
  tipo: "APROBACION" | "ACTIVACION";
  idVersion: string;
  actorUsuarioId: string;
  fechaIso: string;
  revisionAntes: number;
  revisionDespues: number;
  huellaEstadoAntes: string;
  huellaEstadoDespues: string;
  huellaAnterior: string;
  huellaRegistro: string;
}>;
export type EstadoCoordinacionComercialLocal = Readonly<{
  empresaId: string;
  idContrato: string;
  historialInicial: HistorialContratacionSimulado;
  historialActual: HistorialContratacionSimulado;
  bitacora: readonly RegistroAuditoriaComercialLocal[];
  simulacion: true;
  auditoriaDurable: false;
  concurrenciaDistribuidaGarantizada: false;
  accesoOperativoHabilitado: false;
}>;
export type MotivoCoordinacionComercialLocal =
  | "DATOS_INVALIDOS" | "HISTORIAL_INVALIDO" | "EMPRESA_NO_COINCIDE"
  | "CONTRATO_NO_COINCIDE" | "REVISION_DESACTUALIZADA"
  | "SNAPSHOT_DESACTUALIZADO" | "CLAVE_REUTILIZADA_CON_CAMBIO"
  | "FLUJO_RECHAZADO" | "TRANSICION_INVALIDA" | "ERROR_INTEGRIDAD";
export type ResultadoOperacionCoordinadaLocal =
  | Readonly<{ ok: true; repetida: boolean; revisionAplicada: number;
      revisionActual: number; estado: EstadoCoordinacionComercialLocal;
      simulacion: true; auditoriaDurable: false; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: MotivoCoordinacionComercialLocal;
      causaFlujo?: MotivoFlujoComercialLocal;
      simulacion: true; auditoriaDurable: false; accesoOperativoHabilitado: false }>;
export type GestorCoordinacionComercialLocal = Readonly<{
  consultar: () => EstadoCoordinacionComercialLocal;
  ejecutar: (operacion: unknown) => ResultadoOperacionCoordinadaLocal;
}>;
export type ResultadoCreacionCoordinadorLocal =
  | Readonly<{ ok: true; gestor: GestorCoordinacionComercialLocal;
      simulacion: true; auditoriaDurable: false; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: "HISTORIAL_INVALIDO";
      simulacion: true; auditoriaDurable: false; accesoOperativoHabilitado: false }>;

const PATRON_CLAVE = /^OP-[A-Za-z0-9_-]{8,72}$/;
const PATRON_HUELLA = /^[a-f0-9]{64}$/;
const CAMPOS_OPERACION = ["claveIdempotencia", "solicitud", "vistaPrevia", "confirmacion"];
const CAMPOS_ESTADO = ["empresaId", "idContrato", "historialInicial", "historialActual", "bitacora",
  "simulacion", "auditoriaDurable", "concurrenciaDistribuidaGarantizada", "accesoOperativoHabilitado"];
const CAMPOS_REGISTRO = ["claveIdempotencia", "huellaSolicitud", "empresaId", "idContrato", "tipo",
  "idVersion", "actorUsuarioId", "fechaIso", "revisionAntes", "revisionDespues",
  "huellaEstadoAntes", "huellaEstadoDespues", "huellaAnterior", "huellaRegistro"];

function objeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function claves(v: Record<string, unknown>, esperadas: readonly string[]): boolean {
  return Object.keys(v).length === esperadas.length && esperadas.every(k => Object.hasOwn(v, k));
}
function copia<T>(v: T): T { return structuredClone(v); }
function fallo(motivo: MotivoCoordinacionComercialLocal,
  causaFlujo?: MotivoFlujoComercialLocal): ResultadoOperacionCoordinadaLocal {
  return Object.freeze({ ok: false, motivo, ...(causaFlujo ? { causaFlujo } : {}),
    simulacion: true, auditoriaDurable: false, accesoOperativoHabilitado: false });
}
/** JSON canónico acotado; solo objetos de datos, sin ciclos ni efectos externos. */
function canonico(valor: unknown, profundidad = 0, pila = new Set<object>()): string {
  if (profundidad > 24) throw Error("Profundidad excesiva");
  if (valor === null || typeof valor === "string" || typeof valor === "boolean") return JSON.stringify(valor);
  if (typeof valor === "number" && Number.isFinite(valor)) return JSON.stringify(valor);
  if (typeof valor !== "object") throw Error("Tipo no serializable");
  if (pila.has(valor)) throw Error("Referencia circular");
  const prototipo = Object.getPrototypeOf(valor);
  if (!Array.isArray(valor) && prototipo !== Object.prototype && prototipo !== null)
    throw Error("Objeto no plano");
  pila.add(valor);
  let salida: string;
  if (Array.isArray(valor)) {
    if (valor.length > 256) throw Error("Arreglo demasiado grande");
    salida = `[${valor.map(v => canonico(v, profundidad + 1, pila)).join(",")}]`;
  } else {
    const clavesOrdenadas = Object.keys(valor).sort();
    if (clavesOrdenadas.length > 256) throw Error("Demasiadas propiedades");
    salida = `{${clavesOrdenadas.map(k => `${JSON.stringify(k)}:${canonico((valor as Record<string, unknown>)[k], profundidad + 1, pila)}`).join(",")}}`;
  }
  pila.delete(valor);
  return salida;
}
function digest(v: unknown): string {
  const texto = canonico(v);
  if (texto.length > 250_000) throw Error("Datos excesivos");
  return createHash("sha256").update(texto).digest("hex");
}
function huellaRegistro(v: Omit<RegistroAuditoriaComercialLocal, "huellaRegistro">): string {
  return digest(v);
}
function estadoCopia(estado: EstadoCoordinacionComercialLocal): EstadoCoordinacionComercialLocal {
  return copia(estado);
}
function operacionValida(v: unknown): v is OperacionConIdempotenciaLocal {
  return objeto(v) && claves(v, CAMPOS_OPERACION) &&
    typeof v.claveIdempotencia === "string" && PATRON_CLAVE.test(v.claveIdempotencia) &&
    objeto(v.solicitud) && objeto(v.vistaPrevia) && typeof v.confirmacion === "string";
}

/**
 * Verificación de integridad de una bitácora en memoria / exportación JSON.
 * SHA-256 sin clave NO demuestra autenticidad ante un atacante con escritura.
 * Verifica que el registro coincida con los eventos comerciales ya validados.
 */
export function verificarIntegridadBitacoraComercialLocal(entrada: unknown): boolean {
  try {
    if (!objeto(entrada) || !claves(entrada, CAMPOS_ESTADO) ||
        entrada.simulacion !== true || entrada.auditoriaDurable !== false ||
        entrada.concurrenciaDistribuidaGarantizada !== false ||
        entrada.accesoOperativoHabilitado !== false ||
        !esHistorialComercialLocalValido(entrada.historialInicial) ||
        !esHistorialComercialLocalValido(entrada.historialActual) ||
        !Array.isArray(entrada.bitacora)) return false;
    const primero = entrada.historialInicial;
    const actual = entrada.historialActual;
    if (entrada.empresaId !== primero.empresaId || entrada.empresaId !== actual.empresaId ||
        entrada.idContrato !== primero.idContrato || entrada.idContrato !== actual.idContrato ||
        actual.revisionHistorial !== primero.revisionHistorial + entrada.bitacora.length ||
        actual.eventos.length !== primero.eventos.length + entrada.bitacora.length ||
        canonico(actual.eventos.slice(0, primero.eventos.length)) !== canonico(primero.eventos)) return false;
    let ultimaHuellaEstado = digest(primero);
    let ultimaHuellaRegistro = "GENESIS";
    const clavesVistas = new Set<string>();
    for (let i = 0; i < entrada.bitacora.length; i++) {
      const dato: unknown = entrada.bitacora[i];
      if (!objeto(dato) || !claves(dato, CAMPOS_REGISTRO) ||
          typeof dato.claveIdempotencia !== "string" || !PATRON_CLAVE.test(dato.claveIdempotencia) ||
          clavesVistas.has(dato.claveIdempotencia) ||
          typeof dato.huellaSolicitud !== "string" || !PATRON_HUELLA.test(dato.huellaSolicitud) ||
          typeof dato.huellaEstadoAntes !== "string" || !PATRON_HUELLA.test(dato.huellaEstadoAntes) ||
          typeof dato.huellaEstadoDespues !== "string" || !PATRON_HUELLA.test(dato.huellaEstadoDespues) ||
          typeof dato.huellaRegistro !== "string" || !PATRON_HUELLA.test(dato.huellaRegistro) ||
          dato.empresaId !== entrada.empresaId || dato.idContrato !== entrada.idContrato ||
          dato.huellaEstadoAntes !== ultimaHuellaEstado ||
          dato.huellaAnterior !== ultimaHuellaRegistro ||
          dato.revisionAntes !== primero.revisionHistorial + i ||
          dato.revisionDespues !== primero.revisionHistorial + i + 1 ||
          (dato.tipo !== "APROBACION" && dato.tipo !== "ACTIVACION") ||
          typeof dato.idVersion !== "string" || typeof dato.actorUsuarioId !== "string" ||
          typeof dato.fechaIso !== "string") return false;
      const evento = actual.eventos[primero.eventos.length + i];
      if (!evento || evento.tipo !== dato.tipo || evento.idVersion !== dato.idVersion ||
          evento.actorUsuarioId !== dato.actorUsuarioId || evento.fechaIso !== dato.fechaIso) return false;
      const { huellaRegistro: almacenada, ...sinHuella } = dato;
      if (huellaRegistro(sinHuella as Omit<RegistroAuditoriaComercialLocal, "huellaRegistro">) !== almacenada)
        return false;
      clavesVistas.add(dato.claveIdempotencia);
      ultimaHuellaEstado = dato.huellaEstadoDespues;
      ultimaHuellaRegistro = dato.huellaRegistro;
    }
    // Si el historial inicial ya tenía eventos, cada evento nuevo sigue representado.
    return ultimaHuellaEstado === digest(actual);
  } catch { return false; }
}

/**
 * Instancia local con serialización SINCRONICA. No compartir esto como un
 * repositorio persistente o como garantía en Vercel/serverless.
 */
export function crearCoordinadorConcurrenciaComercialLocal(historialInicial: unknown): ResultadoCreacionCoordinadorLocal {
  if (!esHistorialComercialLocalValido(historialInicial)) {
    return Object.freeze({ ok: false, motivo: "HISTORIAL_INVALIDO",
      simulacion: true, auditoriaDurable: false, accesoOperativoHabilitado: false });
  }
  const inicial = copia(historialInicial);
  let interno: EstadoCoordinacionComercialLocal = {
    empresaId: inicial.empresaId, idContrato: inicial.idContrato,
    historialInicial: inicial, historialActual: copia(inicial), bitacora: [],
    simulacion: true, auditoriaDurable: false,
    concurrenciaDistribuidaGarantizada: false, accesoOperativoHabilitado: false,
  };
  const gestor: GestorCoordinacionComercialLocal = Object.freeze({
    consultar: () => estadoCopia(interno),
    ejecutar: (entrada: unknown): ResultadoOperacionCoordinadaLocal => {
      if (!operacionValida(entrada)) return fallo("DATOS_INVALIDOS");
      let fingerprint: string;
      try { fingerprint = digest(entrada); } catch { return fallo("DATOS_INVALIDOS"); }
      if (!verificarIntegridadBitacoraComercialLocal(interno)) return fallo("ERROR_INTEGRIDAD");
      const repetida = interno.bitacora.find(r => r.claveIdempotencia === entrada.claveIdempotencia);
      if (repetida) {
        if (repetida.huellaSolicitud !== fingerprint) return fallo("CLAVE_REUTILIZADA_CON_CAMBIO");
        return Object.freeze({ ok: true, repetida: true, revisionAplicada: repetida.revisionDespues,
          revisionActual: interno.historialActual.revisionHistorial, estado: estadoCopia(interno),
          simulacion: true, auditoriaDurable: false, accesoOperativoHabilitado: false });
      }
      const solicitud = entrada.solicitud;
      if (solicitud.empresaId !== interno.empresaId) return fallo("EMPRESA_NO_COINCIDE");
      if (!objeto(solicitud.historial) || solicitud.historial.idContrato !== interno.idContrato)
        return fallo("CONTRATO_NO_COINCIDE");
      const actual = interno.historialActual;
      if (solicitud.revisionHistorialEsperada !== actual.revisionHistorial)
        return fallo("REVISION_DESACTUALIZADA");
      try {
        if (digest(solicitud.historial) !== digest(actual)) return fallo("SNAPSHOT_DESACTUALIZADO");
      } catch { return fallo("DATOS_INVALIDOS"); }
      const confirmado = confirmarCambioComercialLocal({
        solicitud, vistaPrevia: entrada.vistaPrevia, confirmacion: entrada.confirmacion,
      });
      if (!confirmado.ok) return fallo("FLUJO_RECHAZADO", confirmado.motivo);
      const siguiente = confirmado.historial;
      const comparacion = compararTransicionDeHistorialLocal({
        anterior: actual, siguiente, empresaId: interno.empresaId,
        revisionAnteriorEsperada: actual.revisionHistorial,
      });
      if (!comparacion.ok) return fallo("TRANSICION_INVALIDA");
      const ultimo = siguiente.eventos.at(-1)!;
      const anteriorHuella = interno.bitacora.at(-1)?.huellaRegistro ?? "GENESIS";
      const nuevoRegistro: Omit<RegistroAuditoriaComercialLocal, "huellaRegistro"> = {
        claveIdempotencia: entrada.claveIdempotencia, huellaSolicitud: fingerprint,
        empresaId: interno.empresaId, idContrato: interno.idContrato,
        tipo: ultimo.tipo, idVersion: ultimo.idVersion, actorUsuarioId: ultimo.actorUsuarioId,
        fechaIso: ultimo.fechaIso, revisionAntes: actual.revisionHistorial,
        revisionDespues: siguiente.revisionHistorial,
        huellaEstadoAntes: digest(actual), huellaEstadoDespues: digest(siguiente),
        huellaAnterior: anteriorHuella,
      };
      const proximo: EstadoCoordinacionComercialLocal = {
        ...interno, historialActual: copia(siguiente),
        bitacora: [...interno.bitacora, { ...nuevoRegistro, huellaRegistro: huellaRegistro(nuevoRegistro) }],
      };
      if (!verificarIntegridadBitacoraComercialLocal(proximo)) return fallo("ERROR_INTEGRIDAD");
      // Punto único de actualización en ESTA instancia sincrónica (no un CAS de BD).
      interno = proximo;
      return Object.freeze({ ok: true, repetida: false, revisionAplicada: siguiente.revisionHistorial,
        revisionActual: siguiente.revisionHistorial, estado: estadoCopia(interno),
        simulacion: true, auditoriaDurable: false, accesoOperativoHabilitado: false });
    },
  });
  return Object.freeze({ ok: true, gestor, simulacion: true,
    auditoriaDurable: false, accesoOperativoHabilitado: false });
}
