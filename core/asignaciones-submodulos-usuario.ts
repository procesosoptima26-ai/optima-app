/**
 * OPTIMA 12C.16.3 — Lectura de asignaciones individuales de usuario (SOLO GET).
 *
 * PREPARACIÓN, no autorización operativa ni conexión a endpoints:
 * - Recibe un ContextoCore previamente verificado POR EL SERVIDOR.
 * - Lee exclusivamente el registro USUARIOS correspondiente al usuario autenticado.
 * - Corrobora identidad, empresa vinculada y estado ACTIVO en Base Maestra.
 * - Obtiene permisos CRUD explícitos desde campos PERMISOS_* existentes.
 * - Obtiene los submódulos del campo planeado SUBMODULOS_HABILITADOS.
 * - Si el campo no existe / fue omitido por Airtable, asigna CERO submódulos.
 * - Jamás deriva asignaciones del contrato, rol ADMIN ni módulo padre.
 *
 * IMPORTANTE: SUBMODULOS_HABILITADOS aún NO existe en la Base Maestra. Esta
 * etapa no crea ese campo ni conecta el lector a ninguna API operativa.
 * El módulo de acceso comercial (12C.13) exige además contrato y capacidad.
 */
import { CATALOGO_SUBMODULOS_CONTRATACION } from "./catalogo-comercial-jerarquico.js";
import { leerPermisosAsignados } from "./permisos-airtable.js";
import type { ContextoCore, Permiso } from "./seguridad.js";

export const CAMPO_SUBMODULOS_USUARIO = "SUBMODULOS_HABILITADOS" as const;

const ID_REGISTRO = /^rec[A-Za-z0-9]{14}$/;
const ID_BASE = /^app[A-Za-z0-9]{14}$/;
const ID_TABLA = /^tbl[A-Za-z0-9]{14}$/;
const SUBMODULOS_VALIDOS = new Set(CATALOGO_SUBMODULOS_CONTRATACION.map(s => s.id));

export type RespuestaHttpUsuario = Readonly<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
export type ClienteHttpUsuario = (
  url: string,
  init: Readonly<{
    method: "GET";
    headers: Readonly<{ Authorization: string }>;
    redirect: "error";
    cache: "no-store";
    signal: AbortSignal;
  }>,
) => Promise<RespuestaHttpUsuario>;

export type OpcionesLecturaAsignacionesUsuario = Readonly<{
  baseId: string;
  tablaUsuariosId: string;
  token: string;
  /** Inyectable para pruebas: NUNCA pasar una función desde req.body o el navegador. */
  clienteHttp?: ClienteHttpUsuario;
}>;

export type ResultadoAsignacionesUsuario =
  | Readonly<{
      ok: true;
      usuarioId: string;
      empresaId: string;
      /** Permisos RAW explícitos: no son autorizaciones por sí mismos. */
      permisosAsignadosUsuario: readonly Permiso[];
      submodulosHabilitadosUsuario: readonly string[];
    }>
  | Readonly<{
      ok: false;
      motivo: "CONTEXTO_INVALIDO" | "CONFIGURACION_INVALIDA" |
        "USUARIO_NO_ENCONTRADO" | "REGISTRO_INVALIDO" |
        "EMPRESA_NO_COINCIDE" | "USUARIO_INACTIVO" |
        "ASIGNACIONES_INVALIDAS" | "LECTURA_NO_DISPONIBLE";
    }>;

