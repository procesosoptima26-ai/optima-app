import assert from "node:assert/strict";
import { test } from "node:test";
import { prepararEventoAuditoria, type EntradaAuditoria } from "../lib/auditoria-eventos.js";
import { ejecutarIdentidadAuditada, snapshotIdentidad, ErrorAuditoriaIdentidad } from "../lib/auditoria-identidad-core.js";
import { analizarAuditoriaGlobal } from "../lib/conciliacion-core-global.js";
import type { RegistroAuditoriaAirtable } from "../lib/conciliacion-modulos.js";

const id = (x: string) => "rec" + x.repeat(14);
const empresa = id("E"), usuario = id("U"), actor = id("A");
const previo = snapshotIdentidad(false, false);
const propuesto = snapshotIdentidad(true, true);

function escenario() {
  let estado = previo;
  let escrituras = 0;
  const entradas: EntradaAuditoria[] = [];
  const registros: RegistroAuditoriaAirtable[] = [];
  const registrar = async (e: EntradaAuditoria) => {
    const preparado = prepararEventoAuditoria(e);
    entradas.push(e);
    registros.push({ id: id(String(entradas.length)), fields: { ...preparado.fields } });
    return { eventoId: preparado.eventoId, operacionId: e.operacionId, registroId: id("R") };
  };
  const params = {
    actor: { usuarioId: "SISTEMA", usuario: "ENLACE_ACTIVACION_VERIFICADO", tipo: "SISTEMA" as const },
    empresaId: empresa, empresaNombre: "EMPRESA_VERIFICADA_POR_ENLACE",
    accion: "USUARIO_ACTIVAR" as const, recursoTipo: "USUARIO" as const,
    recursoId: usuario, motivo: "Activación mediante enlace verificado",
    anterior: previo, propuesto, registrar,
    escribir: async () => { estado = propuesto; escrituras++; },
    releer: async () => ({ estado, dato: { activado: true } }),
  };
  return { entradas, registros, params,
    cambios: () => escrituras, aplicar: () => { estado = propuesto; escrituras++; } };
}

test("identidad: activa con INTENTO y CONFIRMADO y no almacena secretos", async () => {
  const x = escenario();
  const r = await ejecutarIdentidadAuditada(x.params);
  assert.equal(r.dato.activado, true);
  assert.equal(x.cambios(), 1);
  assert.deepEqual(x.entradas.map(e => e.resultado), ["INTENTO", "CONFIRMADO"]);
  assert.equal(x.entradas[0].operacionId, x.entradas[1].operacionId);
  assert.equal(x.entradas[0].actor.usuarioId, "SISTEMA");
  assert.ok(!JSON.stringify(x.entradas).includes("PASSWORD_HASH"));
  assert.ok(!JSON.stringify(x.entradas).includes("token="));
  const verificacion = analizarAuditoriaGlobal(empresa, x.registros);
  assert.equal(verificacion.bloqueada, false);
  assert.equal(verificacion.operacionesCore, 1);
});

test("identidad: sin INTENTO registrado no hay escritura de negocio", async () => {
  const x = escenario();
  await assert.rejects(ejecutarIdentidadAuditada({ ...x.params,
    registrar: async () => { throw new Error("mock falla"); },
  }), (e: unknown) => e instanceof ErrorAuditoriaIdentidad && e.codigo === "AUDITORIA_INICIO");
  assert.equal(x.cambios(), 0);
});

test("identidad: timeout posterior a cambio confirmado no duplica escritura", async () => {
  const x = escenario();
  await ejecutarIdentidadAuditada({ ...x.params, escribir: async () => {
    x.aplicar(); throw new Error("timeout después de confirmar");
  } });
  assert.equal(x.cambios(), 1);
  assert.equal(x.entradas.at(-1)?.resultado, "CONFIRMADO");
});

