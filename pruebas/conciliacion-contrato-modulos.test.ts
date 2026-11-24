import test from "node:test";
import assert from "node:assert/strict";
import { conciliarModulos, modulosImplicadosPorContrato } from "../core/conciliacion-contrato-modulos.js";
import { crearConciliacionContratoModulos, type DependenciasConciliacion } from "../handlers/core/conciliacion-contrato-modulos.js";
import type { ContratacionComercial } from "../core/reglas-comerciales.js";

const INV: ContratacionComercial = { modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESENCIAL" };
const CHEQUES: ContratacionComercial = { modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "CHEQUES", nivel: "ESTANDAR" };

test("módulo principal y submódulo suelto cuentan como su módulo padre, ordenados y sin repetir", () => {
  assert.deepEqual(modulosImplicadosPorContrato([CHEQUES, INV]), ["INVENTARIO", "ADMINISTRACION"]);
  assert.deepEqual(modulosImplicadosPorContrato([]), []);
  assert.equal(modulosImplicadosPorContrato([{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: "NO_EXISTE", nivel: "ESTANDAR" }]), null);
});
test("caso MORELLIS: Airtable tiene Inventario+Movimientos y el contrato solo Inventario", () => {
  const r = conciliarModulos(["INVENTARIO", "MOVIMIENTOS"], [INV])!;
  assert.equal(r.coincide, false);
  assert.deepEqual(r.sobranEnAirtable, ["MOVIMIENTOS"]);
  assert.deepEqual(r.faltanEnAirtable, []);
  assert.deepEqual(r.accionesSugeridas, [{ accion: "suspender", modulo: "MOVIMIENTOS" }]);
});
test("coincidencia exacta y módulos no comerciales del campo viejo se ignoran", () => {
  const r = conciliarModulos(["INVENTARIO", "CONFIGURACION", "AUTOMATIZACIONES"], [INV])!;
  assert.equal(r.coincide, true);
  assert.deepEqual(r.accionesSugeridas, []);
});
test("faltantes: el contrato incluye algo que Airtable no tiene", () => {
  const r = conciliarModulos([], [INV, CHEQUES])!;
  assert.deepEqual(r.accionesSugeridas, [{ accion: "habilitar", modulo: "INVENTARIO" }, { accion: "habilitar", modulo: "ADMINISTRACION" }]);
});
test("sin contrato vigente: NO se sugiere quitar nada (no dejar sin acceso a un cliente por error)", () => {
  const r = conciliarModulos(["MOVIMIENTOS"], null)!;
  assert.equal(r.estadoContrato, "SIN_CONTRATO_VIGENTE");
  assert.equal(r.coincide, false);
  assert.deepEqual(r.accionesSugeridas, []);
});
test("contrato con datos raros: devuelve null (requiere revisión), no un informe inventado", () => {
  assert.equal(conciliarModulos(["INVENTARIO"], [{ modalidad: "OTRA" } as never]), null);
});

const REC = "rec4tLlE2dddN2SPL", ADMIN = "recWLVDuCPbyaD3F9", ESTABLE = "emp_s84ng12hqeq1";
function montar(o: { on?: boolean; acceso?: "ok" | "sin" | "403" | "otraEmpresa" | "otroPermiso" | "sinEstable"; legacy?: boolean; contrato?: "vigente" | "no" | "falla" } = {}) {
  const reg = { contrato: 0, legacy: 0, escrituras: 0 };
  const deps: DependenciasConciliacion = {
    habilitada: () => o.on !== false,
    autorizar: async (_r, empresaId) => {
      const a = o.acceso ?? "ok";
      if (a === "sin") return { ok: false, motivo: "SIN_SESION" } as never;
      if (a === "403") return { ok: false, motivo: "SIN_PERMISO" } as never;
      return { ok: true, acceso: { usuarioId: ADMIN, empresaId: a === "otraEmpresa" ? "recZZZZZZZZZZZZZZ" : empresaId,
        permiso: a === "otroPermiso" ? "ACTIVAR_CONTRATO" : "CONSULTAR_CONTRATOS",
        ...(a === "sinEstable" ? {} : { empresaEstableId: ESTABLE }) } } as never;
    },
    leerContrato: async (id) => {
      reg.contrato++;
      assert.equal(id, ESTABLE);
      if (o.contrato === "no") return { ok: false, motivo: "NO_VIGENTE" } as never;
      if (o.contrato === "falla") return { ok: false, motivo: "NO_DISPONIBLE" } as never;
      return { ok: true, contrato: { empresaId: ESTABLE, servicios: [INV] } } as never;
    },
    leerLegacy: async () => { reg.legacy++; return o.legacy === false ? { ok: false } : { ok: true, activa: true, modulos: ["INVENTARIO", "MOVIMIENTOS"] }; },
  };
  const cap = { status: 0, cuerpo: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader: (k: string, v: string) => { cap.headers[k] = v; },
    status: (c: number) => ({ json: (b: unknown) => { cap.status = c; cap.cuerpo = b; } }) };
  const llamar = (req: any) => crearConciliacionContratoModulos(deps)({ method: "GET", query: { accion: "modulos_vs_contrato", empresaId: REC }, ...req }, res);
  return { llamar, cap, reg };
}
test("camino feliz: 200 con el informe y sin guardar en caché", async () => {
  const m = montar(); await m.llamar({});
  assert.equal(m.cap.status, 200);
  assert.equal(m.cap.cuerpo.soloConsulta, true);
  assert.deepEqual(m.cap.cuerpo.sobranEnAirtable, ["MOVIMIENTOS"]);
  assert.match(m.cap.headers["Cache-Control"], /no-store/);
});
test("interruptor apagado → 404; método distinto → 405; cuerpo o parámetros extra → 400", async () => {
  let m = montar({ on: false }); await m.llamar({}); assert.equal(m.cap.status, 404); assert.equal(m.reg.legacy, 0);
  m = montar(); await m.llamar({ method: "POST" }); assert.equal(m.cap.status, 405);
  m = montar(); await m.llamar({ body: { x: 1 } }); assert.equal(m.cap.status, 400);
  m = montar(); await m.llamar({ query: { accion: "modulos_vs_contrato", empresaId: REC, extra: "1" } }); assert.equal(m.cap.status, 400);
  m = montar(); await m.llamar({ query: { accion: "modulos_vs_contrato", empresaId: "mala" } }); assert.equal(m.cap.status, 400);
});
test("sin sesión → 401; sin permiso, otra empresa, otro permiso o sin ID estable → no leen nada", async () => {
  let m = montar({ acceso: "sin" }); await m.llamar({}); assert.equal(m.cap.status, 401);
  for (const a of ["403", "otraEmpresa", "otroPermiso"] as const) {
    m = montar({ acceso: a }); await m.llamar({}); assert.equal(m.cap.status, 403, a); assert.equal(m.reg.legacy, 0, a); assert.equal(m.reg.contrato, 0, a);
  }
  m = montar({ acceso: "sinEstable" }); await m.llamar({}); assert.equal(m.cap.status, 503); assert.equal(m.reg.contrato, 0);
});
test("sin contrato vigente: 200 con acciones vacías; fuente caída: 503", async () => {
  let m = montar({ contrato: "no" }); await m.llamar({});
  assert.equal(m.cap.status, 200); assert.deepEqual(m.cap.cuerpo.accionesSugeridas, []);
  m = montar({ contrato: "falla" }); await m.llamar({}); assert.equal(m.cap.status, 503);
  m = montar({ legacy: false }); await m.llamar({}); assert.equal(m.cap.status, 503);
});

import { modulosDesdeCampoViejo } from "../lib/conciliacion-contrato-adaptadores.js";
test("campo viejo: no exige CORE/USUARIO, normaliza nombres y rechaza opciones desconocidas", () => {
  assert.deepEqual(modulosDesdeCampoViejo(["INVENTARIO", "MOVIMIENTOS"]), ["INVENTARIO", "MOVIMIENTOS"]);
  assert.deepEqual(modulosDesdeCampoViejo(["USUARIO", "CUENTAS CORRIENTES", "CUENTAS_CORRIENTES"]), ["CUENTAS_CORRIENTES"]);
  assert.deepEqual(modulosDesdeCampoViejo(undefined), []);
  assert.equal(modulosDesdeCampoViejo(["INVENTARIO", "COSA_RARA"]), null);
  assert.equal(modulosDesdeCampoViejo("INVENTARIO"), null);
});
