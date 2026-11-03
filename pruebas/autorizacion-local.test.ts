import { respuestaCoreSimulada } from "./ayuda-core-mock.js";

import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  VercelRequest,
  VercelResponse,
} from "@vercel/node";

import {
  exigirAutorizacion,
} from "../lib/autorizacion.js";

test("Seguridad de permisos OPTIMA", async (t) => {
  const fetchOriginal = globalThis.fetch;

  const variables = {
    UPSTASH_REDIS_KV_REST_API_URL:
      "https://redis-falso.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN:
      "token-redis-ficticio",
    AIRTABLE_TOKEN: "token-airtable-ficticio",
    AIRTABLE_USERS_BASE_ID: "appPrueba",
    AIRTABLE_USERS_TABLE_ID: "tblPrueba",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresasMaestraPrueba",
    AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursalesMaestraPrueba",
    OPTIMA_LEGACY_COMPANY_ID: "rec00000000000002",
  };

  const anteriores: Record<string, string | undefined> = {};

  for (const [nombre, valor] of Object.entries(variables)) {
    anteriores[nombre] = process.env[nombre];
    process.env[nombre] = valor;
  }

  const estado = {
    sesionActiva: true,
    usuarioActivo: true,
  };

  // Simulamos las respuestas de Redis y Airtable.
  // Ninguna petición sale a Internet.
  globalThis.fetch = async (entrada, opciones) => {
    const url = String(entrada);
    const core = respuestaCoreSimulada(url, {
      base: "appPrueba", tablaUsuarios: "tblPrueba",
      tablaEmpresas: "tblEmpresasMaestraPrueba",
      tablaSucursales: "tblSucursalesMaestraPrueba",
      usuarioId: "rec00000000000001", empresaId: "rec00000000000002",
      modulos: ["MOVIMIENTOS"], sucursales: ["GOYA"], usuarioActivo: estado.usuarioActivo,
    });
    if (core) return core;

    if (url === "https://redis-falso.invalid") {
      const comando = JSON.parse(
        String(opciones?.body)
      ) as string[];

      assert.equal(comando[0], "GET");
      if (comando[1]?.startsWith("optima:version-sesion:")) return Response.json({ result: null });

      return Response.json({
        result: estado.sesionActiva
          ? JSON.stringify({
              usuarioId: "rec00000000000001",
            })
          : null,
      });
    }

    if (url.startsWith("https://api.airtable.com/")) {
      return Response.json({
        id: "rec00000000000001",
        fields: {
          USUARIO: "EMPLEADO_PRUEBA",
          ACTIVO: estado.usuarioActivo,
          EMPRESA: ["rec00000000000002"],
          ROL: "EMPLEADO",
          SUCURSAL: ["GOYA"],
          MODULOS: ["MOVIMIENTOS"],
        },
      });
    }

    throw new Error("Conexión inesperada");
  };

  t.after(() => {
    globalThis.fetch = fetchOriginal;

    for (const [nombre, valor] of Object.entries(anteriores)) {
      if (valor === undefined) {
        delete process.env[nombre];
      } else {
        process.env[nombre] = valor;
      }
    }
  });

  async function comprobar(
    tieneCookie: boolean,
    modulo: string,
    sucursal: string
  ) {
    const respuesta = {
      codigo: 200,
      contenido: null as unknown,
    };

    const res = {
      status(codigo: number) {
        respuesta.codigo = codigo;
        return this;
      },
      json(contenido: unknown) {
        respuesta.contenido = contenido;
        return this;
      },
      setHeader() {
        return this;
      },
    } as unknown as VercelResponse;

    const req = {
      cookies: tieneCookie
        ? { optima_sesion: "a".repeat(43) }
        : {},
    } as unknown as VercelRequest;

    const usuario = await exigirAutorizacion(
      req,
      res,
      {
        modulos: [modulo],
        permiso: modulo === "INVENTARIO" ? "inventario.ver" : "movimientos.ver",
        sucursal,
      }
    );

    return {
      codigo: respuesta.codigo,
      usuario,
    };
  }

  // Sin sesión: acceso rechazado.
  assert.equal(
    (await comprobar(false, "MOVIMIENTOS", "GOYA")).codigo,
    401
  );

  // Sesión vencida: acceso rechazado.
  estado.sesionActiva = false;

  assert.equal(
    (await comprobar(true, "MOVIMIENTOS", "GOYA")).codigo,
    401
  );

  estado.sesionActiva = true;

  // Usuario sin permiso de inventario.
  assert.equal(
    (await comprobar(true, "INVENTARIO", "GOYA")).codigo,
    403
  );

  // Usuario de Goya intenta acceder a Bella Vista.
  assert.equal(
    (await comprobar(true, "MOVIMIENTOS", "BELLA VISTA")).codigo,
    403
  );

  // Usuario autorizado para movimientos de Goya.
  const accesoPermitido = await comprobar(
    true,
    "MOVIMIENTOS",
    "GOYA"
  );

  assert.equal(accesoPermitido.codigo, 200);
  assert.equal(
    accesoPermitido.usuario?.usuario,
    "EMPLEADO_PRUEBA"
  );

  // Usuario desactivado en Airtable.
  estado.usuarioActivo = false;

  assert.equal(
    (await comprobar(true, "MOVIMIENTOS", "GOYA")).codigo,
    403
  );
});
