import { createHash, randomBytes } from "node:crypto";

const ID = /^rec[A-Za-z0-9]{14}$/;
const BLOQUEO_SEGUNDOS = 120;

function claveBloqueo(empresaId: string): string {
  return "optima:bloqueo-alta-sucursal:" +
    createHash("sha256").update(empresaId).digest("hex");
}

async function redis<T>(
  comando: Array<string | number>
): Promise<T> {
  const url = process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error("Redis no configurado");
  }

  const respuesta = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(comando),
  });

  if (!respuesta.ok) {
    throw new Error("Redis no disponible");
  }

  const datos = await respuesta.json() as {
    result?: T;
    error?: string;
  };

  if (datos.error || !("result" in datos)) {
    throw new Error("Redis rechazó la operación");
  }

  return datos.result as T;
}

/**
 * Reserva temporal por empresa.
 * Solo una creación de sucursal puede ejecutarse
 * a la vez dentro de esa empresa.
 */
export async function bloquearAltaSucursal(
  empresaId: string
): Promise<string | null> {
  if (!ID.test(empresaId)) return null;

  const propietario = randomBytes(16).toString("hex");

  const resultado = await redis<string | null>([
    "SET",
    claveBloqueo(empresaId),
    propietario,
    "NX",
    "EX",
    BLOQUEO_SEGUNDOS,
  ]);

  return resultado === "OK" ? propietario : null;
}

/**
 * Libera el bloqueo únicamente si
 * pertenece a esta solicitud.
 */
export async function liberarAltaSucursal(
  empresaId: string,
  propietario: string
): Promise<void> {
  if (
    !ID.test(empresaId) ||
    !/^[a-f0-9]{32}$/.test(propietario)
  ) return;

  await redis<number>([
    "EVAL",
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    1,
    claveBloqueo(empresaId),
    propietario,
  ]);
}
