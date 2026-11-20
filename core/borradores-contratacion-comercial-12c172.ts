/**
 * OPTIMA 12C.17.2 — Borradores comerciales LOCALES (simulación pura).
 *
 * No lee ni escribe Airtable. No firma ni aprueba contratos, NO activa servicios,
 * NO modifica permisos técnicos, NO genera ID_VERSION ni versiones persistentes.
 * Los datos de empresa/contrato entregados aquí NO son identidad autenticada:
 * antes de integrarlo a una API se deben obtener y verificar del lado servidor.
 *
 * Reutiliza el motor de 12C.12 y el simulador 12C.17.1: no inventa reglas
 * comerciales paralelas ni permite propuestas incompletas para validarlas.
 */
import type { ContratacionComercial } from "./reglas-comerciales.js";
import {
  compararPropuestasComerciales,
  simularPropuestaComercial,
  type CambioCobertura,
} from "./simulador-contratacion-comercial-12c17.js";
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

export type EstadoBorradorLocal = "BORRADOR" | "DESCARTADO_LOCAL";
export type BorradorContratacionLocal = Readonly<{
  idBorrador: string;
  empresaId: string;
  idContrato: string | null;
  /** Versión que observó el editor; no crea ni actualiza contratos reales. */
  versionBase: number | null;
  revisionLocal: number;
  estado: EstadoBorradorLocal;
  motivoCambio: string;
  creadoEnIso: string;
  actualizadoEnIso: string;
  serviciosBase: readonly ContratacionComercial[];
  serviciosPropuestos: readonly ContratacionComercial[];
  diferencias: readonly CambioCobertura[];
  simulacion: true;
  accesoOperativoHabilitado: false;
}>;

export type MotivoErrorBorrador =
  | "DATOS_INVALIDOS" | "CONFIGURACION_INVALIDA" | "BORRADOR_INVALIDO"
  | "EMPRESA_NO_COINCIDE" | "REVISION_DESACTUALIZADA"
  | "VERSION_BASE_DESACTUALIZADA" | "BORRADOR_DESCARTADO"
  | "FECHA_INVALIDA" | "SIN_CAMBIOS";

export type ResultadoBorradorLocal =
  | Readonly<{ ok: true; borrador: BorradorContratacionLocal; simulacion: true; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: MotivoErrorBorrador; errores: readonly string[];
      simulacion: true; accesoOperativoHabilitado: false }>;