function registro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Analiza un registro ya obtenido desde Airtable; no confía en su contenido. */
export function interpretarAsignacionesUsuario(
  contexto: ContextoCore,
  dato: unknown,
): ResultadoAsignacionesUsuario {
  if (!contexto || !contexto.empresa || contexto.activo !== true ||
      contexto.empresa.activa !== true ||
      !ID_REGISTRO.test(contexto.usuarioId ?? "") ||
      !ID_REGISTRO.test(contexto.empresa.id ?? "")) {
    return { ok: false, motivo: "CONTEXTO_INVALIDO" };
  }
  if (!registro(dato) || dato.id !== contexto.usuarioId || !registro(dato.fields)) {
    return { ok: false, motivo: "REGISTRO_INVALIDO" };
  }
  const campos = dato.fields;
  if (!Array.isArray(campos.EMPRESA) || campos.EMPRESA.length !== 1 ||
      campos.EMPRESA[0] !== contexto.empresa.id) {
    return { ok: false, motivo: "EMPRESA_NO_COINCIDE" };
  }
  if (campos.ACTIVO !== true) {
    return { ok: false, motivo: "USUARIO_INACTIVO" };
  }
  const permisos = leerPermisosAsignados(campos);
  if (permisos === null) return { ok: false, motivo: "ASIGNACIONES_INVALIDAS" };

  // Airtable omite campos vacíos y actualmente el campo ni siquiera existe.
  // En ambos casos esto implica cero asignaciones individuales, jamás 'todos'.
  const crudo: unknown = campos[CAMPO_SUBMODULOS_USUARIO];
  const elegidos = crudo === undefined ? [] : crudo;
  if (!Array.isArray(elegidos)) return { ok: false, motivo: "ASIGNACIONES_INVALIDAS" };
  if (elegidos.length > SUBMODULOS_VALIDOS.size) {
    return { ok: false, motivo: "ASIGNACIONES_INVALIDAS" };
  }
  const submodulos = new Set<string>();
  for (const id of elegidos) {
    // IDs exactos y estables. Nunca normalizar etiquetas desconocidas a permisos.
    if (typeof id !== "string" || !SUBMODULOS_VALIDOS.has(id) || submodulos.has(id)) {
      return { ok: false, motivo: "ASIGNACIONES_INVALIDAS" };
    }
    submodulos.add(id);
  }
  return {
    ok: true,
    usuarioId: contexto.usuarioId,
    empresaId: contexto.empresa.id,
    permisosAsignadosUsuario: Object.freeze([...permisos]),
    submodulosHabilitadosUsuario: Object.freeze([...submodulos]),
  };
}

/**
 * Solo se debe invocar DESPUÉS de autenticar la sesión y verificar ContextoCore.
 * No recibe usuarioId/empresaId arbitrarios: ambas identidades salen del Core.
 * Ninguna respuesta incorpora secretos, precios ni datos personales.
 */
export async function consultarAsignacionesUsuarioVerificado(
  contexto: ContextoCore,
  opciones: OpcionesLecturaAsignacionesUsuario,
): Promise<ResultadoAsignacionesUsuario> {
  if (!contexto || !contexto.empresa || contexto.activo !== true ||
      contexto.empresa.activa !== true ||
      !ID_REGISTRO.test(contexto.usuarioId ?? "") ||
      !ID_REGISTRO.test(contexto.empresa.id ?? "")) {
    return { ok: false, motivo: "CONTEXTO_INVALIDO" };
  }
  if (!opciones || !ID_BASE.test(opciones.baseId ?? "") ||
      !ID_TABLA.test(opciones.tablaUsuariosId ?? "") ||
      typeof opciones.token !== "string" || !opciones.token.trim()) {
    return { ok: false, motivo: "CONFIGURACION_INVALIDA" };
  }
  const url = `https://api.airtable.com/v0/${opciones.baseId}/${opciones.tablaUsuariosId}/${contexto.usuarioId}`;
  const cliente = opciones.clienteHttp ?? (globalThis.fetch as ClienteHttpUsuario);
  try {
    const respuesta = await cliente(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${opciones.token}` },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (respuesta.status === 404) return { ok: false, motivo: "USUARIO_NO_ENCONTRADO" };
    if (!respuesta.ok || respuesta.status !== 200) {
      return { ok: false, motivo: "LECTURA_NO_DISPONIBLE" };
    }
    const dato = await respuesta.json();
    return interpretarAsignacionesUsuario(contexto, dato);
  } catch {
    // No filtrar datos de red, token ni respuesta del proveedor.
    return { ok: false, motivo: "LECTURA_NO_DISPONIBLE" };
  }
}
