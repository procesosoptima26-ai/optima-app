import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContextoCore } from "../core/seguridad.js";
import {
  puedeUsarCapacidadComercial,
  type DefinicionCapacidadComercial,
  type ConsultaAccesoComercial,
} from "../core/acceso-comercial.js";

// Catálogos ficticios de pruebas: NO fijan el alcance comercial definitivo.
const submodulos = [
  { id: "CHEQUES", moduloPadre: "ADMINISTRACION" },
  { id: "BANCOS", moduloPadre: "ADMINISTRACION" },
] as const;
const capacidades: readonly DefinicionCapacidadComercial[] = [
  { id: "administracion.cheques.registrar", modulo: "ADMINISTRACION", submodulo: "CHEQUES",
    permiso: "administracion.gestionarCheques", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: "ESTANDAR" },
  { id: "administracion.cheques.analizar", modulo: "ADMINISTRACION", submodulo: "CHEQUES",
    permiso: "administracion.gestionarCheques", nivelMinimoModulo: "PREMIUM", nivelMinimoSubmodulo: "PREMIUM" },
  { id: "administracion.bancos.consultar", modulo: "ADMINISTRACION", submodulo: "BANCOS",
    permiso: "administracion.gestionarBancos", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: "ESTANDAR" },
  { id: "administracion.resumen.consultar", modulo: "ADMINISTRACION", submodulo: null,
    permiso: "administracion.ver", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: null },
  { id: "inventario.productos.consultar", modulo: "INVENTARIO", submodulo: null,
    permiso: "inventario.ver", nivelMinimoModulo: "ESENCIAL", nivelMinimoSubmodulo: null },
];
const contexto: ContextoCore = {
  usuarioId: "usuario-1", activo: true,
  empresa: { id: "empresa-1", clave: "E1", activa: true },
  sucursalesAutorizadas: [{ id: "sucursal-1", nombre: "Goya", empresaId: "empresa-1", activa: true }],
  modulosEmpresa: ["INVENTARIO", "ADMINISTRACION"],
  modulosUsuario: ["INVENTARIO", "ADMINISTRACION"],
  permisos: ["inventario.ver", "administracion.ver", "administracion.gestionarCheques"],
};
const principal = (modulo: string, nivel: string) => ({ modalidad: "MODULO_PRINCIPAL", modulo, nivel });
const independiente = (submodulo: string, nivel: string) =>
  ({ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo, nivel });

function entrada(cambios: Partial<ConsultaAccesoComercial> = {}): ConsultaAccesoComercial {
  return {
    contexto, empresaContratacionId: "empresa-1",
    contrataciones: [principal("ADMINISTRACION", "GESTION")],
    catalogoSubmodulos: submodulos, catalogoCapacidades: capacidades,
    capacidad: "administracion.cheques.registrar",
    recurso: { empresaId: "empresa-1" },
    permisosAsignadosUsuario: ["administracion.gestionarCheques", "administracion.gestionarBancos"],
    submodulosHabilitadosUsuario: ["CHEQUES", "BANCOS"],
    ...cambios,
  };
}

function acceso(cambios: Partial<ConsultaAccesoComercial> = {}): boolean {
  return puedeUsarCapacidadComercial(entrada(cambios));
}

test("12C.13: módulo completo Gestión autoriza función Esencial con permiso Core", () => {
  assert.equal(acceso(), true);
  assert.equal(acceso({ capacidad: "administracion.cheques.analizar" }), false);
});

test("12C.13: módulo completo Premium incluye sus niveles anteriores", () => {
  assert.equal(acceso({
    contrataciones: [principal("ADMINISTRACION", "PREMIUM")],
    capacidad: "administracion.cheques.analizar",
  }), true);
});

test("12C.13: el módulo principal exige habilitación técnica y permiso Core", () => {
  assert.equal(acceso({ contexto: { ...contexto, modulosEmpresa: [] } }), false);
  assert.equal(acceso({ contexto: { ...contexto, modulosUsuario: [] } }), false);
  assert.equal(acceso({ contexto: { ...contexto, permisos: ["administracion.ver"] } }), false);
});

test("12C.13: Cheques Estándar funciona sin habilitar Administración completo", () => {
  assert.equal(acceso({
    contrataciones: [independiente("CHEQUES", "ESTANDAR")],
    contexto: { ...contexto, modulosEmpresa: [], modulosUsuario: [], permisos: [] },
  }), true);
});

test("12C.13: Cheques Estándar NO habilita Cheques Premium", () => {
  assert.equal(acceso({
    contrataciones: [independiente("CHEQUES", "ESTANDAR")],
    capacidad: "administracion.cheques.analizar",
  }), false);
});