test("identidad: desconexión al releer bloquea reintentos automáticos", async () => {
  const x = escenario();
  await assert.rejects(ejecutarIdentidadAuditada({ ...x.params,
    releer: async (): Promise<{estado: typeof previo; dato: {activado:boolean}}> => { throw new Error("sin red"); },
  }), (e: unknown) => e instanceof ErrorAuditoriaIdentidad &&
    e.codigo === "OPERACION_INDETERMINADA" && e.puedeEstarAplicado);
  assert.equal(x.cambios(), 1);
  assert.equal(x.entradas.at(-1)?.resultado, "INDETERMINADO");
  assert.equal(analizarAuditoriaGlobal(empresa, x.registros).bloqueada, true);
});

test("identidad: sin cambios comprobado puede cerrar como FALLIDO", async () => {
  const x = escenario();
  await assert.rejects(ejecutarIdentidadAuditada({ ...x.params,
    escribir: async () => { throw new Error("falló sin efectos"); },
    falloSinEfecto: () => true,
  }), (e: unknown) => e instanceof ErrorAuditoriaIdentidad &&
    e.codigo === "OPERACION_NO_CONFIRMADA" && !e.puedeEstarAplicado);
  assert.equal(x.cambios(), 0);
  assert.equal(x.entradas.at(-1)?.resultado, "FALLIDO");
  assert.equal(analizarAuditoriaGlobal(empresa, x.registros).bloqueada, false);
});

test("identidad: error en auditoría final nunca responde éxito", async () => {
  const x = escenario();
  await assert.rejects(ejecutarIdentidadAuditada({ ...x.params,
    registrar: async e => { if (e.resultado !== "INTENTO") throw new Error("mock caído");
      return x.params.registrar(e); },
  }), (e: unknown) => e instanceof ErrorAuditoriaIdentidad && e.codigo === "AUDITORIA_FINAL");
  assert.equal(x.cambios(), 1);
  assert.equal(analizarAuditoriaGlobal(empresa, x.registros).bloqueada, true);
});

test("identidad: invitación identifica la cuenta creada sin registrar correo/token", () => {
  const x = escenario();
  const evento: EntradaAuditoria = {
    empresaId: empresa, empresaNombre: "EMPRESA_VERIFICADA_POR_ENLACE",
    modulo: "CORE", origen: "API",
    operacionId: "e501527b-735c-4f6d-8d69-16e8e7ce69a3",
    actor: { usuarioId: actor, usuario: actor, tipo: "CLIENTE" },
    recursoId: empresa, recursoTipo: "EMPRESA", accion: "USUARIO_INVITAR",
    resultado: "CONFIRMADO", motivo: "Invitación por administrador autorizado",
    anterior: snapshotIdentidad(false, false, { invitacionAceptada: false }),
    nuevo: snapshotIdentidad(false, false, { usuarioAfectadoId: usuario, invitacionAceptada: true }),
  };
  assert.equal(prepararEventoAuditoria(evento).fields.EMPRESA_ID, empresa);
  assert.throws(() => prepararEventoAuditoria({ ...evento, nuevo: {
    ACTIVA: false, TOKEN: "secreto",
  } as never }));
});

test("historial global: detecta eventos duplicados, ausencia de cierre e inconsistencia", async () => {
  const x = escenario();
  await ejecutarIdentidadAuditada(x.params);
  assert.equal(analizarAuditoriaGlobal(empresa, x.registros.slice(0,1)).incidencias[0].causa, "SIN_RESULTADO");
  const duplicado = [x.registros[0], x.registros[0], x.registros[1]];
  assert.equal(analizarAuditoriaGlobal(empresa, duplicado).bloqueada, true);
  const adulterado = structuredClone(x.registros);
  adulterado[1].fields.RECURSO_ID = id("Z");
  assert.equal(analizarAuditoriaGlobal(empresa, adulterado).incidencias[0].causa, "SECUENCIA_INVALIDA");
});

test("historial global: empresa, secuencia e ID deben ser verificables", async () => {
  const x = escenario(); await ejecutarIdentidadAuditada(x.params);
  assert.equal(analizarAuditoriaGlobal(id("X"), x.registros).operacionesCore, 0);
  assert.equal(analizarAuditoriaGlobal("empresa-falsa", x.registros).bloqueada, true);
});
