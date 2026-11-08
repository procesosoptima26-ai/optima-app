/**
 * OPTIMA 12C.15.1 — Puente de SOLO LECTURA entre contexto Core y contrato vigente.
 *
 * No modifica tablas, no activa módulos, no concede permisos, no llama a
 * puedeRealizarAccion y NO está conectado a las API operativas.
 *
 * PRECONDICIONES para una futura integración:
 * - contexto proviene exclusivamente de una sesión verificada por el servidor;
 * - configuración de Airtable y catálogo provienen del servidor;
 * - el resultado NO debe utilizarse aún como decisión de autorización.
 */
import type { ContextoCore } from "./seguridad.js";
import type { ContratacionComercial } from "./reglas-comerciales.js";
import {
  consultarContratacionVigenteAirtable,
  type ConsultaContratacionesAirtable,
  type ResultadoConsultaContrataciones,
} from "./consulta-contrataciones-airtable.js";

/** No se admite empresaId: siempre se deriva del contexto Core. */
export type OpcionesDiagnosticoContratacion = Omit<ConsultaContratacionesAirtable, "empresaId">;

export type ResultadoDiagnosticoContratacion =
  | Readonly<{
      ok: true;
      empresaId: string;
      registroId: string;
      idContrato: string;
      idVersion: string;
      version: number;
      servicios: readonly ContratacionComercial[];
      /** NO representa un permiso efectivo ni una habilitación técnica. */
      accesoOperativoHabilitado: false;
    }>
  | Readonly<{
      ok: false;
      motivo: "CONTEXTO_INVALIDO" | Extract<ResultadoConsultaContrataciones, { ok: false }>["motivo"];
      accesoOperativoHabilitado: false;
    }>;

const ID_EMPRESA = /^rec[A-Za-z0-9]{14}$/;

/** Rechaza antes de la red las sesiones, empresas o identificadores inválidos. */
function contextoAdmisible(contexto: unknown): contexto is ContextoCore {
  if (!contexto || typeof contexto !== "object") return false;
  const candidato = contexto as Partial<ContextoCore>;
  if (candidato.activo !== true ||
      !candidato.empresa ||
      candidato.empresa.activa !== true ||
      typeof candidato.usuarioId !== "string" ||
      !candidato.usuarioId.trim() ||
      typeof candidato.empresa.id !== "string" ||
      !ID_EMPRESA.test(candidato.empresa.id)) return false;
  // Indica que se recibió el contrato del Core. NO prueba por sí mismo su origen.
  return Array.isArray(candidato.permisos) &&
    Array.isArray(candidato.modulosEmpresa) &&
    Array.isArray(candidato.modulosUsuario) &&
    Array.isArray(candidato.sucursalesAutorizadas);
}

/**
 * Consulta informativa de contrato a partir de una empresa confiable del Core.
 * No devuelve tokens, precios, notas comerciales ni datos de terceros.
 * No debe utilizarse como autorización operativa.
 */
export async function diagnosticarContratacionDelCore(
  contexto: ContextoCore,
  opciones: OpcionesDiagnosticoContratacion,
): Promise<ResultadoDiagnosticoContratacion> {
  if (!contextoAdmisible(contexto) || !opciones || typeof opciones !== "object") {
    return { ok: false, motivo: "CONTEXTO_INVALIDO", accesoOperativoHabilitado: false };
  }
  // El empresaId se coloca AL FINAL para impedir sobrescrituras accidentales.
  const resultado = await consultarContratacionVigenteAirtable({
    ...opciones,
    empresaId: contexto.empresa.id,
  });
  if (!resultado.ok) {
    return { ok: false, motivo: resultado.motivo, accesoOperativoHabilitado: false };
  }
  if (resultado.contratacion.empresaId !== contexto.empresa.id) {
    return { ok: false, motivo: "RESPUESTA_INVALIDA", accesoOperativoHabilitado: false };
  }
  const vigente = resultado.contratacion;
  return {
    ok: true,
    empresaId: vigente.empresaId,
    registroId: vigente.registroId,
    idContrato: vigente.idContrato,
    idVersion: vigente.idVersion,
    version: vigente.version,
    servicios: vigente.servicios,
    accesoOperativoHabilitado: false,
  };
}
