import assert from "node:assert/strict";
import { test } from "node:test";
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import login from "../api/login.js";

const idUsuario = "rec" + "A".repeat(14);
const idEmpresa = "rec" + "B".repeat(14);
const idSucursal = "rec" + "C".repeat(14);
const idOtraEmpresa = "rec" + "D".repeat(14);
const clave = "Prueba123!";

function respuesta() {
  const estado: { status: number; data: unknown } = { status: 200, data: null };
  const res = {
    status(c: number) { estado.status = c; return this; },
    json(v: unknown) { estado.data = v; return this; },
  } as unknown as VercelResponse;
  return { estado, res };
}

test("hotfix: login respeta sucursal predeterminada, empresa y actividad", async t => {
  const previoFetch = globalThis.fetch;
  const vars = {
    AIRTABLE_TOKEN: "token-ficticio",
    AIRTABLE_USERS_BASE_ID: "appTest",
    AIRTABLE_USERS_TABLE_ID: "tblUsuarios",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresas",
    AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursales",
  };
  const prev = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    globalThis.fetch = previoFetch;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  const passwordHash = await argon2.hash(clave, { type: argon2.argon2id });
  const base = {
    USUARIO: "EMPLEADO_PRUEBA", NOMBRE: "Empleado", PASSWORD_HASH: passwordHash,
    ACTIVO: true, EMPRESA: [idEmpresa], ROL: "USUARIO", MODULOS: ["INVENTARIO"],
    SUCURSAL_PREDETERMINADA: [idSucursal],
    SUCURSALES_AUTORIZADAS: [idSucursal],
  };

  for (const caso of [
    { titulo: "sucursal válida", autorizado: true },
    { titulo: "sucursal de otra empresa", autorizado: false, empresaSucursal: idOtraEmpresa },
    { titulo: "sucursal desactivada", autorizado: false, activaSucursal: false },
    { titulo: "sucursal sin autorización", autorizado: false, sucursalesAutorizadas: [] },
    { titulo: "más de una predeterminada", autorizado: false, predeterminadas: [idSucursal, idOtraEmpresa] },
  ]) {
    let consultoSucursal = false;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "api.airtable.com");
      if (url.pathname.endsWith("/tblUsuarios")) {
        return Response.json({ records: [{
          id: idUsuario, fields: {
            ...base,
            SUCURSAL_PREDETERMINADA: caso.predeterminadas ?? [idSucursal],
            SUCURSALES_AUTORIZADAS: caso.sucursalesAutorizadas ?? [idSucursal],
          },
        }] });
      }
      if (url.pathname.endsWith("/tblEmpresas/" + idEmpresa))
        return Response.json({ id: idEmpresa, fields: { NOMBRE_COMERCIAL: "Empresa de prueba" } });
      if (url.pathname.endsWith("/tblSucursales/" + idSucursal)) {
        consultoSucursal = true;
        return Response.json({ id: idSucursal, fields: {
          NOMBRE: "Sucursal de prueba",
          ACTIVA: caso.activaSucursal ?? true,
          EMPRESA: [caso.empresaSucursal ?? idEmpresa],
        } });
      }
      throw new Error("Solicitud inesperada " + url.pathname);
    };
    const req = { method: "POST", body: { usuario: "EMPLEADO_PRUEBA", password: clave } } as VercelRequest;
    const { estado, res } = respuesta();
    await login(req, res);
    assert.equal(estado.status, caso.autorizado ? 200 : 403, caso.titulo);
    if (caso.autorizado) {
      assert.equal((estado.data as { usuario: { sucursal: string } }).usuario.sucursal, "SUCURSAL DE PRUEBA");
      assert.equal(consultoSucursal, true);
    }
  }
});
