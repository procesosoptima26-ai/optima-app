
import { createHash, randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// CONFIGURACIÓN

// Dos horas de inactividad, expresadas en segundos.
export const DURACION_INACTIVIDAD_SEGUNDOS = 2 * 60 * 60;

const NOMBRE_COOKIE_SESION = "optima_sesion";

// Información que Redis guarda de cada sesión.
export type DatosSesion = {
  usuarioId: string;
  versionSesion?: number;
};

// CONEXIÓN CON REDIS

async function ejecutarComandoRedis<T>(
  comando: Array<string | number>
): Promise<T> {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const tokenRedis = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;

  if (!url || !tokenRedis) {
    throw new Error("Redis no está configurado");
  }

  const respuesta = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenRedis}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(comando),
  });

  if (!respuesta.ok) {
    throw new Error(
      `Error de comunicación con Redis: ${respuesta.status}`
    );
  }

  const resultado = (await respuesta.json()) as {
    result?: T;
    error?: string;
  };

  if (resultado.error) {
    throw new Error("Redis rechazó la operación");
  }

  if (!Object.prototype.hasOwnProperty.call(resultado, "result")) {
    throw new Error("Respuesta de Redis inválida");
  }

  return resultado.result as T;
}

/** Contador persistente por usuario; un reset invalida TODAS sus sesiones antiguas. */
function claveVersionSesion(usuarioId: string): string {
  if (!/^rec[A-Za-z0-9]{14}$/.test(usuarioId)) throw new Error("Usuario de sesión inválido");
  return `optima:version-sesion:${usuarioId}`;
}

async function versionActualSesion(usuarioId: string): Promise<number> {
  const raw = await ejecutarComandoRedis<string | number | null>(["GET", claveVersionSesion(usuarioId)]);
  const version = raw === null ? 0 : Number(raw);
  if (!Number.isSafeInteger(version) || version < 0) throw new Error("Versión de sesión inválida");
  return version;
}

export async function revocarSesionesUsuario(usuarioId: string): Promise<void> {
  const valor = await ejecutarComandoRedis<number>(["INCR", claveVersionSesion(usuarioId)]);
  if (!Number.isSafeInteger(valor) || valor < 1) throw new Error("No se confirmó la revocación de sesiones");
}

// IDENTIFICADORES DE SESIÓN

export function generarTokenSesion(): string {
  return randomBytes(32).toString("base64url");
}

export function obtenerClaveSesion(token: string): string {
  const hash = createHash("sha256")
    .update(token)
    .digest("hex");

  return `optima:sesion:${hash}`;
}

// GUARDAR SESIÓN

export async function guardarSesion(
  token: string,
  datos: DatosSesion
): Promise<void> {
  if (!datos.usuarioId) {
    throw new Error("Falta identificar al usuario");
  }

  const versionSesion = await versionActualSesion(datos.usuarioId);
  const resultado = await ejecutarComandoRedis<string>([
    "SET",
    obtenerClaveSesion(token),
    JSON.stringify({ usuarioId: datos.usuarioId, versionSesion }),
    "EX",
    DURACION_INACTIVIDAD_SEGUNDOS,
  ]);

  if (resultado !== "OK") {
    throw new Error("Redis no confirmó el guardado");
  }
}

// BUSCAR SESIÓN

export async function buscarSesion(
  token: string
): Promise<DatosSesion | null> {
  const resultado = await ejecutarComandoRedis<string | null>([
    "GET",
    obtenerClaveSesion(token),
  ]);

  if (resultado === null) {
    return null;
  }

  if (typeof resultado !== "string") {
    throw new Error("Respuesta de sesión inválida");
  }

  const datos: unknown = JSON.parse(resultado);

  if (
    !datos ||
    typeof datos !== "object" ||
    !("usuarioId" in datos) ||
    typeof datos.usuarioId !== "string" ||
    !datos.usuarioId
  ) {
    throw new Error("Datos de sesión inválidos");
  }

  const versionSesion = "versionSesion" in datos ? datos.versionSesion : 0;
  if (typeof versionSesion !== "number" || !Number.isSafeInteger(versionSesion) || versionSesion < 0) {
    throw new Error("Versión de sesión corrupta");
  }
  if (versionSesion !== await versionActualSesion(datos.usuarioId)) return null;
  return { usuarioId: datos.usuarioId, versionSesion };
}

// RENOVAR SESIÓN POR ACTIVIDAD

export async function renovarSesion(
  token: string
): Promise<boolean> {
  const resultado = await ejecutarComandoRedis<number>([
    "EXPIRE",
    obtenerClaveSesion(token),
    DURACION_INACTIVIDAD_SEGUNDOS,
  ]);

  if (resultado !== 0 && resultado !== 1) {
    throw new Error("Redis no confirmó la renovación");
  }

  return resultado === 1;
}

// ELIMINAR SESIÓN

export async function eliminarSesion(
  token: string
): Promise<void> {
  const resultado = await ejecutarComandoRedis<number>([
    "DEL",
    obtenerClaveSesion(token),
  ]);

  if (resultado !== 0 && resultado !== 1) {
    throw new Error("Redis no confirmó la eliminación");
  }
}

// LEER LA COOKIE ENVIADA POR EL NAVEGADOR

export function leerTokenSesion(
  req: VercelRequest
): string | null {
  const token = req.cookies?.[NOMBRE_COOKIE_SESION];

  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    return null;
  }

  return token;
}

// CREAR O RENOVAR LA COOKIE

export function establecerCookieSesion(
  res: VercelResponse,
  token: string
): void {
  const opciones = [
    `${NOMBRE_COOKIE_SESION}=${token}`,
    `Max-Age=${DURACION_INACTIVIDAD_SEGUNDOS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];

  if (process.env.NODE_ENV === "production") {
    opciones.push("Secure");
  }

  res.setHeader("Set-Cookie", opciones.join("; "));
}

// BORRAR LA COOKIE AL CERRAR SESIÓN

export function borrarCookieSesion(
  res: VercelResponse
): void {
  const opciones = [
    `${NOMBRE_COOKIE_SESION}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];

  if (process.env.NODE_ENV === "production") {
    opciones.push("Secure");
  }

  res.setHeader("Set-Cookie", opciones.join("; "));
}
