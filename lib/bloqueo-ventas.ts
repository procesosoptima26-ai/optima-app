/**
 * OPTIMA — candado contra doble carga de un mismo archivo de ventas.
 *
 * Problema: "ya cargado" se detecta mirando los movimientos que YA existen. Si
 * dos pedidos de confirmación llegan casi juntos (doble toque, dos personas,
 * dos pestañas), ambos miran antes de que el otro termine de guardar y los
 * dos descuentan. El candado hace que se atiendan de a uno: el segundo espera
 * a que el primero termine y recién ahí ve lo ya cargado.
 *
 * Es por archivo + ubicación, así que no frena otras operaciones.
 */
import { createHash, randomBytes } from "node:crypto";

export type EjecutorRedis = (comando: Array<string | number>) => Promise<unknown>;

const SEGUNDOS_MAXIMOS = 90;

export function claveBloqueoVentas(ubicacionId: string, etiqueta: string): string {
  const huella = createHash("sha256").update(`${ubicacionId}\u0000${etiqueta}`).digest("hex");
  return `optima:ventas-archivo:${huella}`;
}

export async function ejecutarRedisReal(comando: Array<string | number>): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis no configurado");
  const respuesta = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(comando),
  });
  if (!respuesta.ok) throw new Error("Redis no disponible");
  const dato = (await respuesta.json()) as { result?: unknown; error?: string };
  if (dato.error || !("result" in dato)) throw new Error("Redis rechazó el pedido");
  return dato.result;
}

/** Devuelve un "dueño" si tomó el candado, o null si otra carga del mismo archivo está en curso. */
export async function tomarBloqueoVentas(
  ubicacionId: string, etiqueta: string, ejecutar: EjecutorRedis = ejecutarRedisReal,
): Promise<string | null> {
  const dueno = randomBytes(16).toString("hex");
  const resultado = await ejecutar(["SET", claveBloqueoVentas(ubicacionId, etiqueta), dueno, "NX", "EX", SEGUNDOS_MAXIMOS]);
  return resultado === "OK" ? dueno : null;
}

/** Solo libera si el candado sigue siendo nuestro (si venció y lo tomó otro, no lo pisa). */
export async function liberarBloqueoVentas(
  ubicacionId: string, etiqueta: string, dueno: string, ejecutar: EjecutorRedis = ejecutarRedisReal,
): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(dueno)) return;
  await ejecutar([
    "EVAL",
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    1, claveBloqueoVentas(ubicacionId, etiqueta), dueno,
  ]);
}
