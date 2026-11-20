/**
 * OPTIMA 12C.19 — Autorización comercial del lado del servidor.
 * Integra capacidad publicada, usuario real de Airtable, contrato PostgreSQL
 * y alcance de sucursal. Nunca recibe identidad, rol ni contrato desde HTTP.
 * El acceso falla cerrado ante cualquier incertidumbre.
 */
import type { ContextoCore, Modulo, Permiso, RecursoCore } from "./seguridad.js";
import { MODULO_DEL_PERMISO } from "./seguridad.js";
import { puedeUsarCapacidadComercial } from "./acceso-comercial.js";
import { CATALOGO_SUBMODULOS_CONTRATACION } from "./catalogo-comercial-jerarquico.js";
import { CAPACIDADES_OPERATIVAS_12C19 } from "./capacidades-implementadas-12c19.js";
import { consultarAsignacionesUsuarioVerificado,
  type ResultadoAsignacionesUsuario } from "./asignaciones-submodulos-usuario.js";
import { leerContratoOperativoPg,
  type LecturaContratoOperativo } from "./contrato-vigente-pg-12c19.js";
import { crearPoolComercialLectura186 } from "../lib/pool-lectura-comercial-12c186.js";
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

export type PeticionCapacidadVerificada = Readonly<{
  contexto: ContextoCore;
  capacidad: string;
  modulo: Modulo;
  permiso: Permiso;
  recurso: RecursoCore;
}>;
export type DependenciasCapacidad = Readonly<{
  /** Recibe el ID ESTABLE de la empresa (clave en PostgreSQL), no el código de Airtable. */
  consultarContrato(idEmpresaEstable: string): Promise<LecturaContratoOperativo>;
  consultarAsignaciones(contexto: ContextoCore): Promise<ResultadoAsignacionesUsuario>;
}>;

/** Pureza de integración: dependencias inyectables en laboratorio, sin fallbacks. */
export async function autorizarCapacidadOperativa(
  peticion: PeticionCapacidadVerificada, dependencias: DependenciasCapacidad,
): Promise<boolean> {
  const { contexto, capacidad, modulo, permiso, recurso } = peticion;
  if (!contexto || !contexto.empresa || !contexto.activo || !contexto.empresa.activa ||
      contexto.empresa.id !== recurso?.empresaId ||
      MODULO_DEL_PERMISO[permiso] !== modulo) return false;
  const definicion = CAPACIDADES_OPERATIVAS_12C19.find(c => c.id === capacidad);
  if (!definicion || definicion.modulo !== modulo || definicion.permiso !== permiso) return false;
  try {
    // Ante cualquier fallo no se salta la verificación ni se presume contratación.
    // Sin ID estable válido no hay forma segura de ubicar el contrato: se deniega.
    const idEstable = contexto.empresa.idEstable;
    if (!esIdEmpresaEstable(idEstable)) return false;
    const contrato = await dependencias.consultarContrato(idEstable);
    if (!contrato.ok || contrato.contrato.empresaId !== idEstable) return false;
    const usuario = await dependencias.consultarAsignaciones(contexto);
    if (!usuario.ok || usuario.usuarioId !== contexto.usuarioId ||
        usuario.empresaId !== contexto.empresa.id ||
        !usuario.permisosAsignadosUsuario.includes(permiso)) return false;
    return puedeUsarCapacidadComercial({
      contexto,
      // Ya se comprobó que el contrato pertenece al ID estable de ESTA empresa.
      empresaContratacionId: contexto.empresa.id,
      contrataciones: contrato.contrato.servicios,
      catalogoSubmodulos: CATALOGO_SUBMODULOS_CONTRATACION,
      catalogoCapacidades: CAPACIDADES_OPERATIVAS_12C19,
      capacidad,
      recurso,
      permisosAsignadosUsuario: usuario.permisosAsignadosUsuario,
      submodulosHabilitadosUsuario: usuario.submodulosHabilitadosUsuario,
    });
  } catch { return false; }
}

/** Adaptadores REALES: usados solo después de validar cookie/Redis y Base Maestra.
 * Contrato: PostgreSQL, no la tabla legacy CONTRATACIONES_OPTIMA.
 * Si falta pg/configuración de solo lectura, deniega automáticamente.
 */
export async function autorizarCapacidadOperativaReal(
  peticion: PeticionCapacidadVerificada,
): Promise<boolean> {
  const baseId = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
  const tablaUsuariosId = process.env.AIRTABLE_USERS_TABLE_ID?.trim() ?? "";
  const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
  const pool = crearPoolComercialLectura186();
  return autorizarCapacidadOperativa(peticion, {
    consultarContrato: (empresaId) => leerContratoOperativoPg(pool, empresaId, new Date().toISOString()),
    consultarAsignaciones: (contexto) => consultarAsignacionesUsuarioVerificado(contexto, {
      baseId, tablaUsuariosId, token,
    }),
  });
}
