import { respuestaCoreSimulada, GOYA_CORE_ID, BELLA_VISTA_CORE_ID } from "./ayuda-core-mock.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import ubicaciones from "../api/ubicaciones.js";
import productos from "../api/productos.js";

// Prueba 100 % simulada: ninguna petición puede salir a Internet.
test("API de ubicaciones y productos respetan los permisos", async (t) => {
  const fetchAnterior = globalThis.fetch;
  const variables = {
    AIRTABLE_TOKEN: "token-falso",
    AIRTABLE_USERS_BASE_ID: "appUsuariosPrueba",
    AIRTABLE_USERS_TABLE_ID: "tblUsuariosPrueba",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresasMaestraPrueba",
    AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursalesMaestraPrueba",
    OPTIMA_LEGACY_COMPANY_ID: "rec00000000000002",
    AIRTABLE_MOVIMIENTOS_BASE_ID: "appUsuariosPrueba",
    AIRTABLE_UBICACIONES_TABLE_NAME: "UBICACIONES_PRUEBA",
    AIRTABLE_BASE_ID: "appUsuariosPrueba",
    AIRTABLE_TABLE_NAME: "PRODUCTOS_PRUEBA",
    AIRTABLE_CODE_FIELD: "CODIGO",
    AIRTABLE_NAME_FIELD: "NOMBRE",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-inventado.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "redis-falso",
  };
  const anteriores: Record<string, string | undefined> = {};
  for (const [nombre, valor] of Object.entries(variables)) {
    anteriores[nombre] = process.env[nombre];
    process.env[nombre] = valor;
  }

  const estado = {
    sesionValida: true,
    modulos: ["MOVIMIENTOS"] as string[],
    sucursal: ["GOYA"] as string[],
    airtableDatosLeidos: 0,
  };

  globalThis.fetch = async (entrada, opciones) => {
    const url = String(entrada);
    const core = respuestaCoreSimulada(url, {
      base: "appUsuariosPrueba", tablaUsuarios: "tblUsuariosPrueba",
      tablaEmpresas: "tblEmpresasMaestraPrueba",
      tablaSucursales: "tblSucursalesMaestraPrueba",
      usuarioId: "rec00000000000001", empresaId: "rec00000000000002",
      modulos: estado.modulos, sucursales: estado.sucursal,
    });
    if (core) return core;
    if (url === "https://redis-inventado.invalid") {
      const comando = JSON.parse(String(opciones?.body)) as string[];
      assert.equal(comando[0], "GET");
      if (comando[1]?.startsWith("optima:version-sesion:")) return Response.json({ result: null });
      return Response.json({
        result: estado.sesionValida
          ? JSON.stringify({ usuarioId: "rec00000000000001" })
          : null,
      });
    }
    if (url.includes("appUsuariosPrueba/UBICACIONES_PRUEBA")) {
      estado.airtableDatosLeidos += 1;
      return Response.json({
        records: [
          { id: "rec00000000000003", fields: { NOMBRE: "GÓNDOLA", SUCURSAL: "GOYA", SUCURSAL_CORE: [GOYA_CORE_ID], "TIPO_UBICACIÓN": "GÓNDOLA", ACTIVA: true } },
          { id: "rec00000000000004", fields: { NOMBRE: "GALPÓN", SUCURSAL: "BELLA VISTA", SUCURSAL_CORE: [BELLA_VISTA_CORE_ID], "TIPO_UBICACIÓN": "GALPÓN", ACTIVA: true } },
        ],
      });
    }
    if (url.includes("appUsuariosPrueba/PRODUCTOS_PRUEBA")) {
      estado.airtableDatosLeidos += 1;
      return Response.json({
        records: [{ id: "rec00000000000005", fields: { NOMBRE: "Producto simulado", PRODUCTO: "Simulado", EMPRESA: ["rec00000000000002"] } }],
      });
    }
    throw new Error(`¡Se bloqueó una conexión inesperada! ${url.slice(0, 75)}`);
  };

  t.after(() => {
    globalThis.fetch = fetchAnterior;
    for (const [nombre, anterior] of Object.entries(anteriores)) {
      if (anterior === undefined) delete process.env[nombre];
      else process.env[nombre] = anterior;
    }
  });

  async function solicitar(
    handler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>,
    ruta: "ubicaciones" | "productos",
    cookie: boolean,
  ) {
    let codigo = 200;
    let cuerpo: unknown;
    const res = {
      status(n: number) { codigo = n; return this; },
      json(valor: unknown) { cuerpo = valor; return this; },
      setHeader() { return this; },
    } as unknown as VercelResponse;
    const req = {
      method: "GET",
      cookies: cookie ? { optima_sesion: "a".repeat(43) } : {},
      query: ruta === "ubicaciones" ? { sucursal: "GOYA" } : { codigo: "123" },
    } as unknown as VercelRequest;
    await handler(req, res);
    return { codigo, cuerpo: cuerpo as Record<string, unknown> };
  }

  // 1. Sin sesión, ninguna API debe devolver datos.
  const antesSinSesion = estado.airtableDatosLeidos;
  assert.equal((await solicitar(ubicaciones, "ubicaciones", false)).codigo, 401);
  assert.equal((await solicitar(productos, "productos", false)).codigo, 401);
  assert.equal(estado.airtableDatosLeidos, antesSinSesion);

  // 2. Un empleado de Goya puede leer ubicaciones de Goya, no las de Bella Vista.
  const permitidas = await solicitar(ubicaciones, "ubicaciones", true);
  assert.equal(permitidas.codigo, 200);
  const ubicacionesResultado = permitidas.cuerpo.ubicaciones as Array<{ sucursal: string }>;
  assert.equal(ubicacionesResultado.length, 1);
  assert.equal(ubicacionesResultado[0].sucursal, "GOYA");

  // 3. Un empleado sin INVENTARIO no puede consultar el catálogo.
  const antesDenegado = estado.airtableDatosLeidos;
  assert.equal((await solicitar(productos, "productos", true)).codigo, 403);
  assert.equal(estado.airtableDatosLeidos, antesDenegado);

  // 4. Si obtiene el permiso, sí puede consultar productos.
  estado.modulos = ["MOVIMIENTOS", "INVENTARIO"];
  const permitidoProducto = await solicitar(productos, "productos", true);
  assert.equal(permitidoProducto.codigo, 200);
  assert.equal(permitidoProducto.cuerpo.encontrado, true);

  // 5. Un usuario activo sin permiso de sucursal no puede leer Goya.
  estado.sucursal = ["BELLA VISTA"];
  const antesOtraSucursal = estado.airtableDatosLeidos;
  assert.equal((await solicitar(ubicaciones, "ubicaciones", true)).codigo, 403);
  assert.equal(estado.airtableDatosLeidos, antesOtraSucursal);
});
