import { respuestaCoreSimulada } from "./ayuda-core-mock.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "../api/administracion/terceros.js";

test("Terceros: acceso por sesión, módulo y empresa", async (t) => {
  const originalFetch = globalThis.fetch;
  const names = [
    "UPSTASH_REDIS_KV_REST_API_URL",
    "UPSTASH_REDIS_KV_REST_API_TOKEN",
    "AIRTABLE_TOKEN",
    "AIRTABLE_USERS_BASE_ID",
    "AIRTABLE_USERS_TABLE_ID",
    "AIRTABLE_COMPANIES_TABLE_ID",
    "AIRTABLE_SUCURSALES_TABLE_ID",
    "OPTIMA_LEGACY_COMPANY_ID",
    "AIRTABLE_ADMIN_BASE_ID",
    "AIRTABLE_ADMIN_EMPRESAS_TABLE_ID",
    "AIRTABLE_ADMIN_TERCEROS_TABLE_NAME",
  ];
  const old: Record<string, string | undefined> = {};
  for (const name of names) old[name] = process.env[name];
  Object.assign(process.env, {
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-simulado.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
    AIRTABLE_TOKEN: "ficticio",
    AIRTABLE_USERS_BASE_ID: "appMaestraSimulada",
    AIRTABLE_USERS_TABLE_ID: "tblUsuariosSimulado",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresasMaestra",
    AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursalesMaestraPrueba",
    OPTIMA_LEGACY_COMPANY_ID: "rec00000000000002",
    AIRTABLE_ADMIN_BASE_ID: "appAdminSimulada",
    AIRTABLE_ADMIN_EMPRESAS_TABLE_ID: "tblEmpresasAdmin",
    AIRTABLE_ADMIN_TERCEROS_TABLE_NAME: "TERCEROS",
  });

  const state = { modulo: "ADMINISTRACION", clave: "Frioteka" };
  const userId = "rec00000000000001";
  const masterCompanyId = "rec00000000000002";
  const adminCompanyId = "rec00000000000003";
  const otherAdminCompanyId = "rec00000000000004";
  let requests = 0;

  globalThis.fetch = async (entry, init) => {
    requests++;
    const url = String(entry);
    const core = respuestaCoreSimulada(url, {
      base: "appMaestraSimulada", tablaUsuarios: "tblUsuariosSimulado",
      tablaEmpresas: "tblEmpresasMaestra",
      tablaSucursales: "tblSucursalesMaestraPrueba",
      usuarioId: userId, empresaId: masterCompanyId,
      modulos: [state.modulo], sucursales: ["GOYA"], claveEmpresa: state.clave,
    });
    if (core) return core;
    if (url === "https://redis-simulado.invalid") {
      const comando = JSON.parse(String(init?.body)) as string[];
      assert.equal(comando[0], "GET");
      if (comando[1]?.startsWith("optima:version-sesion:")) return Response.json({ result: null });
      return Response.json({ result: JSON.stringify({ usuarioId: userId }) });
    }
    if (url.includes(`/tblUsuariosSimulado/${userId}`)) {
      return Response.json({
        id: userId,
        fields: {
          USUARIO: "EMPLEADA_PRUEBA",
          ACTIVO: true,
          EMPRESA: [masterCompanyId],
          SUCURSAL: ["GOYA"],
          MODULOS: [state.modulo],
        },
      });
    }
    if (url.includes(`/tblEmpresasMaestra/${masterCompanyId}`)) {
      return Response.json({ id: masterCompanyId, fields: { CLAVE_EMPRESA: state.clave } });
    }
    if (url.includes("/tblEmpresasAdmin?")) {
      return Response.json({ records: [
        { id: adminCompanyId, fields: { CLAVE_EMPRESA: "FRIOTEKA" } },
        { id: otherAdminCompanyId, fields: { CLAVE_EMPRESA: "GUSTAVO SAND" } },
      ] });
    }
    if (url.includes("/TERCEROS?")) {
      return Response.json({ records: [
        { id: "rec00000000000005", fields: { TERCERO: "De Frioteka", EMPRESA: [adminCompanyId], ROLES: ["CLIENTE"], ACTIVO: true } },
        { id: "rec00000000000006", fields: { TERCERO: "Otra empresa", EMPRESA: [otherAdminCompanyId], ROLES: ["CLIENTE"], ACTIVO: true } },
        { id: "rec00000000000007", fields: { TERCERO: "Sin empresa", ROLES: ["CLIENTE"], ACTIVO: true } },
      ] });
    }
    throw new Error(`Solicitud externa inesperada: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function request(withCookie: boolean) {
    let status = 200;
    let body: any = null;
    const res = {
      setHeader() { return this; },
      status(code: number) { status = code; return this; },
      json(data: unknown) { body = data; return this; },
    } as unknown as VercelResponse;
    const req = {
      method: "GET",
      query: {},
      cookies: withCookie ? { optima_sesion: "a".repeat(43) } : {},
    } as unknown as VercelRequest;
    await handler(req, res);
    return { status, body };
  }

  const deniedNoCookie = await request(false);
  assert.equal(deniedNoCookie.status, 401);
  assert.equal(requests, 0, "No debe tocar Redis o Airtable sin cookie");

  state.modulo = "MOVIMIENTOS";
  assert.equal((await request(true)).status, 403);

  state.modulo = "ADMINISTRACION";
  state.clave = "OPTIMA";
  assert.equal((await request(true)).status, 403, "Sin equivalencia: no mostrar terceros");

  state.clave = "Frioteka";
  const allowed = await request(true);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.ok, true);
  assert.equal(allowed.body.terceros.length, 1, "Solo terceros vinculados a la empresa");
  assert.equal(allowed.body.terceros[0].tercero, "De Frioteka");
});
