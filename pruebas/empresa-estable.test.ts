import test from "node:test";
import assert from "node:assert/strict";
import { esIdEmpresaEstable, leerIdEmpresaEstable, generarIdEmpresaEstable } from "../lib/empresa-estable.js";

test("acepta solo el formato emp_ + 12 minúsculas/números", () => {
  assert.equal(esIdEmpresaEstable("emp_s84ng12hqeq1"), true);
  for (const malo of ["emp_S84ng12hqeq1", "emp_s84ng12hqeq", "emp_s84ng12hqeq12", "rec4tLlE2dddN2SPL",
    "emp_s84ng12hqeq!", " emp_s84ng12hqeq1", "", null, undefined, 123]) {
    assert.equal(esIdEmpresaEstable(malo), false, String(malo));
  }
});

test("lee el campo del registro y descarta valores inválidos", () => {
  assert.equal(leerIdEmpresaEstable({ ID_EMPRESA_ESTABLE: "emp_xngaq4y32jji" }), "emp_xngaq4y32jji");
  assert.equal(leerIdEmpresaEstable({ ID_EMPRESA_ESTABLE: "  emp_xngaq4y32jji  " }), "emp_xngaq4y32jji");
  assert.equal(leerIdEmpresaEstable({ ID_EMPRESA_ESTABLE: "otro" }), null);
  assert.equal(leerIdEmpresaEstable({ ID_EMPRESA_ESTABLE: ["emp_xngaq4y32jji"] }), null);
  assert.equal(leerIdEmpresaEstable({}), null);
  assert.equal(leerIdEmpresaEstable(null), null);
  assert.equal(leerIdEmpresaEstable("emp_xngaq4y32jji"), null);
});

test("los tres códigos cargados en la base de prueba son válidos", () => {
  for (const id of ["emp_s84ng12hqeq1", "emp_xngaq4y32jji", "emp_z4zpb2kz13ea"]) {
    assert.equal(esIdEmpresaEstable(id), true);
  }
});

test("genera códigos válidos y distintos entre sí", () => {
  const vistos = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const id = generarIdEmpresaEstable();
    assert.equal(esIdEmpresaEstable(id), true);
    vistos.add(id);
  }
  assert.equal(vistos.size, 2000);
});

test("descarta bytes sesgados (>=252) y usa el alfabeto completo", () => {
  // Primero bytes altos (se descartan), luego 0..35 en orden.
  const bytes = [255, 252, 253, ...Array.from({ length: 36 }, (_, i) => i)];
  const id = generarIdEmpresaEstable(() => Uint8Array.from(bytes));
  assert.equal(id, "emp_abcdefghijkl");
});
