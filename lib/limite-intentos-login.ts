import { createHash } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { ejecutarComandoRedis } from "./session.js";

// LÍMITE DE INTENTOS DE LOGIN
//
// Qué resuelve: impide que alguien pruebe contraseñas sin fin contra una cuenta.
// - Por USUARIO: 5 intentos fallidos y la cuenta se bloquea 15 minutos.
// - Por ORIGEN (IP): 30 intentos fallidos y ese origen se bloquea 15 minutos.
//   El límite por IP es más alto porque varios empleados de una misma empresa
//   comparten la misma IP de oficina y no deben bloquearse entre sí.
// Los contadores viven en Redis. Si Redis falla, el login se bloquea (falla cerrada).
// En Redis no se guardan nombres de usuario ni IP en claro: solo su huella (SHA-256).

export const MAX_INTENTOS_USUARIO = 5;
export const MAX_INTENTOS_IP = 30;
export const VENTANA_SEGUNDOS = 15 * 60;

export type EjecutorRedis = <T>(comando: Array<string | number>) => Promise<T>;

export type ClavesIntentos = { usuario: string; ip: string };

export type EstadoBloqueo = { bloqueado: boolean; esperarSegundos: number };

function huella(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

/** Mismas letras en mayúscula o minúscula cuentan como el mismo usuario. */
export function clavesIntentosLogin(usuario: string, ip: string): ClavesIntentos {
  const usuarioNormalizado = usuario.trim().toLowerCase();
  return {
    usuario: `optima:login-intentos:usuario:${huella(usuarioNormalizado)}`,
    ip: `optima:login-intentos:ip:${huella(ip)}`,
  };
}

/** En Vercel, el primer valor de x-forwarded-for es la IP real de quien consulta. */
export function obtenerIpCliente(req: VercelRequest): string {
  const cabecera = req.headers?.["x-vercel-forwarded-for"] ?? req.headers?.["x-forwarded-for"];
  const texto = Array.isArray(cabecera) ? cabecera[0] : cabecera;
  const primera = typeof texto === "string" ? texto.split(",")[0].trim() : "";
  return primera && primera.length <= 64 ? primera : "desconocida";
}

async function leerContador(redis: EjecutorRedis, clave: string): Promise<number> {
  const bruto = await redis<string | number | null>(["GET", clave]);
  const valor = bruto === null ? 0 : Number(bruto);
  if (!Number.isSafeInteger(valor) || valor < 0) throw new Error("Contador de intentos inválido");
  return valor;
}

async function segundosRestantes(redis: EjecutorRedis, clave: string): Promise<number> {
  const ttl = await redis<number>(["TTL", clave]);
  return Number.isSafeInteger(ttl) && ttl > 0 ? ttl : VENTANA_SEGUNDOS;
}

/** Se consulta ANTES de verificar la contraseña. Si está bloqueado, no se prueba nada. */
export async function verificarBloqueo(
  claves: ClavesIntentos,
  redis: EjecutorRedis = ejecutarComandoRedis
): Promise<EstadoBloqueo> {
  const [porUsuario, porIp] = await Promise.all([
    leerContador(redis, claves.usuario),
    leerContador(redis, claves.ip),
  ]);
  const usuarioBloqueado = porUsuario >= MAX_INTENTOS_USUARIO;
  const ipBloqueada = porIp >= MAX_INTENTOS_IP;
  if (!usuarioBloqueado && !ipBloqueada) return { bloqueado: false, esperarSegundos: 0 };

  const esperas = await Promise.all([
    usuarioBloqueado ? segundosRestantes(redis, claves.usuario) : Promise.resolve(0),
    ipBloqueada ? segundosRestantes(redis, claves.ip) : Promise.resolve(0),
  ]);
  return { bloqueado: true, esperarSegundos: Math.max(...esperas) };
}

async function sumarFallo(redis: EjecutorRedis, clave: string, maximo: number): Promise<void> {
  // Crea el contador CON vencimiento en un solo paso (NX = solo si no existe),
  // así nunca queda un contador eterno que bloquee para siempre.
  await redis<string | null>(["SET", clave, 0, "EX", VENTANA_SEGUNDOS, "NX"]);
  const total = await redis<number>(["INCR", clave]);
  if (!Number.isSafeInteger(total) || total < 1) throw new Error("No se confirmó el registro del intento fallido");
  // Al llegar al límite, el bloqueo dura la ventana completa desde ESE momento.
  if (total >= maximo) {
    const confirmado = await redis<number>(["EXPIRE", clave, VENTANA_SEGUNDOS]);
    if (confirmado !== 1) throw new Error("No se confirmó el bloqueo temporal");
  }
}

/** Se llama cuando el usuario no existe o la contraseña es incorrecta. */
export async function registrarFallo(
  claves: ClavesIntentos,
  redis: EjecutorRedis = ejecutarComandoRedis
): Promise<void> {
  await Promise.all([
    sumarFallo(redis, claves.usuario, MAX_INTENTOS_USUARIO),
    sumarFallo(redis, claves.ip, MAX_INTENTOS_IP),
  ]);
}

/** Tras un ingreso correcto se reinicia el contador de ESE usuario (no el de la IP). */
export async function limpiarIntentosUsuario(
  claves: ClavesIntentos,
  redis: EjecutorRedis = ejecutarComandoRedis
): Promise<void> {
  await redis<number>(["DEL", claves.usuario]);
}
