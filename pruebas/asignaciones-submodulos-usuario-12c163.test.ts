import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContextoCore } from "../core/seguridad.js";
import {
  CAMPO_SUBMODULOS_USUARIO,
  consultarAsignacionesUsuarioVerificado,
  interpretarAsignacionesUsuario,
  type ClienteHttpUsuario,
} from "../core/asignaciones-submodulos-usuario.js";
import { CATALOGO_SUBMODULOS_CONTRATACION } from "../core/catalogo-comercial-jerarquico.js";

const usuarioId = "rec" + "U".repeat(14);
const empresaId = "rec" + "E".repeat(14);
const empresaAjena = "rec" + "A".repeat(14);
const baseId = "app" + "B".repeat(14);
const tablaUsuariosId = "tbl" + "T".repeat(14);
const token = "ficticio-NO-REAL";

const contexto: ContextoCore = {
  usuarioId,
  activo: true,
  empresa: { id: empresaId, clave: "E", activa: true },
  sucursalesAutorizadas: [{ id: "rec" + "S".repeat(14), empresaId, nombre: "Local", activa: true }],
  modulosEmpresa: ["INVENTARIO"],
  modulosUsuario: ["INVENTARIO"],
  permisos: ["inventario.ver"],
};

function fila(cambios: Record<string, unknown> = {}) {
  return { id: usuarioId, fields: {
    ACTIVO: true, EMPRESA: [empresaId],
    PERMISOS_ADMINISTRACION: ["GESTIONAR_CHEQUES", "GESTIONAR_BANCOS"],
    [CAMPO_SUBMODULOS_USUARIO]: ["CHEQUES", "BANCOS"],
    ...cambios,
  } };
}
function simular(dato: unknown = fila(), status = 200) {
  const llamadas: Array<{ url: string; method: string; headers: { Authorization: string }; body?: unknown }> = [];
  const clienteHttp: ClienteHttpUsuario = async (url, init) => {
    llamadas.push({ url, method: init.method, headers: init.headers });
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal("body" in init, false);
    assert.ok(init.signal instanceof AbortSignal);
    return { ok: status === 200, status, json: async () => dato };
  };
  return { clienteHttp, llamadas };
}
const opciones = (clienteHttp: ClienteHttpUsuario) => ({ baseId, tablaUsuariosId, token, clienteHttp });

