/** Único acceso de escritura a USUARIOS en OPTIMA - BASE MAESTRA (Paso 9). */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buscarSesion, leerTokenSesion } from "./session.js";
import { leerAccesoCoreDesdeAirtable } from "../core/airtable.js";
import { puedeRealizarAccion, type ContextoCore } from "../core/seguridad.js";
import { opcionesParaAlta, type OpcionesAlta } from "../core/alta-usuarios.js";

export type RegistroAirtable = { id: string; fields: Record<string, unknown> };
const ID = /^rec[A-Za-z0-9]{14}$/;

function conf() {
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim();
  const tabla = process.env.AIRTABLE_USERS_TABLE_ID?.trim();
  const token = process.env.AIRTABLE_TOKEN?.trim();
  if (!base || !tabla || !token) throw new Error("Base Maestra no configurada");
  return { base, tabla, token };
}

export async function airtableUsuarios(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
  const { base, tabla, token } = conf();
  const url = new URL(`https://api.airtable.com/v0/${base}/${tabla}${path}`);
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error(`Fallo en USUARIOS de Base Maestra (${r.status})`);
  return await r.json() as Record<string, unknown>;
}

export async function leerUsuario(id: string): Promise<RegistroAirtable | null> {
  if (!ID.test(id)) return null;
  const r = await airtableUsuarios("GET", `/${id}`);
  return r.id === id && r.fields && typeof r.fields === "object" ? r as RegistroAirtable : null;
}

/** En el login heredado USUARIO sigue siendo global: jamás creamos duplicados. */
export async function existeNombreUsuario(usuario: string): Promise<boolean> {
  const seguro = usuario.toLowerCase().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const q = new URLSearchParams({ filterByFormula: `LOWER({USUARIO})="${seguro}"`, maxRecords: "1" });
  const r = await airtableUsuarios("GET", `?${q}`);
  return Array.isArray(r.records) && r.records.length > 0;
}

export async function crearUsuarioInactivo(campos: Record<string, unknown>): Promise<string> {
  const r = await airtableUsuarios("POST", "", { fields: campos, typecast: false });
  if (typeof r.id !== "string" || !ID.test(r.id)) throw new Error("Airtable no confirmó el usuario");
  return r.id;
}

export async function activarUsuario(id: string, passwordHash: string): Promise<void> {
  if (!ID.test(id) || !passwordHash.startsWith("$argon2id$")) throw new Error("Activación inválida");
  const r = await airtableUsuarios("PATCH", `/${id}`, { fields: { PASSWORD_HASH: passwordHash, ACTIVO: true }, typecast: false });
  if (r.id !== id) throw new Error("No se confirmó la activación");
}

/** Si falla el envío, retira SOLO una cuenta pendiente que todavía coincida.
 * Nunca borra un empleado activado, modificado ni de otra empresa.
 */
export async function retirarUsuarioPendiente(id: string, empresaId: string, email: string): Promise<boolean> {
  const actual = await leerUsuario(id);
  if (!actual || actual.fields.ACTIVO === true || actual.fields.PASSWORD_HASH ||
      actual.fields.Email !== email || !Array.isArray(actual.fields.EMPRESA) ||
      actual.fields.EMPRESA.length !== 1 || actual.fields.EMPRESA[0] !== empresaId) return false;
  const eliminado = await airtableUsuarios("DELETE", `/${id}`);
  return eliminado.id === id && eliminado.deleted === true;
}

export async function autenticarAdministrador(req: VercelRequest, res: VercelResponse): Promise<{
  contexto: ContextoCore; opciones: OpcionesAlta;
} | null> {
  res.setHeader("Cache-Control", "no-store");
  const token = leerTokenSesion(req);
  if (!token) { res.status(401).json({ ok: false, error: "Iniciá sesión" }); return null; }
  try {
    const sesion = await buscarSesion(token);
    if (!sesion) { res.status(401).json({ ok: false, error: "Sesión vencida" }); return null; }
    const acceso = await leerAccesoCoreDesdeAirtable(sesion.usuarioId);
    if (!acceso.ok || acceso.datosVista.rol !== "ADMIN" ||
        !puedeRealizarAccion(acceso.contexto, "usuarios.gestionar", { empresaId: acceso.contexto.empresa.id })) {
      res.status(403).json({ ok: false, error: "No tenés permiso para invitar empleados" });
      return null;
    }
    const raw = await leerUsuario(sesion.usuarioId);
    if (!raw || raw.fields.ACTIVO !== true) {
      res.status(403).json({ ok: false, error: "Cuenta administradora inválida" });
      return null;
    }
    return {
      contexto: acceso.contexto,
      opciones: opcionesParaAlta(acceso.contexto, raw.fields.MODULOS, raw.fields),
    };
  } catch (err) {
    console.error("No se pudo verificar administrador para alta:", err);
    res.status(503).json({ ok: false, error: "No se pudo verificar la autorización" });
    return null;
  }
}
