import assert from "node:assert/strict";
import { test } from "node:test";
import { tomarBloqueoVentas, liberarBloqueoVentas, claveBloqueoVentas } from "../lib/bloqueo-ventas.js";

function redisFalso() {
  const datos = new Map<string, string>();
  const ejecutar = async (c: Array<string | number>): Promise<unknown> => {
    if (c[0] === "SET") {
      const clave = String(c[1]);
      if (c.includes("NX") && datos.has(clave)) return null;
      datos.set(clave, String(c[2]));
      return "OK";
    }
    if (c[0] === "EVAL") {
      const clave = String(c[3]);
      if (datos.get(clave) === c[4]) { datos.delete(clave); return 1; }
      return 0;
    }
    throw new Error("comando inesperado");
  };
  return { datos, ejecutar };
}
const U = "recUUUUUUUUUUUUUU";

test("el segundo pedido del mismo archivo no puede tomar el candado", async () => {
  const r = redisFalso();
  const a = await tomarBloqueoVentas(U, "Ventas archivo: x.xlsx", r.ejecutar);
  const b = await tomarBloqueoVentas(U, "Ventas archivo: x.xlsx", r.ejecutar);
  assert.ok(a);
  assert.equal(b, null);
});
test("otro archivo u otra ubicación no se bloquea", async () => {
  const r = redisFalso();
  assert.ok(await tomarBloqueoVentas(U, "Ventas archivo: x.xlsx", r.ejecutar));
  assert.ok(await tomarBloqueoVentas(U, "Ventas archivo: y.xlsx", r.ejecutar));
  assert.ok(await tomarBloqueoVentas("recVVVVVVVVVVVVVV", "Ventas archivo: x.xlsx", r.ejecutar));
});
test("al liberar se puede volver a tomar; un dueño ajeno no libera", async () => {
  const r = redisFalso();
  const a = await tomarBloqueoVentas(U, "e", r.ejecutar);
  await liberarBloqueoVentas(U, "e", "0".repeat(32), r.ejecutar);
  assert.equal(await tomarBloqueoVentas(U, "e", r.ejecutar), null);
  await liberarBloqueoVentas(U, "e", a!, r.ejecutar);
  assert.ok(await tomarBloqueoVentas(U, "e", r.ejecutar));
});
test("la clave no expone el nombre del archivo", () => {
  assert.doesNotMatch(claveBloqueoVentas(U, "Ventas archivo: secreto.xlsx"), /secreto|xlsx/);
});
test("si Redis falla, el error se propaga (la API frena la carga)", async () => {
  await assert.rejects(tomarBloqueoVentas(U, "e", async () => { throw new Error("caído"); }));
});
