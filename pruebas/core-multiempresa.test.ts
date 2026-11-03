
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODULO_DEL_PERMISO,
  puedeRealizarAccion,
  tienePermiso,
  esAdmin,
  type ContextoCore,
} from "../core/seguridad.js";

const empresaA = "empresa-a";
const empresaB = "empresa-b";

const usuario: ContextoCore = {
  usuarioId: "usuario-1",
  activo: true,
  empresa: { id: empresaA, clave: "EMPRESA_A", activa: true },
  sucursalesAutorizadas: [
    { id: "sucursal-a1", empresaId: empresaA, nombre: "Goya", activa: true },
  ],
  modulosEmpresa: ["INVENTARIO", "MOVIMIENTOS"],
  modulosUsuario: ["INVENTARIO", "MOVIMIENTOS"],
  permisos: ["inventario.ver", "movimientos.ver"],
};

const evaluar = (
  cambios: Partial<ContextoCore> = {},
  empresaId = empresaA,
  sucursalId = "sucursal-a1"
) =>
  puedeRealizarAccion(
    { ...usuario, ...cambios },
    "inventario.ver",
    { empresaId, sucursalId }
  );

test("Core multiempresa: misma sucursal visible, empresa diferente", () => {
  assert.equal(evaluar(), true);
  assert.equal(evaluar({}, empresaB), false);
  assert.equal(evaluar({}, empresaA, "sucursal-b1"), false);
  assert.equal(
    evaluar({
      sucursalesAutorizadas: [
        { id: "sucursal-b1", empresaId: empresaB, nombre: "Goya", activa: true },
      ],
    }, empresaA, "sucursal-b1"),
    false
  );
});

test("Core multiempresa: permisos y módulos contratados", () => {
  assert.equal(evaluar({ permisos: [] }), false);
  assert.equal(evaluar({ modulosEmpresa: ["MOVIMIENTOS"] }), false);
  assert.equal(evaluar({ modulosUsuario: ["MOVIMIENTOS"] }), false);
  assert.equal(
    puedeRealizarAccion(usuario, "inventario.editarGuardado", {
      empresaId: empresaA,
      sucursalId: "sucursal-a1",
    }),
    false
  );
});

test("Core multiempresa: usuario, empresa y sucursal activa", () => {
  assert.equal(evaluar({ activo: false }), false);
  assert.equal(evaluar({ empresa: { ...usuario.empresa, activa: false } }), false);
  assert.equal(evaluar({ usuarioId: "" }), false);
  assert.equal(
    evaluar({ sucursalesAutorizadas: [{
      id: "sucursal-a1", empresaId: empresaA, nombre: "Goya", activa: false,
    }] }),
    false
  );
  assert.equal(evaluar({}, empresaA, ""), false);
  assert.equal(
    puedeRealizarAccion(usuario, "inventario.ver", { empresaId: empresaA }),
    false
  );
});

test("Core multiempresa: el rol ADMIN no saltea permisos explícitos", () => {
  assert.equal(
    puedeRealizarAccion({ ...usuario, permisos: [] }, "usuarios.gestionar", {
      empresaId: empresaA,
    }),
    false
  );
});

test("Compatibilidad: la UI conserva la tabla de roles existente", () => {
  assert.equal(esAdmin("ADMIN"), true);
  assert.equal(esAdmin("USUARIO"), false);
  assert.equal(tienePermiso("USUARIO", "inventario.crear"), true);
  assert.equal(tienePermiso("USUARIO", "inventario.editarGuardado"), false);
  assert.equal(tienePermiso("ADMIN", "inventario.editarGuardado"), true);
  assert.equal(MODULO_DEL_PERMISO["ajustes.configurar"], "CONFIGURACION");
});
