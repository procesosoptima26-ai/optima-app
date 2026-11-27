import assert from "node:assert/strict";
import test from "node:test";
import {
  FACTOR_MAXIMO, FACTOR_MINIMO, INDICE_ESTACIONAL, COBERTURA_POR_GRUPO, clasificarGrupo, factorDeTemporada, indicePromedio,
  type GrupoCompra,
} from "../lib/compras-reglas.js";

test("clasificarGrupo reconoce los grupos por el nombre", () => {
  const casos: Array<[string, GrupoCompra]> = [
    ["Helado La Montevideana Banana split 500gr", "HELADOS"],
    ["Torta helada Sape! Chocotorta", "HELADOS"],
    ["Cerveza Quilmes 340cc", "CERVEZAS_Y_VINOS"],
    ["Vino Alma Mora Cabernet Sauvignon 750ml", "CERVEZAS_Y_VINOS"],
    ["Agua saborizada LEVITÉ Manzana 2,25lts", "BEBIDAS"],
    ["Yogurt Cremigal Vainilla, Descremado 1Lt", "LACTEOS_Y_FIAMBRES"],
    ["Queso Cremigal Cremoso fraccionado", "LACTEOS_Y_FIAMBRES"],
    ["Hamburguesa Swift 80gr, en Caja x12", "CARNES"],
    ["Papas  McCain bastón, Tradicional 700gr", "CONGELADOS"],
    ["Tarta Frioteka jamón y queso", "CONGELADOS"],
    ["Papas  Lays Jamón serrano 77gr", "SNACKS"],
    ["Chizitos Cheetos Original 43gr", "SNACKS"],
    ["Alfajor Shot Mini", "GOLOSINAS"],
    ["Galletitas dulces Oreo Chocolate 118gr", "ALMACEN"],
    ["Fideo Arcor Mostachol nº52 500gr", "ALMACEN"],
    ["Caldo Alicante Carne x1", "ALMACEN"],
    ["Pan dulce Terrabusi 400gr", "NAVIDENOS"],
    ["Detergente Magistral 500ml", "LIMPIEZA_Y_PERFUMERIA"],
    ["Cosa rara sin palabras conocidas", "GENERAL"],
  ];
  for (const [nombre, grupo] of casos) assert.equal(clasificarGrupo(nombre), grupo, nombre);
});

test("la categoría de Airtable, si se reconoce, tiene prioridad sobre el nombre", () => {
  assert.equal(clasificarGrupo("Producto de nombre raro", "Helados"), "HELADOS");
  assert.equal(clasificarGrupo("Yogurt Cremigal", "Almacén"), "ALMACEN");
  // Una categoría desconocida no estorba: se usa el nombre.
  assert.equal(clasificarGrupo("Yogurt Cremigal", "Otra cosa"), "LACTEOS_Y_FIAMBRES");
  assert.equal(clasificarGrupo("Yogurt Cremigal", ""), "LACTEOS_Y_FIAMBRES");
  assert.equal(clasificarGrupo("Yogurt Cremigal", null), "LACTEOS_Y_FIAMBRES");
});

test("todas las tablas tienen 12 meses y una cobertura por grupo", () => {
  for (const [grupo, indices] of Object.entries(INDICE_ESTACIONAL)) {
    assert.equal(indices.length, 12, grupo);
    assert.ok(indices.every((n) => n > 0), grupo);
    assert.ok(COBERTURA_POR_GRUPO[grupo as GrupoCompra] > 0, grupo);
  }
});

test("indicePromedio promedia día por día y cruza de mes", () => {
  // Helados: noviembre 1,3 y diciembre 1,5. Del 30-11 al 01-12 es la mitad y la mitad.
  assert.equal(Math.round(indicePromedio("HELADOS", "2026-11-30", "2026-12-01") * 100) / 100, 1.4);
  assert.equal(indicePromedio("GENERAL", "2026-01-01", "2026-12-31"), 1);
});

test("factorDeTemporada: sube hacia el verano, baja hacia el invierno y respeta los topes", () => {
  assert.ok(factorDeTemporada("HELADOS", "2026-11-27", 10, 60) > 1);
  assert.ok(factorDeTemporada("HELADOS", "2026-04-27", 15, 60) < 1);
  assert.equal(factorDeTemporada("GENERAL", "2026-11-27", 15, 60), 1);
  const navidad = factorDeTemporada("NAVIDENOS", "2026-11-27", 15, 60);
  assert.ok(navidad <= FACTOR_MAXIMO && navidad > 1.5, `navideños ${navidad}`);
  const bajo = factorDeTemporada("NAVIDENOS", "2026-01-10", 15, 60);
  assert.ok(bajo >= FACTOR_MINIMO && bajo < 1);
});

test("factorDeTemporada: fecha inválida corta con error claro", () => {
  assert.throws(() => factorDeTemporada("HELADOS", "27/11/2026", 10, 60), /Fecha inválida/);
});
