/** Tokens opacos, de un solo uso y con vencimiento; Redis nunca guarda el token plano. */
import { createHash, randomBytes } from "node:crypto";

export const VENCIMIENTO_INVITACION_SEGUNDOS = 24 * 60 * 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^rec[A-Za-z0-9]{14}$/;

export type DatosInvitacion = Readonly<{
  usuarioId: string;
  empresaId: string;
  email: string;
  tipo: "activacion";
}>;

export function claveInvitacion(token: string): string {
  return "optima:invitacion:" + createHash("sha256").update(token).digest("hex");
}

async function redis<T>(comando: Array<string | number>): Promise<T> {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis no configurado");
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(comando),
  });
  if (!r.ok) throw new Error(`Redis no disponible (${r.status})`);
  const json = await r.json() as { result?: T; error?: string };
  if (json.error || !("result" in json)) throw new Error("Redis rechazó la operación");
  return json.result as T;
}

/** Reserva breve y atómica: dos invitaciones simultáneas no crean el mismo USUARIO. */
export async function reservarNombreUsuario(usuario: string): Promise<boolean> {
  if (!/^[A-Z0-9._-]{3,40}$/.test(usuario)) return false;
  const digest = createHash("sha256").update(usuario).digest("hex");
  const resultado = await redis<string | null>([
    "SET", `optima:reserva-usuario:${digest}`, "1", "NX", "EX", 60,
  ]);
  return resultado === "OK";
}

export async function crearInvitacion(datos: DatosInvitacion): Promise<string> {
  if (!ID.test(datos.usuarioId) || !ID.test(datos.empresaId) || !datos.email) {
    throw new Error("Invitación incompleta");
  }
  const token = randomBytes(32).toString("base64url");
  const respuesta = await redis<string>([
    "SET", claveInvitacion(token), JSON.stringify(datos), "EX", VENCIMIENTO_INVITACION_SEGUNDOS,
  ]);
  if (respuesta !== "OK") throw new Error("No se guardó la invitación");
  return token;
}

function convertirInvitacion(raw: string | null): DatosInvitacion | null {
  if (!raw || typeof raw !== "string") return null;
  let d: Record<string, unknown>;
  try { d = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (d.tipo !== "activacion" || typeof d.usuarioId !== "string" ||
      typeof d.empresaId !== "string" || typeof d.email !== "string" ||
      !ID.test(d.usuarioId) || !ID.test(d.empresaId) ||
      !d.email.includes("@")) return null;
  return { tipo: "activacion", usuarioId: d.usuarioId, empresaId: d.empresaId, email: d.email };
}

export async function consultarInvitacion(token: string): Promise<DatosInvitacion | null> {
  if (!TOKEN.test(token)) return null;
  return convertirInvitacion(await redis<string | null>(["GET", claveInvitacion(token)]));
}

/** GETDEL es atómico: dos solicitudes no pueden usar la misma invitación. */
export async function consumirInvitacion(token: string): Promise<DatosInvitacion | null> {
  if (!TOKEN.test(token)) return null;
  return convertirInvitacion(await redis<string | null>(["GETDEL", claveInvitacion(token)]));
}

export async function anularInvitacion(token: string): Promise<void> {
  if (TOKEN.test(token)) await redis<number>(["DEL", claveInvitacion(token)]);
}

export function validarClaveNueva(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length >= 12 && valor.length <= 128 &&
    /[a-zA-Z]/.test(valor) && /\d/.test(valor);
}
