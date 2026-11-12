/** Verifica el cruce de empresas entre Base Maestra y Administración sin red. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { respuestaCoreSimulada } from "./ayuda-core-mock.js";
import terceros from "../api/administracion/terceros.js";

const usuarioId = "rec00000000000001";
const empresaId = "rec00000000000002";
const empresaAjena = "rec00000000000009";
const empresaAdminId = "rec00000000000003";
const empresaAdminAjena = "rec00000000000004";

const variables: Record<string, string> = {
  UPSTASH_REDIS_KV_REST_API_URL: "https://redis-aislamiento.invalid",
  UPSTASH_REDIS_KV_REST_API_TOKEN: "falso",
  AIRTABLE_TOKEN: "falso",
  AIRTABLE_USERS_BASE_ID: "appMaestraTest",
  AIRTABLE_USERS_TABLE_ID: "USUARIOS",
  AIRTABLE_COMPANIES_TABLE_ID: "EMPRESAS_CORE",
  AIRTABLE_SUCURSALES_TABLE_ID: "SUCURSALES_CORE",
  OPTIMA_LEGACY_COMPANY_ID: empresaId,
  AIRTABLE_ADMIN_BASE_ID: "appAdminTest",
  AIRTABLE_ADMIN_EMPRESAS_TABLE_ID: "EMPRESAS_ADMIN",
  AIRTABLE_ADMIN_TERCEROS_TABLE_NAME: "TERCEROS",
};

test("API terceros: una respuesta de empresa maestra con ID diferente impide consultar datos", async (t) => {
  const anterior = globalThis.fetch;
  const prev = Object.fromEntries(Object.keys(variables).map(k => [k, process.env[k]]));
  Object.assign(process.env, variables);
  t.after(() => {
    globalThis.fetch = anterior;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  let empresaLecturas = 0;
  let adminLecturas = 0;
  let respuestaCruzada = true;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === variables.UPSTASH_REDIS_KV_REST_API_URL) {
      const command = JSON.parse(String(init?.body)) as string[];
      assert.equal(command[0], "GET");
      return Response.json({ result: command[1]?.startsWith("optima:version-sesion:") ? null : JSON.stringify({ usuarioId }) });
    }
    if (url.includes(`/EMPRESAS_CORE/${empresaId}`)) {
      empresaLecturas++;
      if (empresaLecturas % 2 === 0) {
        return Response.json({ id: respuestaCruzada ? empresaAjena : empresaId, fields: { CLAVE_EMPRESA: "PILOTO" } });
      }
    }
    const core = respuestaCoreSimulada(url, {
      base: variables.AIRTABLE_USERS_BASE_ID, tablaUsuarios: variables.AIRTABLE_USERS_TABLE_ID,
      tablaEmpresas: variables.AIRTABLE_COMPANIES_TABLE_ID, tablaSucursales: variables.AIRTABLE_SUCURSALES_TABLE_ID,
      usuarioId, empresaId, modulos: ["ADMINISTRACION"], sucursales: ["GOYA"], claveEmpresa: "PILOTO",
    });
    if (core) return core;
    if (url.includes("/EMPRESAS_ADMIN?")) {
      adminLecturas++;
      return Response.json({ records: [
        { id: empresaAdminId, fields: { CLAVE_EMPRESA: "PILOTO" } },
        { id: empresaAdminAjena, fields: { CLAVE_EMPRESA: "AJENA" } },
      ] });
    }
    if (url.includes("/TERCEROS?")) {
      adminLecturas++;
      return Response.json({ records: [
        { id: "rec00000000000005", fields: { TERCERO: "Propio", EMPRESA: [empresaAdminId] } },
        { id: "rec00000000000006", fields: { TERCERO: "Ajeno", EMPRESA: [empresaAdminAjena] } },
      ] });
    }
    throw new Error(`Solicitud no simulada: ${url}`);
  };
  async function consulta() {
    let codigo = 200; let body: unknown;
    const res = { setHeader() { return this; }, status(n: number) { codigo = n; return this; }, json(d: unknown) { body = d; return this; } } as unknown as VercelResponse;
    const req = { method: "GET", query: {}, cookies: { optima_sesion: "a".repeat(43) } } as unknown as VercelRequest;
    await terceros(req, res);
    return { codigo, body: body as { terceros?: Array<{ tercero: string }> } };
  }
  const denegado = await consulta();
  assert.equal(denegado.codigo, 403);
  assert.equal(adminLecturas, 0, "No se deben leer terceros con una relación empresarial inconsistente");
  respuestaCruzada = false;
  const permitido = await consulta();
  assert.equal(permitido.codigo, 200);
  assert.deepEqual(permitido.body.terceros?.map(t => t.tercero), ["Propio"]);
});
