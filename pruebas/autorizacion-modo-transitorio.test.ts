import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirAutorizacion } from "../lib/autorizacion.js";
import { respuestaCoreSimulada } from "./ayuda-core-mock.js";

const usuarioId = "rec11111111111111";
const empresaId = "rec99999999999999";

function respuesta() {
  const estado = { codigo: 200, cuerpo: null as unknown };
  const res = {
    setHeader() { return this; },
    status(valor: number) { estado.codigo = valor; return this; },
    json(valor: unknown) { estado.cuerpo = valor; return this; },
  } as unknown as VercelResponse;
  return { estado, res };
}

test("Modo transitorio: con el control comercial encendido, el contrato se exige solo donde hay capacidad declarada", async (t) => {
  const fetchAnterior = globalThis.fetch;
  const variables: Record<string, string> = {
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-central-falso.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "falso",
    AIRTABLE_TOKEN: "falso",
    AIRTABLE_USERS_BASE_ID: "appCentralPrueba",
    AIRTABLE_USERS_TABLE_ID: "tblUsuariosCentral",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresasCentral",
    AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursalesCentral",
    OPTIMA_LEGACY_COMPANY_ID: empresaId,
    OPTIMA_COMERCIAL_ENFORCE_ENABLED: "true",
  };
  const anteriores = Object.fromEntries(Object.keys(variables).map(k => [k, process.env[k]]));
  Object.assign(process.env, variables);
  t.after(() => {
    globalThis.fetch = fetchAnterior;
    for (const [k, v] of Object.entries(anteriores)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  const estado = {
    modulos: ["MOVIMIENTOS"], contratados: ["MOVIMIENTOS"],
    permisos: { PERMISOS_MOVIMIENTOS: ["VER"] } as Record<string, string[]>,
  };
  globalThis.fetch = async (entrada, opciones) => {
    const url = String(entrada);
    if (url === variables.UPSTASH_REDIS_KV_REST_API_URL) {
      const comando = JSON.parse(String(opciones?.body)) as string[];
      if (comando[1]?.startsWith("optima:version-sesion:")) return Response.json({ result: null });
      return Response.json({ result: JSON.stringify({ usuarioId }) });
    }
    const resCore = respuestaCoreSimulada(url, {
      base: "appCentralPrueba", tablaUsuarios: "tblUsuariosCentral",
      tablaEmpresas: "tblEmpresasCentral", tablaSucursales: "tblSucursalesCentral",
      usuarioId, empresaId, empresaActiva: true, usuarioActivo: true,
      modulos: estado.modulos, contratados: estado.contratados,
      sucursales: ["GOYA"], permisos: estado.permisos,
    });
    if (resCore) return resCore;
    throw new Error(`Solicitud no prevista: ${url}`);
  };

  async function verificar(extra: { capacidadComercial?: string } = {}, permiso: "movimientos.ver" | "movimientos.crear" = "movimientos.ver") {
    const { res, estado: r } = respuesta();
    const req = { cookies: { optima_sesion: "a".repeat(43) } } as unknown as VercelRequest;
    const acceso = await exigirAutorizacion(req, res, {
      modulos: ["MOVIMIENTOS"], permiso, sucursal: "GOYA", ...extra,
    });
    return { status: r.codigo, acceso };
  }

  // 1) Endpoint heredado SIN capacidad declarada: sigue con las reglas heredadas (no se rompe).
  assert.equal((await verificar()).status, 200);

  // 2) Sin capacidad declarada, las reglas heredadas siguen cerrando: no se libera nada.
  assert.equal((await verificar({}, "movimientos.crear")).status, 403, "permiso no concedido");
  estado.contratados = ["INVENTARIO"];
  assert.equal((await verificar()).status, 403, "módulo no contratado en el campo viejo");
  estado.contratados = ["MOVIMIENTOS"];
  process.env.OPTIMA_LEGACY_COMPANY_ID = "rec22222222222222";
  assert.equal((await verificar()).status, 403, "otra empresa no usa API heredadas");
  process.env.OPTIMA_LEGACY_COMPANY_ID = empresaId;

  // 3) Con capacidad declarada, se exige el contrato: sin base de contratos disponible, DENIEGA (falla cerrado).
  const conCapacidad = await verificar({ capacidadComercial: "movimientos.ejemplo.consultar" });
  assert.equal(conCapacidad.status, 403);
  assert.equal(conCapacidad.acceso, null);

  // 4) Con el control comercial APAGADO, la capacidad declarada no cambia nada (reglas heredadas).
  process.env.OPTIMA_COMERCIAL_ENFORCE_ENABLED = "false";
  assert.equal((await verificar({ capacidadComercial: "movimientos.ejemplo.consultar" })).status, 200);
});
