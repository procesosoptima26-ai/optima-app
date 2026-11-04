import assert from "node:assert/strict";
import { test } from "node:test";
import {
  prepararAltaSucursal,
  prepararCambioNombreSucursal,
  prepararDesactivacionSucursal,
} from "../core/gestion-sucursales.js";

const EMPRESA = "rec" + "A".repeat(14);
const SUCURSAL_1 = "rec" + "B".repeat(14);
const SUCURSAL_2 = "rec" + "C".repeat(14);

const sucursales = [
  { id: SUCURSAL_1, nombre: "Bella Vista", activa: true },
  { id: SUCURSAL_2, nombre: "Goya", activa: true },
];

test("11B: crear sin duplicar nombres", () => {
  const alta = prepararAltaSucursal(
    "Santa Lucía", EMPRESA, sucursales
  );
  assert.equal(alta.ok, true);

  const duplicada = prepararAltaSucursal(
    "bella vista", EMPRESA, sucursales
  );
  assert.equal(duplicada.ok, false);
});

test("11B: cambiar nombre de sucursal", () => {
  const cambio = prepararCambioNombreSucursal(
    SUCURSAL_1, "Bella Vista Centro", sucursales
  );
  assert.equal(cambio.ok, true);

  const repetido = prepararCambioNombreSucursal(
    SUCURSAL_1, "Goya", sucursales
  );
  assert.equal(repetido.ok, false);
});

test("11B: proteger la desactivación", () => {
  const conUsuarios = prepararDesactivacionSucursal(
    SUCURSAL_1, sucursales, 2
  );
  assert.equal(conUsuarios.ok, false);

  const sinUsuarios = prepararDesactivacionSucursal(
    SUCURSAL_1, sucursales, 0
  );
  assert.equal(sinUsuarios.ok, true);

  const ultima = prepararDesactivacionSucursal(
    SUCURSAL_1, [sucursales[0]], 0
  );
  assert.equal(ultima.ok, false);
});
