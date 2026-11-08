/**
 * OPTIMA 12C.16.1 — regresión defensiva para integración comercial.
 * Pruebas LOCALES: entradas sintéticas, ninguna consulta real a Redis/Airtable/Vercel.
 * No sustituyen una auditoría de despliegue ni un pentest.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { puedeUsarCapacidadComercial, type ConsultaAccesoComercial } from "../core/acceso-comercial.js";
import { puedeRealizarAccion, type ContextoCore } from "../core/seguridad.js";
import { validarContrataciones } from "../core/reglas-comerciales.js";
import { crearConsultaComercial, type DependenciasConsultaComercial } from "../handlers/core/consulta-comercial.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const EMPRESA = "rec" + "A".repeat(14);
const AJENA = "rec" + "B".repeat(14);
const PLATAFORMA = "rec" + "P".repeat(14);
const SUCURSAL = "rec" + "S".repeat(14);
const SUCURSAL_AJENA = "rec" + "X".repeat(14);

const submodulos = [{ id: "CHEQUES", moduloPadre: "ADMINISTRACION" }] as const;
const capacidades = [
  {
    id: "inventario.stock", modulo: "INVENTARIO", submodulo: null,
    permiso: "inventario.ver", nivelMinimoModulo: "GESTION", nivelMinimoSubmodulo: null,
  },
  {
    id: "administracion.cheques", modulo: "ADMINISTRACION", submodulo: "CHEQUES",
    permiso: "administracion.gestionarCheques", nivelMinimoModulo: "GESTION", nivelMinimoSubmodulo: "ESTANDAR",
  },
] as const;
const principal = [{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "PREMIUM" }] as const;
const independiente = [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "PREMIUM" }] as const;

const contexto: ContextoCore = {
  usuarioId: "rec" + "U".repeat(14), activo: true,
  empresa: { id: EMPRESA, clave: "FICTICIA", activa: true },
  modulosEmpresa: ["INVENTARIO"], modulosUsuario: ["INVENTARIO"],
  permisos: ["inventario.ver"],
  sucursalesAutorizadas: [{ id: SUCURSAL, empresaId: EMPRESA, nombre: "Ficticia", activa: true }],
};
function c(overrides: Partial<ConsultaAccesoComercial> = {}): ConsultaAccesoComercial {
  return {
    contexto,
    empresaContratacionId: EMPRESA,
    contrataciones: principal,
    catalogoSubmodulos: submodulos,
    catalogoCapacidades: capacidades,
    capacidad: "inventario.stock",
    recurso: { empresaId: EMPRESA, sucursalId: SUCURSAL },
    permisosAsignadosUsuario: ["inventario.ver"],
    submodulosHabilitadosUsuario: [],
    ...overrides,
  };
}
function independ(overrides: Partial<ConsultaAccesoComercial> = {}): ConsultaAccesoComercial {
  return c({
    contrataciones: independiente, capacidad: "administracion.cheques",
    recurso: { empresaId: EMPRESA },
    permisosAsignadosUsuario: ["administracion.gestionarCheques"],
    submodulosHabilitadosUsuario: ["CHEQUES"],
    ...overrides,
  });
}

test("12C.16: contrato principal válido NO reemplaza el permiso efectivo del Core", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ contexto: { ...contexto, permisos: [] } })), false);
});
test("12C.16: contrato principal válido NO activa módulo técnico ausente", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ contexto: { ...contexto, modulosEmpresa: [] } })), false);
});
test("12C.16: contrato principal válido NO activa módulo de usuario ausente", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ contexto: { ...contexto, modulosUsuario: [] } })), false);
});
test("12C.16: contrato y empresa de sesión deben coincidir", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ empresaContratacionId: AJENA })), false);
});
test("12C.16: recurso de empresa ajena queda bloqueado", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ recurso: { empresaId: AJENA, sucursalId: SUCURSAL } })), false);
});
test("12C.16: sucursal no autorizada queda bloqueada", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ recurso: { empresaId: EMPRESA, sucursalId: SUCURSAL_AJENA } })), false);
});
test("12C.16: sucursal suspendida queda bloqueada", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ contexto: {
    ...contexto, sucursalesAutorizadas: [{ ...contexto.sucursalesAutorizadas[0], activa: false }],
  } })), false);
});
test("12C.16: usuario inactivo queda bloqueado", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ contexto: { ...contexto, activo: false } })), false);
});
test("12C.16: empresa inactiva queda bloqueada", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ contexto: { ...contexto, empresa: { ...contexto.empresa, activa: false } } })), false);
});
test("12C.16: módulo de nivel menor no habilita capacidad superior", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ contrataciones: [
    { modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESENCIAL" },
  ] })), false);
});
test("12C.16: ruta principal solo concede cuando todos los controles están presentes", () => {
  assert.equal(puedeUsarCapacidadComercial(c()), true);
});
test("12C.16: submódulo sin permiso personal queda bloqueado", () => {
  assert.equal(puedeUsarCapacidadComercial(independ({ permisosAsignadosUsuario: [] })), false);
});
test("12C.16: submódulo sin asignación personal queda bloqueado", () => {
  assert.equal(puedeUsarCapacidadComercial(independ({ submodulosHabilitadosUsuario: [] })), false);
});
test("12C.16: submódulo independiente válido requiere ambas asignaciones", () => {
  assert.equal(puedeUsarCapacidadComercial(independ()), true);
});
test("12C.16: submódulo ESTANDAR no cumple capacidad PREMIUM", () => {
  const premium = capacidades.map(cap => cap.id === "administracion.cheques"
    ? { ...cap, nivelMinimoSubmodulo: "PREMIUM" as const } : cap);
  assert.equal(puedeUsarCapacidadComercial(independ({
    catalogoCapacidades: premium,
    contrataciones: [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" }],
  })), false);
});
test("12C.16: contratación incompatible padre más independiente deniega", () => {
  assert.equal(puedeUsarCapacidadComercial(independ({ contrataciones: [
    { modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "PREMIUM" },
    ...independiente,
  ] })), false);
});
test("12C.16: capacidad no incluida en catálogo no puede habilitarse", () => {
  assert.equal(puedeUsarCapacidadComercial(c({ capacidad: "inventario.privilegio_desconocido" })), false);
});
test("12C.16: catálogo corrupto de permisos deniega TODAS las capacidades", () => {
  const alterado = capacidades.map(cap => cap.id === "administracion.cheques"
    ? { ...cap, permiso: "inventario.ver" as const } : cap);
  assert.equal(puedeUsarCapacidadComercial(c({ catalogoCapacidades: alterado })), false);
});
test("12C.16: campos extra en contrato no se aceptan silenciosamente", () => {
  const r = validarContrataciones([
    { modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "PREMIUM", permisoAdministrador: true },
  ], submodulos);
  assert.equal(r.ok, false);
});
test("12C.16: el Core no acepta acceso directo al recurso de empresa ajena", () => {
  assert.equal(puedeRealizarAccion(contexto, "inventario.ver", { empresaId: AJENA, sucursalId: SUCURSAL }), false);
});

type ControlRuta = { autorizacion: "SIN_SESION" | "NO_AUTORIZADO" | "OK"; empresa: number; contrato: number };
function ruta() {
  const control: ControlRuta = { autorizacion: "OK", empresa: 0, contrato: 0 };
  const deps: DependenciasConsultaComercial = {
    async autenticar() { return control.autorizacion === "OK"
      ? { estado: "OK", empresaPlataformaId: PLATAFORMA } : { estado: control.autorizacion }; },
    async buscarEmpresa(id) { control.empresa++; return { id, nombre: "Empresa simulada" }; },
    async buscarContrato() { control.contrato++; return { ok: false, motivo: "SIN_CONTRATO" }; },
  };
  const h = crearConsultaComercial(deps);
  async function pedir(method: string, empresaId: unknown = EMPRESA) {
    let status = 0; let body: any;
    const req = { method, query: { empresaId } } as unknown as VercelRequest;
    const res = {
      setHeader() { return this; },
      status(n: number) { status = n; return this; },
      json(data: unknown) { body = data; return this; },
    } as unknown as VercelResponse;
    await h(req, res);
    return { status, body };
  }
  return { control, pedir };
}
test("12C.16: denegar cuenta cliente antes de consultar contrato", async () => {
  const { control, pedir } = ruta();
  control.autorizacion = "NO_AUTORIZADO";
  assert.equal((await pedir("GET")).status, 403);
  assert.equal(control.empresa, 0);
  assert.equal(control.contrato, 0);
});
test("12C.16: denegar ausencia de sesión antes de consultar contrato", async () => {
  const { control, pedir } = ruta();
  control.autorizacion = "SIN_SESION";
  assert.equal((await pedir("GET")).status, 401);
  assert.equal(control.empresa, 0);
  assert.equal(control.contrato, 0);
});
test("12C.16: denegar escrituras antes de consultar contrato", async () => {
  for (const metodo of ["POST", "PATCH", "PUT", "DELETE"]) {
    const { control, pedir } = ruta();
    assert.equal((await pedir(metodo)).status, 405);
    assert.equal(control.contrato, 0);
  }
});
test("12C.16: empresa seleccionada no puede ser la de la plataforma", async () => {
  const { control, pedir } = ruta();
  assert.equal((await pedir("GET", PLATAFORMA)).status, 400);
  assert.equal(control.empresa, 0);
});
test("12C.16: lista sin contratos no habilita operaciones", async () => {
  const { pedir } = ruta();
  const r = await pedir("GET");
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, "SIN_CONTRATO");
  assert.equal(r.body.accesoOperativoHabilitado, false);
  assert.equal(r.body.contrato, null);
});
