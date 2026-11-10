import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContextoCore } from "../core/seguridad.js";
import type { DefinicionCapacidadComercial } from "../core/acceso-comercial.js";
import {
  diagnosticarAccesoComercialIntegrado,
  type OpcionesDiagnosticoAccesoIntegrado,
} from "../core/diagnostico-integrado-acceso-12c164.js";

const id = (prefijo: string, letra: string) => prefijo + letra.repeat(14);
const EMPRESA = id("rec", "E"), AJENA = id("rec", "X");
const USUARIO = id("rec", "U"), OTRO = id("rec", "O");
const SUCURSAL = id("rec", "S"), OTRA_SUCURSAL = id("rec", "Y");
const BASE = id("app", "B"), TABLA_CONTRATOS = id("tbl", "C"), TABLA_USUARIOS = id("tbl", "T");
const TOKEN = "TOKEN-FICTICIO-NUNCA-REAL";
const AHORA = "2026-11-10T17:00:00.000Z";

const CHEQUES: DefinicionCapacidadComercial = {
  id: "administracion.cheques.consultar", modulo: "ADMINISTRACION", submodulo: "CHEQUES",
  permiso: "administracion.gestionarCheques", nivelMinimoModulo: "ESENCIAL",
  nivelMinimoSubmodulo: "ESTANDAR",
};
const BANCOS: DefinicionCapacidadComercial = {
  id: "administracion.bancos.consultar", modulo: "ADMINISTRACION", submodulo: "BANCOS",
  permiso: "administracion.gestionarBancos", nivelMinimoModulo: "ESENCIAL",
  nivelMinimoSubmodulo: "ESTANDAR",
};
const STOCK: DefinicionCapacidadComercial = {
  id: "inventario.stock.consultar", modulo: "INVENTARIO", submodulo: "INV_STOCK_UBICACIONES",
  permiso: "inventario.ver", nivelMinimoModulo: "ESENCIAL",
  nivelMinimoSubmodulo: "ESTANDAR",
};
const CHEQUES_PREMIUM: DefinicionCapacidadComercial = {
  ...CHEQUES, id: "administracion.cheques.analizar", nivelMinimoSubmodulo: "PREMIUM",
};

const BASE_CONTEXTO: ContextoCore = {
  usuarioId: USUARIO, activo: true,
  empresa: { id: EMPRESA, clave: "PRUEBA", activa: true },
  sucursalesAutorizadas: [{ id: SUCURSAL, empresaId: EMPRESA, nombre: "Sucursal prueba", activa: true }],
  modulosEmpresa: ["CORE"], modulosUsuario: ["CORE"], permisos: [],
};

type Servicio = { modalidad: "SUBMODULO_INDEPENDIENTE"; submodulo: string; nivel: "ESTANDAR" | "PREMIUM" } |
  { modalidad: "MODULO_PRINCIPAL"; modulo: string; nivel: string };

type Alteraciones = {
  servicios?: readonly Servicio[];
  camposContrato?: Record<string, unknown>;
  camposUsuario?: Record<string, unknown>;
  usuarioFilaId?: string;
  sinContrato?: boolean;
  sinCampoSubmodulos?: boolean;
  estadoContrato?: string;
  contratoStatus?: number;
  usuarioStatus?: number;
  contratoError?: boolean;
  usuarioError?: boolean;
  contexto?: ContextoCore;
  opciones?: Partial<OpcionesDiagnosticoAccesoIntegrado>;
};

