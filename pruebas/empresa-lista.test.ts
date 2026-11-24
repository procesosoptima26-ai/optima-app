import test from "node:test";
import assert from "node:assert/strict";
import { analizarOpcionesModulos, clasificarIdEstable, evaluarEmpresaLista, type HechosEmpresaLista } from "../core/empresa-lista.js";
import { crearEmpresaLista, type DependenciasEmpresaLista } from "../handlers/core/empresa-lista.js";
import type { ContratacionComercial } from "../core/reglas-comerciales.js";

const INV: ContratacionComercial = { modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESENCIAL" };
const buenos: HechosEmpresaLista = {
  activa: true, idEstable: "VALIDO", idRepetidoEn: 0, opciones: analizarOpcionesModulos(["INVENTARIO", "USUARIO"]),
  cicloVida: "OK", contrato: [INV], administradoresConCorreo: 1,
};
const estado = (h: HechosEmpresaLista, id: string) => evaluarEmpresaLista(h).controles.find((x) => x.id === id)!.estado;

test("empresa completa: lista, todos los controles OK", () => {
  const r = evaluarEmpresaLista(buenos);
  assert.equal(r.lista, true);
  assert.ok(r.controles.every((x) => x.estado === "OK"));
});
test("clasificar ID estable: válido, falta e inválido", () => {
  assert.equal(clasificarIdEstable("emp_s84ng12hqeq1"), "VALIDO");
  assert.equal(clasificarIdEstable("  emp_s84ng12hqeq1 "), "VALIDO");
  for (const x of [undefined, null, "", "   "]) assert.equal(clasificarIdEstable(x), "FALTA");
  for (const x of ["EMP_S84NG12HQEQ1", "emp_corto", "rec4tLlE2dddN2SPL", 12, "emp_s84ng12hqeq1x"]) assert.equal(clasificarIdEstable(x), "INVALIDO");
});
test("caso MORELLIS viejo: sin USUARIO y con Movimientos de más → no está lista", () => {
  const h = { ...buenos, opciones: analizarOpcionesModulos(["INVENTARIO", "MOVIMIENTOS"]) };
  assert.equal(estado(h, "modulo_usuario"), "FALTA");
  assert.equal(estado(h, "modulos_alineados"), "FALTA");
  assert.equal(evaluarEmpresaLista(h).lista, false);
});
test("sin ID estable: los controles que dependen de él quedan sin verificar y no está lista", () => {
  const h: HechosEmpresaLista = { ...buenos, idEstable: "FALTA", idRepetidoEn: null, cicloVida: "NO_VERIFICADO", contrato: "NO_VERIFICADO" };
  const r = evaluarEmpresaLista(h);
  assert.equal(r.lista, false);
  for (const id of ["id_unico", "ciclo_vida", "contrato", "modulos_alineados"]) assert.equal(estado(h, id), "NO_VERIFICADO", id);
  assert.equal(estado(h, "id_estable"), "FALTA");
});
test("ID repetido en otra empresa: falla grave", () => {
  const h = { ...buenos, idRepetidoEn: 1 };
  assert.equal(estado(h, "id_unico"), "FALTA");
  assert.match(evaluarEmpresaLista(h).controles.find((x) => x.id === "id_unico")!.ayuda, /GRAVE/);
  assert.equal(evaluarEmpresaLista(h).lista, false);
});
test("sin ciclo de vida o sin contrato: falta; error de lectura: no verificado (nunca OK)", () => {
  assert.equal(estado({ ...buenos, cicloVida: "SIN_REGISTRO" }, "ciclo_vida"), "FALTA");
  assert.equal(estado({ ...buenos, cicloVida: "ERROR" }, "ciclo_vida"), "NO_VERIFICADO");
  assert.equal(estado({ ...buenos, contrato: "SIN_CONTRATO" }, "contrato"), "FALTA");
  assert.equal(estado({ ...buenos, contrato: "ERROR" }, "contrato"), "NO_VERIFICADO");
  assert.equal(evaluarEmpresaLista({ ...buenos, contrato: "ERROR" }).lista, false);
});
test("sin administrador con correo: solo aviso, no impide estar lista", () => {
  const h = { ...buenos, administradoresConCorreo: 0 };
  assert.equal(estado(h, "admin_correo"), "AVISO");
  assert.equal(evaluarEmpresaLista(h).lista, true);
  assert.equal(estado({ ...buenos, administradoresConCorreo: null }, "admin_correo"), "NO_VERIFICADO");
});
test("opciones raras: no reconocidas se marcan", () => {
  assert.equal(analizarOpcionesModulos(["INVENTARIO", "COSA"]).reconocidas, false);
  assert.equal(analizarOpcionesModulos("INVENTARIO").reconocidas, false);
  assert.equal(estado({ ...buenos, opciones: analizarOpcionesModulos(["USUARIO", "COSA"]) }, "opciones_conocidas"), "FALTA");
});

const REC = "rec4tLlE2dddN2SPL", ESTABLE = "emp_s84ng12hqeq1";
function montar(o: { on?: boolean; acceso?: "ok" | "sin" | "403" | "otraEmpresa" | "otroPermiso"; ficha?: "ok" | "nula" | "sinId"; ciclo?: "ok" | "sin" | "lanza"; contrato?: "vigente" | "no" | "lanza"; repetidos?: number | null } = {}) {
  const reg = { ficha: 0, ciclo: 0, contrato: 0 };
  const deps: DependenciasEmpresaLista = {
    habilitada: () => o.on !== false,
    autorizar: async (_r, empresaId) => {
      const a = o.acceso ?? "ok";
      if (a === "sin") return { ok: false, motivo: "SIN_SESION" } as never;
      if (a === "403") return { ok: false, motivo: "SIN_PERMISO" } as never;
      return { ok: true, acceso: { usuarioId: "recWLVDuCPbyaD3F9", empresaId: a === "otraEmpresa" ? "recZZZZZZZZZZZZZZ" : empresaId,
        permiso: a === "otroPermiso" ? "ACTIVAR_CONTRATO" : "CONSULTAR_CONTRATOS" } } as never;
    },
    leerFicha: async () => { reg.ficha++; return o.ficha === "nula" ? null : { activa: true, idEstableCrudo: o.ficha === "sinId" ? undefined : ESTABLE, opcionesModulos: ["INVENTARIO", "USUARIO"] }; },
    contarRepetidos: async () => o.repetidos === undefined ? 0 : o.repetidos,
    leerCiclo: async () => {
      reg.ciclo++; if (o.ciclo === "lanza") throw new Error("x");
      return (o.ciclo === "sin" ? { ok: false, motivo: "SIN_REGISTRO" } : { ok: true, revision: 1, hechos: {} }) as never;
    },
    leerContrato: async () => {
      reg.contrato++; if (o.contrato === "lanza") throw new Error("x");
      return (o.contrato === "no" ? { ok: false, motivo: "NO_VIGENTE" } : { ok: true, contrato: { empresaId: ESTABLE, servicios: [INV] } }) as never;
    },
    contarAdministradoresConCorreo: async () => 2,
  };
  const cap = { status: 0, cuerpo: undefined as any };
  const res = { setHeader: () => undefined, status: (c: number) => ({ json: (b: unknown) => { cap.status = c; cap.cuerpo = b; } }) };
  const llamar = (req: any = {}) => crearEmpresaLista(deps)({ method: "GET", query: { accion: "empresa_lista", empresaId: REC }, ...req }, res);
  return { llamar, cap, reg };
}
test("handler: empresa completa → 200 lista=true, y nunca devuelve correos", async () => {
  const m = montar(); await m.llamar();
  assert.equal(m.cap.status, 200); assert.equal(m.cap.cuerpo.lista, true); assert.equal(m.cap.cuerpo.soloConsulta, true);
  assert.ok(!JSON.stringify(m.cap.cuerpo).includes("@"));
});
test("handler: apagado 404, método 405, cuerpo/parámetros extra 400", async () => {
  let m = montar({ on: false }); await m.llamar(); assert.equal(m.cap.status, 404); assert.equal(m.reg.ficha, 0);
  m = montar(); await m.llamar({ method: "POST" }); assert.equal(m.cap.status, 405);
  m = montar(); await m.llamar({ body: {} }); assert.equal(m.cap.status, 400);
  m = montar(); await m.llamar({ query: { accion: "empresa_lista", empresaId: REC, x: "1" } }); assert.equal(m.cap.status, 400);
  m = montar(); await m.llamar({ query: { accion: "empresa_lista", empresaId: "mala" } }); assert.equal(m.cap.status, 400);
});
test("handler: sin sesión 401; sin permiso/otra empresa/otro permiso 403 sin leer nada", async () => {
  let m = montar({ acceso: "sin" }); await m.llamar(); assert.equal(m.cap.status, 401);
  for (const a of ["403", "otraEmpresa", "otroPermiso"] as const) { m = montar({ acceso: a }); await m.llamar(); assert.equal(m.cap.status, 403, a); assert.equal(m.reg.ficha, 0, a); }
});
test("handler: empresa sin ID estable → 200 no lista y NO consulta Neon", async () => {
  const m = montar({ ficha: "sinId" }); await m.llamar();
  assert.equal(m.cap.status, 200); assert.equal(m.cap.cuerpo.lista, false);
  assert.equal(m.reg.ciclo, 0); assert.equal(m.reg.contrato, 0);
});
test("handler: sin ciclo, sin contrato, errores de Neon y ID repetido → no lista; ficha ilegible → 503", async () => {
  let m = montar({ ciclo: "sin" }); await m.llamar(); assert.equal(m.cap.cuerpo.lista, false);
  m = montar({ contrato: "no" }); await m.llamar(); assert.equal(m.cap.cuerpo.lista, false);
  m = montar({ ciclo: "lanza", contrato: "lanza" }); await m.llamar(); assert.equal(m.cap.status, 200); assert.equal(m.cap.cuerpo.lista, false);
  m = montar({ repetidos: 1 }); await m.llamar(); assert.equal(m.cap.cuerpo.lista, false);
  m = montar({ ficha: "nula" }); await m.llamar(); assert.equal(m.cap.status, 503);
});
