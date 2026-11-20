/** Tarea 5.4: entrada HTTP del ciclo de vida (dependencias simuladas). */
import test from "node:test";
import assert from "node:assert/strict";
import { crearOperacionCicloVida, type DependenciasCicloVida, type PeticionCicloVida } from "../handlers/core/escritura-ciclo-vida.js";

const EMP = "rec" + "E".repeat(14), ACTOR = "rec" + "A".repeat(14), EK = "emp_s84ng12hqeq1";
const ORIGEN = "https://optima.ejemplo.app";
const AHORA = "2026-11-20T15:00:00.000Z";
const MOTIVO = "Renovación mensual confirmada por transferencia";

function entorno(cambios: Partial<DependenciasCicloVida> = {}) {
  const llamadas: string[] = [];
  const deps: DependenciasCicloVida = {
    habilitada: () => true, origenPermitido: () => ORIGEN,
    verificar: async () => ({ ok: true, acceso: { usuarioId: ACTOR, empresaId: EMP, empresaEstableId: EK, permiso: "GESTIONAR_CICLO_VIDA" } }),
    poolEscritura: () => { llamadas.push("poolEscritura"); return {} as any; },
    poolLectura: () => { llamadas.push("poolLectura"); return {} as any; },
    aplicar: async (_p, actor, sol) => { llamadas.push(`aplicar:${actor}:${sol.empresaId}:${sol.accion}`); return { ok: true, revision: 1, estado: "ACTIVO", hechos: { periodoHasta: "2026-12-20T00:00:00.000Z", suspendidoDesde: null, canceladoDesde: null } }; },
    leer: async () => ({ ok: true, revision: 3, hechos: { periodoHasta: "2026-12-20T00:00:00.000Z", suspendidoDesde: null, canceladoDesde: null } }),
    ahora: () => AHORA, ...cambios };
  return { deps, llamadas };
}
function responder() {
  const r: { codigo?: number; cuerpo?: any; cabeceras: Record<string, string> } = { cabeceras: {} };
  return { r, res: { setHeader(n: string, v: string) { r.cabeceras[n] = v; }, status(c: number) { return { json(d: unknown) { r.codigo = c; r.cuerpo = d; } }; } } };
}
const post = (body: unknown, extra: Partial<PeticionCicloVida> = {}): PeticionCicloVida => ({
  method: "POST", query: { accion: "ciclo_vida_accion", empresaId: EMP }, headers: { origin: ORIGEN, "content-type": "application/json" },
  body, ...extra });
const BODY = { tipo: "RENOVACION", motivo: MOTIVO, revisionEsperada: 0, nuevoPeriodoHasta: "2026-12-20T00:00:00.000Z" };
async function correr(op: "ciclo_vida_accion" | "ciclo_vida_estado", req: PeticionCicloVida, cambios: Partial<DependenciasCicloVida> = {}) {
  const e = entorno(cambios); const x = responder();
  await crearOperacionCicloVida(op, e.deps)(req, x.res);
  return { ...x.r, llamadas: e.llamadas };
}

