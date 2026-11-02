import { createHash, randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const COOKIE = "__Host-optima_session";
const DURACION_SEGUNDOS = 12 * 60 * 60;
const VALIDACION_SEGUNDOS = 60;
const PREFIJO = "optima:session:v1:";

export type UsuarioAutenticado = {
  usuario: string;
  nombre: string;
  empresa: string;
  empresaId: string;
  rol: string;
  sucursal: string;
  modulos: string[];
};

type SesionGuardada = {
  registroId: string;
  usuario: UsuarioAutenticado;
  verificadoEn: number;
};

type RegistroAirtable = {
  id: string;
  fields?: Record<string, unknown>;
};

function env(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error("Falta variable de entorno: " + nombre);
  return valor;
}

function texto(valor: unknown): string {
  if (typeof valor === "string") return valor.trim();
  if (Array.isArray(valor)) return valor.map(texto).filter(Boolean).join(", ");
  if (valor && typeof valor === "object") {
    const obj = valor as Record<string, unknown>;
    if (typeof obj.name === "string") return obj.name.trim();
  }
  return "";
}

function lista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map(texto).filter(Boolean);
  return texto(valor).split(",").map((x) => x.trim()).filter(Boolean);
}

function activo(valor: unknown): boolean {
  return valor === true || valor === 1 || valor === "1" || valor === "true";
}

function clave(token: string): string {
  return PREFIJO + createHash("sha256").update(token).digest("hex");
}

