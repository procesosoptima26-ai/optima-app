import test from "node:test";
import assert from "node:assert/strict";
import {
  agruparOpciones, claveOpcion, formatearOpcionNueva, limpiarOpcion, nombreMaster,
  normalizarCantPack, opcionExistente, resolverOpcion,
} from "../lib/producto-opciones.js";

test("la clave ignora mayúsculas, tildes, espacios, puntos y guiones", () => {
  assert.equal(claveOpcion("Clásico"), claveOpcion("clasico"));
  assert.equal(claveOpcion("1 Kg"), claveOpcion("1kg"));
  assert.equal(claveOpcion("LA SERENÍSIMA"), claveOpcion("La Serenisima "));
  assert.notEqual(claveOpcion("Arroz"), claveOpcion("Arroz Gallo"));
});

test("los decimales no se confunden con enteros", () => {
  assert.notEqual(claveOpcion("10,5gr"), claveOpcion("105gr"));
  assert.notEqual(claveOpcion("1.1kg"), claveOpcion("11kg"));
  assert.notEqual(claveOpcion("1-2"), claveOpcion("12"));
  assert.equal(claveOpcion("10,5gr"), claveOpcion("10.5 GR"));
  assert.equal(claveOpcion("1,5L"), claveOpcion("1.5l"));
  assert.equal(claveOpcion("c.c."), claveOpcion("cc"));
  assert.equal(claveOpcion("sin-tacc"), claveOpcion("Sin Tacc"));
  assert.equal(agruparOpciones(["105gr", "10,5gr", "10.5gr"]).length, 2);
  assert.equal(claveOpcion(""), "");
});

test("agrupar deja una sola opción por grupo: la más usada", () => {
  const lista = agruparOpciones([
    "1kg", "1kg", "1kg", "1Kg", "1KG", "x2", "X2", "X2", "Queso", "Queso ", "Queso",
  ]);
  assert.deepEqual(lista, ["1kg", "Queso", "X2"]);
});

test("en un empate gana la que tiene tilde", () => {
  assert.deepEqual(agruparOpciones(["Budin", "Budín"]), ["Budín"]);
});

test("agrupar ordena alfabéticamente sin importar tildes y descarta vacíos", () => {
  assert.deepEqual(agruparOpciones(["Pan", "", "  ", "Árbol", "Arroz"]), ["Árbol", "Arroz", "Pan"]);
});

test("una opción existente equivalente se reconoce y devuelve la oficial", () => {
  const opciones = ["1kg", "Clásico"];
  assert.equal(opcionExistente("1 KG", opciones), "1kg");
  assert.equal(opcionExistente("clasico", opciones), "Clásico");
  assert.equal(opcionExistente("2kg", opciones), null);
  assert.equal(opcionExistente("", opciones), null);
});

test("las opciones nuevas se formatean prolijas", () => {
  assert.equal(formatearOpcionNueva("especificacion", "  doble   CAROLINA "), "Doble Carolina");
  assert.equal(formatearOpcionNueva("marca", "la serenisima"), "La Serenisima");
  assert.equal(formatearOpcionNueva("presentacion", " 1KG "), "1kg");
  assert.equal(formatearOpcionNueva("producto", "   "), "");
});

test("resolver usa la existente aunque venga escrita distinto", () => {
  assert.deepEqual(resolverOpcion("presentacion", "1KG", ["1kg"]), { valor: "1kg", esNueva: false });
  assert.deepEqual(resolverOpcion("producto", "arroz", ["Arroz"]), { valor: "Arroz", esNueva: false });
  assert.deepEqual(resolverOpcion("producto", "yerba mate", ["Arroz"]), { valor: "Yerba Mate", esNueva: true });
  assert.deepEqual(resolverOpcion("marca", undefined, ["Arcor"]), { valor: "", esNueva: false });
});

test("el nombre final sigue el orden de Airtable: Producto, Marca, Especificación, Presentación", () => {
  assert.equal(
    nombreMaster({ producto: "Queso", marca: "Cremigal", especificacion: ["Cremoso"], presentacion: "fraccionado" }),
    "Queso Cremigal Cremoso fraccionado",
  );
  assert.equal(nombreMaster({ producto: "Arroz", especificacion: ["Doble", "Carolina"] }), "Arroz Doble Carolina");
});

test("cant. pack: vacío se permite; solo enteros mayores a 0", () => {
  assert.equal(normalizarCantPack(""), "");
  assert.equal(normalizarCantPack(undefined), "");
  assert.equal(normalizarCantPack("12"), "12");
  assert.equal(normalizarCantPack(" 012 "), "12");
  assert.equal(normalizarCantPack(6), "6");
  assert.equal(normalizarCantPack("0"), null);
  assert.equal(normalizarCantPack("-3"), null);
  assert.equal(normalizarCantPack("1,5"), null);
  assert.equal(normalizarCantPack("abc"), null);
  assert.equal(normalizarCantPack("12345"), null);
});

test("limpiar saca espacios de más y tolera valores raros", () => {
  assert.equal(limpiarOpcion("  Pan   lactal "), "Pan lactal");
  assert.equal(limpiarOpcion(undefined), "");
  assert.equal(limpiarOpcion(5), "");
});