test("accion: camino feliz usa el ACTOR de la sesión y el ID ESTABLE, nunca datos del body", async () => {
  const r = await correr("ciclo_vida_accion", post(BODY));
  assert.equal(r.codigo, 200);
  assert.deepEqual(r.llamadas.filter(l => l.startsWith("aplicar")), [`aplicar:${ACTOR}:${EK}:RENOVACION`]);
  assert.equal(r.cabeceras["Cache-Control"], "no-store, max-age=0");
});
test("accion: apagada (flag) -> 404 y no abre ninguna conexión", async () => {
  const r = await correr("ciclo_vida_accion", post(BODY), { habilitada: () => false });
  assert.equal(r.codigo, 404); assert.deepEqual(r.llamadas, []);
});
test("accion: método, origen, content-type y query inválidos se rechazan antes de autenticar", async () => {
  let verificaciones = 0;
  const c = { verificar: async () => { verificaciones++; return { ok: false as const, motivo: "SIN_SESION" as const }; } };
  assert.equal((await correr("ciclo_vida_accion", post(BODY, { method: "GET" }), c)).codigo, 405);
  assert.equal((await correr("ciclo_vida_accion", post(BODY, { headers: { "content-type": "application/json" } }), c)).codigo, 403);
  assert.equal((await correr("ciclo_vida_accion", post(BODY, { headers: { origin: "https://malo.com", "content-type": "application/json" } }), c)).codigo, 403);
  assert.equal((await correr("ciclo_vida_accion", post(BODY, { headers: { origin: ORIGEN, "content-type": "text/plain" } }), c)).codigo, 400);
  assert.equal((await correr("ciclo_vida_accion", post(BODY, { query: { accion: "ciclo_vida_accion", empresaId: "x" } }), c)).codigo, 400);
  assert.equal((await correr("ciclo_vida_accion", post(BODY, { query: { accion: "ciclo_vida_accion", empresaId: EMP, extra: "1" } }), c)).codigo, 400);
  assert.equal(verificaciones, 0);
});
test("accion: cuerpo con claves de más (actor, empresa, rol) o tipo inventado -> 400", async () => {
  for (const b of [{ ...BODY, actor: ACTOR }, { ...BODY, empresaId: EK }, { ...BODY, tipo: "BORRAR" }, { tipo: "SUSPENSION", motivo: MOTIVO }, null, [], "texto"]) {
    assert.equal((await correr("ciclo_vida_accion", post(b))).codigo, 400);
  }
});
test("accion: sesión/permiso/ID estable faltantes fallan cerrado", async () => {
  assert.equal((await correr("ciclo_vida_accion", post(BODY), { verificar: async () => ({ ok: false, motivo: "SIN_SESION" }) })).codigo, 401);
  assert.equal((await correr("ciclo_vida_accion", post(BODY), { verificar: async () => ({ ok: false, motivo: "SIN_PERMISO" }) })).codigo, 403);
  assert.equal((await correr("ciclo_vida_accion", post(BODY), { verificar: async () => ({ ok: false, motivo: "FUENTE_NO_DISPONIBLE" }) })).codigo, 503);
  const sinEstable = await correr("ciclo_vida_accion", post(BODY), { verificar: async () => ({ ok: true, acceso: { usuarioId: ACTOR, empresaId: EMP, permiso: "GESTIONAR_CICLO_VIDA" } }) });
  assert.equal(sinEstable.codigo, 503); assert.equal(sinEstable.llamadas.some(l => l.startsWith("aplicar")), false);
  const otroPermiso = await correr("ciclo_vida_accion", post(BODY), { verificar: async () => ({ ok: true, acceso: { usuarioId: ACTOR, empresaId: EMP, empresaEstableId: EK, permiso: "ACTIVAR_CONTRATO" } }) });
  assert.equal(otroPermiso.codigo, 403);
  const otraEmpresa = await correr("ciclo_vida_accion", post(BODY), { verificar: async () => ({ ok: true, acceso: { usuarioId: ACTOR, empresaId: "rec" + "Z".repeat(14), empresaEstableId: EK, permiso: "GESTIONAR_CICLO_VIDA" } }) });
  assert.equal(otraEmpresa.codigo, 403);
});
test("accion: rechazos del motor se traducen a 400 / 409 / 503", async () => {
  const motor = (motivo: any) => ({ aplicar: async () => ({ ok: false as const, motivo }) });
  assert.equal((await correr("ciclo_vida_accion", post(BODY), motor("SOLICITUD_INVALIDA"))).codigo, 400);
  assert.equal((await correr("ciclo_vida_accion", post(BODY), motor("TRANSICION_INVALIDA"))).codigo, 409);
  assert.equal((await correr("ciclo_vida_accion", post(BODY), motor("REVISION_DESACTUALIZADA"))).codigo, 409);
  assert.equal((await correr("ciclo_vida_accion", post(BODY), motor("ERROR_BD"))).codigo, 503);
  assert.equal((await correr("ciclo_vida_accion", post(BODY), { aplicar: async () => { throw Error("boom"); } })).codigo, 503);
});
test("estado: GET devuelve revisión, hechos y estado calculado; sin registro devuelve registrada=false", async () => {
  const get: PeticionCicloVida = { method: "GET", query: { accion: "ciclo_vida_estado", empresaId: EMP } };
  const r = await correr("ciclo_vida_estado", get);
  assert.equal(r.codigo, 200);
  assert.equal(r.cuerpo.revision, 3); assert.equal(r.cuerpo.estado, "ACTIVO");
  const s = await correr("ciclo_vida_estado", get, { leer: async () => ({ ok: false, motivo: "SIN_REGISTRO" }) });
  assert.deepEqual(s.cuerpo, { ok: true, registrada: false, revision: 0 });
  assert.equal((await correr("ciclo_vida_estado", get, { leer: async () => ({ ok: false, motivo: "NO_DISPONIBLE" }) })).codigo, 503);
  assert.equal((await correr("ciclo_vida_estado", { ...get, body: {} })).codigo, 400);
  assert.equal((await correr("ciclo_vida_estado", { ...get, method: "POST" })).codigo, 405);
  assert.equal((await correr("ciclo_vida_estado", get)).llamadas.includes("poolEscritura"), false);
});
