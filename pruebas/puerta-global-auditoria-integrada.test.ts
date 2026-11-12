import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  ejecutarConPuertaAuditoriaGlobal, comprobarPuertaAuditoriaGlobal,
  ErrorPuertaAuditoriaGlobal, type DependenciasPuertaGlobal,
} from "../lib/puerta-auditoria-core-global.js";
import { ejecutarOperacionCoreAuditada } from "../lib/auditoria-core-transversal.js";
import { ejecutarIdentidadAuditada, snapshotIdentidad } from "../lib/auditoria-identidad-core.js";
import type { EntradaAuditoria } from "../lib/auditoria-eventos.js";
import type { InformeGlobal } from "../lib/conciliacion-core-global.js";

const id = (s: string) => `rec${s.repeat(14)}`;
const empresa = id("E"), usuario = id("U"), propietario = "0123456789abcdef0123456789abcdef";
const limpio: InformeGlobal = { bloqueada: false, operacionesModulos: 3, operacionesCore: 5, incidencias: [] };
const pendiente: InformeGlobal = { ...limpio, bloqueada: true,
  incidencias: [{ operacionId: null, causa: "HISTORIAL_INVALIDO" }] };

function aislar(t: { after(fn: () => void): void }, habilitar = true) {
  const anterior = [process.env.OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED, process.env.OPTIMA_CORE_AUDIT_ENFORCE_ENABLED, process.env.OPTIMA_AUDIT_WRITES_ENABLED];
  t.after(() => {
    for (const [i, k] of ["OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED", "OPTIMA_CORE_AUDIT_ENFORCE_ENABLED", "OPTIMA_AUDIT_WRITES_ENABLED"].entries()) {
      if (anterior[i] === undefined) delete process.env[k]; else process.env[k] = anterior[i];
    }
  });
  delete process.env.OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED;
  delete process.env.OPTIMA_CORE_AUDIT_ENFORCE_ENABLED;
  delete process.env.OPTIMA_AUDIT_WRITES_ENABLED;
  if (habilitar) {
    process.env.OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED = "true";
    process.env.OPTIMA_CORE_AUDIT_ENFORCE_ENABLED = "true";
    process.env.OPTIMA_AUDIT_WRITES_ENABLED = "true";
  }
}

function simular(eventos: string[], informe: InformeGlobal = limpio): DependenciasPuertaGlobal {
  return {
    bloquear: async e => { assert.equal(e, empresa); eventos.push("bloquear"); return propietario; },
    consultar: async e => { assert.equal(e, empresa); eventos.push("consultar"); return informe; },
    renovar: async (e, owner) => { assert.equal(e, empresa); assert.equal(owner, propietario);
      eventos.push("renovar"); return true; },
    liberar: async (e, owner) => { assert.equal(e, empresa); assert.equal(owner, propietario);
      eventos.push("liberar"); },
  };
}
function errorCon(codigo: ErrorPuertaAuditoriaGlobal["codigo"]) {
  return (e: unknown) => e instanceof ErrorPuertaAuditoriaGlobal && e.codigo === codigo;
}

test("puerta: desactivada por defecto preserva flujo y no consulta proveedores", async t => {
  aislar(t, false);
  const llamados: string[] = [];
  const result = await ejecutarConPuertaAuditoriaGlobal(empresa, async asegurar => {
    await asegurar(); llamados.push("operacion"); return 7;
  }, { bloquear: async () => { throw new Error("NUNCA"); }, consultar: async () => { throw new Error("NUNCA"); } });
  assert.equal(result, 7);
  assert.deepEqual(llamados, ["operacion"]);
});

test("puerta: no se activa sin auditoría de escritura habilitada", async t => {
  aislar(t); delete process.env.OPTIMA_AUDIT_WRITES_ENABLED;
  let llamadas = 0;
  await assert.rejects(ejecutarConPuertaAuditoriaGlobal(empresa, async () => {
    llamadas++; return true;
  }, { bloquear: async () => { llamadas++; return propietario; } }), errorCon("CONFIGURACION"));
  assert.equal(llamadas, 0);
});

test("puerta: rechaza empresa inválida sin consulta ni escritura", async t => {
  aislar(t);
  await assert.rejects(comprobarPuertaAuditoriaGlobal("empresa_no_validada", {
    consultar: async () => { throw new Error("NO SE DEBE LLAMAR"); },
  }), errorCon("CONFIGURACION"));
});

test("puerta: lock ocupado impide leer y ejecutar cambios", async t => {
  aislar(t);
  let negocio = false;
  await assert.rejects(ejecutarConPuertaAuditoriaGlobal(empresa, async () => {
    negocio = true;
  }, { bloquear: async () => null, consultar: async () => { throw new Error("NO"); } }), errorCon("OCUPADA"));
  assert.equal(negocio, false);
});

test("puerta: incidencia global impide INTENTO y libera lock", async t => {
  aislar(t);
  const eventos: string[] = [];
  await assert.rejects(ejecutarConPuertaAuditoriaGlobal(empresa, async () => {
    eventos.push("OPERACION");
  }, simular(eventos, pendiente)), errorCon("INCIDENCIAS"));
  assert.deepEqual(eventos, ["bloquear", "consultar", "liberar"]);
});

test("puerta: error de lectura bloquea sin escrituras y libera lock", async t => {
  aislar(t);
  const eventos: string[] = [];
  await assert.rejects(ejecutarConPuertaAuditoriaGlobal(empresa, async () => {
    eventos.push("OPERACION");
  }, { ...simular(eventos), consultar: async () => { eventos.push("fallo-lectura"); throw new Error("timeout"); } }),
  errorCon("NO_DISPONIBLE"));
  assert.deepEqual(eventos, ["bloquear", "fallo-lectura", "liberar"]);
});

