import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirAutorizacion } from "../lib/autorizacion.js";
import erroresMovimientos from "../api/errores-movimientos.js";
import { respuestaCoreSimulada, GOYA_CORE_ID } from "./ayuda-core-mock.js";

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

test("Las API reciben contexto vigente de empresa y sucursal, y cierran el legado a otras empresas", async (t) => {
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
    AIRTABLE_MOVIMIENTOS_BASE_ID: "appCentralPrueba",
    AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME: "PRODUCTOS",
    AIRTABLE_UBICACIONES_TABLE_NAME: "UBICACIONES",
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
    empresaActiva: true,
    usuarioActivo: true,
    modulos: ["MOVIMIENTOS"],
    contratados: ["MOVIMIENTOS"],
    sucursales: ["GOYA"],
    permisos: { PERMISOS_MOVIMIENTOS: ["VER", "CREAR", "AJUSTAR"] },
    peticionesOperativas: 0,
  };
  let ultimoRegistroError: Record<string, unknown> | null = null;
  globalThis.fetch = async (entrada, opciones) => {
    const url = String(entrada);
    if (url === variables.UPSTASH_REDIS_KV_REST_API_URL) {
      const comando = JSON.parse(String(opciones?.body)) as string[];
      assert.equal(comando[0], "GET");
      if (comando[1]?.startsWith("optima:version-sesion:")) return Response.json({ result: null });
      return Response.json({ result: JSON.stringify({ usuarioId }) });
    }
    const resCore = respuestaCoreSimulada(url, {
      base: "appCentralPrueba", tablaUsuarios: "tblUsuariosCentral",
      tablaEmpresas: "tblEmpresasCentral", tablaSucursales: "tblSucursalesCentral",
      usuarioId, empresaId,
      empresaActiva: estado.empresaActiva, usuarioActivo: estado.usuarioActivo,
      modulos: estado.modulos, contratados: estado.contratados,
      sucursales: estado.sucursales, permisos: estado.permisos,
    });
    if (resCore) return resCore;
    if (url.endsWith("/PRODUCTOS/rec55555555555555")) {
      return Response.json({ id: "rec55555555555555", fields: { EMPRESA: [empresaId] } });
    }
    if (url.endsWith("/UBICACIONES/rec66666666666666")) {
      return Response.json({ id: "rec66666666666666", fields: { SUCURSAL_CORE: [GOYA_CORE_ID] } });
    }
    if (url.startsWith("https://api.airtable.com/v0/")) {
      estado.peticionesOperativas++;
      ultimoRegistroError = JSON.parse(String(opciones?.body)) as Record<string, unknown>;
      return Response.json({ id: "rec00000000000000" });
    }
    throw new Error(`Solicitud no prevista: ${url}`);
  };

  async function verificar(
    sucursal?: string, modulo = "MOVIMIENTOS",
    permiso: "movimientos.ver" | "movimientos.crear" | "movimientos.ajustar" | "inventario.ver" = "movimientos.ver"
  ) {
    const { res, estado: respuestaEstado } = respuesta();
    const req = { cookies: { optima_sesion: "a".repeat(43) } } as unknown as VercelRequest;
    const acceso = await exigirAutorizacion(req, res, {
      modulos: [modulo], permiso: modulo === "INVENTARIO" ? "inventario.ver" : permiso,
      ...(sucursal === undefined ? {} : { sucursal }),
    });
    return { status: respuestaEstado.codigo, acceso };
  }

  let r = await verificar("GOYA");
  assert.equal(r.status, 200);
  assert.equal(r.acceso?.empresaId, empresaId);
  assert.deepEqual(r.acceso?.sucursalIds, [GOYA_CORE_ID]);
  assert.deepEqual(r.acceso?.sucursales, ["GOYA"]);
  assert.equal((await verificar("BELLA VISTA")).status, 403);
  assert.equal((await verificar("sucursal inventada")).status, 403);
  assert.equal((await verificar("GOYA", "INVENTARIO")).status, 403);
  assert.equal((await verificar(GOYA_CORE_ID)).status, 200);

  // Un cambio de permisos en Airtable se aplica a la misma sesión, sin
  // deducir autorizaciones del rol ni habilitar acciones de otros módulos.
  estado.permisos.PERMISOS_MOVIMIENTOS = ["VER"];
  assert.equal((await verificar("GOYA", "MOVIMIENTOS", "movimientos.crear")).status, 403);
  assert.equal((await verificar("GOYA", "MOVIMIENTOS", "movimientos.ajustar")).status, 403);
  assert.equal((await verificar("GOYA", "MOVIMIENTOS", "movimientos.ver")).status, 200);
  estado.permisos.PERMISOS_MOVIMIENTOS = ["VER", "CREAR", "AJUSTAR"];
  assert.equal((await verificar("GOYA", "MOVIMIENTOS", "movimientos.crear")).status, 200);

  estado.contratados = ["INVENTARIO"];
  assert.equal((await verificar("GOYA")).status, 403, "El usuario no puede usar un módulo sin contrato");
  estado.contratados = ["MOVIMIENTOS"];
  estado.empresaActiva = false;
  assert.equal((await verificar("GOYA")).status, 403);
  estado.empresaActiva = true;
  estado.usuarioActivo = false;
  assert.equal((await verificar("GOYA")).status, 403);
  estado.usuarioActivo = true;

  process.env.OPTIMA_LEGACY_COMPANY_ID = "rec22222222222222";
  assert.equal((await verificar("GOYA")).status, 403, "Otra empresa no usa datos legados");
  delete process.env.OPTIMA_LEGACY_COMPANY_ID;
  assert.equal((await verificar("GOYA")).status, 503, "Sin empresa piloto explícita, cerrado");
  process.env.OPTIMA_LEGACY_COMPANY_ID = empresaId;

  // Endpoint de errores: la cookie es obligatoria y el usuario no es falsificable.
  const payload = {
    usuario: "OTRA PERSONA", sucursal: "GOYA", productoId: "rec55555555555555",
    ubicacionId: "rec66666666666666", tipoError: "PRUEBA",
  };
  const noAutenticado = respuesta();
  await erroresMovimientos({ method: "POST", cookies: {}, body: payload } as VercelRequest, noAutenticado.res);
  assert.equal(noAutenticado.estado.codigo, 401);
  assert.equal(estado.peticionesOperativas, 0);

  // Las escrituras de la prueba son simuladas; comprueba quién figura como autor.
  process.env.AIRTABLE_MOVIMIENTOS_BASE_ID = "appCentralPrueba";
  process.env.AIRTABLE_ERRORES_MOVIMIENTOS_TABLE_NAME = "ERRORES_FALSOS";
  t.after(() => { delete process.env.AIRTABLE_MOVIMIENTOS_BASE_ID; delete process.env.AIRTABLE_ERRORES_MOVIMIENTOS_TABLE_NAME; });
  const autenticado = respuesta();
  await erroresMovimientos({
    method: "POST", cookies: { optima_sesion: "a".repeat(43) }, body: payload,
  } as unknown as VercelRequest, autenticado.res);
  assert.equal(autenticado.estado.codigo, 200);
  assert.equal(estado.peticionesOperativas, 1);
  assert.equal((ultimoRegistroError?.fields as Record<string, unknown>).USUARIO, "EMPLEADO_PRUEBA");
});
