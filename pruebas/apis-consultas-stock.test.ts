import { respuestaCoreSimulada, GOYA_CORE_ID, BELLA_VISTA_CORE_ID } from "./ayuda-core-mock.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const token = "a".repeat(43);
const usuarioId = "rec00000000000001";
const empresaId = "rec00000000000002";
const productoId = "rec00000000000003";
const ubicacionGoya = "rec00000000000004";
const ubicacionBellaVista = "rec00000000000005";

test("Consultas de lotes y productos rechazan accesos indebidos", async (t) => {
  const fetchReal = globalThis.fetch;
  const anterior: Record<string, string | undefined> = {};
  const vars: Record<string, string> = {
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-ficticio.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "TOKEN_FICTICIO",
    AIRTABLE_TOKEN: "TOKEN_AIRTABLE_FICTICIO",
    AIRTABLE_USERS_BASE_ID: "appUsuariosPrueba",
    AIRTABLE_USERS_TABLE_ID: "USUARIOS",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresasMaestraPrueba",
    AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursalesMaestraPrueba",
    OPTIMA_LEGACY_COMPANY_ID: empresaId,
    AIRTABLE_MOVIMIENTOS_BASE_ID: "appUsuariosPrueba",
    AIRTABLE_STOCK_LOTES_TABLE_NAME: "STOCK_LOTES",
    AIRTABLE_UBICACIONES_TABLE_NAME: "UBICACIONES",
    AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME: "PRODUCTOS",
    AIRTABLE_MOVIMIENTOS_CODE_FIELD: "CÓDIGO",
    AIRTABLE_MOVIMIENTOS_NAME_FIELD: "NOMBRE MASTER",
  };
  for (const [clave, valor] of Object.entries(vars)) {
    anterior[clave] = process.env[clave];
    process.env[clave] = valor;
  }

  let accesos = 0;
  let empresaDelProducto = empresaId;
  globalThis.fetch = async (entrada, opciones) => {
    accesos++;
    const url = String(entrada);
    if (url !== "https://redis-ficticio.invalid" &&
        (opciones?.method === "POST" || opciones?.method === "PATCH")) {
      throw new Error("La prueba de aislamiento nunca escribe en Airtable");
    }
    const core = respuestaCoreSimulada(url, {
      base: "appUsuariosPrueba", tablaUsuarios: "USUARIOS",
      tablaEmpresas: "tblEmpresasMaestraPrueba",
      tablaSucursales: "tblSucursalesMaestraPrueba",
      usuarioId: usuarioId, empresaId: empresaId,
      modulos: ["MOVIMIENTOS"], sucursales: ["GOYA"],
    });
    if (core) return core;
    if (url === "https://redis-ficticio.invalid") {
      const cmd = JSON.parse(String(opciones?.body)) as string[];
      assert.equal(cmd[0], "GET");
      if (cmd[1]?.startsWith("optima:version-sesion:")) return Response.json({ result: null });
      return Response.json({ result: JSON.stringify({ usuarioId }) });
    }
    if (url.includes("appUsuariosPrueba/USUARIOS/")) {
      return Response.json({
        id: usuarioId,
        fields: {
          USUARIO: "EMPLEADO_GOYA", ACTIVO: true,
          EMPRESA: [empresaId], ROL: "EMPLEADO",
          SUCURSAL: ["GOYA"], MODULOS: ["MOVIMIENTOS"],
        },
      });
    }
    if (url.includes("appUsuariosPrueba/UBICACIONES")) {
      return Response.json({ records: [
        { id: ubicacionGoya, fields: { SUCURSAL: "GOYA", SUCURSAL_CORE: [GOYA_CORE_ID], NOMBRE: "Góndola", "TIPO_UBICACIÓN": "GÓNDOLA" } },
        { id: ubicacionBellaVista, fields: { SUCURSAL: "BELLA VISTA", SUCURSAL_CORE: [BELLA_VISTA_CORE_ID], NOMBRE: "Galpón", "TIPO_UBICACIÓN": "GALPÓN" } },
      ] });
    }
    if (url.includes("appUsuariosPrueba/STOCK_LOTES")) {
      return Response.json({ records: [
        { id: "rec00000000000006", fields: { PRODUCTOS: [productoId], "UBICACIÓN": [ubicacionGoya], CANTIDAD_ACTUAL: 5 } },
        { id: "rec00000000000007", fields: { PRODUCTOS: [productoId], "UBICACIÓN": [ubicacionBellaVista], CANTIDAD_ACTUAL: 9 } },
      ] });
    }
    if (url.includes("appUsuariosPrueba/PRODUCTOS")) {
      const registro = { id: productoId, fields: {
        "CÓDIGO": 2673, PRODUCTO: "Ejemplo", "NOMBRE MASTER": "Ejemplo de prueba", EMPRESA: [empresaDelProducto],
      } };
      return Response.json(url.endsWith(`/${productoId}`) ? registro : { records: [registro] });
    }
    throw new Error(`Conexión inesperada en prueba simulada: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = fetchReal;
    for (const [clave, valor] of Object.entries(anterior)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  });

  const { default: stockLotes } = await import("../api/stock-lotes.js");
  const { default: productosMovimientos } = await import("../api/productos-movimientos.js");

  async function invocar(
    handler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>,
    query: Record<string, string>,
    autenticado: boolean,
    metodo = "GET",
    body: unknown = undefined
  ) {
    let estado = 200;
    let respuesta: unknown;
    const req = {
      method: metodo,
      cookies: autenticado ? { optima_sesion: token } : {},
      query,
      body,
    } as unknown as VercelRequest;
    const res = {
      setHeader() { return this; },
      status(codigo: number) { estado = codigo; return this; },
      json(datos: unknown) { respuesta = datos; return this; },
    } as unknown as VercelResponse;
    await handler(req, res);
    return { estado, respuesta: respuesta as Record<string, unknown> };
  }

  // Ninguna ruta consulta datos cuando falta la cookie.
  let llamadasAntes = accesos;
  let resultado = await invocar(stockLotes, { vista: "general", sucursal: "GOYA" }, false);
  assert.equal(resultado.estado, 401);
  resultado = await invocar(productosMovimientos, { codigo: "2673" }, false);
  assert.equal(resultado.estado, 401);
  assert.equal(accesos, llamadasAntes);

  // Un usuario de GOYA no puede solicitar el stock general de BELLA VISTA.
  resultado = await invocar(stockLotes, { vista: "general", sucursal: "BELLA VISTA" }, true);
  assert.equal(resultado.estado, 403);

  // Una consulta sin ubicación debe filtrar TODOS los lotes según la sesión.
  resultado = await invocar(stockLotes, { productoId }, true);
  assert.equal(resultado.estado, 200);
  assert.equal((resultado.respuesta.lotes as unknown[]).length, 1);
  const lote = (resultado.respuesta.lotes as Array<{ ubicacionId: string }>)[0];
  assert.equal(lote.ubicacionId, ubicacionGoya);

  // Consultar explícitamente una ubicación ajena debe rechazar la solicitud.
  resultado = await invocar(stockLotes, { productoId, ubicacionId: ubicacionBellaVista }, true);
  assert.equal(resultado.estado, 403);

  // Consultar el catálogo de movimientos está permitido al empleado autorizado.
  resultado = await invocar(productosMovimientos, { codigo: "2673" }, true);
  assert.equal(resultado.estado, 200);
  assert.equal(resultado.respuesta.encontrado, true);

  // El mismo código de otra empresa no aparece y no se duplica al crear.
  empresaDelProducto = "rec00000000000099";
  resultado = await invocar(productosMovimientos, { codigo: "2673" }, true);
  assert.equal(resultado.estado, 200);
  assert.equal(resultado.respuesta.encontrado, false);
  resultado = await invocar(stockLotes, { productoId }, true);
  assert.equal(resultado.estado, 403);
  resultado = await invocar(productosMovimientos, {}, true, "POST", {
    codigo: "2673", producto: "Ejemplo",
  });
  assert.equal(resultado.estado, 409);
  empresaDelProducto = empresaId;

  // El alta de productos sin sesión no debe generar ninguna escritura.
  llamadasAntes = accesos;
  resultado = await invocar(productosMovimientos, {}, false, "POST", { codigo: "123", producto: "Falso" });
  assert.equal(resultado.estado, 401);
  assert.equal(accesos, llamadasAntes);
});
