import { test } from "node:test";
import assert from "node:assert/strict";
import {
  construirContextoCore,
  resolverSucursalAutorizada,
  type RegistrosContexto,
} from "../core/contexto.js";
import { puedeRealizarAccion } from "../core/seguridad.js";

const base: RegistrosContexto = {
  empresa: {
    id: "empresa-1",
    clave: "E1",
    activa: true,
    modulosContratados: ["INVENTARIO", "MOVIMIENTOS"],
  },
  usuario: {
    id: "usuario-1",
    empresaId: "empresa-1",
    activo: true,
    sucursalIds: ["sucursal-1"],
    modulosHabilitados: ["INVENTARIO", "ADMINISTRACION"],
    permisosAsignados: [
      "inventario.ver", "administracion.ver", "usuarios.ver",
    ],
  },
  sucursales: [
    { id: "sucursal-1", empresaId: "empresa-1", nombre: "Goya", activa: true },
  ],
};

function contexto(valores: RegistrosContexto = base) {
  return construirContextoCore(valores);
}

test("Core: empresa, sucursal y permisos efectivos", () => {
  const resultado = contexto();
  assert.equal(resultado.ok, true);
  if (!resultado.ok) return;
  assert.deepEqual(resultado.contexto.modulosUsuario, ["INVENTARIO"]);
  assert.deepEqual(resultado.contexto.permisos,
    ["inventario.ver", "usuarios.ver"]);
  assert.equal(puedeRealizarAccion(resultado.contexto, "inventario.ver", {
    empresaId: "empresa-1", sucursalId: "sucursal-1",
  }), true);
  assert.equal(puedeRealizarAccion(resultado.contexto, "administracion.ver", {
    empresaId: "empresa-1",
  }), false);
  assert.equal(resolverSucursalAutorizada(resultado.contexto, "sucursal-1")?.id,
    "sucursal-1");
  assert.equal(resolverSucursalAutorizada(resultado.contexto, "Goya"), null);
});

test("Core: rechaza empresas diferentes aunque compartan el nombre de sucursal", () => {
  const resultado = contexto({
    ...base,
    sucursales: [{ id: "sucursal-1", empresaId: "empresa-2", nombre: "Goya", activa: true }],
  });
  assert.deepEqual(resultado, {
    ok: false, motivo: "REFERENCIAS_INCONSISTENTES",
  });
  assert.deepEqual(contexto({
    ...base, usuario: { ...base.usuario, empresaId: "empresa-2" },
  }), { ok: false, motivo: "EMPRESA_NO_COINCIDE" });
});

test("Core: empresa o usuario desactivados no producen contexto", () => {
  assert.deepEqual(contexto({
    ...base, usuario: { ...base.usuario, activo: false },
  }), { ok: false, motivo: "USUARIO_INACTIVO" });
  assert.deepEqual(contexto({
    ...base, empresa: { ...base.empresa, activa: false },
  }), { ok: false, motivo: "EMPRESA_INACTIVA" });
});

test("Core: referencias de sucursal incompletas se rechazan", () => {
  assert.deepEqual(contexto({
    ...base, usuario: { ...base.usuario, sucursalIds: ["sucursal-inexistente"] },
  }), { ok: false, motivo: "REFERENCIAS_INCONSISTENTES" });
});

test("Core: sucursal desactivada no se autoriza", () => {
  const resultado = contexto({
    ...base, sucursales: [{ ...base.sucursales[0], activa: false }],
  });
  assert.equal(resultado.ok, true);
  if (resultado.ok) {
    assert.deepEqual(resultado.contexto.sucursalesAutorizadas, []);
    assert.equal(puedeRealizarAccion(resultado.contexto, "inventario.ver", {
      empresaId: "empresa-1", sucursalId: "sucursal-1",
    }), false);
  }
});

test("Core: jamás asigna permisos por el nombre ADMIN", () => {
  const resultado = contexto({
    ...base, usuario: { ...base.usuario, permisosAsignados: [] },
  });
  assert.equal(resultado.ok, true);
  if (resultado.ok) assert.deepEqual(resultado.contexto.permisos, []);
});

test("Core: configuración inválida no se interpreta como acceso libre", () => {
  const invalido = {
    ...base,
    empresa: { ...base.empresa, modulosContratados: ["INVENTARIO", "DESCONOCIDO"] },
  } as unknown as RegistrosContexto;
  assert.deepEqual(contexto(invalido), {
    ok: false, motivo: "REGISTROS_INVALIDOS",
  });
});
