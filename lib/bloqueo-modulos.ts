/** Bloqueo por empresa para impedir escrituras simultáneas desde esta API. */
import { createHash, randomBytes } from "node:crypto";
const ID = /^rec[A-Za-z0-9]{14}$/;
function clave(id: string) {
  return "optima:gestion-modulos:" + createHash("sha256").update(id).digest("hex");
}
async function redis<T>(comando: Array<string | number>): Promise<T> {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis no configurado");
  const r = await fetch(url, { method: "POST", headers: {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
  }, body: JSON.stringify(comando) });
  if (!r.ok) throw new Error("Redis no disponible para bloqueo");
  const dato = await r.json() as { result?: T; error?: string };
  if (dato.error || !("result" in dato)) throw new Error("Redis rechazó bloqueo");
  return dato.result as T;
}
export async function bloquearModulos(id: string): Promise<string | null> {
  if (!ID.test(id)) return null;
  const owner = randomBytes(16).toString("hex");
  const r = await redis<string | null>(["SET", clave(id), owner, "NX", "EX", 120]);
  return r === "OK" ? owner : null;
}
export async function liberarModulos(id: string, owner: string): Promise<void> {
  if (!ID.test(id) || !/^[a-f0-9]{32}$/.test(owner)) return;
  await redis<number>(["EVAL",
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    1, clave(id), owner]);
}
