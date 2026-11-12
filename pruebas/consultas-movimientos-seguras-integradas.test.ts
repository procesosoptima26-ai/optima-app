/** Pruebas sólo con proveedores simulados: ninguna solicitud sale a servicios reales. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { respuestaCoreSimulada, GOYA_CORE_ID, BELLA_VISTA_CORE_ID } from "./ayuda-core-mock.js";
import { movimientoPermitido, type RegistroOperativo } from "../lib/alcance-operativo.js";
import type { ContextoCore } from "../core/seguridad.js";
import movimientos from "../api/movimientos.js";

const empresaId = "rec99999999999999";
const usuarioId = "rec11111111111111";
const ubicacionGoya = "rec33333333333333";
const ubicacionBella = "rec22222222222222";
const movGoya = "rec55555555555555";
const movAusente = "rec44444444444444";
const vars: Record<string, string> = {
  AIRTABLE_TOKEN: "SOLO_MOCK", AIRTABLE_USERS_BASE_ID: "appUsuariosPrueba",
  AIRTABLE_USERS_TABLE_ID: "tblUsuariosPrueba",
  AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresasMaestraPrueba",
  AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursalesMaestraPrueba",
  OPTIMA_LEGACY_COMPANY_ID: empresaId,
  AIRTABLE_MOVIMIENTOS_BASE_ID: "appUsuariosPrueba",
  AIRTABLE_MOVIMIENTOS_TABLE_NAME: "MOVIMIENTOS_PRUEBA",
  AIRTABLE_UBICACIONES_TABLE_NAME: "UBICACIONES_PRUEBA",
  UPSTASH_REDIS_KV_REST_API_URL: "https://redis-falso.invalid",
  UPSTASH_REDIS_KV_REST_API_TOKEN: "SOLO_MOCK",
};
const local = (id: string) => ({
  id, fields: { PRODUCTO: ["rec66666666666666"], "UBICACIÓN ORIGEN": [ubicacionGoya],
    TIPO_MOVIMIENTO: "VENTA", CANTIDAD: 1 },
});
const ajeno = (id: string) => ({
  id, fields: { PRODUCTO: ["rec66666666666666"], "UBICACIÓN ORIGEN": [ubicacionBella],
    TIPO_MOVIMIENTO: "VENTA", CANTIDAD: 1 },
});

type Plan = (url: URL) => Response;
function simular(t: { after(fn: () => void): void }, plan: Plan) {
  const anterior = globalThis.fetch;
  const antes = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    globalThis.fetch = anterior;
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === vars.UPSTASH_REDIS_KV_REST_API_URL) {
      const comando = JSON.parse(String(init?.body)) as string[];
      assert.equal(comando[0], "GET");
      return Response.json({ result: comando[1]?.startsWith("optima:version-sesion:")
        ? null : JSON.stringify({ usuarioId }) });
    }
    assert.ok(!init?.method || init.method === "GET", "Nunca escribir en las pruebas");
    const core = respuestaCoreSimulada(url, {
      base: vars.AIRTABLE_USERS_BASE_ID, tablaUsuarios: vars.AIRTABLE_USERS_TABLE_ID,
      tablaEmpresas: vars.AIRTABLE_COMPANIES_TABLE_ID,
      tablaSucursales: vars.AIRTABLE_SUCURSALES_TABLE_ID,
      usuarioId, empresaId, modulos: ["MOVIMIENTOS"], sucursales: ["GOYA"],
    });
    if (core) return core;
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/UBICACIONES_PRUEBA")) {
      return Response.json({ records: [
        { id: ubicacionGoya, fields: { SUCURSAL_CORE: [GOYA_CORE_ID], SUCURSAL: "GOYA" } },
        { id: ubicacionBella, fields: { SUCURSAL_CORE: [BELLA_VISTA_CORE_ID], SUCURSAL: "BELLA VISTA" } },
      ] });
    }
    if (parsed.pathname.includes("/MOVIMIENTOS_PRUEBA")) return plan(parsed);
    throw new Error(`Solicitud no simulada: ${url}`);
  };
}
async function consultar(query: Record<string, string>) {
  const estado = { status: 200, body: null as unknown };
  const req = { method: "GET", cookies: { optima_sesion: "a".repeat(43) }, query } as unknown as VercelRequest;
  const res = {
    setHeader() { return this; },
    status(n: number) { estado.status = n; return this; },
    json(body: unknown) { estado.body = body; return this; },
  } as unknown as VercelResponse;
  await movimientos(req, res);
  return { status: estado.status, body: estado.body as { movimientos?: Array<{ id: string }> } };
}

test("consulta por IDs: no devuelve un subconjunto si uno de los registros falta", async (t) => {
  simular(t, url => {
    if (url.pathname.endsWith(`/${movGoya}`)) return Response.json(local(movGoya));
    if (url.pathname.endsWith(`/${movAusente}`)) return Response.json({ error: "Not Found" }, { status: 404 });
    throw new Error(`Consulta no esperada: ${url}`);
  });
  const r = await consultar({ ids: `${movGoya},${movAusente}` });
  assert.equal(r.status, 403);
  assert.equal(r.body.movimientos, undefined);
});

test("consulta por IDs: valida duplicados y formatos sin leer el historial", async (t) => {
  let llamadas = 0;
  simular(t, () => { llamadas++; throw new Error("No consultar movimientos"); });
  assert.equal((await consultar({ ids: `${movGoya},${movGoya}` })).status, 400);
  assert.equal((await consultar({ ids: "recNO_ES_UN_ID" })).status, 400);
  assert.equal(llamadas, 0);
});

test("consulta reciente: encuentra movimientos autorizados en páginas posteriores", async (t) => {
  let paginas = 0;
  simular(t, url => {
    paginas++;
    const offset = url.searchParams.get("offset");
    if (!offset) return Response.json({
      records: Array.from({ length: 100 }, (_, i) => ajeno(`rec${String(i).padStart(14, "0")}`)),
      offset: "PAGINA_DOS",
    });
    assert.equal(offset, "PAGINA_DOS");
    return Response.json({ records: [local(movGoya)] });
  });
  const r = await consultar({ sucursal: "GOYA", limite: "20" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.movimientos?.map(x => x.id), [movGoya]);
  assert.equal(paginas, 2);
});

test("consulta reciente: rechaza un cursor repetido y evita respuesta parcial", async (t) => {
  let paginas = 0;
  simular(t, () => {
    paginas++;
    return Response.json({ records: [ajeno(movAusente)], offset: "BUCLE" });
  });
  const r = await consultar({ sucursal: "GOYA" });
  assert.equal(r.status, 500);
  assert.equal(r.body.movimientos, undefined);
  assert.equal(paginas, 2);
});

test("aislamiento: un movimiento con dos ubicaciones en un mismo campo es ambiguo", () => {
  const contexto: ContextoCore = {
    usuarioId, activo: true, empresa: { id: empresaId, clave: "SIMULADA", activa: true },
    sucursalesAutorizadas: [{ id: GOYA_CORE_ID, empresaId, nombre: "GOYA", activa: true }],
    modulosEmpresa: ["MOVIMIENTOS"], modulosUsuario: ["MOVIMIENTOS"],
    permisos: ["movimientos.ver"],
  };
  const ubicaciones = new Map<string, RegistroOperativo>([
    [ubicacionGoya, { id: ubicacionGoya, fields: { SUCURSAL_CORE: [GOYA_CORE_ID] } }],
    [ubicacionBella, { id: ubicacionBella, fields: { SUCURSAL_CORE: [GOYA_CORE_ID] } }],
  ]);
  assert.equal(movimientoPermitido({ "UBICACIÓN ORIGEN": [ubicacionGoya, ubicacionBella] }, ubicaciones, contexto), false);
  assert.equal(movimientoPermitido({ "UBICACIÓN ORIGEN": [ubicacionGoya] }, ubicaciones, contexto), true);
});
