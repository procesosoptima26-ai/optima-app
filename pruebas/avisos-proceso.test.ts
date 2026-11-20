import test from "node:test";
import assert from "node:assert/strict";
import { procesarAvisosEmpresa, enmascararCorreo, type DependenciasAvisos } from "../core/avisos-proceso.js";
import type { LecturaCicloVida } from "../core/ciclo-vida-pg.js";

const EMP = { idEstable: "emp_s84ng12hqeq1", nombre: "MORELLIS", recId: "rec4tLlE2dddN2SPL" };
const HASTA = "2026-12-20T12:00:00.000Z";
const AHORA = "2026-12-14T12:00:00.000Z"; // faltan 6 días -> VENCE_7
const vigente: LecturaCicloVida = { ok: true, revision: 3, hechos: { periodoHasta: HASTA, suspendidoDesde: null, canceladoDesde: null } };

function fixture(o: { ciclo?: LecturaCicloVida; correos?: string[] | null; yaReservado?: boolean; envio?: (c: string) => boolean | "lanza";
  fallaRedis?: boolean } = {}) {
  const reservas = new Set<string>();
  if (o.yaReservado) reservas.add("*");
  const reg = { reservar: 0, liberar: 0, enviados: [] as { para: string; asunto: string }[], intentos: 0, claves: [] as string[] };
  const deps: DependenciasAvisos = {
    leerCiclo: async () => o.ciclo ?? vigente,
    listarDestinatarios: async () => o.correos === undefined ? ["Ana@Morellis.com", "ana@morellis.com", "jefe@morellis.com"] : o.correos,
    reservar: async (clave) => {
      reg.reservar++; reg.claves.push(clave);
      if (o.fallaRedis) throw new Error("redis");
      if (o.yaReservado || reservas.has(clave)) return false;
      reservas.add(clave); return true;
    },
    liberar: async (clave) => { reg.liberar++; reservas.delete(clave); },
    enviar: async (c) => {
      reg.intentos++;
      const r = o.envio ? o.envio(c.para) : true;
      if (r === "lanza") throw new Error("resend");
      if (r) reg.enviados.push({ para: c.para, asunto: c.asunto });
      return r;
    },
    ambiente: () => "preview",
  };
  return { deps, reg };
}

