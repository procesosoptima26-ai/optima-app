/**
 * OPTIMA 12C.14.2 — Adaptador PURO de lectura de versiones comerciales.
 * Recibe un conjunto COMPLETO de registros ya obtenido por el servidor.
 * No consulta Airtable, no escribe, no modifica permisos y no activa módulos.
 * Nunca utilizar este resultado, por sí solo, para autorizar una API operativa.
 */
import {
  validarContrataciones,
  type ContratacionComercial,
  type DefinicionSubmodulo,
} from "./reglas-comerciales.js";

export const ESTADOS_CONTRATACION = [
  "BORRADOR", "APROBADA", "VIGENTE", "HISTORICA",
  "SUSPENDIDA", "FINALIZADA", "ANULADA",
] as const;
export type EstadoContratacion = (typeof ESTADOS_CONTRATACION)[number];

export type RegistroContratacionAirtable = Readonly<{
  id: string;
  fields: Readonly<Record<string, unknown>>;
}>;

export type ContratacionVigente = Readonly<{
  registroId: string;
  empresaId: string;
  idContrato: string;
  idVersion: string;
  version: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
  aprobadoPorId: string;
  fechaAprobacion: string;
  servicios: readonly ContratacionComercial[];
  /** Datos informativos: los precios aún NO tienen un contrato de validación definitivo. */
  condicionesEconomicas: string;
}>;

export type ResultadoLecturaContratacion =
  | Readonly<{ ok: true; contratacion: ContratacionVigente }>
  | Readonly<{ ok: false; motivo: "SIN_CONTRATO" | "NO_VIGENTE" | "DATOS_INVALIDOS" | "INCONSISTENTE" }>;

const ID_REGISTRO = /^rec[A-Za-z0-9]{14}$/;
const FECHA_ZONA = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;

function registro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() && valor === valor.trim() &&
    valor.length <= 500 ? valor : null;
}

