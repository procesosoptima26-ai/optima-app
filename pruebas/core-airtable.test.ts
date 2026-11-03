import { test } from "node:test";
import assert from "node:assert/strict";
import { leerAccesoCoreDesdeAirtable } from "../core/airtable.js";

const U = `rec${"A".repeat(14)}`;
const E = `rec${"B".repeat(14)}`;
const S1 = `rec${"C".repeat(14)}`;
const S2 = `rec${"D".repeat(14)}`;
const E_AJENA = `rec${"E".repeat(14)}`;

test("Core desde Airtable: valida los vínculos reales sin hacer escrituras", async (t) => {
  const anteriorFetch = globalThis.fetch;
  const nombres = ["AIRTABLE_TOKEN", "AIRTABLE_USERS_BASE_ID", "AIRTABLE_USERS_TABLE_ID", "AIRTABLE_COMPANIES_TABLE_ID", "AIRTABLE_SUCURSALES_TABLE_ID"] as const;
  const anteriores = Object.fromEntries(nombres.map((n) => [n, process.env[n]]));
  Object.assign(process.env, {
    AIRTABLE_TOKEN: "token-falso",
    AIRTABLE_USERS_BASE_ID: "appSimulacion",
    AIRTABLE_USERS_TABLE_ID: "tblUsuarios",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresas",
    AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursales",
  });

  const datos: Record<string, { id: string; fields: Record<string, unknown> }> = {
    [U]: {
      id: U,
      fields: {
        ACTIVO: true, EMPRESA: [E], SUCURSALES_AUTORIZADAS: [S1, S2],
        SUCURSAL_PREDETERMINADA: [S1], MODULOS: ["INVENTARIO", "CUENTAS_CORRIENTES", "USUARIO"],
      },
    },
    [E]: {
      id: E,
      fields: {
        ACTIVA: true, CLAVE_EMPRESA: "Empresa-1",
        MODULOS_CONTRATADOS: ["INVENTARIO", "CUENTAS CORRIENTES", "USUARIO", "CONFIGURACIÓN"],
      },
    },
    [S1]: { id: S1, fields: { NOMBRE: "GOYA", EMPRESA: [E], ACTIVA: true } },
    [S2]: { id: S2, fields: { NOMBRE: "BELLA VISTA", EMPRESA: [E], ACTIVA: true } },
  };
  const solicitudes: string[] = [];
  globalThis.fetch = async (entrada, opciones) => {
    const url = new URL(String(entrada));
    assert.equal(url.origin, "https://api.airtable.com");
    assert.equal(opciones?.method ?? "GET", "GET");
    assert.equal((opciones?.headers as Record<string, string>)?.Authorization, "Bearer token-falso");
    solicitudes.push(url.pathname);
    const registro = datos[url.pathname.split("/").at(-1) ?? ""];
    return Response.json(registro ?? { error: "not found" }, { status: registro ? 200 : 404 });
  };

  t.after(() => {
    globalThis.fetch = anteriorFetch;
    for (const nombre of nombres) {
      if (anteriores[nombre] === undefined) delete process.env[nombre];
      else process.env[nombre] = anteriores[nombre];
    }
  });

  const valido = await leerAccesoCoreDesdeAirtable(U);
  assert.equal(valido.ok, true);
  if (!valido.ok) return;
  assert.equal(valido.contexto.empresa.id, E);
  assert.equal(valido.sucursalPredeterminada.id, S1);
  assert.deepEqual(valido.contexto.sucursalesAutorizadas.map(s => s.id), [S1, S2]);
  assert.ok(valido.contexto.modulosUsuario.includes("CUENTAS_CORRIENTES"));
  assert.deepEqual(valido.contexto.permisos, []);
  assert.equal(solicitudes.length, 4);

  // Nunca dejar entrar por una sucursal con el mismo nombre pero otra empresa.
  datos[S2].fields.EMPRESA = [E_AJENA];
  assert.deepEqual(await leerAccesoCoreDesdeAirtable(U), {
    ok: false, motivo: "REFERENCIAS_INCONSISTENTES",
  });
  datos[S2].fields.EMPRESA = [E];

  // La predeterminada siempre debe estar dentro de las autorizadas.
  datos[U].fields.SUCURSAL_PREDETERMINADA = [E_AJENA];
  assert.deepEqual(await leerAccesoCoreDesdeAirtable(U), {
    ok: false, motivo: "DATOS_INCOMPLETOS",
  });
  datos[U].fields.SUCURSAL_PREDETERMINADA = [S1];

  datos[S1].fields.ACTIVA = false;
  assert.deepEqual(await leerAccesoCoreDesdeAirtable(U), {
    ok: false, motivo: "REFERENCIAS_INCONSISTENTES",
  });
  datos[S1].fields.ACTIVA = true;

  // Sin módulos contratados, no hay acceso por defecto.
  datos[E].fields.MODULOS_CONTRATADOS = [];
  assert.deepEqual(await leerAccesoCoreDesdeAirtable(U), {
    ok: false, motivo: "DATOS_INCOMPLETOS",
  });
  datos[E].fields.MODULOS_CONTRATADOS = ["INVENTARIO", "CUENTAS CORRIENTES"];

  datos[U].fields.ACTIVO = false;
  assert.deepEqual(await leerAccesoCoreDesdeAirtable(U), {
    ok: false, motivo: "USUARIO_INACTIVO",
  });
  datos[U].fields.ACTIVO = true;

  datos[E].fields.ACTIVA = false;
  assert.deepEqual(await leerAccesoCoreDesdeAirtable(U), {
    ok: false, motivo: "EMPRESA_INACTIVA",
  });
  datos[E].fields.ACTIVA = true;

  datos[U].fields.MODULOS = ["MODULO_DESCONOCIDO"];
  assert.deepEqual(await leerAccesoCoreDesdeAirtable(U), {
    ok: false, motivo: "DATOS_INCOMPLETOS",
  });
});