function fallar(motivo: MotivoErrorBorrador, descripcion: string | readonly string[]): ResultadoBorradorLocal {
  return Object.freeze({ ok: false, motivo,
    errores: Object.freeze(typeof descripcion === "string" ? [descripcion] : [...descripcion]),
    simulacion: true, accesoOperativoHabilitado: false });
}
function registro(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function clavesExactas(v: Record<string, unknown>, claves: readonly string[]): boolean {
  return Object.keys(v).length === claves.length && claves.every(k => Object.hasOwn(v, k));
}
function empresaValida(v: unknown): v is string {
  return esIdEmpresaEstable(v);
}
function idBorradorValido(v: unknown): v is string {
  return typeof v === "string" && /^BOR-[A-Za-z0-9_-]{4,60}$/.test(v);
}
function idContratoValido(v: unknown): v is string | null {
  return v === null || typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(v);
}
function versionValida(v: unknown): v is number | null {
  return v === null || typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
}
function revisionValida(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
}
function fechaValida(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
    !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
}
function motivoValido(v: unknown): v is string {
  return typeof v === "string" && v === v.trim() && v.length >= 10 && v.length <= 500 &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v);
}
function coberturaIgual(valor: unknown, esperado: CambioCobertura["anterior"]): boolean {
  if (esperado === null) return valor === null;
  return registro(valor) && clavesExactas(valor, ["modalidad", "nivel"]) &&
    valor.modalidad === esperado.modalidad && valor.nivel === esperado.nivel;
}
function diferenciasIguales(valor: unknown, esperadas: readonly CambioCobertura[]): boolean {
  return Array.isArray(valor) && valor.length === esperadas.length &&
    esperadas.every((esperada, i) => {
      const dato: unknown = valor[i];
      return registro(dato) && clavesExactas(dato,
        ["submodulo", "modulo", "nombre", "anterior", "propuesta", "tipo"]) &&
        dato.submodulo === esperada.submodulo && dato.modulo === esperada.modulo &&
        dato.nombre === esperada.nombre && dato.tipo === esperada.tipo &&
        coberturaIgual(dato.anterior, esperada.anterior) &&
        coberturaIgual(dato.propuesta, esperada.propuesta);
    });
}
function contextoContratoValido(idContrato: unknown, versionBase: unknown): boolean {
  return idContratoValido(idContrato) && versionValida(versionBase) &&
    ((idContrato === null && versionBase === null) ||
     (typeof idContrato === "string" && typeof versionBase === "number"));
}
function copiarServicios(entrada: readonly ContratacionComercial[]): readonly ContratacionComercial[] {
  return Object.freeze(entrada.map(servicio => Object.freeze({ ...servicio })));
}
function construirDatos(
  valores: Omit<BorradorContratacionLocal, "simulacion" | "accesoOperativoHabilitado">,
): ResultadoBorradorLocal {
  const comparacion = compararPropuestasComerciales(valores.serviciosBase, valores.serviciosPropuestos);
  if (comparacion.ok === false) return fallar("CONFIGURACION_INVALIDA", comparacion.errores);
  const borrador: BorradorContratacionLocal = Object.freeze({
    idBorrador: valores.idBorrador, empresaId: valores.empresaId,
    idContrato: valores.idContrato, versionBase: valores.versionBase,
    revisionLocal: valores.revisionLocal, estado: valores.estado,
    motivoCambio: valores.motivoCambio,
    creadoEnIso: valores.creadoEnIso, actualizadoEnIso: valores.actualizadoEnIso,
    serviciosBase: copiarServicios(valores.serviciosBase),
    serviciosPropuestos: copiarServicios(valores.serviciosPropuestos),
    diferencias: Object.freeze(comparacion.cambios.map(c => Object.freeze({ ...c }))),
    simulacion: true,
    accesoOperativoHabilitado: false,
  });
  return Object.freeze({ ok: true, borrador, simulacion: true, accesoOperativoHabilitado: false });
}

/** Primer borrador de una contratación nueva o de una versión existente. */
export function crearBorradorComercialLocal(entrada: unknown): ResultadoBorradorLocal {
  const CLAVES = ["idBorrador", "empresaId", "idContrato", "versionBase", "serviciosBase",
    "serviciosPropuestos", "motivoCambio", "ahoraIso"];
  if (!registro(entrada) || !clavesExactas(entrada, CLAVES) ||
      !idBorradorValido(entrada.idBorrador) || !empresaValida(entrada.empresaId) ||
      !contextoContratoValido(entrada.idContrato, entrada.versionBase) ||
      !motivoValido(entrada.motivoCambio)) {
    return fallar("DATOS_INVALIDOS", "Identidad, versión, motivo o estructura del borrador inválidos");
  }
  if (!fechaValida(entrada.ahoraIso)) return fallar("FECHA_INVALIDA", "Fecha UTC inválida");
  const anterior = simularPropuestaComercial(entrada.serviciosBase);
  const propuesta = simularPropuestaComercial(entrada.serviciosPropuestos);
  if (anterior.ok === false || propuesta.ok === false) return fallar("CONFIGURACION_INVALIDA", [
    ...(anterior.ok === false ? anterior.errores.map(e => `Base: ${e}`) : []),
    ...(propuesta.ok === false ? propuesta.errores.map(e => `Propuesta: ${e}`) : []),
  ]);
  if (entrada.idContrato === null && anterior.propuesta.length > 0)
    return fallar("DATOS_INVALIDOS", "Un contrato nuevo no puede tener servicios previos");
  const comparacion = compararPropuestasComerciales(anterior.propuesta, propuesta.propuesta);
  if (comparacion.ok === false) return fallar("CONFIGURACION_INVALIDA", comparacion.errores);
  if (comparacion.sinCambios) return fallar("SIN_CAMBIOS", "La propuesta no cambia los servicios base");
  return construirDatos({
    idBorrador: entrada.idBorrador, empresaId: entrada.empresaId,
    idContrato: entrada.idContrato as string | null, versionBase: entrada.versionBase as number | null,
    revisionLocal: 1, estado: "BORRADOR", motivoCambio: entrada.motivoCambio,
    creadoEnIso: entrada.ahoraIso, actualizadoEnIso: entrada.ahoraIso,
    serviciosBase: anterior.propuesta, serviciosPropuestos: propuesta.propuesta,
    diferencias: comparacion.cambios,
  });
}