test("12C.16.3: usa campo canónico de submódulos", () => {
  assert.equal(CAMPO_SUBMODULOS_USUARIO, "SUBMODULOS_HABILITADOS");
});
test("12C.16.3: lectura segura de submódulos y permisos RAW explícitos", async () => {
  const m = simular();
  const r = await consultarAsignacionesUsuarioVerificado(contexto, opciones(m.clienteHttp));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.submodulosHabilitadosUsuario, ["CHEQUES", "BANCOS"]);
    assert.ok(r.permisosAsignadosUsuario.includes("administracion.gestionarCheques"));
    assert.ok(r.permisosAsignadosUsuario.includes("administracion.gestionarBancos"));
    assert.equal(r.usuarioId, usuarioId);
    assert.equal(r.empresaId, empresaId);
    assert.ok(Object.isFrozen(r.submodulosHabilitadosUsuario));
  }
  assert.equal(m.llamadas.length, 1);
  assert.equal(m.llamadas[0].url, `https://api.airtable.com/v0/${baseId}/${tablaUsuariosId}/${usuarioId}`);
  assert.equal(m.llamadas[0].headers.Authorization, `Bearer ${token}`);
});
test("12C.16.3: sin campo nuevo no concede submódulos", () => {
  const f = fila();
  delete (f.fields as Record<string, unknown>)[CAMPO_SUBMODULOS_USUARIO];
  const r = interpretarAsignacionesUsuario(contexto, f);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.submodulosHabilitadosUsuario, []);
});
test("12C.16.3: campo vacío no equivale a contratar todos", () => {
  const r = interpretarAsignacionesUsuario(contexto, fila({ [CAMPO_SUBMODULOS_USUARIO]: [] }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.submodulosHabilitadosUsuario, []);
});
test("12C.16.3: permisos faltantes nunca se deducen de ADMIN", () => {
  const f = fila();
  delete (f.fields as Record<string, unknown>).PERMISOS_ADMINISTRACION;
  (f.fields as Record<string, unknown>).ROL = "ADMIN";
  const r = interpretarAsignacionesUsuario(contexto, f);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.permisosAsignadosUsuario, []);
});
test("12C.16.3: permisos propios no habilitan submódulos no asignados", () => {
  const r = interpretarAsignacionesUsuario(contexto, fila({ [CAMPO_SUBMODULOS_USUARIO]: ["CHEQUES"] }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.submodulosHabilitadosUsuario, ["CHEQUES"]);
});
test("12C.16.3: asignación de submódulo sola no concede permisos", () => {
  const r = interpretarAsignacionesUsuario(contexto, fila({ PERMISOS_ADMINISTRACION: [] }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.permisosAsignadosUsuario, []);
});
test("12C.16.3: admite todas las 29 referencias válidas", () => {
  const ids = CATALOGO_SUBMODULOS_CONTRATACION.map(s => s.id);
  const r = interpretarAsignacionesUsuario(contexto, fila({ [CAMPO_SUBMODULOS_USUARIO]: ids }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.submodulosHabilitadosUsuario, ids);
});
test("12C.16.3: niega ID desconocido", () => {
  assert.deepEqual(interpretarAsignacionesUsuario(contexto,
    fila({ [CAMPO_SUBMODULOS_USUARIO]: ["CHEQUES", "OTRO"] })),
  { ok: false, motivo: "ASIGNACIONES_INVALIDAS" });
});
test("12C.16.3: niega etiquetas no canónicas", () => {
  assert.equal(interpretarAsignacionesUsuario(contexto,
    fila({ [CAMPO_SUBMODULOS_USUARIO]: ["Cheques"] })).ok, false);
});
test("12C.16.3: niega duplicados", () => {
  assert.equal(interpretarAsignacionesUsuario(contexto,
    fila({ [CAMPO_SUBMODULOS_USUARIO]: ["CHEQUES", "CHEQUES"] })).ok, false);
});
test("12C.16.3: niega tipo distinto de lista", () => {
  assert.equal(interpretarAsignacionesUsuario(contexto,
    fila({ [CAMPO_SUBMODULOS_USUARIO]: "CHEQUES" })).ok, false);
});
test("12C.16.3: niega listas con objetos o null", () => {
  for (const v of [[{ name: "CHEQUES" }], [null], [42]]) {
    assert.equal(interpretarAsignacionesUsuario(contexto,
      fila({ [CAMPO_SUBMODULOS_USUARIO]: v })).ok, false);
  }
});
test("12C.16.3: niega lista de longitud excesiva", () => {
  assert.equal(interpretarAsignacionesUsuario(contexto,
    fila({ [CAMPO_SUBMODULOS_USUARIO]: Array(30).fill("CHEQUES") })).ok, false);
});
test("12C.16.3: niega referencia cruzada a otra empresa", () => {
  assert.deepEqual(interpretarAsignacionesUsuario(contexto, fila({ EMPRESA: [empresaAjena] })),
    { ok: false, motivo: "EMPRESA_NO_COINCIDE" });
});
test("12C.16.3: niega varias empresas", () => {
  assert.equal(interpretarAsignacionesUsuario(contexto,
    fila({ EMPRESA: [empresaId, empresaAjena] })).ok, false);
});
test("12C.16.3: niega ausencia de vínculo empresarial", () => {
  assert.equal(interpretarAsignacionesUsuario(contexto,
    fila({ EMPRESA: [] })).ok, false);
});
test("12C.16.3: niega usuario inactivo", () => {
  assert.deepEqual(interpretarAsignacionesUsuario(contexto, fila({ ACTIVO: false })),
    { ok: false, motivo: "USUARIO_INACTIVO" });
});
test("12C.16.3: niega usuario diferente incluso de la misma empresa", () => {
  assert.deepEqual(interpretarAsignacionesUsuario(contexto,
    { ...fila(), id: "rec" + "X".repeat(14) }),
    { ok: false, motivo: "REGISTRO_INVALIDO" });
});
test("12C.16.3: deniega permisos inválidos en el maestro", () => {
  assert.deepEqual(interpretarAsignacionesUsuario(contexto,
    fila({ PERMISOS_ADMINISTRACION: ["PERMISO_FALSO"] })),
    { ok: false, motivo: "ASIGNACIONES_INVALIDAS" });
});
test("12C.16.3: deniega campo de permiso con formato incorrecto", () => {
  assert.equal(interpretarAsignacionesUsuario(contexto,
    fila({ PERMISOS_ADMINISTRACION: "GESTIONAR_CHEQUES" })).ok, false);
});
test("12C.16.3: niega JSON malformado o incompleto", () => {
  for (const dato of [null, [], {}, { id: usuarioId }, { id: usuarioId, fields: null }]) {
    assert.equal(interpretarAsignacionesUsuario(contexto, dato).ok, false);
  }
});
test("12C.16.3: niega contexto inactivo antes de acceder a la red", async () => {
  const m = simular();
  const r = await consultarAsignacionesUsuarioVerificado({ ...contexto, activo: false }, opciones(m.clienteHttp));
  assert.deepEqual(r, { ok: false, motivo: "CONTEXTO_INVALIDO" });
  assert.equal(m.llamadas.length, 0);
});
test("12C.16.3: niega empresa inactiva antes de red", async () => {
  const m = simular();
  const r = await consultarAsignacionesUsuarioVerificado(
    { ...contexto, empresa: { ...contexto.empresa, activa: false } }, opciones(m.clienteHttp));
  assert.equal(r.ok, false);
  assert.equal(m.llamadas.length, 0);
});
test("12C.16.3: niega usuarioId inválido antes de red", async () => {
  const m = simular();
  const r = await consultarAsignacionesUsuarioVerificado({ ...contexto, usuarioId: "usuario-any" }, opciones(m.clienteHttp));
  assert.equal(r.ok, false);
  assert.equal(m.llamadas.length, 0);
});
test("12C.16.3: niega empresaId inválido antes de red", async () => {
  const m = simular();
  const r = await consultarAsignacionesUsuarioVerificado(
    { ...contexto, empresa: { ...contexto.empresa, id: "empresa-any" } }, opciones(m.clienteHttp));
  assert.equal(r.ok, false);
  assert.equal(m.llamadas.length, 0);
});
test("12C.16.3: niega base inválida sin red", async () => {
  const m = simular();
  const r = await consultarAsignacionesUsuarioVerificado(contexto, { ...opciones(m.clienteHttp), baseId: "Base" });
  assert.deepEqual(r, { ok: false, motivo: "CONFIGURACION_INVALIDA" });
  assert.equal(m.llamadas.length, 0);
});
test("12C.16.3: niega tabla inválida sin red", async () => {
  const m = simular();
  const r = await consultarAsignacionesUsuarioVerificado(contexto, { ...opciones(m.clienteHttp), tablaUsuariosId: "USUARIOS" });
  assert.equal(r.ok, false);
  assert.equal(m.llamadas.length, 0);
});
test("12C.16.3: niega token vacío antes de red", async () => {
  const m = simular();
  const r = await consultarAsignacionesUsuarioVerificado(contexto, { ...opciones(m.clienteHttp), token: "   " });
  assert.equal(r.ok, false);
  assert.equal(m.llamadas.length, 0);
});
test("12C.16.3: GET 404 significa usuario no encontrado", async () => {
  const m = simular(null, 404);
  assert.deepEqual(await consultarAsignacionesUsuarioVerificado(contexto, opciones(m.clienteHttp)),
    { ok: false, motivo: "USUARIO_NO_ENCONTRADO" });
});
test("12C.16.3: GET 403 deniega sin revelar detalles", async () => {
  const m = simular(null, 403);
  assert.deepEqual(await consultarAsignacionesUsuarioVerificado(contexto, opciones(m.clienteHttp)),
    { ok: false, motivo: "LECTURA_NO_DISPONIBLE" });
});
test("12C.16.3: GET con respuesta diferente de 200 deniega", async () => {
  const m = simular(fila(), 206);
  assert.deepEqual(await consultarAsignacionesUsuarioVerificado(contexto, opciones(m.clienteHttp)),
    { ok: false, motivo: "LECTURA_NO_DISPONIBLE" });
});
test("12C.16.3: error de red oculta secreto", async () => {
  const clienteHttp: ClienteHttpUsuario = async () => { throw Error(`SECRETO ${token}`); };
  const r = await consultarAsignacionesUsuarioVerificado(contexto, opciones(clienteHttp));
  assert.deepEqual(r, { ok: false, motivo: "LECTURA_NO_DISPONIBLE" });
  assert.equal(JSON.stringify(r).includes(token), false);
});
test("12C.16.3: respuesta JSON inválida deniega", async () => {
  const clienteHttp: ClienteHttpUsuario = async () => ({ ok: true, status: 200, json: async () => { throw Error("secreto"); } });
  assert.equal((await consultarAsignacionesUsuarioVerificado(contexto, opciones(clienteHttp))).ok, false);
});
test("12C.16.3: no muta registro ni contexto", () => {
  const origen = fila();
  const antes = JSON.stringify({ origen, contexto });
  const r = interpretarAsignacionesUsuario(contexto, origen);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify({ origen, contexto }), antes);
});
test("12C.16.3: no expone token ni campos personales", async () => {
  const m = simular({ ...fila(), fields: { ...fila().fields, Email: "personal@example.invalid", PASSWORD_HASH: "privado" } });
  const r = await consultarAsignacionesUsuarioVerificado(contexto, opciones(m.clienteHttp));
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r).includes("PASSWORD_HASH"), false);
  assert.equal(JSON.stringify(r).includes("personal@example.invalid"), false);
  assert.equal(JSON.stringify(r).includes(token), false);
});
