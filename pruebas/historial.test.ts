import assert from "node:assert/strict";
import { test } from "node:test";
import {
  estadoDeMovimiento, fechaArgentina, filtrarHistorial, historialACsv, valoresDistintos,
  type MovimientoHistorial,
} from "../src/modules/movimientos/historial.js";

const base = (c: Partial<MovimientoHistorial>): MovimientoHistorial => ({
  id: "recAAAAAAAAAAAAAA", fechaHora: "2026-11-26T15:00:00.000Z", nombreProducto: "Yerba Mate",
  tipoMovimiento: "EGRESO", motivo: "VENTA", vencimiento: null, cantidad: 1, responsable: "",
  observacion: "", procesado: true, errorMotor: "", ...c,
});
const lista = [
  base({ id: "rec1", nombreProducto: "Yerba Mate", observacion: "Ventas archivo: 26-11.xlsx" }),
  base({ id: "rec2", nombreProducto: "Turrón", fechaHora: "2026-11-20T12:00:00.000Z", tipoMovimiento: "INGRESO", motivo: "COMPRA" }),
  base({ id: "rec3", nombreProducto: "Galletitas", procesado: false, errorMotor: "Stock insuficiente", motivo: "VENTA" }),
  base({ id: "rec4", nombreProducto: "Budín", procesado: false, motivo: "TRANSFERENCIA", ubicacionDestinoNombre: "BELLA VISTA PRUEBA | GÓNDOLA" }),
];

test("fecha en hora argentina (después de las 21 UTC sigue siendo el mismo día)", () => {
  assert.equal(fechaArgentina("2026-11-27T01:30:00.000Z"), "2026-11-26");
  assert.equal(fechaArgentina("no es fecha"), "");
});
test("estado: OK, ERROR, PENDIENTE", () => {
  assert.deepEqual(lista.map(estadoDeMovimiento), ["OK", "OK", "ERROR", "PENDIENTE"]);
});
test("filtra por fechas, tipo, motivo y estado", () => {
  assert.deepEqual(filtrarHistorial(lista, { desde: "2026-11-25" }).map((m) => m.id), ["rec1", "rec3", "rec4"]);
  assert.deepEqual(filtrarHistorial(lista, { hasta: "2026-11-21" }).map((m) => m.id), ["rec2"]);
  assert.deepEqual(filtrarHistorial(lista, { tipo: "INGRESO" }).map((m) => m.id), ["rec2"]);
  assert.deepEqual(filtrarHistorial(lista, { motivo: "TRANSFERENCIA" }).map((m) => m.id), ["rec4"]);
  assert.deepEqual(filtrarHistorial(lista, { estado: "ERROR" }).map((m) => m.id), ["rec3"]);
});
test("busca sin importar mayúsculas ni tildes, también en observación y destino", () => {
  assert.deepEqual(filtrarHistorial(lista, { texto: "turron" }).map((m) => m.id), ["rec2"]);
  assert.deepEqual(filtrarHistorial(lista, { texto: "VENTAS ARCHIVO" }).map((m) => m.id), ["rec1"]);
  assert.deepEqual(filtrarHistorial(lista, { texto: "bella vista" }).map((m) => m.id), ["rec4"]);
  assert.equal(filtrarHistorial(lista, { texto: "zzz" }).length, 0);
});
test("una fecha inválida no pasa un filtro de fechas", () => {
  assert.equal(filtrarHistorial([base({ fechaHora: "" })], { desde: "2026-01-01" }).length, 0);
});
test("valores distintos ordenados", () => {
  assert.deepEqual(valoresDistintos(lista, "motivo"), ["COMPRA", "TRANSFERENCIA", "VENTA"]);
});
test("CSV: separador ;, coma decimal, comillas escapadas y sin fórmulas peligrosas", () => {
  const csv = historialACsv([base({ nombreProducto: '=CMD("x")', cantidad: 0.25, observacion: 'dice "hola"' })]);
  assert.ok(csv.startsWith("﻿Fecha;Producto"));
  const fila = csv.split("\r\n")[1];
  assert.match(fila, /"'=CMD\(""x""\)"/);
  assert.match(fila, /;0,25;/);
  assert.match(fila, /"dice ""hola"""/);
});
