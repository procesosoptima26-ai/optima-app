import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "../handlers/core/sucursales.js";

const ID = (letra: string) => "rec" + letra.repeat(14);
const TABLA = (letra: string) => "tbl" + letra.repeat(14);
const ADMIN = ID("A");
const EMPRESA = ID("B");
const SUCURSAL = ID("C");
const NUEVA = ID("D");
const USUARIOS = TABLA("U");
const EMPRESAS = TABLA("E");
const SUCURSALES = TABLA("S");
const TOKEN = "s".repeat(43);

test("11B: alta exige permiso, valida duplicados y limita escritura", async (t) => {
  const fetchAnterior = globalThis.fetch;
  const variables = {
    AIRTABLE_USERS_BASE_ID: "app" + "X".repeat(14),
    AIRTABLE_USERS_TABLE_ID: USUARIOS,
    AIRTABLE_COMPANIES_TABLE_ID: EMPRESAS,
    AIRTABLE_SUCURSALES_TABLE_ID: SUCURSALES,
    AIRTABLE_TOKEN: "ficticio",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-prueba.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
  };
  const originales = Object.fromEntries(
    Object.keys(variables).map(k => [k, process.env[k]])
  );
  Object.assign(process.env, variables);

  t.after(() => {
    globalThis.fetch = fetchAnterior;
    for (const [k, v] of Object.entries(originales)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  let autorizado = false;
  let escrituras = 0;
  let bloqueoActivo = false;

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const ruta = url.pathname;

    if (url.hostname === "redis-prueba.invalid") {
      const [comando, clave] = JSON.parse(String(init?.body));

      if (comando === "GET") {
        return Response.json({
          result: String(clave).startsWith("optima:version-sesion:")
            ? null
            : JSON.stringify({ usuarioId: ADMIN, versionSesion: 0 }),
        });
      }

      if (comando === "SET") {
        assert.ok(String(clave).startsWith("optima:bloqueo-alta-sucursal:"));
        if (bloqueoActivo) return Response.json({ result: null });
        bloqueoActivo = true;
        return Response.json({ result: "OK" });
      }

      if (comando === "EVAL") {
        assert.equal(bloqueoActivo, true);
        bloqueoActivo = false;
        return Response.json({ result: 1 });
      }

      throw Error("Comando Redis no simulado: " + comando);
    }

    assert.equal(url.hostname, "api.airtable.com");

    if (ruta.endsWith(`/${USUARIOS}/${ADMIN}`)) {
      return Response.json({ id: ADMIN, fields: {
        USUARIO: "ADMIN", ROL: "ADMIN", ACTIVO: true,
        EMPRESA: [EMPRESA], MODULOS: ["USUARIO"],
        SUCURSALES_AUTORIZADAS: [SUCURSAL],
        SUCURSAL_PREDETERMINADA: [SUCURSAL],
        PERMISOS_USUARIOS: ["GESTIONAR USUARIOS"],
        ...(autorizado ? {
          PERMISOS_SUCURSALES: ["GESTIONAR SUCURSALES"]
        } : {}),
      } });
    }

    if (ruta.endsWith(`/${EMPRESAS}/${EMPRESA}`)) {
      return Response.json({ id: EMPRESA, fields: {
        ACTIVA: true, CLAVE_EMPRESA: "PRUEBA",
        MODULOS_CONTRATADOS: ["USUARIO"],
        SUCURSALES: [SUCURSAL],
      } });
    }

    if (ruta.endsWith(`/${SUCURSALES}/${SUCURSAL}`)) {
      return Response.json({ id: SUCURSAL, fields: {
        NOMBRE: "Bella Vista", ACTIVA: true,
        EMPRESA: [EMPRESA],
      } });
    }

    if (ruta.endsWith(`/${SUCURSALES}`) && init?.method === "POST") {
      escrituras++;
      const datos = JSON.parse(String(init.body));
      assert.equal(datos.typecast, false);
      assert.deepEqual(datos.fields.EMPRESA, [EMPRESA]);
      assert.deepEqual(Object.keys(datos.fields).sort(),
        ["NOMBRE", "EMPRESA", "ACTIVA"].sort());
      return Response.json({
        id: NUEVA, fields: datos.fields,
      });
    }

    throw Error("Consulta no simulada: " + ruta);
  };

  async function solicitar(nombre: string, cookie = true) {
    const req = {
      method: "POST",
      query: {},
      cookies: cookie ? { optima_sesion: TOKEN } : {},
      body: { accion: "crear", nombre },
    } as unknown as VercelRequest;

    const salida = { codigo: 200 };
    const res = {
      setHeader() { return this; },
      status(codigo: number) { salida.codigo = codigo; return this; },
      json() { return this; },
    } as unknown as VercelResponse;

    await handler(req, res);
    return salida.codigo;
  }

  assert.equal(await solicitar("Santa Lucía", false), 401);
  assert.equal(await solicitar("Santa Lucía"), 403);
  assert.equal(escrituras, 0);

  autorizado = true;

  bloqueoActivo = true;
  assert.equal(await solicitar("Santa Lucía"), 409);
  assert.equal(escrituras, 0);
  bloqueoActivo = false;

  assert.equal(await solicitar("bella vista"), 400);
  assert.equal(escrituras, 0);
  assert.equal(bloqueoActivo, false);

  assert.equal(await solicitar("Santa Lucía"), 201);
  assert.equal(escrituras, 1);
  assert.equal(bloqueoActivo, false);
});
