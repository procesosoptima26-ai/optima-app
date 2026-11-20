import assert from "node:assert/strict";
import { test } from "node:test";
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import login from "../handlers/login.js";
import {
  MAX_INTENTOS_USUARIO,
  MAX_INTENTOS_IP,
  VENTANA_SEGUNDOS,
  clavesIntentosLogin,
  obtenerIpCliente,
  verificarBloqueo,
  registrarFallo,
  limpiarIntentosUsuario,
  type EjecutorRedis,
} from "../lib/limite-intentos-login.js";

// Redis en memoria con reloj controlable: ninguna conexión real.
class RedisFalso {
  datos = new Map<string, { valor: string; expiraMs: number | null }>();
  ahoraMs = 0;
  falla = false;

  avanzar(segundos: number) { this.ahoraMs += segundos * 1000; }

  private vivo(clave: string) {
    const d = this.datos.get(clave);
    if (d && d.expiraMs !== null && d.expiraMs <= this.ahoraMs) { this.datos.delete(clave); return undefined; }
    return d;
  }

  ejecutar: EjecutorRedis = async <T,>(comando: Array<string | number>): Promise<T> => {
    if (this.falla) throw new Error("Redis caído (simulado)");
    const [op, clave, ...resto] = comando.map(String);
    switch (op) {
      case "GET": return (this.vivo(clave)?.valor ?? null) as T;
      case "SET": {
        const nx = resto.includes("NX");
        const i = resto.indexOf("EX");
        if (nx && this.vivo(clave)) return null as T;
        this.datos.set(clave, { valor: resto[0], expiraMs: i >= 0 ? this.ahoraMs + Number(resto[i + 1]) * 1000 : null });
        return "OK" as T;
      }
      case "INCR": {
        const d = this.vivo(clave);
        const nuevo = Number(d?.valor ?? 0) + 1;
        this.datos.set(clave, { valor: String(nuevo), expiraMs: d?.expiraMs ?? null });
        return nuevo as T;
      }
      case "EXPIRE": {
        const d = this.vivo(clave);
        if (!d) return 0 as T;
        d.expiraMs = this.ahoraMs + Number(resto[0]) * 1000;
        return 1 as T;
      }
      case "TTL": {
        const d = this.vivo(clave);
        if (!d) return -2 as T;
        return (d.expiraMs === null ? -1 : Math.ceil((d.expiraMs - this.ahoraMs) / 1000)) as T;
      }
      case "DEL": return (this.datos.delete(clave) ? 1 : 0) as T;
      default: throw new Error(`Comando Redis no simulado: ${op}`);
    }
  };
}

const IP = "203.0.113.7";

async function fallar(redis: RedisFalso, usuario: string, ip = IP, veces = 1) {
  for (let i = 0; i < veces; i++) await registrarFallo(clavesIntentosLogin(usuario, ip), redis.ejecutar);
}
const estado = (redis: RedisFalso, usuario: string, ip = IP) =>
  verificarBloqueo(clavesIntentosLogin(usuario, ip), redis.ejecutar);

test("Usuario: 4 fallos no bloquean; el 5.º bloquea", async () => {
  const redis = new RedisFalso();
  await fallar(redis, "ana", IP, MAX_INTENTOS_USUARIO - 1);
  assert.equal((await estado(redis, "ana")).bloqueado, false);
  await fallar(redis, "ana");
  const e = await estado(redis, "ana");
  assert.equal(e.bloqueado, true);
  assert.equal(e.esperarSegundos, VENTANA_SEGUNDOS);
});

test("El bloqueo dura 15 minutos desde el 5.º fallo (no desde el primero) y luego se libera", async () => {
  const redis = new RedisFalso();
  await fallar(redis, "ana", IP, 4);
  redis.avanzar(VENTANA_SEGUNDOS - 60);          // casi vence la ventana del primer fallo
  await fallar(redis, "ana");                      // 5.º fallo
  redis.avanzar(120);                              // ya pasó la ventana original
  const bloqueada = await estado(redis, "ana");
  assert.equal(bloqueada.bloqueado, true, "sigue bloqueada: la ventana corre desde el 5.º fallo");
  assert.ok(bloqueada.esperarSegundos > 0 && bloqueada.esperarSegundos <= VENTANA_SEGUNDOS);
  redis.avanzar(VENTANA_SEGUNDOS);
  assert.equal((await estado(redis, "ana")).bloqueado, false);
});

