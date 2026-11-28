import assert from "node:assert/strict";
import test from "node:test";
import { formatoDeProveedor, normalizarProveedor, pasoDeCompra, textoFormato } from "../lib/compras-proveedores.js";

test("formato por proveedor: tolera tildes, mayúsculas y espacios; desconocido = caja cerrada", () => {
  assert.equal(formatoDeProveedor("ARCOR"), "UNIDAD");
  assert.equal(formatoDeProveedor("  arcor "), "UNIDAD");
  assert.equal(formatoDeProveedor("Coca Cola Goya"), "PACK");
  assert.equal(formatoDeProveedor("chajari mayorista"), "MEDIO_PACK");
  assert.equal(formatoDeProveedor("HUEVOS VIOLA"), "DOCENA");
  assert.equal(formatoDeProveedor("Proveedor nuevo"), "PACK");
  assert.equal(formatoDeProveedor(undefined), "PACK");
  assert.equal(normalizarProveedor("ÑANGAPIRÍ"), "NANGAPIRI");
  assert.equal(formatoDeProveedor("Ñangapirí"), "PACK");
});

test("escalón de compra según formato", () => {
  assert.equal(pasoDeCompra("UNIDAD", 24), 1);
  assert.equal(pasoDeCompra("PACK", 24), 24);
  assert.equal(pasoDeCompra("MEDIO_PACK", 24), 12);
  assert.equal(pasoDeCompra("MEDIO_PACK", 5), 3);
  assert.equal(pasoDeCompra("MEDIO_PACK", 1), 1);
  assert.equal(pasoDeCompra("DOCENA", 30), 12);
  assert.equal(pasoDeCompra("PACK", Number.NaN), 1);
  assert.match(textoFormato("DOCENA", 30), /12/);
});
