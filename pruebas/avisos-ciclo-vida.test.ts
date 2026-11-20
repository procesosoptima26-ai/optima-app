import test from "node:test";
import assert from "node:assert/strict";
import { crearAvisosManual, crearAvisosCron, type DependenciasAvisosHttp, type PeticionAvisos } from "../handlers/core/avisos-ciclo-vida.js";
import type { DependenciasAvisos } from "../core/avisos-proceso.js";

const REC = "rec4tLlE2dddN2SPL", USU = "recWLVDuCPbyaD3F9", ESTABLE = "emp_s84ng12hqeq1";
const ORIGEN = "https://preview.example.org";
const SECRETO = "s".repeat(40);
const HASTA = "2026-12-20T12:00:00.000Z";
const AHORA = "2026-12-14T12:00:00.000Z";

function fixture(o: { manual?: boolean; cron?: boolean; sesion?: boolean; permiso?: boolean; sinEstable?: boolean; otraEstable?: boolean; sinEmpresa?: boolean } = {}) {
  const reg = { enviados: 0, reservas: 0, verificaciones: 0, listados: 0 };
  const proceso: DependenciasAvisos = {
    leerCiclo: async () => ({ ok: true, revision: 1, hechos: { periodoHasta: HASTA, suspendidoDesde: null, canceladoDesde: null } }),
    listarDestinatarios: async () => ["admin@morellis.com"],
    reservar: async () => { reg.reservas++; return true; },
    liberar: async () => undefined,
    enviar: async () => { reg.enviados++; return true; },
    ambiente: () => "preview",
  };
  const deps: DependenciasAvisosHttp = {
    habilitadaManual: () => o.manual !== false,
    habilitadaCron: () => o.cron !== false,
    origenPermitido: () => ORIGEN,
    secretoCron: () => SECRETO,
    verificar: async () => {
      reg.verificaciones++;
      if (o.sesion === false) return { ok: false, motivo: "SIN_SESION" };
      if (o.permiso === false) return { ok: false, motivo: "SIN_PERMISO" };
      return { ok: true, acceso: { usuarioId: USU, empresaId: REC, permiso: "GESTIONAR_CICLO_VIDA",
        ...(o.sinEstable ? {} : { empresaEstableId: ESTABLE }) } };
    },
    leerEmpresa: async () => o.sinEmpresa ? null : ({ recId: REC, nombre: "MORELLIS", idEstable: o.otraEstable ? "emp_otraotraotra" : ESTABLE }),
    listarEmpresas: async () => { reg.listados++; return [{ recId: REC, nombre: "MORELLIS", idEstable: ESTABLE }]; },
    proceso, ahora: () => AHORA,
  };
  let codigo = 0; let cuerpo: unknown;
  const res = { setHeader() { return this; }, status(n: number) { codigo = n; return this; }, json(o2: unknown) { cuerpo = o2; return this; } };
  const manual = crearAvisosManual(deps), cron = crearAvisosCron(deps);
  const peticion = (c: Partial<PeticionAvisos> = {}): PeticionAvisos => ({ method: "POST",
    query: { accion: "ciclo_vida_avisos", empresaId: REC },
    headers: { origin: ORIGEN, "content-type": "application/json" }, body: { modo: "ENVIAR" }, ...c });
  const peticionCron = (c: Partial<PeticionAvisos> = {}): PeticionAvisos => ({ method: "GET",
    query: { accion: "ciclo_vida_avisos_cron" }, headers: { authorization: `Bearer ${SECRETO}` }, ...c });
  return { reg, manual: async (c?: Partial<PeticionAvisos>) => { await manual(peticion(c), res); return { codigo, cuerpo: cuerpo as Record<string, unknown> }; },
    cron: async (c?: Partial<PeticionAvisos>) => { await cron(peticionCron(c), res); return { codigo, cuerpo: cuerpo as Record<string, unknown> }; } };
}

test("manual: ENVIAR correcto responde 200 con el resultado y manda el correo", async () => {
  const f = fixture(); const r = await f.manual();
  assert.equal(r.codigo, 200);
  assert.equal((r.cuerpo.resultado as { resultado: string }).resultado, "ENVIADO");
  assert.equal(f.reg.enviados, 1);
});
test("manual: SIMULAR no envía", async () => {
  const f = fixture(); const r = await f.manual({ body: { modo: "SIMULAR" } });
  assert.equal(r.codigo, 200); assert.equal(f.reg.enviados, 0); assert.equal(f.reg.reservas, 0);
});
test("manual: apagado -> 404 sin consultar nada", async () => {
  const f = fixture({ manual: false }); assert.equal((await f.manual()).codigo, 404); assert.equal(f.reg.verificaciones, 0);
});
test("manual: método, consulta, origen y tipo de contenido incorrectos", async () => {
  const f = fixture();
  assert.equal((await f.manual({ method: "GET" })).codigo, 405);
  assert.equal((await f.manual({ query: { accion: "ciclo_vida_avisos" } })).codigo, 400);
  assert.equal((await f.manual({ query: { accion: "ciclo_vida_avisos", empresaId: REC, x: "1" } })).codigo, 400);
  assert.equal((await f.manual({ headers: { origin: "https://otro.example.org", "content-type": "application/json" } })).codigo, 403);
  assert.equal((await f.manual({ headers: { origin: ORIGEN, "content-type": "text/plain" } })).codigo, 400);
  assert.equal(f.reg.verificaciones, 0);
});
test("manual: cuerpo inválido (modo raro, clave extra, vacío)", async () => {
  const f = fixture();
  for (const body of [{ modo: "BORRAR" }, { modo: "ENVIAR", actor: USU }, {}, null, [], "ENVIAR"]) {
    assert.equal((await f.manual({ body })).codigo, 400, JSON.stringify(body));
  }
  assert.equal(f.reg.enviados, 0);
});
test("manual: sin sesión 401, sin permiso 403, sin ID estable 503, otra empresa 503", async () => {
  assert.equal((await fixture({ sesion: false }).manual()).codigo, 401);
  assert.equal((await fixture({ permiso: false }).manual()).codigo, 403);
  assert.equal((await fixture({ sinEstable: true }).manual()).codigo, 503);
  assert.equal((await fixture({ otraEstable: true }).manual()).codigo, 503);
  assert.equal((await fixture({ sinEmpresa: true }).manual()).codigo, 503);
});
test("cron: con secreto correcto recorre las empresas y devuelve solo cantidades", async () => {
  const f = fixture(); const r = await f.cron();
  assert.equal(r.codigo, 200);
  assert.deepEqual(r.cuerpo, { ok: true, empresas: 1, resultados: { ENVIADO: 1 } });
  assert.ok(!JSON.stringify(r.cuerpo).includes("MORELLIS") && !JSON.stringify(r.cuerpo).includes("@"));
  assert.equal(f.reg.enviados, 1);
});
test("cron: apagado 404; secreto ausente, ajeno o corto 401; método y consulta incorrectos", async () => {
  assert.equal((await fixture({ cron: false }).cron()).codigo, 404);
  const f = fixture();
  assert.equal((await f.cron({ headers: {} })).codigo, 401);
  assert.equal((await f.cron({ headers: { authorization: "Bearer otro" } })).codigo, 401);
  assert.equal((await f.cron({ headers: { authorization: SECRETO } })).codigo, 401);
  assert.equal((await f.cron({ method: "POST" })).codigo, 405);
  assert.equal((await f.cron({ query: { accion: "ciclo_vida_avisos_cron", x: "1" } })).codigo, 400);
  assert.equal(f.reg.listados, 0); assert.equal(f.reg.enviados, 0);
});