function fecha(valor: unknown): number | null {
  if (typeof valor !== "string" || !FECHA_ZONA.test(valor)) return null;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

function estado(valor: unknown): EstadoContratacion | null {
  const nombre = typeof valor === "string" ? valor :
    registro(valor) && typeof valor.name === "string" ? valor.name : null;
  return ESTADOS_CONTRATACION.find((x) => x === nombre) ?? null;
}

function idsEmpresa(valor: unknown): string[] | null {
  if (!Array.isArray(valor)) return null;
  const ids: string[] = [];
  for (const item of valor) {
    const id = typeof item === "string" ? item : registro(item) ? item.id : null;
    if (typeof id !== "string" || !ID_REGISTRO.test(id)) return null;
    ids.push(id);
  }
  return ids;
}

/**
 * Es obligatorio suministrar TODAS las páginas de CONTRATACIONES_OPTIMA.
 * Si el llamador usa solo una página no se pueden detectar versiones duplicadas.
 * Los registros totalmente vacíos, sin empresa, nunca conceden acceso.
 */
export function leerContratacionVigente(
  registros: unknown,
  empresaId: unknown,
  catalogoSubmodulos: readonly DefinicionSubmodulo[],
  ahoraIso: unknown,
): ResultadoLecturaContratacion {
  if (!Array.isArray(registros) || typeof empresaId !== "string" ||
      !ID_REGISTRO.test(empresaId) || fecha(ahoraIso) === null ||
      !Array.isArray(catalogoSubmodulos)) {
    return { ok: false, motivo: "DATOS_INVALIDOS" };
  }
  const ahora = fecha(ahoraIso)!;
  const filas: RegistroContratacionAirtable[] = [];
  for (const item of registros) {
    if (!registro(item) || typeof item.id !== "string" || !ID_REGISTRO.test(item.id) ||
        !registro(item.fields)) return { ok: false, motivo: "DATOS_INVALIDOS" };
    const campos = item.fields;
    const vinculos = idsEmpresa(campos.EMPRESA);
    // Una referencia malformada que menciona a la empresa consultada es insegura.
    if (vinculos === null && campos.EMPRESA !== undefined) {
      return { ok: false, motivo: "DATOS_INVALIDOS" };
    }
    if (vinculos?.includes(empresaId)) {
      if (vinculos.length !== 1) return { ok: false, motivo: "INCONSISTENTE" };
      filas.push(item as RegistroContratacionAirtable);
    }
  }
  if (filas.length === 0) return { ok: false, motivo: "SIN_CONTRATO" };

  const contratos = new Set<string>();
  const versiones = new Set<number>();
  const versionesIds = new Set<string>();
  const vigentes: RegistroContratacionAirtable[] = [];
  for (const fila of filas) {
    const c = fila.fields;
    const contrato = texto(c.ID_CONTRATO);
    const versionId = texto(c.ID_VERSION);
    const version = c.VERSION;
    const tipoEstado = estado(c.ESTADO);
    if (!contrato || !versionId || typeof version !== "number" ||
        !Number.isSafeInteger(version) || version < 1 || !tipoEstado ||
        versiones.has(version) || versionesIds.has(versionId)) {
      return { ok: false, motivo: "INCONSISTENTE" };
    }
    contratos.add(contrato);
    versiones.add(version);
    versionesIds.add(versionId);
    if (tipoEstado === "VIGENTE") vigentes.push(fila);
  }
  if (contratos.size !== 1 || vigentes.length > 1) return { ok: false, motivo: "INCONSISTENTE" };
  if (vigentes.length === 0) return { ok: false, motivo: "NO_VIGENTE" };

  const fila = vigentes[0];
  const c = fila.fields;
  const desde = fecha(c.VIGENTE_DESDE);
  const hasta = c.VIGENTE_HASTA === undefined || c.VIGENTE_HASTA === null ||
    c.VIGENTE_HASTA === "" ? null : fecha(c.VIGENTE_HASTA);
  const aprobacion = fecha(c.FECHA_APROBACION);
  const aprobador = texto(c.APROBADO_POR_ID);
  if (desde === null || (c.VIGENTE_HASTA !== undefined && c.VIGENTE_HASTA !== null &&
      c.VIGENTE_HASTA !== "" && hasta === null) ||
      (hasta !== null && hasta <= desde) || aprobacion === null || !aprobador ||
      aprobacion > ahora) return { ok: false, motivo: "INCONSISTENTE" };
  if (ahora < desde || (hasta !== null && ahora >= hasta)) {
    return { ok: false, motivo: "NO_VIGENTE" };
  }

  const serviciosTexto = c.SERVICIOS_CONTRATADOS;
  if (typeof serviciosTexto !== "string" || !serviciosTexto.trim() ||
      serviciosTexto.length > 100_000) {
    return { ok: false, motivo: "INCONSISTENTE" };
  }
  let serviciosRaw: unknown;
  try { serviciosRaw = JSON.parse(serviciosTexto); }
  catch { return { ok: false, motivo: "INCONSISTENTE" }; }
  const validados = validarContrataciones(serviciosRaw, catalogoSubmodulos);
  if (!validados.ok || validados.contrataciones.length === 0) {
    return { ok: false, motivo: "INCONSISTENTE" };
  }

  // La economía comercial se devuelve intacta para una etapa posterior.
  // Todavía NO se certifica que los importes o descuentos sean correctos.
  const condiciones = c.CONDICIONES_ECONOMICAS;
  if (condiciones !== undefined && typeof condiciones !== "string") {
    return { ok: false, motivo: "INCONSISTENTE" };
  }

  return {
    ok: true,
    contratacion: {
      registroId: fila.id,
      empresaId,
      idContrato: c.ID_CONTRATO as string,
      idVersion: c.ID_VERSION as string,
      version: c.VERSION as number,
      vigenteDesde: c.VIGENTE_DESDE as string,
      vigenteHasta: typeof c.VIGENTE_HASTA === "string" && c.VIGENTE_HASTA ? c.VIGENTE_HASTA : null,
      aprobadoPorId: aprobador,
      fechaAprobacion: c.FECHA_APROBACION as string,
      servicios: validados.contrataciones,
      condicionesEconomicas: typeof condiciones === "string" ? condiciones : "",
    },
  };
}
