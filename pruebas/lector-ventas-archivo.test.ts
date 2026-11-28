/** Etapa 1 de "Ventas por archivo": lector de Excel/CSV y suma por producto. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  leerArchivoVentas, agruparVentas, interpretarFilas, convertirCantidad,
  normalizarCodigoVenta,
} from "../src/modules/movimientos/lector-ventas-archivo.js";

const buf = (t: string): ArrayBuffer => new TextEncoder().encode(t).buffer as ArrayBuffer;

test("xlsx de ejemplo: lee todas las filas, suma por código y respeta decimales", async () => {
  const b = readFileSync(new URL("./fixtures/ventas-ejemplo.xlsx", import.meta.url));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const r = await leerArchivoVentas(ab, "ventas.xlsx");
  assert.equal(r.errores.length, 0);
  assert.equal(r.lineas.length, 5);
  assert.equal(r.lineas[0].producto, "Producto A & B");
  const g = agruparVentas(r.lineas);
  assert.equal(g.length, 3);
  assert.equal(g.find((x) => x.codigo === "7790000000001")?.cantidad, 3);
  assert.equal(g.find((x) => x.codigo === "1004")?.cantidad, 0.74);
  assert.equal(g.find((x) => x.codigo === "7790000000002")?.cantidad, 5);
});

test("csv con punto y coma y coma decimal", async () => {
  const r = await leerArchivoVentas(
    buf("Código;Producto;Cantidad\n1004;Queso;0,36\n1004;Queso;0,38\n55;Pan;2\n"), "v.csv");
  assert.deepEqual(r.errores, []);
  const g = agruparVentas(r.lineas);
  assert.equal(g.find((x) => x.codigo === "1004")?.cantidad, 0.74);
});

test("acepta el encabezado 'Código / CB' del sistema de Goya", async () => {
  const r = await leerArchivoVentas(
    buf("Código / CB;Producto;Cantidad\n0763571720592;Azúcar;1\n1023;Huevos;2\n"), "g.csv");
  assert.deepEqual(r.errores, []);
  assert.equal(r.lineas.length, 2);
  assert.equal(r.lineas[0].codigo, "763571720592");
});

test("csv con comillas y encabezados con tilde/mayúsculas", async () => {
  const r = await leerArchivoVentas(
    buf('CÓDIGO,DESCRIPCIÓN,CANTIDAD\n"123","Galletitas, dulces ""x""",3\n'), "v.csv");
  assert.equal(r.lineas[0].producto, 'Galletitas, dulces "x"');
  assert.equal(r.lineas[0].cantidad, 3);
});

test("filas inválidas se informan sin frenar el resto", () => {
  const r = interpretarFilas([
    ["Codigo", "Producto", "Cantidad"],
    ["", "Sin código", "1"],
    ["ABC", "Código con letras", "1"],
    ["10", "Cantidad mala", "uno"],
    ["11", "Cantidad cero", "0"],
    ["12", "Cantidad negativa", "-2"],
    ["13", "Bien", "2"],
    ["", "", ""],
  ]);
  assert.equal(r.lineas.length, 1);
  assert.equal(r.lineas[0].codigo, "13");
  assert.deepEqual(r.errores.map((e) => e.fila), [2, 3, 4, 5, 6]);
});

test("faltan columnas, archivo vacío, formato y tamaño inválidos", async () => {
  await assert.rejects(leerArchivoVentas(buf("A,B\n1,2\n"), "v.csv"), /columnas/);
  await assert.rejects(leerArchivoVentas(new ArrayBuffer(0), "v.csv"), /vacío/);
  await assert.rejects(leerArchivoVentas(buf("x"), "v.pdf"), /Formato no soportado/);
  await assert.rejects(leerArchivoVentas(buf("no soy un zip"), "v.xlsx"), /Excel/);
  await assert.rejects(
    leerArchivoVentas(new ArrayBuffer(2 * 1024 * 1024 + 1), "v.csv"), /demasiado grande/);
});

test("normalización de códigos y cantidades", () => {
  assert.equal(normalizarCodigoVenta(" 0001023 "), "1023");
  assert.equal(normalizarCodigoVenta("77 90"), "7790");
  assert.equal(normalizarCodigoVenta("12a"), "");
  // Etiquetas de balanza: los dígitos 3 a 7 son el código del producto.
  assert.equal(normalizarCodigoVenta("2401002000222750"), "1002");
  assert.equal(normalizarCodigoVenta(" 2401123000679000 "), "1123");
  assert.equal(normalizarCodigoVenta("7790045002123"), "7790045002123");
  assert.equal(normalizarCodigoVenta("2400000000123456"), "2400000000123456");
  assert.equal(convertirCantidad("1.234,56"), 1234.56);
  assert.equal(convertirCantidad("1,234.56"), 1234.56);
  assert.equal(convertirCantidad("0,1"), 0.1);
  assert.equal(convertirCantidad("abc"), null);
  assert.equal(agruparVentas([
    { fila: 2, codigo: "1", producto: "", cantidad: 0.1 },
    { fila: 3, codigo: "1", producto: "Nombre", cantidad: 0.2 },
  ])[0].cantidad, 0.3);
});
