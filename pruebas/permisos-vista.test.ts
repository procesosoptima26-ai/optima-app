import assert from "node:assert/strict";
import test from "node:test";
import { permiteAccionUI, permisoMovimientoPorTipo, permiteMovimientoUI, permiteModoMovimientoUI, modoMovimientoInicialUI } from "../src/config/permisos-vista.js";

const lectura = {modulos:["INVENTARIO","MOVIMIENTOS","ADMINISTRACION"],permisos:["inventario.ver","movimientos.ver","administracion.ver"]};
const creador = {modulos:["INVENTARIO","MOVIMIENTOS"],permisos:["inventario.crear","movimientos.crear"]};
const ajustador = {modulos:["MOVIMIENTOS"],permisos:["movimientos.ajustar"]};

test("la lectura no habilita guardar ni editar inventario", () => {
  assert.equal(permiteAccionUI(lectura, "INVENTARIO", "inventario.ver"),true);
  assert.equal(permiteAccionUI(lectura, "INVENTARIO", "inventario.crear"),false);
  assert.equal(permiteAccionUI(lectura, "INVENTARIO", "inventario.editarGuardado"),false);
});
test("un permiso de otro módulo no concede acceso", () => {
  assert.equal(permiteAccionUI({modulos:["INVENTARIO"],permisos:["movimientos.ajustar"]},"MOVIMIENTOS","movimientos.ajustar"),false);
  assert.equal(permiteAccionUI(null,"INVENTARIO","inventario.crear"),false);
});
test("tipos AJUSTE requieren AJUSTAR y movimientos normales CREAR", () => {
  assert.equal(permisoMovimientoPorTipo("AJUSTE -"),"movimientos.ajustar");
  assert.equal(permisoMovimientoPorTipo("EGRESO"),"movimientos.crear");
  assert.equal(permiteMovimientoUI(creador,"AJUSTE +"),false);
  assert.equal(permiteMovimientoUI(creador,"INGRESO"),true);
  assert.equal(permiteMovimientoUI(ajustador,"AJUSTE -"),true);
  assert.equal(permiteMovimientoUI(ajustador,"EGRESO"),false);
});
test("pestañas de movimientos según permiso y primera vista segura", () => {
  assert.equal(permiteModoMovimientoUI(lectura,"stock"),true);
  assert.equal(permiteModoMovimientoUI(lectura,"recepcion"),false);
  assert.equal(permiteModoMovimientoUI(creador,"reposicion"),true);
  assert.equal(permiteModoMovimientoUI(creador,"individual"),true);
  assert.equal(permiteModoMovimientoUI(ajustador,"individual"),true);
  assert.equal(modoMovimientoInicialUI(lectura),"stock");
  assert.equal(modoMovimientoInicialUI(creador),"recepcion");
  assert.equal(modoMovimientoInicialUI(ajustador),"individual");
});