/**
 * Verificación de forma/consistencia, NO autenticación. Una API futura deberá
 * obtener el borrador de almacenamiento confiable y la empresa de la sesión.
 */
function verificarBorradorInterno(entrada: unknown): BorradorContratacionLocal | null {
  const KEYS = ["idBorrador", "empresaId", "idContrato", "versionBase", "revisionLocal", "estado",
    "motivoCambio", "creadoEnIso", "actualizadoEnIso", "serviciosBase", "serviciosPropuestos",
    "diferencias", "simulacion", "accesoOperativoHabilitado"];
  if (!registro(entrada) || !clavesExactas(entrada, KEYS) ||
      !idBorradorValido(entrada.idBorrador) || !empresaValida(entrada.empresaId) ||
      !contextoContratoValido(entrada.idContrato, entrada.versionBase) ||
      !revisionValida(entrada.revisionLocal) ||
      (entrada.estado !== "BORRADOR" && entrada.estado !== "DESCARTADO_LOCAL") ||
      !motivoValido(entrada.motivoCambio) || !fechaValida(entrada.creadoEnIso) ||
      !fechaValida(entrada.actualizadoEnIso) ||
      entrada.actualizadoEnIso < entrada.creadoEnIso ||
      entrada.simulacion !== true || entrada.accesoOperativoHabilitado !== false ||
      !Array.isArray(entrada.diferencias)) return null;
  const a = simularPropuestaComercial(entrada.serviciosBase);
  const b = simularPropuestaComercial(entrada.serviciosPropuestos);
  const cambios = compararPropuestasComerciales(entrada.serviciosBase, entrada.serviciosPropuestos);
  if (!a.ok || !b.ok || !cambios.ok || cambios.sinCambios ||
       !diferenciasIguales(entrada.diferencias, cambios.cambios)) return null;
  if (entrada.idContrato === null && a.propuesta.length > 0) return null;
  return entrada as BorradorContratacionLocal;
}

