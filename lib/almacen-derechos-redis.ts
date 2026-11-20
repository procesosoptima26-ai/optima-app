/**
 * OPTIMA Core — almacén REDIS (Upstash REST) para la caché de derechos resueltos (Tarea 6).
 * Usa las mismas variables que las sesiones. No conserva datos personales: solo marcas "1" con
 * vencimiento y un contador de generación por empresa.
 */
import { claveGeneracionEmpresa, type AlmacenDerechos } from "../core/cache-derechos.js";
import { esIdEmpresaEstable } from "./empresa-estable.js";

type Ejecutar = (comando: Array<string | number>) => Promise<unknown>;

export async function ejecutarRedis(comando: Array<string | number>): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Redis no está configurado");
  const r = await fetch(url, { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(comando), signal: AbortSignal.timeout(1500) });
  if (!r.ok) throw new Error("Redis no respondió");
  const cuerpo = await r.json() as { result?: unknown; error?: string };
  if (cuerpo.error || !Object.prototype.hasOwnProperty.call(cuerpo, "result")) throw new Error("Redis rechazó la operación");
  return cuerpo.result;
}

export function ambienteActual(): string {
  const a = process.env.VERCEL_ENV;
  return a === "production" || a === "preview" || a === "development" ? a : "local";
}

export function crearAlmacenDerechosRedis(
  ambiente: string = ambienteActual(), ejecutar: Ejecutar = ejecutarRedis,
): AlmacenDerechos {
  return {
    async leerGeneracion(emp) {
      const raw = await ejecutar(["GET", claveGeneracionEmpresa(ambiente, emp)]);
      const n = raw === null ? 0 : Number(raw);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error("Generación inválida");
      return n;
    },
    async existe(clave) { return (await ejecutar(["EXISTS", clave])) === 1; },
    async guardar(clave, ttl) {
      if ((await ejecutar(["SET", clave, "1", "EX", ttl])) !== "OK") throw new Error("Redis no confirmó el guardado");
    },
    async invalidarEmpresa(emp) {
      if (!esIdEmpresaEstable(emp)) throw new Error("Empresa inválida");
      const n = await ejecutar(["INCR", claveGeneracionEmpresa(ambiente, emp)]);
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) throw new Error("Redis no confirmó la invalidación");
    },
  };
}
