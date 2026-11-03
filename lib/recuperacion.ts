/** Recuperación: tokens aleatorios, TTL breve, hash SHA-256 en la clave Redis. */
import { createHash, randomBytes } from "node:crypto";

export const DURACION_RECUPERACION_SEGUNDOS = 30 * 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^rec[A-Za-z0-9]{14}$/;
export type DatosRecuperacion = Readonly<{
  usuarioId: string;
  empresaId: string;
  email: string;
  huellaPassword: string;
}>;

const digest = (valor: string) => createHash("sha256").update(valor).digest("hex");
export const huellaPassword = (hash: string) => digest(hash);
const clave = (token: string) => `optima:recuperacion:${digest(token)}`;

export async function comandoRedis<T>(comando: Array<string | number>): Promise<T> {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis no configurado");
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(comando),
  });
  if (!r.ok) throw new Error(`Redis no disponible (${r.status})`);
  const result = await r.json() as { result?: T; error?: string };
  if (result.error || !Object.prototype.hasOwnProperty.call(result, "result"))
    throw new Error("Respuesta de Redis inválida");
  return result.result as T;
}

/** Cooldown por identidad: no se almacena el email ni el nombre en claro como clave. */
export async function reservarSolicitud(usuario: string, email: string): Promise<boolean> {
  const key = `optima:recuperacion:cooldown:${digest(usuario + "|" + email)}`;
  const valor = await comandoRedis<string | null>(["SET", key, "1", "NX", "EX", 180]);
  return valor === "OK";
}

/** Límite adicional por IP, si Vercel proporciona una IP confiable. */
export async function permitirOrigen(ip: string): Promise<boolean> {
  if (!ip || ip.length > 100) return true;
  const key = `optima:recuperacion:origen:${digest(ip)}`;
  const total = await comandoRedis<number>(["INCR", key]);
  if (total === 1) await comandoRedis<number>(["EXPIRE", key, 3600]);
  return Number.isSafeInteger(total) && total <= 20;
}

export async function crearRecuperacion(datos: DatosRecuperacion): Promise<string> {
  if (!ID.test(datos.usuarioId) || !ID.test(datos.empresaId) ||
      !datos.email.includes("@") || !/^[a-f0-9]{64}$/.test(datos.huellaPassword))
    throw new Error("Datos de recuperación inválidos");
  const token = randomBytes(32).toString("base64url");
  const resultado = await comandoRedis<string>([
    "SET", clave(token), JSON.stringify(datos), "EX", DURACION_RECUPERACION_SEGUNDOS,
  ]);
  if (resultado !== "OK") throw new Error("Redis no confirmó el token");
  return token;
}

export async function consultarRecuperacion(token: string): Promise<DatosRecuperacion | null> {
  if (!TOKEN.test(token)) return null;
  const raw = await comandoRedis<string | null>(["GET", clave(token)]);
  if (!raw || typeof raw !== "string") return null;
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== "object") return null;
  const v = d as Record<string, unknown>;
  if (typeof v.usuarioId !== "string" || !ID.test(v.usuarioId) ||
      typeof v.empresaId !== "string" || !ID.test(v.empresaId) ||
      typeof v.email !== "string" || !v.email.includes("@") ||
      typeof v.huellaPassword !== "string" || !/^[a-f0-9]{64}$/.test(v.huellaPassword)) return null;
  return { usuarioId: v.usuarioId, empresaId: v.empresaId, email: v.email, huellaPassword: v.huellaPassword };
}

/** Protección contra dos restablecimientos simultáneos del mismo enlace. */
export async function bloquearRecuperacion(token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const owner = randomBytes(16).toString("hex");
  const result = await comandoRedis<string | null>([
    "SET", `optima:recuperacion:bloqueo:${digest(token)}`, owner, "NX", "EX", 120,
  ]);
  return result === "OK" ? owner : null;
}

export async function liberarRecuperacion(token: string, owner: string): Promise<void> {
  if (!TOKEN.test(token) || !/^[a-f0-9]{32}$/.test(owner)) return;
  await comandoRedis<number>([
    "EVAL",
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    1, `optima:recuperacion:bloqueo:${digest(token)}`, owner,
  ]);
}

export async function anularRecuperacion(token: string): Promise<void> {
  if (TOKEN.test(token)) await comandoRedis<number>(["DEL", clave(token)]);
}
