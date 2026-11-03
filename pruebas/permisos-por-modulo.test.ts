import assert from "node:assert/strict";
import { test } from "node:test";
import { leerPermisosAsignados } from "../core/permisos-airtable.js";
import { construirContextoCore } from "../core/contexto.js";
import { puedeRealizarAccion } from "../core/seguridad.js";

const empresaId = "recAAAAAAAAAAAAAA";
const sucursalId = "recBBBBBBBBBBBBBB";

function contexto(permisos: ReturnType<typeof leerPermisosAsignados>, modulosUsuario: readonly ("INVENTARIO" | "MOVIMIENTOS")[] = ["INVENTARIO", "MOVIMIENTOS"]) {
  assert.ok(permisos);
  const resultado = construirContextoCore({
    usuario: { id: "recCCCCCCCCCCCCCC", activo: true, empresaId, sucursalIds: [sucursalId],
      modulosHabilitados: modulosUsuario, permisosAsignados: permisos },
    empresa: { id: empresaId, clave: "EMPRESA DEMO", activa: true,
      modulosContratados: ["INVENTARIO", "MOVIMIENTOS"] },
    sucursales: [{ id: sucursalId, empresaId, nombre: "LOCAL", activa: true }],
  });
  assert.equal(resultado.ok, true);
  if (!resultado.ok) throw new Error("Contexto no generado");
  return resultado.contexto;
}

test("Los permisos pertenecen al módulo: CREAR en Inventario no autoriza Movimientos", () => {
  const permisos = leerPermisosAsignados({
    PERMISOS_INVENTARIO: ["VER", "CREAR", "EDITAR GUARDADO"],
    PERMISOS_MOVIMIENTOS: ["VER"],
  });
  const ctx = contexto(permisos);
  assert.equal(puedeRealizarAccion(ctx, "inventario.crear", {empresaId, sucursalId}), true);
  assert.equal(puedeRealizarAccion(ctx, "movimientos.crear", {empresaId, sucursalId}), false);
  assert.equal(puedeRealizarAccion(ctx, "movimientos.ver", {empresaId, sucursalId}), true);
  assert.equal(puedeRealizarAccion(ctx, "inventario.editarGuardado", {empresaId, sucursalId}), true);
});

test("Sin permisos, opción desconocida o sin contrato: acceso cerrado", () => {
  assert.deepEqual(leerPermisosAsignados({}), []);
  assert.equal(leerPermisosAsignados({ PERMISOS_INVENTARIO: ["PERMITIR TODO"] }), null);
  assert.equal(leerPermisosAsignados({ PERMISOS_MOVIMIENTOS: "VER" }), null);
  const vacio = contexto(leerPermisosAsignados({}));
  assert.equal(puedeRealizarAccion(vacio, "inventario.ver", {empresaId, sucursalId}), false);
  const restringido = contexto(leerPermisosAsignados({PERMISOS_INVENTARIO: ["VER"]}), ["MOVIMIENTOS"]);
  assert.equal(puedeRealizarAccion(restringido, "inventario.ver", {empresaId, sucursalId}), false);
});

test("Permisos con acento, espacios y guiones se normalizan sin mezclar acciones", () => {
  const permisos = leerPermisosAsignados({
    PERMISOS_ADMINISTRACION: ["GESTIONAR TERCEROS", "GESTIONAR_CHEQUES"],
    PERMISOS_MOVIMIENTOS: ["REVISAR AJUSTES", "EDITAR_GUARDADO"],
    PERMISOS_USUARIOS: ["GESTIONAR USUARIOS"],
  });
  assert.deepEqual(permisos, ["movimientos.revisarAjustes", "movimientos.editarGuardado",
    "administracion.gestionarTerceros", "administracion.gestionarCheques", "usuarios.gestionar"]);
});
