
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  generarTokenSesion,
  obtenerClaveSesion,
  guardarSesion,
  buscarSesion,
  renovarSesion,
  eliminarSesion,
  DURACION_INACTIVIDAD_SEGUNDOS,
} from "../lib/session.js";

test("Ciclo completo de una sesión OPTIMA", async (t) => {
  // Guardamos la configuración original.
  const fetchOriginal = globalThis.fetch;

  const urlOriginal =
    process.env.UPSTASH_REDIS_KV_REST_API_URL;

  const tokenOriginal =
    process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;

  // Credenciales inventadas: no corresponden a Redis real.
  process.env.UPSTASH_REDIS_KV_REST_API_URL =
    "https://redis-prueba.invalid";

  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN =
    "TOKEN_FICTICIO_PARA_PRUEBA";

  // Esta Map simula el almacenamiento de Redis.
  const redisSimulado = new Map<string, string>();

  // Reemplazamos temporalmente fetch.
  // No se realizarán conexiones a Internet.
  globalThis.fetch = async (_url, opciones) => {
    const comando = JSON.parse(
      String(opciones?.body)
    ) as Array<string | number>;

    const [operacion, clave, ...argumentos] = comando;
    const llave = String(clave);

    if (operacion === "SET") {
      assert.equal(argumentos[1], "EX");
      assert.equal(
        argumentos[2],
        DURACION_INACTIVIDAD_SEGUNDOS
      );

      redisSimulado.set(
        llave,
        String(argumentos[0])
      );

      return Response.json({ result: "OK" });
    }

    if (operacion === "GET") {
      return Response.json({
        result: redisSimulado.get(llave) ?? null,
      });
    }

    if (operacion === "EXPIRE") {
      assert.equal(
        argumentos[0],
        DURACION_INACTIVIDAD_SEGUNDOS
      );

      return Response.json({
        result: redisSimulado.has(llave) ? 1 : 0,
      });
    }

    if (operacion === "DEL") {
      const existia = redisSimulado.delete(llave);

      return Response.json({
        result: existia ? 1 : 0,
      });
    }

    return Response.json({
      error: "Comando desconocido",
    });
  };

  // Restauramos todo al terminar la prueba.
  t.after(() => {
    globalThis.fetch = fetchOriginal;

    if (urlOriginal === undefined) {
      delete process.env.UPSTASH_REDIS_KV_REST_API_URL;
    } else {
      process.env.UPSTASH_REDIS_KV_REST_API_URL =
        urlOriginal;
    }

    if (tokenOriginal === undefined) {
      delete process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
    } else {
      process.env.UPSTASH_REDIS_KV_REST_API_TOKEN =
        tokenOriginal;
    }
  });

  // PRUEBA 1: generar un token seguro.
  const token = generarTokenSesion();

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(obtenerClaveSesion(token));

  // PRUEBA 2: una sesión nueva no existe todavía.
  assert.equal(await buscarSesion(token), null);

  // PRUEBA 3: guardar la sesión.
  await guardarSesion(token, {
    usuarioId: "usuario-de-prueba",
  });

  // PRUEBA 4: recuperar los datos guardados.
  assert.deepEqual(await buscarSesion(token), {
    usuarioId: "usuario-de-prueba",
  });

  // PRUEBA 5: renovar la sesión.
  assert.equal(await renovarSesion(token), true);

  // PRUEBA 6: eliminarla.
  await eliminarSesion(token);

  // PRUEBA 7: confirmar que ya no existe.
  assert.equal(await buscarSesion(token), null);

  // PRUEBA 8: no renovar una sesión eliminada.
  assert.equal(await renovarSesion(token), false);
});