test("SIMULAR: muestra qué haría, enmascara correos y no reserva ni envía", async () => {
  const { deps, reg } = fixture();
  const r = await procesarAvisosEmpresa(deps, EMP, "SIMULAR", AHORA);
  assert.equal(r.resultado, "SIMULADO");
  assert.equal(r.tipo, "VENCE_7");
  assert.deepEqual(r.destinatarios, ["a***@morellis.com", "j***@morellis.com"]);
  assert.equal(reg.reservar, 0); assert.equal(reg.intentos, 0);
});
test("ENVIAR: reserva una vez, envía un correo individual a cada administrador sin repetidos", async () => {
  const { deps, reg } = fixture();
  const r = await procesarAvisosEmpresa(deps, EMP, "ENVIAR", AHORA);
  assert.equal(r.resultado, "ENVIADO");
  assert.equal(r.enviados, 2);
  assert.deepEqual(reg.enviados.map(e => e.para), ["ana@morellis.com", "jefe@morellis.com"]);
  assert.equal(reg.reservar, 1);
  assert.equal(reg.claves[0], `optima:aviso:preview:emp_s84ng12hqeq1:${HASTA}:VENCE_7`);
});
test("ENVIAR dos veces el mismo día: la segunda no repite", async () => {
  const { deps, reg } = fixture();
  assert.equal((await procesarAvisosEmpresa(deps, EMP, "ENVIAR", AHORA)).resultado, "ENVIADO");
  assert.equal((await procesarAvisosEmpresa(deps, EMP, "ENVIAR", AHORA)).resultado, "YA_ENVIADO");
  assert.equal(reg.intentos, 2);
});
test("si no llegó a nadie se libera la reserva y se puede reintentar", async () => {
  const f = fixture({ envio: () => false });
  const r = await procesarAvisosEmpresa(f.deps, EMP, "ENVIAR", AHORA);
  assert.equal(r.resultado, "ERROR_ENVIO"); assert.equal(f.reg.liberar, 1);
  const g = fixture({ envio: () => "lanza" });
  assert.equal((await procesarAvisosEmpresa(g.deps, EMP, "ENVIAR", AHORA)).resultado, "ERROR_ENVIO");
});
test("si llegó a algunos: ENVIADO_PARCIAL y se conserva la reserva", async () => {
  const f = fixture({ envio: (p) => p.startsWith("ana") });
  const r = await procesarAvisosEmpresa(f.deps, EMP, "ENVIAR", AHORA);
  assert.equal(r.resultado, "ENVIADO_PARCIAL"); assert.equal(r.enviados, 1); assert.equal(r.fallidos, 1);
  assert.equal(f.reg.liberar, 0);
});
test("Redis caído al reservar: no se envía nada", async () => {
  const f = fixture({ fallaRedis: true });
  assert.equal((await procesarAvisosEmpresa(f.deps, EMP, "ENVIAR", AHORA)).resultado, "NO_DISPONIBLE");
  assert.equal(f.reg.intentos, 0);
});
test("sin destinatarios válidos o sin poder consultarlos: no reserva ni envía", async () => {
  for (const correos of [[], ["no-es-correo", " "], null]) {
    const f = fixture({ correos });
    const r = await procesarAvisosEmpresa(f.deps, EMP, "ENVIAR", AHORA);
    assert.equal(r.resultado, correos === null ? "NO_DISPONIBLE" : "SIN_DESTINATARIOS");
    assert.equal(f.reg.reservar, 0); assert.equal(f.reg.intentos, 0);
  }
});
test("máximo 5 destinatarios", async () => {
  const f = fixture({ correos: Array.from({ length: 9 }, (_, i) => `u${i}@x.com`) });
  const r = await procesarAvisosEmpresa(f.deps, EMP, "ENVIAR", AHORA);
  assert.equal(r.enviados, 5);
});
test("sin registro de ciclo, datos inválidos o sin aviso hoy", async () => {
  assert.equal((await procesarAvisosEmpresa(fixture({ ciclo: { ok: false, motivo: "SIN_REGISTRO" } }).deps, EMP, "ENVIAR", AHORA)).resultado, "SIN_REGISTRO");
  assert.equal((await procesarAvisosEmpresa(fixture({ ciclo: { ok: false, motivo: "INCONSISTENTE" } }).deps, EMP, "ENVIAR", AHORA)).resultado, "NO_DISPONIBLE");
  assert.equal((await procesarAvisosEmpresa(fixture({ ciclo: { ok: false, motivo: "NO_DISPONIBLE" } }).deps, EMP, "ENVIAR", AHORA)).resultado, "NO_DISPONIBLE");
  const lejos = fixture();
  assert.equal((await procesarAvisosEmpresa(lejos.deps, EMP, "ENVIAR", "2026-11-01T00:00:00.000Z")).resultado, "SIN_AVISO");
  assert.equal(lejos.reg.reservar, 0);
  assert.equal((await procesarAvisosEmpresa(fixture().deps, { ...EMP, idEstable: "rec4tLlE2dddN2SPL" }, "ENVIAR", AHORA)).resultado, "NO_DISPONIBLE");
});
test("suspendida: no se avisa", async () => {
  const f = fixture({ ciclo: { ok: true, revision: 4, hechos: { periodoHasta: HASTA, suspendidoDesde: "2026-12-01T00:00:00.000Z", canceladoDesde: null } } });
  assert.equal((await procesarAvisosEmpresa(f.deps, EMP, "ENVIAR", AHORA)).resultado, "SIN_AVISO");
});
test("enmascarar correo", () => assert.equal(enmascararCorreo("maria@empresa.com"), "m***@empresa.com"));
