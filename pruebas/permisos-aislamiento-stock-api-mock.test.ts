/** Ninguna llamada de estas pruebas sale de los proveedores simulados. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { respuestaCoreSimulada, GOYA_CORE_ID } from "./ayuda-core-mock.js";
import stockLotes from "../api/stock-lotes.js";

const usuarioId = "rec00000000000001";
const empresaId = "rec00000000000002";
const productoId = "rec00000000000003";
const ubicacionId = "rec00000000000004";
const loteValido = "rec00000000000005";
const loteAmbiguo = "rec00000000000006";
const otroProducto = "rec00000000000007";
const otraUbicacion = "rec00000000000008";

const vars: Record<string, string> = {
  UPSTASH_REDIS_KV_REST_API_URL: "https://redis-mock.invalid",
  UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
  AIRTABLE_TOKEN: "ficticio",
  AIRTABLE_USERS_BASE_ID: "appMaestraPrueba",
  AIRTABLE_USERS_TABLE_ID: "USUARIOS",
  AIRTABLE_COMPANIES_TABLE_ID: "EMPRESAS_CORE",
  AIRTABLE_SUCURSALES_TABLE_ID: "SUCURSALES_CORE",
  OPTIMA_LEGACY_COMPANY_ID: empresaId,
  AIRTABLE_MOVIMIENTOS_BASE_ID: "appMaestraPrueba",
  AIRTABLE_STOCK_LOTES_TABLE_NAME: "STOCK_LOTES",
  AIRTABLE_UBICACIONES_TABLE_NAME: "UBICACIONES",
  AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME: "PRODUCTOS",
};

test("API de lotes: descarta vínculos múltiples y nunca entrega un lote ambiguo", async (t) => {
  const fetchAnterior = globalThis.fetch;
  const envAnterior = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    globalThis.fetch = fetchAnterior;
    for (const [k, v] of Object.entries(envAnterior)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  let lecturasStock = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const core = respuestaCoreSimulada(url, {
      base: vars.AIRTABLE_USERS_BASE_ID, tablaUsuarios: vars.AIRTABLE_USERS_TABLE_ID,
      tablaEmpresas: vars.AIRTABLE_COMPANIES_TABLE_ID, tablaSucursales: vars.AIRTABLE_SUCURSALES_TABLE_ID,
      usuarioId, empresaId, modulos: ["MOVIMIENTOS"], sucursales: ["GOYA"],
    });
    if (core) return core;
    if (url === vars.UPSTASH_REDIS_KV_REST_API_URL) {
      const command = JSON.parse(String(init?.body)) as string[];
      assert.equal(command[0], "GET");
      return Response.json({ result: command[1]?.startsWith("optima:version-sesion:") ? null : JSON.stringify({ usuarioId }) });
    }
    if (url.includes("/UBICACIONES?")) return Response.json({ records: [
      { id: ubicacionId, fields: { NOMBRE: "Depósito", SUCURSAL: "GOYA", SUCURSAL_CORE: [GOYA_CORE_ID], "TIPO_UBICACIÓN": "DEPÓSITO" } },
      { id: otraUbicacion, fields: { NOMBRE: "Otra", SUCURSAL: "GOYA", SUCURSAL_CORE: [GOYA_CORE_ID], "TIPO_UBICACIÓN": "GÓNDOLA" } },
    ] });
    if (url.includes("/PRODUCTOS?")) return Response.json({ records: [
      { id: productoId, fields: { EMPRESA: [empresaId], "CÓDIGO": 123, "NOMBRE MASTER": "Prueba" } },
      { id: otroProducto, fields: { EMPRESA: [empresaId], "CÓDIGO": 456, "NOMBRE MASTER": "Otra prueba" } },
    ] });
    if (url.endsWith(`/PRODUCTOS/${productoId}`)) return Response.json({ id: productoId, fields: { EMPRESA: [empresaId] } });
    if (url.includes("/STOCK_LOTES?")) {
      lecturasStock++;
      return Response.json({ records: [
        { id: loteValido, fields: { PRODUCTOS: [productoId], "UBICACIÓN": [ubicacionId], CANTIDAD_ACTUAL: 3 } },
        { id: loteAmbiguo, fields: { PRODUCTOS: [productoId, otroProducto], "UBICACIÓN": [ubicacionId], CANTIDAD_ACTUAL: 999 } },
        { id: "rec00000000000009", fields: { PRODUCTOS: [productoId], "UBICACIÓN": [ubicacionId, otraUbicacion], CANTIDAD_ACTUAL: 888 } },
      ] });
    }
    throw new Error(`Conexión no simulada: ${url}`);
  };
  async function consultar(query: Record<string, string>, autenticado = true) {
    let codigo = 200; let body: unknown;
    const res = { setHeader() { return this; }, status(n: number) { codigo = n; return this; }, json(data: unknown) { body = data; return this; } } as unknown as VercelResponse;
    const req = { method: "GET", cookies: autenticado ? { optima_sesion: "a".repeat(43) } : {}, query } as unknown as VercelRequest;
    await stockLotes(req, res);
    return { codigo, body: body as { lotes?: Array<{ id: string }>; cantidadTotal?: number } };
  }
  assert.equal((await consultar({ vista: "general", sucursal: "GOYA" }, false)).codigo, 401);
  assert.equal(lecturasStock, 0);
  const general = await consultar({ vista: "general", sucursal: "GOYA" });
  assert.equal(general.codigo, 200);
  assert.deepEqual(general.body.lotes?.map(x => x.id), [loteValido]);
  assert.equal(general.body.cantidadTotal, 3);
  const producto = await consultar({ productoId });
  assert.equal(producto.codigo, 200);
  assert.deepEqual(producto.body.lotes?.map(x => x.id), [loteValido]);
});