test("12C.13: Cheques Premium permite las capacidades de Estándar", () => {
  assert.equal(acceso({ contrataciones: [independiente("CHEQUES", "PREMIUM")] }), true);
  assert.equal(acceso({
    contrataciones: [independiente("CHEQUES", "PREMIUM")],
    capacidad: "administracion.cheques.analizar",
  }), true);
});

test("12C.13: Cheques no da acceso a Bancos ni al resumen de Administración", () => {
  const contrataciones = [independiente("CHEQUES", "PREMIUM")];
  assert.equal(acceso({ contrataciones, capacidad: "administracion.bancos.consultar" }), false);
  assert.equal(acceso({ contrataciones, capacidad: "administracion.resumen.consultar" }), false);
});

test("12C.13: tampoco se concede acceso por tener solo contrato y no asignación", () => {
  const contrataciones = [independiente("CHEQUES", "ESTANDAR")];
  assert.equal(acceso({ contrataciones, submodulosHabilitadosUsuario: [] }), false);
  assert.equal(acceso({ contrataciones, permisosAsignadosUsuario: [] }), false);
});

test("12C.13: contratos superpuestos o duplicados se rechazan enteros", () => {
  assert.equal(acceso({ contrataciones: [
    principal("ADMINISTRACION", "PREMIUM"), independiente("CHEQUES", "ESTANDAR"),
  ] }), false);
  assert.equal(acceso({ contrataciones: [
    independiente("CHEQUES", "PREMIUM"), independiente("CHEQUES", "ESTANDAR"),
  ] }), false);
});

test("12C.13: empresa de contrato distinta, empresa de recurso distinta, usuario inactivo", () => {
  assert.equal(acceso({ empresaContratacionId: "empresa-2" }), false);
  assert.equal(acceso({ recurso: { empresaId: "empresa-2" } }), false);
  assert.equal(acceso({ contexto: { ...contexto, activo: false } }), false);
  assert.equal(acceso({ contexto: { ...contexto, empresa: { ...contexto.empresa, activa: false } } }), false);
});

test("12C.13: valida sucursales indicadas y exige sucursal en inventario", () => {
  assert.equal(acceso({ recurso: { empresaId: "empresa-1", sucursalId: "otra" } }), false);
  assert.equal(acceso({ recurso: { empresaId: "empresa-1", sucursalId: "sucursal-1" } }), true);
  assert.equal(acceso({
    contrataciones: [principal("INVENTARIO", "ESENCIAL")],
    capacidad: "inventario.productos.consultar", recurso: { empresaId: "empresa-1" },
  }), false);
  assert.equal(acceso({
    contrataciones: [principal("INVENTARIO", "ESENCIAL")],
    capacidad: "inventario.productos.consultar",
    recurso: { empresaId: "empresa-1", sucursalId: "sucursal-1" },
  }), true);
});

test("12C.13: un catálogo de capacidades con claves desconocidas bloquea todo", () => {
  const extra = { ...capacidades[0], adicional: true };
  assert.equal(acceso({ catalogoCapacidades: [extra, ...capacidades.slice(1)] as never }), false);
  assert.equal(acceso({ catalogoCapacidades: [capacidades[0], capacidades[0]] }), false);
});

test("12C.13: un permiso no correspondiente al módulo no sirve", () => {
  const ajena = { ...capacidades[0], permiso: "inventario.ver" };
  assert.equal(acceso({ catalogoCapacidades: [ajena, ...capacidades.slice(1)] as never }), false);
});

test("12C.13: no acepta submódulos mal vinculados ni niveles inventados", () => {
  // Capacidad declarada en otro módulo padre: debe fallar la validación.
  assert.equal(acceso({ catalogoSubmodulos: [
    { id: "CHEQUES", moduloPadre: "INVENTARIO" },
    { id: "BANCOS", moduloPadre: "ADMINISTRACION" },
  ] }), false);
  assert.equal(acceso({ catalogoCapacidades: [
    { ...capacidades[0], nivelMinimoSubmodulo: "AVANZADO" }, ...capacidades.slice(1),
  ] as never }), false);
});

test("12C.13: capacidad desconocida, ningún contrato o catálogo inválido no dan acceso", () => {
  assert.equal(acceso({ capacidad: "inventado" }), false);
  assert.equal(acceso({ contrataciones: [] }), false);
  assert.equal(acceso({ contrataciones: null }), false);
  assert.equal(acceso({ catalogoSubmodulos: [submodulos[0], submodulos[0]] }), false);
});

test("12C.13: no muta entradas congeladas ni genera permisos implícitos", () => {
  const contrataciones = Object.freeze([Object.freeze(independiente("CHEQUES", "ESTANDAR"))]);
  const parametros = entrada({ contrataciones, submodulosHabilitadosUsuario: Object.freeze(["CHEQUES"]) });
  const antes = JSON.stringify(parametros);
  assert.equal(puedeUsarCapacidadComercial(parametros), true);
  assert.equal(JSON.stringify(parametros), antes);
});
