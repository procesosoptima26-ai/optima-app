import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluarCicloVida, estadoPermiteAccion, NATURALEZA_DEL_PERMISO,
  PARAMETROS_CICLO_VIDA_POR_DEFECTO, type HechosCicloVida,
} from "../core/ciclo-vida-contrato.js";
import { PERMISOS } from "../core/seguridad.js";

const VENCE = "2026-12-01T00:00:00.000Z";
const dia = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString();
const sin: HechosCicloVida = { periodoHasta: null, suspendidoDesde: null, canceladoDesde: null };
const ev = (h: Partial<HechosCicloVida>, ahora: string) => evaluarCicloVida({ ...sin, ...h }, ahora);

test("sin fechas: ACTIVO y nunca cambia solo", () => {
  assert.deepEqual(ev({}, "2026-11-20T12:00:00.000Z"),
    { ok: true, estado: "ACTIVO", motivo: "VIGENTE", cambiaEn: null });
});

test("vencimiento: activo -> gracia (10 d) -> solo lectura (30 d) -> cerrada", () => {
  const e = (ahora: string) => ev({ periodoHasta: VENCE }, ahora) as any;
  assert.equal(e(VENCE).estado, "ACTIVO");                       // justo en el límite sigue activo
  assert.equal(e(dia(VENCE, 0.001)).estado, "GRACIA");
  assert.equal(e(dia(VENCE, 10)).estado, "GRACIA");               // último instante de gracia
  assert.equal(e(dia(VENCE, 10.001)).estado, "SOLO_LECTURA");
  assert.equal(e(dia(VENCE, 40)).estado, "SOLO_LECTURA");
  assert.equal(e(dia(VENCE, 40.001)).estado, "CERRADA");
  assert.equal(e(dia(VENCE, 40.001)).motivo, "CERRADO_POR_VENCIMIENTO");
  assert.equal(e(dia(VENCE, 400)).cambiaEn, null);
});

test("cambiaEn anuncia el próximo cambio por tiempo", () => {
  const a = ev({ periodoHasta: VENCE }, "2026-11-20T00:00:00.000Z") as any;
  assert.equal(a.estado, "ACTIVO");
  assert.equal(Date.parse(a.cambiaEn), Date.parse(VENCE) + 1);
  const g = ev({ periodoHasta: VENCE }, dia(VENCE, 3)) as any;
  assert.equal(Date.parse(g.cambiaEn), Date.parse(dia(VENCE, 10)) + 1);
});

test("suspensión manual: solo lectura hasta que OPTIMA la levante; una futura no rige", () => {
  const s = ev({ suspendidoDesde: "2026-11-10T00:00:00.000Z" }, "2027-06-01T00:00:00.000Z") as any;
  assert.equal(s.estado, "SOLO_LECTURA");
  assert.equal(s.motivo, "SUSPENDIDO");
  assert.equal(s.cambiaEn, null);
  const futura = ev({ suspendidoDesde: "2026-12-10T00:00:00.000Z" }, "2026-11-20T00:00:00.000Z") as any;
  assert.equal(futura.estado, "ACTIVO");
});

test("cancelación: 90 días de solo lectura y luego cerrada", () => {
  const C = "2026-11-01T00:00:00.000Z";
  assert.equal((ev({ canceladoDesde: C }, dia(C, 1)) as any).estado, "SOLO_LECTURA");
  assert.equal((ev({ canceladoDesde: C }, dia(C, 1)) as any).motivo, "CANCELADO");
  assert.equal((ev({ canceladoDesde: C }, dia(C, 90)) as any).estado, "SOLO_LECTURA");
  const c = ev({ canceladoDesde: C }, dia(C, 90.001)) as any;
  assert.equal(c.estado, "CERRADA");
  assert.equal(c.motivo, "CERRADO_POR_CANCELACION");
});

test("gana el motivo MÁS restrictivo", () => {
  // período vigente pero cancelada hace 100 días: cerrada
  const C = "2026-08-01T00:00:00.000Z";
  assert.equal((ev({ periodoHasta: "2027-12-01T00:00:00.000Z", canceladoDesde: C }, "2026-11-20T00:00:00.000Z") as any).estado, "CERRADA");
  // vencido en gracia pero suspendido: solo lectura
  const r = ev({ periodoHasta: VENCE, suspendidoDesde: "2026-11-25T00:00:00.000Z" }, dia(VENCE, 2)) as any;
  assert.equal(r.estado, "SOLO_LECTURA");
  assert.equal(r.motivo, "SUSPENDIDO");
  // suspendida + vencida sin renovar: el tiempo la va a cerrar aunque siga suspendida
  const t = ev({ periodoHasta: VENCE, suspendidoDesde: "2026-11-25T00:00:00.000Z" }, dia(VENCE, 20)) as any;
  assert.equal(t.estado, "SOLO_LECTURA");
  assert.equal(Date.parse(t.cambiaEn), Date.parse(dia(VENCE, 40)) + 1);
});