test("Fallos viejos vencen solos: 4 fallos y 15 minutos después no quedan rastros", async () => {
  const redis = new RedisFalso();
  await fallar(redis, "ana", IP, 4);
  redis.avanzar(VENTANA_SEGUNDOS + 1);
  await fallar(redis, "ana");
  assert.equal((await estado(redis, "ana")).bloqueado, false);
});

test("Mayúsculas, minúsculas y espacios cuentan como el mismo usuario", async () => {
  const redis = new RedisFalso();
  for (const nombre of ["Ana", "ANA", " ana ", "aNa", "ana"]) await fallar(redis, nombre);
  assert.equal((await estado(redis, "ana")).bloqueado, true);
});

test("Otro usuario desde la misma IP no se bloquea por los fallos de ana", async () => {
  const redis = new RedisFalso();
  await fallar(redis, "ana", IP, MAX_INTENTOS_USUARIO);
  assert.equal((await estado(redis, "ana")).bloqueado, true);
  assert.equal((await estado(redis, "beto")).bloqueado, false);
});

test("Ingreso correcto reinicia el contador del usuario, pero no el de la IP", async () => {
  const redis = new RedisFalso();
  await fallar(redis, "ana", IP, 4);
  await limpiarIntentosUsuario(clavesIntentosLogin("ana", IP), redis.ejecutar);
  await fallar(redis, "ana", IP, 4);
  assert.equal((await estado(redis, "ana")).bloqueado, false, "empieza de cero");
  const claves = clavesIntentosLogin("ana", IP);
  assert.equal(await redis.ejecutar(["GET", claves.ip]), "8", "la IP conserva su historial");
});

test("IP: 30 fallos con usuarios distintos bloquean ese origen; otro origen no", async () => {
  const redis = new RedisFalso();
  for (let i = 0; i < MAX_INTENTOS_IP; i++) await fallar(redis, `usuario${i}`);
  assert.equal((await estado(redis, "nuevo")).bloqueado, true);
  assert.equal((await estado(redis, "nuevo", "198.51.100.9")).bloqueado, false);
});

test("Varios empleados de una misma oficina (misma IP) con pocos errores no se bloquean", async () => {
  const redis = new RedisFalso();
  for (let i = 0; i < 6; i++) await fallar(redis, `empleado${i}`, IP, 3);
  assert.equal((await estado(redis, "empleado0")).bloqueado, false);
});

test("Falla cerrada: si Redis falla, no se permite ni verificar ni registrar", async () => {
  const redis = new RedisFalso();
  redis.falla = true;
  await assert.rejects(() => estado(redis, "ana"));
  await assert.rejects(() => fallar(redis, "ana"));
});

test("Contador corrupto en Redis se trata como error, nunca como permiso", async () => {
  const redis = new RedisFalso();
  const claves = clavesIntentosLogin("ana", IP);
  await redis.ejecutar(["SET", claves.usuario, "basura", "EX", 60]);
  await assert.rejects(() => verificarBloqueo(claves, redis.ejecutar));
});

test("Todo contador tiene vencimiento: nunca queda una clave eterna", async () => {
  const redis = new RedisFalso();
  await fallar(redis, "ana");
  const claves = clavesIntentosLogin("ana", IP);
  for (const clave of [claves.usuario, claves.ip]) {
    const ttl = await redis.ejecutar<number>(["TTL", clave]);
    assert.ok(ttl > 0 && ttl <= VENTANA_SEGUNDOS, `TTL válido para ${clave}`);
  }
});

test("Redis no guarda el usuario ni la IP en claro", () => {
  const { usuario, ip } = clavesIntentosLogin("Ana.Perez", "203.0.113.7");
  for (const clave of [usuario, ip]) {
    assert.ok(!clave.toLowerCase().includes("ana"));
    assert.ok(!clave.includes("203.0.113.7"));
    assert.match(clave, /^optima:login-intentos:(usuario|ip):[0-9a-f]{64}$/);
  }
});

test("IP del cliente: toma el primer valor de x-forwarded-for y rechaza basura", () => {
  const con = (headers: Record<string, string | string[]>) => obtenerIpCliente({ headers } as unknown as VercelRequest);
  assert.equal(con({ "x-vercel-forwarded-for": "203.0.113.7" }), "203.0.113.7");
  assert.equal(con({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }), "203.0.113.7");
  assert.equal(con({ "x-forwarded-for": ["198.51.100.1, 10.0.0.1"] }), "198.51.100.1");
  assert.equal(con({}), "desconocida");
  assert.equal(obtenerIpCliente({} as VercelRequest), "desconocida");
  assert.equal(con({ "x-forwarded-for": "x".repeat(200) }), "desconocida");
});

// ---- Pruebas del login completo (Redis y Airtable simulados) ----