export function actualizarBorradorComercialLocal(entrada: unknown): ResultadoBorradorLocal {
  const CLAVES = ["borrador", "empresaId", "revisionEsperada", "versionBaseEsperada",
    "serviciosPropuestos", "motivoCambio", "ahoraIso"];
  if (!registro(entrada) || !clavesExactas(entrada, CLAVES) || !empresaValida(entrada.empresaId) ||
      !revisionValida(entrada.revisionEsperada) || !versionValida(entrada.versionBaseEsperada) ||
      !motivoValido(entrada.motivoCambio))
    return fallar("DATOS_INVALIDOS", "Solicitud de revisión inválida");
  const previo = verificarBorradorInterno(entrada.borrador);
  if (!previo) return fallar("BORRADOR_INVALIDO", "Borrador local no verificable");
  if (entrada.empresaId !== previo.empresaId)
    return fallar("EMPRESA_NO_COINCIDE", "No corresponde a la empresa del borrador");
  if (entrada.revisionEsperada !== previo.revisionLocal)
    return fallar("REVISION_DESACTUALIZADA", "El borrador cambió desde la última lectura");
  if (previo.revisionLocal === Number.MAX_SAFE_INTEGER)
    return fallar("BORRADOR_INVALIDO", "La revisión local excede el límite permitido");
  if (entrada.versionBaseEsperada !== previo.versionBase)
    return fallar("VERSION_BASE_DESACTUALIZADA", "La versión contractual observada cambió");
  if (previo.estado !== "BORRADOR")
    return fallar("BORRADOR_DESCARTADO", "No se puede modificar un borrador descartado");
  if (!fechaValida(entrada.ahoraIso) || entrada.ahoraIso < previo.actualizadoEnIso)
    return fallar("FECHA_INVALIDA", "Fecha UTC anterior o inválida");
  const propuesta = simularPropuestaComercial(entrada.serviciosPropuestos);
  if (propuesta.ok === false) return fallar("CONFIGURACION_INVALIDA", propuesta.errores);
  const cambiosPrevios = compararPropuestasComerciales(previo.serviciosPropuestos, propuesta.propuesta);
  if (cambiosPrevios.ok === false) return fallar("CONFIGURACION_INVALIDA", cambiosPrevios.errores);
  if (cambiosPrevios.sinCambios) return fallar("SIN_CAMBIOS", "No hay modificaciones para guardar");
  const resultadoFinal = compararPropuestasComerciales(previo.serviciosBase, propuesta.propuesta);
  if (resultadoFinal.ok === false) return fallar("CONFIGURACION_INVALIDA", resultadoFinal.errores);
  if (resultadoFinal.sinCambios) return fallar("SIN_CAMBIOS", "La propuesta vuelve al estado original; descartá el borrador");
  return construirDatos({
    ...previo, revisionLocal: previo.revisionLocal + 1, motivoCambio: entrada.motivoCambio,
    actualizadoEnIso: entrada.ahoraIso, serviciosPropuestos: propuesta.propuesta,
    diferencias: resultadoFinal.cambios,
  });
}

/** Descarta la simulación, sin anular, borrar o cambiar contratos reales. */
export function descartarBorradorComercialLocal(entrada: unknown): ResultadoBorradorLocal {
  const CLAVES = ["borrador", "empresaId", "revisionEsperada", "ahoraIso"];
  if (!registro(entrada) || !clavesExactas(entrada, CLAVES) ||
      !empresaValida(entrada.empresaId) || !revisionValida(entrada.revisionEsperada))
    return fallar("DATOS_INVALIDOS", "Solicitud de descarte inválida");
  const previo = verificarBorradorInterno(entrada.borrador);
  if (!previo) return fallar("BORRADOR_INVALIDO", "Borrador local no verificable");
  if (entrada.empresaId !== previo.empresaId)
    return fallar("EMPRESA_NO_COINCIDE", "No corresponde a la empresa del borrador");
  if (entrada.revisionEsperada !== previo.revisionLocal)
    return fallar("REVISION_DESACTUALIZADA", "El borrador cambió desde la última lectura");
  if (previo.revisionLocal === Number.MAX_SAFE_INTEGER)
    return fallar("BORRADOR_INVALIDO", "La revisión local excede el límite permitido");
  if (previo.estado !== "BORRADOR")
    return fallar("BORRADOR_DESCARTADO", "El borrador ya fue descartado");
  if (!fechaValida(entrada.ahoraIso) || entrada.ahoraIso < previo.actualizadoEnIso)
    return fallar("FECHA_INVALIDA", "Fecha UTC anterior o inválida");
  return construirDatos({ ...previo, estado: "DESCARTADO_LOCAL",
    revisionLocal: previo.revisionLocal + 1, actualizadoEnIso: entrada.ahoraIso });
}
