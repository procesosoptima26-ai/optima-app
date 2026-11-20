/**
 * OPTIMA Core — adaptadores REALES de los avisos de vencimiento (Tarea 5, avisos):
 * Airtable (empresas y administradores), Redis (reserva anti-duplicados) y Resend (correo).
 * Solo se ejecutan desde handlers/core/avisos-ciclo-vida.ts. Todo falla cerrado: ante cualquier
 * duda se devuelve null / false y no se envía nada.
 */
import { ejecutarRedis } from "./almacen-derechos-redis.js";
import { leerIdEmpresaEstable } from "./empresa-estable.js";
import type { CorreoAviso } from "../core/avisos-proceso.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const MAX_PAGINAS = 20;
type Registro = { id: string; fields: Record<string, unknown> };
export type EmpresaCliente = Readonly<{ recId: string; nombre: string; idEstable: string }>;

function configuracion(): { base: string; usuarios: string; empresas: string; token: string } {
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim();
  const usuarios = process.env.AIRTABLE_USERS_TABLE_ID?.trim();
  const empresas = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim();
  const token = process.env.AIRTABLE_TOKEN?.trim();
  if (!base || !usuarios || !empresas || !token) throw new Error("Base Maestra no configurada");
  return { base, usuarios, empresas, token };
}

async function paginas(tabla: "usuarios" | "empresas", parametros: URLSearchParams): Promise<Registro[]> {
  const c = configuracion();
  const salida: Registro[] = [];
  let offset: string | undefined;
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const q = new URLSearchParams(parametros);
    q.set("pageSize", "100");
    if (offset) q.set("offset", offset);
    const r = await fetch(`https://api.airtable.com/v0/${c.base}/${c[tabla]}?${q}`,
      { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Base Maestra respondió ${r.status}`);
    const cuerpo = await r.json() as { records?: unknown; offset?: unknown };
    if (!Array.isArray(cuerpo.records)) throw new Error("Respuesta inválida de Base Maestra");
    for (const reg of cuerpo.records as Registro[]) {
      if (reg && typeof reg.id === "string" && ID.test(reg.id) && reg.fields && typeof reg.fields === "object") salida.push(reg);
    }
    if (typeof cuerpo.offset !== "string") return salida;
    offset = cuerpo.offset;
  }
  throw new Error("Demasiadas páginas en Base Maestra");
}

function aEmpresaCliente(reg: Registro): EmpresaCliente | null {
  const plataforma = process.env.OPTIMA_PLATFORM_COMPANY_ID?.trim();
  const idEstable = leerIdEmpresaEstable(reg.fields);
  const nombre = typeof reg.fields.NOMBRE_COMERCIAL === "string" ? reg.fields.NOMBRE_COMERCIAL.trim() : "";
  if (reg.fields.ACTIVA !== true || !idEstable || !nombre || reg.id === plataforma) return null;
  return { recId: reg.id, nombre, idEstable };
}

export async function listarEmpresasClientes(): Promise<EmpresaCliente[]> {
  const q = new URLSearchParams();
  for (const f of ["NOMBRE_COMERCIAL", "ACTIVA", "ID_EMPRESA_ESTABLE"]) q.append("fields[]", f);
  const regs = await paginas("empresas", q);
  return regs.map(aEmpresaCliente).filter((e): e is EmpresaCliente => e !== null);
}

export async function leerEmpresaCliente(recId: string): Promise<EmpresaCliente | null> {
  if (!ID.test(recId)) return null;
  const c = configuracion();
  const r = await fetch(`https://api.airtable.com/v0/${c.base}/${c.empresas}/${recId}`,
    { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Base Maestra respondió ${r.status}`);
  const reg = await r.json() as Registro;
  return reg && reg.id === recId && reg.fields ? aEmpresaCliente(reg) : null;
}

/** Correos de los usuarios ADMIN activos que pertenecen EXACTAMENTE a esa empresa. */
export async function listarCorreosAdministradores(recEmpresaId: string): Promise<string[] | null> {
  if (!ID.test(recEmpresaId)) return null;
  try {
    const q = new URLSearchParams({ filterByFormula: 'AND({ACTIVO}=1,{ROL}="ADMIN")' });
    for (const f of ["ACTIVO", "ROL", "EMPRESA", "Email"]) q.append("fields[]", f);
    const regs = await paginas("usuarios", q);
    const correos: string[] = [];
    for (const { fields } of regs) {
      const emp = fields.EMPRESA;
      if (fields.ACTIVO !== true || fields.ROL !== "ADMIN" || !Array.isArray(emp) || emp.length !== 1 ||
          emp[0] !== recEmpresaId || typeof fields.Email !== "string") continue;
      correos.push(fields.Email);
    }
    return correos;
  } catch { return null; }
}

export async function reservarAvisoRedis(clave: string, vigenciaSegundos: number): Promise<boolean> {
  const r = await ejecutarRedis(["SET", clave, "1", "NX", "EX", vigenciaSegundos]);
  if (r === "OK") return true;
  if (r === null) return false;
  throw new Error("Redis devolvió una respuesta inesperada");
}

export async function liberarAvisoRedis(clave: string): Promise<void> {
  await ejecutarRedis(["DEL", clave]);
}

export async function enviarCorreoResend(correo: CorreoAviso): Promise<boolean> {
  const clave = process.env.RESEND_API_KEY;
  const remitente = process.env.OPTIMA_EMAIL_FROM;
  if (!clave || !remitente) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json", "User-Agent": "optima-app/1.0" },
    body: JSON.stringify({ from: remitente, to: [correo.para], subject: correo.asunto, text: correo.texto }),
    signal: AbortSignal.timeout(10000),
  });
  return r.ok;
}