function respuestaFalsa() {
  const estado = { status: 200, body: null as unknown, headers: {} as Record<string, string> };
  const res = {
    setHeader(n: string, v: string) { estado.headers[n] = v; return this; },
    status(c: number) { estado.status = c; return this; },
    json(b: unknown) { estado.body = b; return this; },
  } as unknown as VercelResponse;
  return { estado, res };
}

function entornoLogin(t: { after: (fn: () => void) => void }, redis: RedisFalso, usuarios: Record<string, string>) {
  const original = globalThis.fetch;
  const vars: Record<string, string> = {
    AIRTABLE_TOKEN: "ficticio", AIRTABLE_USERS_BASE_ID: "appSimulada", AIRTABLE_USERS_TABLE_ID: "tblUsuarios",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid", UPSTASH_REDIS_KV_REST_API_TOKEN: "falso",
  };
  const previas = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    globalThis.fetch = original;
    for (const [k, v] of Object.entries(previas)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  const contadores = { consultasAirtable: 0 };
  globalThis.fetch = async (entrada, opciones) => {
    const url = new URL(String(entrada));
    if (url.host === "redis-prueba.invalid") {
      const resultado = await redis.ejecutar(JSON.parse(String(opciones?.body)) as string[]);
      return Response.json({ result: resultado });
    }
    assert.equal(url.host, "api.airtable.com", "Nunca conectar a una URL externa");
    assert.ok(!opciones?.method || opciones.method === "GET", "Airtable debe ser solo lectura");
    contadores.consultasAirtable++;
    const formula = url.searchParams.get("filterByFormula") ?? "";
    const nombre = Object.keys(usuarios).find((u) => formula.includes(`"${u.toLowerCase()}"`));
    if (!nombre) return Response.json({ records: [] });
    return Response.json({ records: [{ id: `rec${"A".repeat(14)}`, fields: { USUARIO: nombre, PASSWORD_HASH: usuarios[nombre] } }] });
  };
  return contadores;
}

const intento = (usuario: string, password: string, ip = IP) => ({
  method: "POST", body: { usuario, password }, headers: { "x-forwarded-for": ip },
} as unknown as VercelRequest);

test("Login: tras 5 contraseñas incorrectas, hasta la contraseña CORRECTA recibe 429 sin consultar Airtable", async (t) => {
  const redis = new RedisFalso();
  const hash = await argon2.hash("clave-correcta-123", { type: argon2.argon2id });
  const contadores = entornoLogin(t, redis, { ANA: hash });
  for (let i = 0; i < MAX_INTENTOS_USUARIO; i++) {
    const r = respuestaFalsa();
    await login(intento("ana", "incorrecta"), r.res);
    assert.equal(r.estado.status, 401);
  }
  const consultasAntes = contadores.consultasAirtable;
  const bloqueada = respuestaFalsa();
  await login(intento("ana", "clave-correcta-123"), bloqueada.res);
  assert.equal(bloqueada.estado.status, 429);
  assert.ok(Number(bloqueada.estado.headers["Retry-After"]) > 0);
  assert.equal(contadores.consultasAirtable, consultasAntes, "no se consultó la Base Maestra");
  assert.deepEqual(bloqueada.estado.body, { ok: false, error: "Demasiados intentos fallidos. Esperá unos minutos antes de volver a intentar." });
});

test("Login: un usuario inexistente también se bloquea y no hay forma de distinguirlo de uno real", async (t) => {
  const redis = new RedisFalso();
  entornoLogin(t, redis, {});
  const mensajes: unknown[] = [];
  for (let i = 0; i < MAX_INTENTOS_USUARIO; i++) {
    const r = respuestaFalsa();
    await login(intento("fantasma", "lo-que-sea"), r.res);
    assert.equal(r.estado.status, 401);
    mensajes.push(r.estado.body);
  }
  assert.ok(mensajes.every((m) => JSON.stringify(m) === JSON.stringify({ ok: false, error: "Usuario o contraseña incorrectos" })));
  const r = respuestaFalsa();
  await login(intento("fantasma", "lo-que-sea"), r.res);
  assert.equal(r.estado.status, 429);
});

test("Login: si Redis falla, responde 503 y no deja ingresar", async (t) => {
  const redis = new RedisFalso();
  redis.falla = true;
  entornoLogin(t, redis, {});
  const consola = console.error;
  console.error = () => undefined;
  try {
    const r = respuestaFalsa();
    await login(intento("ana", "x"), r.res);
    assert.equal(r.estado.status, 503);
  } finally { console.error = consola; }
});