test("reactivar = nuevo período pagado y sin suspensión/cancelación: vuelve a ACTIVO", () => {
  const antes = ev({ periodoHasta: VENCE }, dia(VENCE, 20)) as any;
  assert.equal(antes.estado, "SOLO_LECTURA");
  const despues = ev({ periodoHasta: dia(VENCE, 365) }, dia(VENCE, 20)) as any;
  assert.equal(despues.estado, "ACTIVO");
});

test("datos inválidos NO se adivinan: error (el llamador debe denegar)", () => {
  const malos: unknown[] = ["ayer", "2026-11-20", "2026-11-20T00:00:00", 123, {}, ""];
  for (const m of malos) {
    assert.deepEqual(evaluarCicloVida({ ...sin, periodoHasta: m as never }, "2026-11-20T00:00:00.000Z"),
      { ok: false, motivo: "DATOS_INVALIDOS" });
  }
  assert.deepEqual(evaluarCicloVida(sin, "mañana"), { ok: false, motivo: "DATOS_INVALIDOS" });
  assert.deepEqual(evaluarCicloVida(sin, "2026-11-20T00:00:00.000Z", { ...PARAMETROS_CICLO_VIDA_POR_DEFECTO, diasGracia: -1 }),
    { ok: false, motivo: "DATOS_INVALIDOS" });
  assert.deepEqual(evaluarCicloVida(sin, "2026-11-20T00:00:00.000Z", { ...PARAMETROS_CICLO_VIDA_POR_DEFECTO, diasGracia: 1.5 }),
    { ok: false, motivo: "DATOS_INVALIDOS" });
  assert.deepEqual(evaluarCicloVida(null as never, "2026-11-20T00:00:00.000Z"), { ok: false, motivo: "DATOS_INVALIDOS" });
});

test("los plazos son parámetros: se pueden cambiar sin tocar la lógica", () => {
  const p = { diasGracia: 0, diasSoloLecturaVencimiento: 5, diasSoloLecturaCancelacion: 1 };
  assert.equal((evaluarCicloVida({ ...sin, periodoHasta: VENCE }, dia(VENCE, 1), p) as any).estado, "SOLO_LECTURA");
  assert.equal((evaluarCicloVida({ ...sin, periodoHasta: VENCE }, dia(VENCE, 6), p) as any).estado, "CERRADA");
});

test("cada permiso del Core está clasificado como LECTURA o ESCRITURA", () => {
  for (const permiso of PERMISOS) assert.ok(["LECTURA", "ESCRITURA"].includes(NATURALEZA_DEL_PERMISO[permiso]), permiso);
  assert.equal(Object.keys(NATURALEZA_DEL_PERMISO).length, PERMISOS.length);
  // Todo lo que se llama ver/exportar es lectura; el resto modifica algo.
  for (const permiso of PERMISOS) {
    const esperado = permiso.endsWith(".ver") || permiso === "reportes.exportar" ? "LECTURA" : "ESCRITURA";
    assert.equal(NATURALEZA_DEL_PERMISO[permiso], esperado, permiso);
  }
});

test("qué se permite en cada estado", () => {
  for (const permiso of PERMISOS) {
    assert.equal(estadoPermiteAccion("ACTIVO", permiso), true);
    assert.equal(estadoPermiteAccion("GRACIA", permiso), true);
    assert.equal(estadoPermiteAccion("SOLO_LECTURA", permiso), NATURALEZA_DEL_PERMISO[permiso] === "LECTURA");
    assert.equal(estadoPermiteAccion("CERRADA", permiso), false);
  }
  assert.equal(estadoPermiteAccion("SOLO_LECTURA", "reportes.exportar"), true);
  assert.equal(estadoPermiteAccion("SOLO_LECTURA", "administracion.gestionarCheques"), false);
  assert.equal(estadoPermiteAccion("SOLO_LECTURA", "inventario.crear"), false);
  assert.equal(estadoPermiteAccion("INEXISTENTE" as never, "inventario.ver"), false);
  assert.equal(estadoPermiteAccion("ACTIVO", "permiso.inventado" as never), false);
});
