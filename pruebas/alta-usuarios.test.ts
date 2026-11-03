import assert from "node:assert/strict";
import { test } from "node:test";
import { construirAltaInvitado, opcionesParaAlta } from "../core/alta-usuarios.js";
import type { ContextoCore } from "../core/seguridad.js";

const company = `rec${"B".repeat(14)}`;
const u1 = `rec${"C".repeat(14)}`;
const u2 = `rec${"D".repeat(14)}`;
const contexto: ContextoCore = {
  usuarioId: `rec${"A".repeat(14)}`, activo: true,
  empresa: { id: company, clave: "DEMO", activa: true },
  modulosEmpresa: ["CORE", "INVENTARIO", "MOVIMIENTOS"],
  modulosUsuario: ["CORE", "INVENTARIO"],
  permisos: ["usuarios.gestionar", "usuarios.ver", "inventario.ver"],
  sucursalesAutorizadas: [
    { id: u1, nombre: "GOYA", empresaId: company, activa: true },
    { id: u2, nombre: "BELLA VISTA", empresaId: company, activa: false },
  ],
};
const disponibles = opcionesParaAlta(contexto, ["USUARIO", "INVENTARIO", "MOVIMIENTOS"], {
  PERMISOS_USUARIOS: ["VER", "GESTIONAR USUARIOS"],
  PERMISOS_INVENTARIO: ["VER", "CREAR"],
});
const valido = {
  usuario: "PRUEBA_001", nombre: "Persona ficticia", email: "prueba@example.org",
  sucursalIds: [u1], sucursalPredeterminadaId: u1,
  modulos: ["CORE", "INVENTARIO"], permisos: ["inventario.ver"],
};

test("solo ofrece módulos y acciones del administrador", () => {
  assert.deepEqual(disponibles.modulos.map((m) => m.id), ["CORE", "INVENTARIO"]);
  assert.deepEqual(disponibles.permisos.map((p) => p.id), ["inventario.ver", "usuarios.ver", "usuarios.gestionar"]);
  assert.deepEqual(disponibles.sucursales.map((s) => s.id), [u1]);
});

test("alta autorizada: cuenta inactiva, empresa, sucursal y permisos limitados", () => {
  const r = construirAltaInvitado(valido, contexto, disponibles);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.campos.EMPRESA, [company]);
  assert.equal(r.campos.ACTIVO, false);
  assert.equal(r.campos.ROL, "USUARIO");
  assert.deepEqual(r.campos.MODULOS, ["USUARIO", "INVENTARIO"]);
  assert.deepEqual(r.campos.PERMISOS_INVENTARIO, ["VER"]);
  assert.equal("PASSWORD_HASH" in r.campos, false);
  assert.equal(r.campos.Email, valido.email);
});

test("rechaza crear en Inventario sin permiso para crearlo", () => {
  assert.equal(construirAltaInvitado({ ...valido, permisos: ["inventario.crear"] }, contexto, disponibles).ok, false);
});

test("rechaza módulos fuera de los autorizados", () => {
  assert.equal(construirAltaInvitado({ ...valido, modulos: ["CORE", "MOVIMIENTOS"] }, contexto, disponibles).ok, false);
});

test("rechaza sucursales que no están activas o autorizadas", () => {
  assert.equal(construirAltaInvitado({ ...valido, sucursalIds: [u2], sucursalPredeterminadaId: u2 }, contexto, disponibles).ok, false);
});

test("rechaza la predeterminada si no pertenece a las autorizadas", () => {
  assert.equal(construirAltaInvitado({ ...valido, sucursalPredeterminadaId: u2 }, contexto, disponibles).ok, false);
});

test("no concede permisos de un módulo no seleccionado", () => {
  assert.equal(construirAltaInvitado({ ...valido, modulos: ["CORE"] }, contexto, disponibles).ok, false);
});

test("rechaza correos y usuarios inválidos", () => {
  assert.equal(construirAltaInvitado({ ...valido, email: "invalido" }, contexto, disponibles).ok, false);
  assert.equal(construirAltaInvitado({ ...valido, usuario: "!!" }, contexto, disponibles).ok, false);
});