test("puerta: lock inicial perdido impide crear INTENTO", async t => {
  aislar(t);
  const eventos: string[] = [];
  await assert.rejects(ejecutarConPuertaAuditoriaGlobal(empresa, async () => {
    eventos.push("OPERACION");
  }, { ...simular(eventos), renovar: async () => { eventos.push("perdido"); return false; } }),
  errorCon("BLOQUEO_PERDIDO"));
  assert.deepEqual(eventos, ["bloquear", "consultar", "perdido", "liberar"]);
});

test("puerta: mantiene lock durante transacción y revalida antes de escribir", async t => {
  aislar(t);
  const eventos: string[] = [];
  const resultado = await ejecutarConPuertaAuditoriaGlobal(empresa, async asegurar => {
    eventos.push("INTENTO");
    await asegurar();
    eventos.push("ESCRITURA");
    eventos.push("FINAL");
    return "OK";
  }, simular(eventos));
  assert.equal(resultado, "OK");
  assert.deepEqual(eventos, ["bloquear", "consultar", "renovar", "INTENTO", "renovar", "ESCRITURA", "FINAL", "liberar"]);
});

test("puerta: si pierde lock antes de escribir, no ejecuta negocio", async t => {
  aislar(t);
  const eventos: string[] = [];
  let cuenta = 0;
  await assert.rejects(ejecutarConPuertaAuditoriaGlobal(empresa, async asegurar => {
    eventos.push("INTENTO"); await asegurar(); cuenta++;
  }, { ...simular(eventos), renovar: async () => {
    eventos.push("renovar"); return eventos.filter(x => x === "renovar").length === 1;
  } }), errorCon("BLOQUEO_PERDIDO"));
  assert.equal(cuenta, 0);
  assert.equal(eventos.at(-1), "liberar");
});

test("puerta: serializa dos operaciones sobre empresa compartida", async t => {
  aislar(t);
  let bloqueado = false;
  let resolver: (() => void) | undefined;
  const pausa = new Promise<void>(resolve => { resolver = resolve; });
  const deps: DependenciasPuertaGlobal = {
    bloquear: async () => { if (bloqueado) return null; bloqueado = true; return propietario; },
    consultar: async () => limpio,
    renovar: async () => true,
    liberar: async () => { bloqueado = false; },
  };
  const primera = ejecutarConPuertaAuditoriaGlobal(empresa, async () => { await pausa; return "primera"; }, deps);
  await assert.rejects(ejecutarConPuertaAuditoriaGlobal(empresa, async () => "segunda", deps), errorCon("OCUPADA"));
  resolver?.();
  assert.equal(await primera, "primera");
});

test("Core: integración impide el primer evento si global tiene incidencias", async t => {
  aislar(t);
  const acciones: string[] = [];
  const registrar = async (evento: EntradaAuditoria) => { acciones.push(evento.resultado);
    return { eventoId: "sim", operacionId: evento.operacionId, registroId: id("R") }; };
  await assert.rejects(ejecutarOperacionCoreAuditada({
    actorId: usuario, empresaId: empresa, empresaNombre: "Empresa simulada",
    accion: "SUCURSAL_DESACTIVAR", recursoTipo: "SUCURSAL", recursoId: id("S"),
    motivo: "Solicitud administrada de baja",
    anterior: { ACTIVA: true }, propuesto: { ACTIVA: false },
    escribir: async () => { acciones.push("ESCRIBIR"); },
    releer: async () => ({ estado: { ACTIVA: false }, dato: true }),
    registrar, controlGlobal: simular(acciones, pendiente),
  }), errorCon("INCIDENCIAS"));
  assert.deepEqual(acciones, ["bloquear", "consultar", "liberar"]);
});

test("Identidad: recuperación no puede revocar sesiones con incidencia global", async t => {
  aislar(t);
  const acciones: string[] = [];
  const registrar = async (evento: EntradaAuditoria) => { acciones.push(evento.resultado);
    return { eventoId: "sim", operacionId: evento.operacionId, registroId: id("R") }; };
  await assert.rejects(ejecutarIdentidadAuditada({
    actor: { usuarioId: "SISTEMA", usuario: "ENLACE_VERIFICADO", tipo: "SISTEMA" },
    empresaId: empresa, empresaNombre: "Empresa simulada",
    accion: "USUARIO_RESTABLECER_CLAVE", recursoTipo: "USUARIO", recursoId: usuario,
    motivo: "Restablecimiento mediante enlace válido",
    anterior: snapshotIdentidad(true, false, { sesionesRevocadas: false }),
    propuesto: snapshotIdentidad(true, true, { sesionesRevocadas: true }),
    escribir: async () => { acciones.push("REVOCAR"); },
    releer: async () => ({ estado: snapshotIdentidad(true, true, { sesionesRevocadas: true }), dato: true }),
    registrar, controlGlobal: simular(acciones, pendiente),
  }), errorCon("INCIDENCIAS"));
  assert.deepEqual(acciones, ["bloquear", "consultar", "liberar"]);
});

test("módulos: reutiliza el lock ya tomado y cambia a consulta global bajo bandera", async () => {
  const codigo = await readFile(new URL("../handlers/core/gestion-modulos.ts", import.meta.url), "utf8");
  assert.ok(codigo.includes("owner = await bloquearModulos(empresaId)"));
  assert.ok(codigo.includes("puertaGlobalHabilitada()"));
  assert.ok(codigo.includes("await consultarAuditoriaGlobal(empresaId)"));
});