function cookie(req: VercelRequest): string | null {
  const cabecera = String(req.headers.cookie || "");
  const entrada = cabecera.split(";").map((x) => x.trim()).find((x) => x.startsWith(COOKIE + "="));
  if (!entrada) return null;
  const token = entrada.slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function cookieHeader(token: string, edad: number): string {
  return COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + edad;
}

async function redis(comando: Array<string | number>): Promise<unknown> {
  const respuesta = await fetch(env("UPSTASH_REDIS_KV_REST_API_URL"), {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env("UPSTASH_REDIS_KV_REST_API_TOKEN"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(comando),
  });
  if (!respuesta.ok) throw new Error("Redis no disponible (" + respuesta.status + ")");
  const datos = (await respuesta.json()) as { result?: unknown; error?: string };
  if (datos.error) throw new Error("Redis rechazó una operación");
  return datos.result;
}

async function registroUsuario(registroId: string): Promise<RegistroAirtable | null> {
  if (!/^rec[A-Za-z0-9]{14}$/.test(registroId)) return null;
  const url = "https://api.airtable.com/v0/" +
    env("AIRTABLE_USERS_BASE_ID") + "/" +
    encodeURIComponent(env("AIRTABLE_USERS_TABLE_ID")) + "/" + registroId;
  const respuesta = await fetch(url, {
    headers: { Authorization: "Bearer " + env("AIRTABLE_TOKEN") },
  });
  if (respuesta.status === 404) return null;
  if (!respuesta.ok) throw new Error("No se pudo validar el usuario en Airtable (" + respuesta.status + ")");
  return (await respuesta.json()) as RegistroAirtable;
}

async function empresaActual(empresaId: string): Promise<string> {
  if (!/^rec[A-Za-z0-9]{14}$/.test(empresaId)) return "";
  const url = "https://api.airtable.com/v0/" +
    env("AIRTABLE_USERS_BASE_ID") + "/" +
    encodeURIComponent(env("AIRTABLE_COMPANIES_TABLE_ID")) + "/" + empresaId;
  const respuesta = await fetch(url, {
    headers: { Authorization: "Bearer " + env("AIRTABLE_TOKEN") },
  });
  if (respuesta.status === 404) return "";
  if (!respuesta.ok) throw new Error("No se pudo validar la empresa (" + respuesta.status + ")");
  const registro = (await respuesta.json()) as RegistroAirtable;
  return texto(registro.fields?.NOMBRE_COMERCIAL);
}

async function refrescarUsuario(registroId: string): Promise<UsuarioAutenticado | null> {
  const registro = await registroUsuario(registroId);
  if (!registro?.fields || !activo(registro.fields.ACTIVO)) return null;
  const empresaId = lista(registro.fields.EMPRESA)[0] || "";
  const empresa = await empresaActual(empresaId);
  const sucursales = lista(registro.fields.SUCURSAL).map((x) => x.toUpperCase());
  if (!empresa || !sucursales.length) return null;
  return {
    usuario: texto(registro.fields.USUARIO),
    nombre: texto(registro.fields.NOMBRE),
    empresa,
    empresaId,
    rol: texto(registro.fields.ROL).toUpperCase(),
    sucursal: sucursales.join(", "),
    modulos: lista(registro.fields.MODULOS).map((x) => x.toUpperCase().replaceAll(" ", "_")),
  };
}

export async function crearSesion(
  res: VercelResponse,
  registroId: string,
  usuario: UsuarioAutenticado
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const sesion: SesionGuardada = {
    registroId,
    usuario,
    verificadoEn: Date.now(),
  };
  await redis(["SET", clave(token), JSON.stringify(sesion), "EX", DURACION_SEGUNDOS]);
  res.setHeader("Set-Cookie", cookieHeader(token, DURACION_SEGUNDOS));
  res.setHeader("Cache-Control", "no-store");
}

export async function obtenerSesion(req: VercelRequest): Promise<UsuarioAutenticado | null> {
  const token = cookie(req);
  if (!token) return null;
  const key = clave(token);
  const valor = await redis(["GET", key]);
  if (typeof valor !== "string") return null;
  let sesion: SesionGuardada;
  try {
    sesion = JSON.parse(valor) as SesionGuardada;
  } catch {
    return null;
  }
  if (!sesion.registroId || !sesion.usuario || !Number.isFinite(sesion.verificadoEn)) return null;
  if (Date.now() - sesion.verificadoEn < VALIDACION_SEGUNDOS * 1000) return sesion.usuario;
  const usuario = await refrescarUsuario(sesion.registroId);
  if (!usuario) {
    await redis(["DEL", key]);
    return null;
  }
  sesion.usuario = usuario;
  sesion.verificadoEn = Date.now();
  await redis(["SET", key, JSON.stringify(sesion), "KEEPTTL"]);
  return usuario;
}

export async function cerrarSesion(req: VercelRequest, res: VercelResponse): Promise<void> {
  const token = cookie(req);
  if (token) await redis(["DEL", clave(token)]);
  res.setHeader("Set-Cookie", cookieHeader("", 0));
  res.setHeader("Cache-Control", "no-store");
}

export function mismoOrigen(req: VercelRequest): boolean {
  const origen = req.headers.origin;
  if (!origen) return true;
  const host = req.headers.host;
  if (!host || Array.isArray(origen)) return false;
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

export function puedeSucursal(usuario: UsuarioAutenticado, sucursal: unknown): boolean {
  const pedida = texto(sucursal).toUpperCase();
  return !!pedida && usuario.sucursal.split(",").map((s) => s.trim().toUpperCase()).includes(pedida);
}

export function tieneModulo(usuario: UsuarioAutenticado, modulo: string): boolean {
  return usuario.modulos.includes(modulo);
}

export async function exigirSesion(
  req: VercelRequest,
  res: VercelResponse,
  modulo?: string
): Promise<UsuarioAutenticado | null> {
  res.setHeader("Cache-Control", "no-store");
  const usuario = await obtenerSesion(req);
  if (!usuario) {
    res.status(401).json({ ok: false, error: "Sesión vencida o inexistente. Volvé a ingresar." });
    return null;
  }
  if (modulo && !tieneModulo(usuario, modulo)) {
    res.status(403).json({ ok: false, error: "No tenés permiso para esta operación." });
    return null;
  }
  if (req.method !== "GET" && !mismoOrigen(req)) {
    res.status(403).json({ ok: false, error: "Origen no autorizado." });
    return null;
  }
  return usuario;
}

export async function permitirIntentoLogin(usuario: string, ip: string): Promise<boolean> {
  const identificador = createHash("sha256").update(usuario.toLowerCase() + "|" + ip).digest("hex");
  const key = "optima:login-attempts:v1:" + identificador;
  const cantidad = Number(await redis(["INCR", key]));
  if (cantidad === 1) await redis(["EXPIRE", key, 15 * 60]);
  return cantidad <= 12;
}

export async function limpiarIntentosLogin(usuario: string, ip: string): Promise<void> {
  const identificador = createHash("sha256").update(usuario.toLowerCase() + "|" + ip).digest("hex");
  await redis(["DEL", "optima:login-attempts:v1:" + identificador]);
}