function escenario(cambios: Alteraciones = {}) {
  const llamadas: Array<{ tipo: string; url: string; method: string }> = [];
  const servicios = cambios.servicios ?? [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" }];
  const contrato = {
    id: id("rec", "C"),
    fields: {
      ID_VERSION: "VERSION-1", ID_CONTRATO: "CONTRATO-1", EMPRESA: [EMPRESA], VERSION: 1,
      ESTADO: cambios.estadoContrato ?? "VIGENTE",
      SERVICIOS_CONTRATADOS: JSON.stringify(servicios),
      CONDICIONES_ECONOMICAS: "PRIVADO-NO-DEVOLVER",
      VIGENTE_DESDE: "2026-01-01T00:00:00.000Z",
      FECHA_APROBACION: "2026-01-01T00:00:00.000Z",
      APROBADO_POR_ID: "APROBADOR-INTERNO",
      ...cambios.camposContrato,
    },
  };
  const usuario = {
    id: cambios.usuarioFilaId ?? USUARIO,
    fields: {
      EMPRESA: [EMPRESA], ACTIVO: true,
      PERMISOS_ADMINISTRACION: ["GESTIONAR_CHEQUES"],
      SUBMODULOS_HABILITADOS: ["CHEQUES"],
      Email: "usuario@ejemplo.invalid", PASSWORD_HASH: "NUNCA_MOSTRAR",
      ...cambios.camposUsuario,
    },
  };
  if (cambios.sinCampoSubmodulos) delete (usuario.fields as Record<string, unknown>).SUBMODULOS_HABILITADOS;
  const opciones: OpcionesDiagnosticoAccesoIntegrado = {
    capacidad: CHEQUES.id, recurso: { empresaId: EMPRESA },
    catalogoCapacidades: [CHEQUES, BANCOS, STOCK, CHEQUES_PREMIUM],
    ahoraIso: AHORA,
    baseId: BASE, tablaContratosId: TABLA_CONTRATOS, tablaUsuariosId: TABLA_USUARIOS,
    token: TOKEN,
    clienteHttpContratos: async (url, init) => {
      llamadas.push({ tipo: "contratos", url, method: init.method ?? "GET" });
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      assert.ok(url.includes(`/${BASE}/${TABLA_CONTRATOS}`));
      assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
      if (cambios.contratoError) throw Error("PROVEEDOR_PRIVADO");
      return {
        ok: (cambios.contratoStatus ?? 200) === 200, status: cambios.contratoStatus ?? 200,
        json: async () => ({ records: cambios.sinContrato ? [] : [contrato] }),
      };
    },
    clienteHttpUsuarios: async (url, init) => {
      llamadas.push({ tipo: "usuarios", url, method: init.method });
      assert.equal(init.method, "GET");
      assert.ok(url.endsWith(`/${TABLA_USUARIOS}/${USUARIO}`));
      assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
      if (cambios.usuarioError) throw Error("PROVEEDOR_PRIVADO");
      return {
        ok: (cambios.usuarioStatus ?? 200) === 200, status: cambios.usuarioStatus ?? 200,
        json: async () => usuario,
      };
    },
    ...cambios.opciones,
  };
  return {
    llamadas,
    contrato,
    usuario,
    contexto: cambios.contexto ?? BASE_CONTEXTO,
    opciones,
    ejecutar: () => diagnosticarAccesoComercialIntegrado(cambios.contexto ?? BASE_CONTEXTO, opciones),
  };
}

async function compatible(cambios: Alteraciones = {}): Promise<boolean> {
  const r = await escenario(cambios).ejecutar();
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("Diagnóstico inválido");
  assert.equal(r.accesoOperativoHabilitado, false);
  assert.equal(r.estado, "DIAGNOSTICO_NO_OPERATIVO");
  return r.compatibleEnSimulacion;
}

test("12C.16.4: submódulo individual estándar con asignación y permiso explícitos", async () => {
  const caso = escenario();
  const r = await caso.ejecutar();
  assert.deepEqual(r, { ok: true, compatibleEnSimulacion: true,
    accesoOperativoHabilitado: false, estado: "DIAGNOSTICO_NO_OPERATIVO" });
  assert.deepEqual(caso.llamadas.map(x => x.tipo), ["contratos", "usuarios"]);
});

test("12C.16.4: contrato empresarial sin asignación individual no habilita", async () => {
  assert.equal(await compatible({ camposUsuario: { SUBMODULOS_HABILITADOS: [] } }), false);
});

test("12C.16.4: campo de submódulos ausente no habilita", async () => {
  assert.equal(await compatible({ sinCampoSubmodulos: true }), false);
});

test("12C.16.4: asignación individual sin permiso RAW no habilita", async () => {
  assert.equal(await compatible({ camposUsuario: { PERMISOS_ADMINISTRACION: [] } }), false);
});

test("12C.16.4: un permiso RAW no implica contratar submódulo", async () => {
  assert.equal(await compatible({ servicios: [
    { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "BANCOS", nivel: "ESTANDAR" },
  ] }), false);
});

test("12C.16.4: contrato ausente deniega antes de leer usuario", async () => {
  const caso = escenario({ sinContrato: true });
  const r = await caso.ejecutar();
  assert.deepEqual(r, { ok: false, motivo: "CONTRATO_NO_DISPONIBLE", accesoOperativoHabilitado: false });
  assert.deepEqual(caso.llamadas.map(x => x.tipo), ["contratos"]);
});

test("12C.16.4: contrato de otra empresa deniega", async () => {
  const caso = escenario({ camposContrato: { EMPRESA: [AJENA] } });
  assert.equal((await caso.ejecutar()).ok, false);
  assert.equal(caso.llamadas.some(x => x.tipo === "usuarios"), false);
});

test("12C.16.4: contrato caducado deniega", async () => {
  const caso = escenario({ camposContrato: { VIGENTE_HASTA: "2026-05-01T00:00:00.000Z" } });
  assert.equal((await caso.ejecutar()).ok, false);
});

test("12C.16.4: contrato aún no vigente deniega", async () => {
  const caso = escenario({ camposContrato: { VIGENTE_DESDE: "2027-01-01T00:00:00.000Z" } });
  assert.equal((await caso.ejecutar()).ok, false);
});

test("12C.16.4: estado aprobado sin vigencia deniega", async () => {
  const caso = escenario({ estadoContrato: "APROBADA" });
  assert.equal((await caso.ejecutar()).ok, false);
});

test("12C.16.4: modalidad de módulo más submódulo superpuesto deniega", async () => {
  const caso = escenario({ servicios: [
    { modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "ESENCIAL" },
    { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" },
  ] });
  assert.equal((await caso.ejecutar()).ok, false);
});

test("12C.16.4: usuario de otra empresa no habilita", async () => {
  const caso = escenario({ camposUsuario: { EMPRESA: [AJENA] } });
  assert.deepEqual(await caso.ejecutar(), {
    ok: false, motivo: "ASIGNACIONES_NO_DISPONIBLES", accesoOperativoHabilitado: false,
  });
});

test("12C.16.4: usuario inactivo no habilita", async () => {
  assert.equal((await escenario({ camposUsuario: { ACTIVO: false } }).ejecutar()).ok, false);
});

test("12C.16.4: usuario distinto no habilita", async () => {
  assert.equal((await escenario({ usuarioFilaId: OTRO }).ejecutar()).ok, false);
});

test("12C.16.4: asignación malformada no habilita", async () => {
  assert.equal((await escenario({ camposUsuario: { SUBMODULOS_HABILITADOS: "CHEQUES" } }).ejecutar()).ok, false);
});

test("12C.16.4: nivel Premium requerido no se satisface con Estándar", async () => {
  assert.equal(await compatible({ opciones: { capacidad: CHEQUES_PREMIUM.id } }), false);
});

test("12C.16.4: nivel Premium contratado sí satisface Premium en diagnóstico", async () => {
  assert.equal(await compatible({
    servicios: [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "PREMIUM" }],
    opciones: { capacidad: CHEQUES_PREMIUM.id },
  }), true);
});

test("12C.16.4: módulo principal activo con permisos técnicos admite sin asignar submódulos", async () => {
  const contexto: ContextoCore = {
    ...BASE_CONTEXTO, modulosEmpresa: ["CORE", "ADMINISTRACION"],
    modulosUsuario: ["CORE", "ADMINISTRACION"], permisos: ["administracion.gestionarCheques"],
  };
  assert.equal(await compatible({
    contexto,
    servicios: [{ modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "ESENCIAL" }],
    camposUsuario: { SUBMODULOS_HABILITADOS: [] },
  }), true);
});

test("12C.16.4: módulo principal sin habilitación técnica no habilita", async () => {
  assert.equal(await compatible({
    servicios: [{ modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "ESENCIAL" }],
  }), false);
});

test("12C.16.4: módulo principal con contexto obsoleto y permiso RAW retirado deniega", async () => {
  const contexto: ContextoCore = {
    ...BASE_CONTEXTO, modulosEmpresa: ["CORE", "ADMINISTRACION"],
    modulosUsuario: ["CORE", "ADMINISTRACION"], permisos: ["administracion.gestionarCheques"],
  };
  assert.equal(await compatible({
    contexto,
    servicios: [{ modalidad: "MODULO_PRINCIPAL", modulo: "ADMINISTRACION", nivel: "ESENCIAL" }],
    camposUsuario: { PERMISOS_ADMINISTRACION: [] },
  }), false);
});

test("12C.16.4: una sucursal ajena no habilita inventario", async () => {
  const caso = escenario({
    contexto: { ...BASE_CONTEXTO, modulosEmpresa: ["CORE", "INVENTARIO"],
      modulosUsuario: ["CORE", "INVENTARIO"], permisos: ["inventario.ver"] },
    servicios: [{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESENCIAL" }],
    camposUsuario: { PERMISOS_INVENTARIO: ["VER"] },
    opciones: { capacidad: STOCK.id, recurso: { empresaId: EMPRESA, sucursalId: OTRA_SUCURSAL } },
  });
  const r = await caso.ejecutar();
  assert.equal(r.ok && r.compatibleEnSimulacion, false);
});

test("12C.16.4: inventario requiere sucursal explícita", async () => {
  assert.equal(await compatible({
    contexto: { ...BASE_CONTEXTO, modulosEmpresa: ["CORE", "INVENTARIO"],
      modulosUsuario: ["CORE", "INVENTARIO"], permisos: ["inventario.ver"] },
    servicios: [{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESENCIAL" }],
    camposUsuario: { PERMISOS_INVENTARIO: ["VER"] },
    opciones: { capacidad: STOCK.id },
  }), false);
});

test("12C.16.4: inventario admite solo sucursal propia en diagnóstico", async () => {
  assert.equal(await compatible({
    contexto: { ...BASE_CONTEXTO, modulosEmpresa: ["CORE", "INVENTARIO"],
      modulosUsuario: ["CORE", "INVENTARIO"], permisos: ["inventario.ver"] },
    servicios: [{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESENCIAL" }],
    camposUsuario: { PERMISOS_INVENTARIO: ["VER"] },
    opciones: { capacidad: STOCK.id, recurso: { empresaId: EMPRESA, sucursalId: SUCURSAL } },
  }), true);
});

test("12C.16.4: recurso de otra empresa deniega ANTES de la red", async () => {
  const caso = escenario({ opciones: { recurso: { empresaId: AJENA } } });
  assert.deepEqual(await caso.ejecutar(), {
    ok: false, motivo: "CONTEXTO_INVALIDO", accesoOperativoHabilitado: false,
  });
  assert.equal(caso.llamadas.length, 0);
});

test("12C.16.4: empresa inactiva deniega ANTES de la red", async () => {
  const caso = escenario({ contexto: { ...BASE_CONTEXTO, empresa: { ...BASE_CONTEXTO.empresa, activa: false } } });
  assert.equal((await caso.ejecutar()).ok, false);
  assert.equal(caso.llamadas.length, 0);
});

test("12C.16.4: config inválida deniega ANTES de la red", async () => {
  const caso = escenario({ opciones: { baseId: "INEXISTENTE" } });
  assert.deepEqual(await caso.ejecutar(), {
    ok: false, motivo: "CONFIGURACION_INVALIDA", accesoOperativoHabilitado: false,
  });
  assert.equal(caso.llamadas.length, 0);
});

test("12C.16.4: falla del proveedor de contratos no filtra información", async () => {
  const r = await escenario({ contratoError: true }).ejecutar();
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(r).includes("PROVEEDOR_PRIVADO"), false);
});

test("12C.16.4: falla del proveedor de usuarios no filtra información", async () => {
  const r = await escenario({ usuarioError: true }).ejecutar();
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(r).includes("PROVEEDOR_PRIVADO"), false);
});

test("12C.16.4: niega capacidad no declarada", async () => {
  assert.equal(await compatible({ opciones: { capacidad: "administracion.cheques.inventada" } }), false);
});

test("12C.16.4: no filtra token, precios, correo ni contraseña", async () => {
  const r = await escenario().ejecutar();
  const s = JSON.stringify(r);
  for (const dato of [TOKEN, "PRIVADO-NO-DEVOLVER", "usuario@ejemplo.invalid", "NUNCA_MOSTRAR"]) {
    assert.equal(s.includes(dato), false);
  }
});

test("12C.16.4: no escribe ni solicita métodos ajenos a GET", async () => {
  const caso = escenario();
  await caso.ejecutar();
  assert.deepEqual(caso.llamadas.map(x => x.method), ["GET", "GET"]);
});
