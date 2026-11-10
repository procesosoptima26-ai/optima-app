/**
 * OPTIMA 12C.15.2 — Consulta comercial INFORMATIVA para administración global.
 * Solo GET. No registra contratos, no cambia habilitaciones, no modifica permisos.
 * El cliente solo elige una empresa por ID; la autorización procede del servidor.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buscarSesion, leerTokenSesion } from "../../lib/session.js";
import { leerAccesoPlataforma } from "../../core/acceso-plataforma.js";
import { consultarContratacionVigenteAirtable, type ResultadoConsultaContrataciones } from "../../core/consulta-contrataciones-airtable.js";
import { CATALOGO_SUBMODULOS_CONTRATACION } from "../../core/catalogo-comercial-jerarquico.js";

const ID_REGISTRO = /^rec[A-Za-z0-9]{14}$/;
const ID_BASE = /^app[A-Za-z0-9]{14}$/;
const ID_TABLA = /^tbl[A-Za-z0-9]{14}$/;

// Identificadores de la tabla creada por la usuaria y auditada en 12C.14.
// Solo se consulta si la configuración apunta a la misma Base Maestra.
const BASE_MAESTRA = "appHVaLyE72Q1okqg";
const TABLA_CONTRATACIONES = "tblHiIQqmWNGwDeC9";

type Autenticacion =
  | Readonly<{ estado: "SIN_SESION" | "NO_AUTORIZADO" }>
  | Readonly<{ estado: "OK"; empresaPlataformaId: string }>;

type EmpresaVista = Readonly<{ id: string; nombre: string }>;

/** Inyección solo para las pruebas; la ruta real siempre usa los servicios seguros. */
export type DependenciasConsultaComercial = Readonly<{
  autenticar(req: VercelRequest): Promise<Autenticacion>;
  buscarEmpresa(empresaId: string): Promise<EmpresaVista | null>;
  buscarContrato(empresaId: string): Promise<ResultadoConsultaContrataciones>;
}>;

/** Protecciones comprobadas antes de leer los datos comerciales. */
export function crearConsultaComercial(deps: DependenciasConsultaComercial) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Método no permitido" });
      return;
    }
    try {
      const autenticado = await deps.autenticar(req);
      if (autenticado.estado === "SIN_SESION") {
        res.status(401).json({ ok: false, error: "Iniciá sesión" });
        return;
      }
      if (autenticado.estado !== "OK") {
        res.status(403).json({ ok: false, error: "Consulta exclusiva de OPTIMA" });
        return;
      }
      const keys = Object.keys(req.query ?? {});
      if (keys.some(k => k !== "accion" && k !== "empresaId") ||
          (req.query?.accion !== undefined && req.query.accion !== "consulta_comercial")) {
        res.status(400).json({ ok: false, error: "Parámetros no admitidos" });
        return;
      }
      const empresaId = req.query?.empresaId;
      if (typeof empresaId !== "string" || !ID_REGISTRO.test(empresaId)) {
        res.status(400).json({ ok: false, error: "Empresa inválida" });
        return;
      }
      if (empresaId === autenticado.empresaPlataformaId) {
        res.status(400).json({ ok: false, error: "Seleccioná una empresa cliente" });
        return;
      }
      const empresa = await deps.buscarEmpresa(empresaId);
      if (!empresa || empresa.id !== empresaId) {
        res.status(404).json({ ok: false, error: "Empresa no encontrada" });
        return;
      }
      const lectura = await deps.buscarContrato(empresaId);
      if (!lectura.ok) {
        if (lectura.motivo === "SIN_CONTRATO" || lectura.motivo === "NO_VIGENTE") {
          res.status(200).json({
            ok: true, soloConsulta: true, accesoOperativoHabilitado: false,
            estado: lectura.motivo, empresa, contrato: null,
          });
          return;
        }
        res.status(503).json({ ok: false, error: "La información contractual no está disponible o requiere revisión" });
        return;
      }
      if (lectura.contratacion.empresaId !== empresaId) {
        res.status(503).json({ ok: false, error: "La información contractual requiere revisión" });
        return;
      }
      const { idContrato, idVersion, version, servicios, vigenteDesde, vigenteHasta } = lectura.contratacion;
      res.status(200).json({
        ok: true, soloConsulta: true, accesoOperativoHabilitado: false,
        estado: "VIGENTE", empresa,
        contrato: { idContrato, idVersion, version, vigenteDesde, vigenteHasta, servicios },
      });
    } catch {
      // Jamás exponer tokens, excepciones del proveedor ni datos económicos.
      res.status(503).json({ ok: false, error: "No se pudo verificar la consulta comercial" });
    }
  };
}

function configuracion(): { baseId: string; empresasTablaId: string; token: string } {
  const baseId = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
  const empresasTablaId = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim() ?? "";
  const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
  if (!ID_BASE.test(baseId) || baseId !== BASE_MAESTRA ||
      !ID_TABLA.test(empresasTablaId) || !token) {
    throw new Error("Configuración de la Base Maestra no disponible");
  }
  return { baseId, empresasTablaId, token };
}

const dependenciasReales: DependenciasConsultaComercial = {
  async autenticar(req) {
    const tokenSesion = leerTokenSesion(req);
    if (!tokenSesion) return { estado: "SIN_SESION" };
    const sesion = await buscarSesion(tokenSesion);
    if (!sesion) return { estado: "SIN_SESION" };
    const acceso = await leerAccesoPlataforma(sesion.usuarioId);
    if (!acceso) return { estado: "NO_AUTORIZADO" };
    return { estado: "OK", empresaPlataformaId: acceso.empresaId };
  },
  async buscarEmpresa(empresaId) {
    const { baseId, empresasTablaId, token } = configuracion();
    const url = `https://api.airtable.com/v0/${baseId}/${empresasTablaId}/${empresaId}`;
    const r = await fetch(url, {
      method: "GET", headers: { Authorization: `Bearer ${token}` },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("Error consultando empresa");
    const dato: unknown = await r.json();
    if (!dato || typeof dato !== "object" || Array.isArray(dato)) throw new Error("Empresa inválida");
    const reg = dato as { id?: unknown; fields?: { NOMBRE_COMERCIAL?: unknown } };
    const nombre = reg.fields?.NOMBRE_COMERCIAL;
    if (reg.id !== empresaId || typeof nombre !== "string" || !nombre.trim()) throw new Error("Empresa inválida");
    return { id: empresaId, nombre: nombre.trim() };
  },
  async buscarContrato(empresaId) {
    const { baseId, token } = configuracion();
    return consultarContratacionVigenteAirtable({
      empresaId, baseId, tablaId: TABLA_CONTRATACIONES, token,
      ahoraIso: new Date().toISOString(),
      catalogoSubmodulos: CATALOGO_SUBMODULOS_CONTRATACION,
    });
  },
};

export default crearConsultaComercial(dependenciasReales);
