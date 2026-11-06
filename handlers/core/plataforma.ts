import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buscarSesion, leerTokenSesion } from "../../lib/session.js";
import { leerAccesoPlataforma } from "../../core/acceso-plataforma.js";
import { normalizarNombreModulo } from "../../core/alta-usuarios.js";
import { leerEstadoModulos } from "../../core/gestion-modulos.js";
import type { Modulo } from "../../core/seguridad.js";

type Registro = { id: string; fields: Record<string, unknown> };
const ID = /^rec[A-Za-z0-9]{14}$/;

/** Sólo muestra información comercial mínima, sin usuarios ni datos operativos. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const cookie = leerTokenSesion(req);
  if (!cookie) return res.status(401).json({ ok: false, error: "Iniciá sesión" });
  try {
    const sesion = await buscarSesion(cookie);
    if (!sesion) return res.status(401).json({ ok: false, error: "Sesión vencida" });
    const admin = await leerAccesoPlataforma(sesion.usuarioId);
    if (!admin) return res.status(403).json({ ok: false, error: "Acceso exclusivo de administración OPTIMA" });

    const base = process.env.AIRTABLE_USERS_BASE_ID?.trim();
    const tabla = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim();
    const token = process.env.AIRTABLE_TOKEN?.trim();
    if (!base || !tabla || !token) throw new Error("Base Maestra no configurada");

    const empresas: Array<{ id: string; nombre: string; clave: string; activa: boolean;
      modulosHabilitados: Modulo[]; requiereRevision: boolean; version: string | null; esPlataforma: boolean }> = [];
    let offset: string | undefined;
    let paginas = 0;
    do {
      if (++paginas > 50) throw new Error("Cantidad de páginas no soportada");
      const url = new URL(`https://api.airtable.com/v0/${base}/${tabla}`);
      url.searchParams.set("pageSize", "100");
      for (const campo of ["NOMBRE_COMERCIAL", "CLAVE_EMPRESA", "ACTIVA", "MODULOS_CONTRATADOS"])
        url.searchParams.append("fields[]", campo);
      if (offset) url.searchParams.set("offset", offset);
      const r = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`No se pudo consultar empresas (${r.status})`);
      const respuesta = await r.json() as { records?: Registro[]; offset?: unknown };
      if (!Array.isArray(respuesta.records)) throw new Error("Formato de catálogo empresarial inválido");
      for (const registro of respuesta.records) {
        if (!ID.test(registro.id) || !registro.fields || typeof registro.fields !== "object")
          throw new Error("Empresa inválida en catálogo");
        const campos = registro.fields;
        const nombre = typeof campos.NOMBRE_COMERCIAL === "string" ? campos.NOMBRE_COMERCIAL.trim() : "";
        const clave = typeof campos.CLAVE_EMPRESA === "string" ? campos.CLAVE_EMPRESA.trim() : "";
        if (!nombre || !clave || (campos.ACTIVA !== true && campos.ACTIVA !== undefined && campos.ACTIVA !== false))
          throw new Error("Empresa con metadatos incompletos");
        const modulos: Modulo[] = [];
        let requiereRevision = false;
        const valores = campos.MODULOS_CONTRATADOS;
        if (valores !== undefined && !Array.isArray(valores)) requiereRevision = true;
        if (Array.isArray(valores)) for (const valor of valores) {
          const modulo = typeof valor === "string" ? normalizarNombreModulo(valor) : null;
          if (!modulo) { requiereRevision = true; continue; }
          if (modulo !== "CORE" && !modulos.includes(modulo)) modulos.push(modulo);
        }
        const estado = leerEstadoModulos(registro.id, campos.ACTIVA === true, campos.MODULOS_CONTRATADOS);
        empresas.push({ id: registro.id, nombre, clave, activa: campos.ACTIVA === true,
          modulosHabilitados: requiereRevision ? [] : modulos, requiereRevision: requiereRevision || !estado.ok,
          version: estado.ok ? estado.estado.version : null, esPlataforma: registro.id === admin.empresaId });
      }
      if (respuesta.offset !== undefined && (typeof respuesta.offset !== "string" || !respuesta.offset))
        throw new Error("Paginación de empresas inválida");
      offset = respuesta.offset as string | undefined;
    } while (offset);
    empresas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    const gestionHabilitada = process.env.OPTIMA_MODULES_CHANGES_ENABLED === "true" &&
      process.env.OPTIMA_AUDIT_WRITES_ENABLED === "true" &&
      /^tbl[A-Za-z0-9]{14}$/.test(process.env.AIRTABLE_AUDITORIA_TABLE_ID ?? "");
    return res.status(200).json({ ok: true, soloConsulta: !gestionHabilitada, gestionHabilitada, empresas });
  } catch (error) {
    console.error("11C.2: error en consulta de plataforma:", error);
    return res.status(503).json({ ok: false, error: "No se pudo verificar la administración OPTIMA" });
  }
}
