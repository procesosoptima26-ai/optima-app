import assert from "node:assert/strict";
import { test } from "node:test";
import { armarCorreoProveedorNuevo, avisarProveedorNuevo } from "../lib/aviso-proveedor-nuevo.js";
import type { CorreoAviso } from "../core/avisos-proceso.js";

const datos = {
  empresaId: "recMCEWAk9ActnnPn", proveedorNombre: "DISTRIBUIDORA NUEVA", pantalla: "Stock",
  codigoProducto: "7790001112223", productoNombre: "Arroz",
};

test("el mail dice qué proveedor es, de dónde salió y qué falta completar", () => {
  const c = armarCorreoProveedorNuevo(datos, "admin@x.com");
  assert.equal(c.para, "admin@x.com");
  assert.match(c.asunto, /DISTRIBUIDORA NUEVA/);
  assert.match(c.texto, /desde Stock/);
  assert.match(c.texto, /7790001112223 · Arroz/);
  assert.match(c.texto, /CUIT/);
});

test("envía un mail por cada administrador, sin repetir direcciones", async () => {
  const enviados: CorreoAviso[] = [];
  const n = await avisarProveedorNuevo(datos, {
    listarCorreos: async (empresa) => { assert.equal(empresa, "recMCEWAk9ActnnPn"); return ["A@x.com", "a@x.com ", "b@x.com"]; },
    enviar: async (c) => { enviados.push(c); return true; },
  });
  assert.equal(n, 2);
  assert.deepEqual(enviados.map((c) => c.para), ["a@x.com", "b@x.com"]);
});

test("si no hay administradores con mail, no envía y no falla", async () => {
  let llamado = false;
  const n = await avisarProveedorNuevo(datos, {
    listarCorreos: async () => [],
    enviar: async () => { llamado = true; return true; },
  });
  assert.equal(n, 0);
  assert.equal(llamado, false);
});

test("si no se pudo consultar a los administradores (null), no envía y no falla", async () => {
  const n = await avisarProveedorNuevo(datos, { listarCorreos: async () => null, enviar: async () => true });
  assert.equal(n, 0);
});

test("si el correo no está configurado (enviar devuelve false), devuelve 0 sin romper", async () => {
  const n = await avisarProveedorNuevo(datos, { listarCorreos: async () => ["a@x.com"], enviar: async () => false });
  assert.equal(n, 0);
});

test("si algo lanza error, nunca se propaga (el alta del producto no se frena)", async () => {
  const n1 = await avisarProveedorNuevo(datos, { listarCorreos: async () => { throw new Error("Airtable caído"); }, enviar: async () => true });
  assert.equal(n1, 0);
  const n2 = await avisarProveedorNuevo(datos, {
    listarCorreos: async () => ["a@x.com", "b@x.com"],
    enviar: async (c) => { if (c.para === "a@x.com") throw new Error("Resend caído"); return true; },
  });
  assert.equal(n2, 1);
});
