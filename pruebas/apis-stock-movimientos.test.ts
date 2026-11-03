import { respuestaCoreSimulada, GOYA_CORE_ID, BELLA_VISTA_CORE_ID } from "./ayuda-core-mock.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";

test("Stock y movimientos rechazan solicitudes sin sesión", async (t) => {
  const original = globalThis.fetch;
  const consultas: string[] = [];

  // Nunca permite una conexión a Internet: cualquier llamada es un error.
  globalThis.fetch = async (input) => {
    consultas.push(String(input));
    throw new Error("Una solicitud sin sesión NO debe consultar Airtable ni Redis");
  };
  t.after(() => { globalThis.fetch = original; });

  const { default: stock } = await import("../api/stock.js");
  const { default: movimientos } = await import("../api/movimientos.js");

  function respuesta() {
    const estado = { status: 200, body: null as unknown };
    const res = {
      setHeader() { return this; },
      status(codigo: number) { estado.status = codigo; return this; },
      json(body: unknown) { estado.body = body; return this; },
    } as VercelResponse;
    return { res, estado };
  }

  const stockBody = {
    codigo: "12345", nombre: "Producto prueba", producto: "Prueba",
    marca: "Marca", presentacion: "1 kg", especificacion: "",
    sucursal: "GOYA", ubicacion: "GÓNDOLA", sinVencimiento: true,
    productoNuevo: false, observaciones: "",
    lotes: [{ vencimiento: "", cantidad: "2" }],
  };

  for (const method of ["POST", "PATCH"]) {
    const { res, estado } = respuesta();
    await stock({ method, cookies: {}, body: stockBody } as unknown as VercelRequest, res);
    assert.equal(estado.status, 401, `stock ${method} sin sesión`);
  }

  for (const req of [
    { method: "POST", cookies: {}, body: { sucursal: "GOYA", movimientos: [{ productoId: "rec00000000000001" }] }, query: {} },
    { method: "GET", cookies: {}, query: { sucursal: "GOYA" } },
    { method: "GET", cookies: {}, query: { ids: "rec00000000000001" } },
  ]) {
    const { res, estado } = respuesta();
    await movimientos(req as unknown as VercelRequest, res);
    assert.equal(estado.status, 401, `movimientos ${req.method} sin sesión`);
  }
  assert.deepEqual(consultas, [], "No se efectuaron consultas externas");
});
test("Acceso por sucursal y por IDs", async (t) => {
  const fetchOriginal = globalThis.fetch;
  const variables = {
    AIRTABLE_TOKEN: "ficticio",
    AIRTABLE_USERS_BASE_ID: "appUsuariosPrueba",
    AIRTABLE_USERS_TABLE_ID: "tblUsuariosPrueba",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresasMaestraPrueba",
    AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursalesMaestraPrueba",
    OPTIMA_LEGACY_COMPANY_ID: "rec99999999999999",
    AIRTABLE_BASE_ID: "appUsuariosPrueba",
    AIRTABLE_STOCK_TABLE_NAME: "STOCK_PRUEBA",
    AIRTABLE_TABLE_NAME: "PRODUCTOS_PRUEBA", AIRTABLE_CODE_FIELD: "CÓDIGO",
    AIRTABLE_MOVIMIENTOS_BASE_ID: "appUsuariosPrueba",
    AIRTABLE_MOVIMIENTOS_TABLE_NAME: "MOVIMIENTOS_PRUEBA",
    AIRTABLE_UBICACIONES_TABLE_NAME: "UBICACIONES_PRUEBA",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-falso.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
  };
  const previos = Object.fromEntries(
    Object.keys(variables).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, variables);

  const ubicacionGoya = "rec33333333333333";
  const ubicacionBellaVista = "rec22222222222222";
  const movimientoGoya = "rec55555555555555";
  const movimientoBellaVista = "rec44444444444444";
  const loteBellaVista = "rec66666666666666";
  let intentosEscritura = 0;

  globalThis.fetch = async (input, opciones) => {
    const url = String(input);
    const core = respuestaCoreSimulada(url, {
      base: "appUsuariosPrueba", tablaUsuarios: "tblUsuariosPrueba",
      tablaEmpresas: "tblEmpresasMaestraPrueba",
      tablaSucursales: "tblSucursalesMaestraPrueba",
      usuarioId: "rec11111111111111", empresaId: "rec99999999999999",
      modulos: ["MOVIMIENTOS", "INVENTARIO"], sucursales: ["GOYA"],
    });
    if (core) return core;
    const metodo = opciones?.method ?? "GET";
    if (metodo !== "GET" && url !== variables.UPSTASH_REDIS_KV_REST_API_URL) {
      intentosEscritura += 1;
      throw new Error("La prueba no permite escrituras reales");
    }

    if (url === variables.UPSTASH_REDIS_KV_REST_API_URL) {
      const comando = JSON.parse(String(opciones?.body)) as string[];
      if (comando[1]?.startsWith("optima:version-sesion:")) return Response.json({ result: null });
      return Response.json({ result: JSON.stringify({ usuarioId: "rec11111111111111" }) });
    }
    if (url.includes("appUsuariosPrueba/STOCK_PRUEBA/")) {
      return Response.json({
        id: loteBellaVista, fields: { SUCURSAL: "BELLA VISTA" },
      });
    }
    if (url.includes("appUsuariosPrueba/MOVIMIENTOS_PRUEBA/")) {
      const esGoya = url.endsWith(movimientoGoya);
      return Response.json({
        id: esGoya ? movimientoGoya : movimientoBellaVista,
        fields: {
          PRODUCTO: ["rec77777777777777"],
          "UBICACIÓN ORIGEN": [esGoya ? ubicacionGoya : ubicacionBellaVista],
          TIPO_MOVIMIENTO: "EGRESO", MOTIVO: "VENTA", CANTIDAD: 1,
        },
      });
    }
    if (url.includes("appUsuariosPrueba/PRODUCTOS_PRUEBA")) {
      return Response.json({ records: [{ id: "rec77777777777777", fields: {
        "CÓDIGO": 123, EMPRESA: ["rec99999999999999"],
      } }] });
    }
    if (url.includes("appUsuariosPrueba/UBICACIONES_PRUEBA")) {
      return Response.json({ records: [
        { id: ubicacionGoya, fields: { SUCURSAL: "GOYA", SUCURSAL_CORE: [GOYA_CORE_ID], NOMBRE: "Góndola", "TIPO_UBICACIÓN": "GÓNDOLA" } },
        { id: ubicacionBellaVista, fields: { SUCURSAL: "BELLA VISTA", SUCURSAL_CORE: [BELLA_VISTA_CORE_ID], NOMBRE: "Góndola", "TIPO_UBICACIÓN": "GÓNDOLA" } },
      ] });
    }
    throw new Error(`Consulta no simulada: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = fetchOriginal;
    for (const [key, valor] of Object.entries(previos)) {
      if (valor === undefined) delete process.env[key];
      else process.env[key] = valor;
    }
  });

  const { default: stock } = await import("../api/stock.js");
  const { default: movimientos } = await import("../api/movimientos.js");

  function crearRespuesta() {
    const estado = { codigo: 200, body: null as unknown };
    const res = {
      setHeader() { return this; },
      status(codigo: number) { estado.codigo = codigo; return this; },
      json(body: unknown) { estado.body = body; return this; },
    } as VercelResponse;
    return { res, estado };
  }
  const cookie = { optima_sesion: "a".repeat(43) };

  // Goya no puede escribir inventario de Bella Vista por ID de lote.
  const { res: resStock, estado: estadoStock } = crearRespuesta();
  await stock({ method: "PATCH", cookies: cookie, body: {
    codigo: "123", nombre: "Prueba", producto: "Prueba", marca: "Marca",
    presentacion: "1 kg", especificacion: "", sucursal: "GOYA",
    ubicacion: "GÓNDOLA", sinVencimiento: true, productoNuevo: false,
    observaciones: "", lotes: [{ recordId: loteBellaVista, vencimiento: "", cantidad: "2" }],
  } } as unknown as VercelRequest, resStock);
  assert.equal(estadoStock.codigo, 403);

  // Goya no puede pedir movimientos por ID de Bella Vista.
  const { res: resAjeno, estado: estadoAjeno } = crearRespuesta();
  await movimientos({ method: "GET", cookies: cookie,
    query: { ids: movimientoBellaVista } } as unknown as VercelRequest, resAjeno);
  assert.equal(estadoAjeno.codigo, 403);

  // Goya sí puede consultar sus propios movimientos por ID.
  const { res: resPropio, estado: estadoPropio } = crearRespuesta();
  await movimientos({ method: "GET", cookies: cookie,
    query: { ids: movimientoGoya } } as unknown as VercelRequest, resPropio);
  assert.equal(estadoPropio.codigo, 200);

  // No hubo escrituras en Airtable.
  assert.equal(intentosEscritura, 0);
});
