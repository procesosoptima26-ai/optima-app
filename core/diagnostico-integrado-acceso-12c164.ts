/**
 * OPTIMA 12C.16.4 — Diagnóstico integrado comercial, SOLO LECTURA.
 *
 * Encadena tres piezas existentes sin alterar el Core:
 *   1) Contrato vigente de la empresa del contexto verificado.
 *   2) Asignaciones del usuario identificado por ese mismo contexto.
 *   3) Evaluación pura de capacidad, módulo, permiso y sucursal.
 *
 * NO ES AUTORIZACIÓN OPERATIVA. Incluso un diagnóstico compatible devuelve
 * accesoOperativoHabilitado: false y no puede usarse para permitir endpoints.
 *
 * Preparación para pruebas/integración futura: los valores de `contexto`,
 * `catalogoCapacidades`, configuración y recurso deben venir de fuentes
 * verificadas del SERVIDOR. No llamar con datos de req.body o del navegador.
 *
 * No crea campos de Airtable, no escribe datos y no activa servicios.
 */
import type { ContextoCore, RecursoCore } from "./seguridad.js";
import type { DefinicionCapacidadComercial } from "./acceso-comercial.js";
import { puedeUsarCapacidadComercial } from "./acceso-comercial.js";
import { CATALOGO_SUBMODULOS_CONTRATACION } from "./catalogo-comercial-jerarquico.js";
import {
  diagnosticarContratacionDelCore,
  type OpcionesDiagnosticoContratacion,
} from "./diagnostico-contratacion-core.js";
import {
  consultarAsignacionesUsuarioVerificado,
  type ClienteHttpUsuario,
} from "./asignaciones-submodulos-usuario.js";

export type OpcionesDiagnosticoAccesoIntegrado = Readonly<{
  /** Capacidad solicitada: ID de un catálogo revisado en código. */
  capacidad: string;
  recurso: RecursoCore;
  catalogoCapacidades: readonly DefinicionCapacidadComercial[];
  ahoraIso: string;
  baseId: string;
  tablaContratosId: string;
  tablaUsuariosId: string;
  token: string;
  /** Inyecciones exclusivamente para pruebas locales. */
  clienteHttpContratos?: OpcionesDiagnosticoContratacion["clienteHttp"];
  clienteHttpUsuarios?: ClienteHttpUsuario;
}>;

export type ResultadoDiagnosticoAccesoIntegrado =
  | Readonly<{
      ok: true;
      /** Solo sirve para revisión funcional, NUNCA para autorizar una API. */
      compatibleEnSimulacion: boolean;
      accesoOperativoHabilitado: false;
      estado: "DIAGNOSTICO_NO_OPERATIVO";
    }>
  | Readonly<{
      ok: false;
      motivo: "CONTEXTO_INVALIDO" | "CONFIGURACION_INVALIDA" |
        "CONTRATO_NO_DISPONIBLE" | "ASIGNACIONES_NO_DISPONIBLES";
      accesoOperativoHabilitado: false;
    }>;

const ID = /^rec[A-Za-z0-9]{14}$/;
const BASE = /^app[A-Za-z0-9]{14}$/;
const TABLA = /^tbl[A-Za-z0-9]{14}$/;

/**
 * El llamador tiene que construir el contexto autenticado en backend.
 * Aquí solo se verifica coherencia mínima ANTES de llamar a la red.
 */
export async function diagnosticarAccesoComercialIntegrado(
  contexto: ContextoCore,
  opciones: OpcionesDiagnosticoAccesoIntegrado,
): Promise<ResultadoDiagnosticoAccesoIntegrado> {
  if (!contexto || !contexto.empresa || contexto.activo !== true ||
      contexto.empresa.activa !== true || !ID.test(contexto.usuarioId ?? "") ||
      !ID.test(contexto.empresa.id ?? "") ||
      !Array.isArray(contexto.permisos) ||
      !Array.isArray(contexto.modulosEmpresa) ||
      !Array.isArray(contexto.modulosUsuario) ||
      !Array.isArray(contexto.sucursalesAutorizadas) ||
      !opciones || !opciones.recurso ||
      opciones.recurso.empresaId !== contexto.empresa.id) {
    return { ok: false, motivo: "CONTEXTO_INVALIDO", accesoOperativoHabilitado: false };
  }

  if (typeof opciones.capacidad !== "string" || !opciones.capacidad ||
      !Array.isArray(opciones.catalogoCapacidades) ||
      typeof opciones.ahoraIso !== "string" ||
      !Number.isFinite(Date.parse(opciones.ahoraIso)) ||
      !BASE.test(opciones.baseId ?? "") ||
      !TABLA.test(opciones.tablaContratosId ?? "") ||
      !TABLA.test(opciones.tablaUsuariosId ?? "") ||
      typeof opciones.token !== "string" || !opciones.token.trim()) {
    return { ok: false, motivo: "CONFIGURACION_INVALIDA", accesoOperativoHabilitado: false };
  }

  // Contrato: ID de empresa viene solo del contexto. Nunca del navegador.
  const contrato = await diagnosticarContratacionDelCore(contexto, {
    baseId: opciones.baseId,
    tablaId: opciones.tablaContratosId,
    token: opciones.token,
    ahoraIso: opciones.ahoraIso,
    catalogoSubmodulos: CATALOGO_SUBMODULOS_CONTRATACION,
    ...(opciones.clienteHttpContratos ? { clienteHttp: opciones.clienteHttpContratos } : {}),
  });
  if (!contrato.ok || contrato.empresaId !== contexto.empresa.id) {
    return { ok: false, motivo: "CONTRATO_NO_DISPONIBLE", accesoOperativoHabilitado: false };
  }

  // Usuario: el lector consulta estrictamente el ID de la sesión verificada.
  const usuario = await consultarAsignacionesUsuarioVerificado(contexto, {
    baseId: opciones.baseId,
    tablaUsuariosId: opciones.tablaUsuariosId,
    token: opciones.token,
    ...(opciones.clienteHttpUsuarios ? { clienteHttp: opciones.clienteHttpUsuarios } : {}),
  });
  if (!usuario.ok || usuario.usuarioId !== contexto.usuarioId ||
      usuario.empresaId !== contexto.empresa.id) {
    return { ok: false, motivo: "ASIGNACIONES_NO_DISPONIBLES", accesoOperativoHabilitado: false };
  }

  // Un contexto viejo que conserve permisos ya retirados no debe aprobar
  // siquiera el diagnóstico, incluida la modalidad MÓDULO PRINCIPAL.
  const definicion = opciones.catalogoCapacidades.find(c => c?.id === opciones.capacidad);
  const permisoActual = definicion && usuario.permisosAsignadosUsuario.includes(definicion.permiso);
  const compatibleEnSimulacion = Boolean(permisoActual) && puedeUsarCapacidadComercial({
    contexto,
    empresaContratacionId: contrato.empresaId,
    contrataciones: contrato.servicios,
    catalogoSubmodulos: CATALOGO_SUBMODULOS_CONTRATACION,
    catalogoCapacidades: opciones.catalogoCapacidades,
    capacidad: opciones.capacidad,
    recurso: opciones.recurso,
    permisosAsignadosUsuario: usuario.permisosAsignadosUsuario,
    submodulosHabilitadosUsuario: usuario.submodulosHabilitadosUsuario,
  });

  return {
    ok: true,
    compatibleEnSimulacion,
    accesoOperativoHabilitado: false,
    estado: "DIAGNOSTICO_NO_OPERATIVO",
  };
}
