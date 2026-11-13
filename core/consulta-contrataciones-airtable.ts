/**
 * OPTIMA 12C.14.3 — Consulta de SOLO LECTURA de contratos en Airtable.
 *
 * No se importa desde rutas operativas, no modifica permisos, no escribe datos.
 * Las credenciales y los IDs deben provenir del SERVIDOR, nunca del navegador.
 *
 * IMPORTANTE: recorrer páginas de Airtable no garantiza una foto transaccional.
 * No utilizar directamente este resultado para habilitar funcionalidades en
 * producción: esa integración requiere política de activación y consistencia.
 */
import {
  leerContratacionVigente,
  type ResultadoLecturaContratacion,
  type RegistroContratacionAirtable,
} from "./contrataciones-airtable.js";
import {
  validarContrataciones,
  type DefinicionSubmodulo,
} from "./reglas-comerciales.js";

const BASE_ID = /^app[A-Za-z0-9]{14}$/;
const TABLA_ID = /^tbl[A-Za-z0-9]{14}$/;
const MAX_PAGINAS = 50;
const MAX_REGISTROS = 5_000;
const POR_PAGINA = 100;

/** Campos mínimos definidos en CONTRATACIONES_OPTIMA. */
const CAMPOS_CONTRATO = [
  "ID_VERSION", "ID_CONTRATO", "EMPRESA", "VERSION", "ESTADO",
  "SERVICIOS_CONTRATADOS", "CONDICIONES_ECONOMICAS", "VIGENTE_DESDE",
  "VIGENTE_HASTA", "FECHA_APROBACION", "APROBADO_POR_ID",
] as const;

type RespuestaHttp = Readonly<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Permite simular fetch en pruebas sin llamar a la red. */
export type ClienteLecturaHttp = (
  url: string,
  opciones: RequestInit,
) => Promise<RespuestaHttp>;

export type ConsultaContratacionesAirtable = Readonly<{
  empresaId: string;
  ahoraIso: string;
  catalogoSubmodulos: readonly DefinicionSubmodulo[];
  /** Solo configuración confiable leída en el servidor. */
  baseId: string;
  tablaId: string;
  token: string;
  /** Opcional para pruebas unitarias, no para recibir datos del cliente. */
  clienteHttp?: ClienteLecturaHttp;
}>;

export type ResultadoConsultaContrataciones =
  | ResultadoLecturaContratacion
  | Readonly<{ ok: false; motivo:
      "CONFIGURACION_INVALIDA" | "LECTURA_NO_DISPONIBLE" |
      "RESPUESTA_INVALIDA" | "CONSULTA_INCOMPLETA" }>;

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Lee TODAS las páginas y recién después llama al motor puro del 12C.14.2.
 * Si hay error de red, paginación incompleta o formato inesperado, deniega.
 * Solo GET; no incluye datos de contratos ni credenciales en la respuesta.
 */
export async function consultarContratacionVigenteAirtable(
  consulta: ConsultaContratacionesAirtable,
): Promise<ResultadoConsultaContrataciones> {
  if (!consulta || typeof consulta !== "object" ||
      typeof consulta.baseId !== "string" || !BASE_ID.test(consulta.baseId) ||
      typeof consulta.tablaId !== "string" || !TABLA_ID.test(consulta.tablaId) ||
      typeof consulta.token !== "string" || !consulta.token ||
      consulta.token !== consulta.token.trim() || /\s/.test(consulta.token) ||
      consulta.token.length > 4096) {
    return { ok: false, motivo: "CONFIGURACION_INVALIDA" };
  }

  // Rechazar datos inválidos SIN efectuar llamadas de red.
  const preliminar = leerContratacionVigente(
    [], consulta.empresaId, consulta.catalogoSubmodulos, consulta.ahoraIso,
  );
  if (preliminar.ok === true || (preliminar.ok === false && preliminar.motivo !== "SIN_CONTRATO") ||
      !validarContrataciones([], consulta.catalogoSubmodulos).ok) {
    return { ok: false, motivo: "CONFIGURACION_INVALIDA" };
  }

  const registros: RegistroContratacionAirtable[] = [];
  const ids = new Set<string>();
  const offsets = new Set<string>();
  const clienteHttp = consulta.clienteHttp ?? fetch;
  let offset: string | null = null;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const url = new URL(
      `https://api.airtable.com/v0/${consulta.baseId}/${consulta.tablaId}`,
    );
    url.searchParams.set("pageSize", String(POR_PAGINA));
    for (const campo of CAMPOS_CONTRATO) url.searchParams.append("fields[]", campo);
    if (offset !== null) url.searchParams.set("offset", offset);

    let datos: unknown;
    try {
      const respuesta = await clienteHttp(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${consulta.token}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!respuesta || !respuesta.ok || respuesta.status !== 200) {
        return { ok: false, motivo: "LECTURA_NO_DISPONIBLE" };
      }
      datos = await respuesta.json();
    } catch {
      // No se exponen tokens, URLs ni detalles de la red.
      return { ok: false, motivo: "LECTURA_NO_DISPONIBLE" };
    }

    if (!objeto(datos) || !Array.isArray(datos.records) ||
        datos.records.length > POR_PAGINA) {
      return { ok: false, motivo: "RESPUESTA_INVALIDA" };
    }
    for (const item of datos.records) {
      if (!objeto(item) || typeof item.id !== "string" ||
          !/^rec[A-Za-z0-9]{14}$/.test(item.id) ||
          !objeto(item.fields) || ids.has(item.id)) {
        return { ok: false, motivo: "RESPUESTA_INVALIDA" };
      }
      ids.add(item.id);
      registros.push({ id: item.id, fields: item.fields });
      if (registros.length > MAX_REGISTROS) {
        return { ok: false, motivo: "CONSULTA_INCOMPLETA" };
      }
    }

    if (datos.offset === undefined) {
      // Ningún resultado incompleto se interpreta como vigente.
      return leerContratacionVigente(
        registros, consulta.empresaId, consulta.catalogoSubmodulos, consulta.ahoraIso,
      );
    }
    if (typeof datos.offset !== "string" || !datos.offset ||
        datos.offset.length > 4096 || offsets.has(datos.offset)) {
      return { ok: false, motivo: "RESPUESTA_INVALIDA" };
    }
    offsets.add(datos.offset);
    offset = datos.offset;
  }
  return { ok: false, motivo: "CONSULTA_INCOMPLETA" };
}
