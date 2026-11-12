import assert from "node:assert/strict";
import { test } from "node:test";
import { prepararEventoAuditoria, type EntradaAuditoria } from "../lib/auditoria-eventos.js";
import { ejecutarOperacionCoreAuditada, ErrorAuditoriaCore,
  motivoAuditoriaCore } from "../lib/auditoria-core-transversal.js";
import { snapshotSucursal } from "../core/snapshots-auditoria-core.js";

const id = (x: string) => "rec" + x.repeat(14);
const ACTOR = id("A"), EMPRESA = id("E"), SUCURSAL = id("S");
const previo = snapshotSucursal({ id: SUCURSAL, nombre: "Centro", activa: true });
const esperado = snapshotSucursal({ id: SUCURSAL, nombre: "Nueva Centro", activa: true });
type Resultado = { nombre: string };
function fixture() {
  let estado = previo;
  let cambios = 0;
  const eventos: EntradaAuditoria[] = [];
  const registrar = async (e: EntradaAuditoria) => {
    // valida payload con el motor REAL sin abrir red
    prepararEventoAuditoria(e);
    eventos.push(e);
    return { eventoId: "simulado", operacionId: e.operacionId, registroId: id("R") };
  };
  return {
    eventos,
    cuenta: () => cambios,
    cambiar: () => { estado = esperado; cambios++; },
    params: {
      actorId: ACTOR, empresaId: EMPRESA, empresaNombre: "Empresa simulada",
      accion: "SUCURSAL_RENOMBRAR" as const, recursoTipo: "SUCURSAL" as const,
      recursoId: SUCURSAL, motivo: "Renombrar por solicitud administrativa",
      anterior: previo, propuesto: esperado, registrar,
      escribir: async () => { estado = esperado; cambios++; },
      releer: async () => ({ estado, dato: { nombre: String(estado.NOMBRE_SUCURSAL) } }),
    },
  };
}

test("auditoría Core: dos eventos reales de motor, mismos operación y snapshots", async () => {
  const a = fixture();
  const r = await ejecutarOperacionCoreAuditada<Resultado>(a.params);
  assert.equal(a.cuenta(), 1);
  assert.equal(r.dato.nombre, "Nueva Centro");
  assert.deepEqual(a.eventos.map(x => x.resultado), ["INTENTO", "CONFIRMADO"]);
  assert.equal(a.eventos[0].operacionId, r.operacionId);
  assert.equal(a.eventos[1].operacionId, r.operacionId);
  assert.equal(a.eventos[0].actor.usuarioId, ACTOR);
  assert.equal(a.eventos[0].empresaId, EMPRESA);
  assert.deepEqual(a.eventos[0].anterior, previo);
  assert.deepEqual(a.eventos[1].nuevo, esperado);
});

test("auditoría Core: sin INTENTO confirmado no se ejecuta negocio", async () => {
  const a = fixture();
  await assert.rejects(ejecutarOperacionCoreAuditada({ ...a.params,
    registrar: async () => { throw Error("auditoria caida"); },
  }), (e: unknown) => e instanceof ErrorAuditoriaCore && e.codigo === "AUDITORIA_INICIO");
  assert.equal(a.cuenta(), 0);
});

test("auditoría Core: si PATCH falla pero la relectura confirma, no reintenta", async () => {
  const a = fixture();
  const r = await ejecutarOperacionCoreAuditada({ ...a.params, escribir: async () => {
    a.cambiar();
    throw Error("timeout simulado después de aplicar");
  } });
  assert.equal(a.cuenta(), 1);
  assert.equal(r.dato.nombre, "Nueva Centro");
  assert.equal(a.eventos[1].resultado, "CONFIRMADO");
});

test("auditoría Core: si PATCH falla sin aplicarse, registra FALLIDO", async () => {
  const a = fixture();
  await assert.rejects(ejecutarOperacionCoreAuditada({ ...a.params,
    escribir: async () => { throw Error("fallo simulado"); },
  }), (e: unknown) => e instanceof ErrorAuditoriaCore &&
    e.codigo === "CAMBIO_NO_CONFIRMADO" && !e.puedeEstarAplicado);
  assert.deepEqual(a.eventos.map(e => e.resultado), ["INTENTO", "FALLIDO"]);
});

test("auditoría Core: relectura no confirmable registra INDETERMINADO", async () => {
  const a = fixture();
  await assert.rejects(ejecutarOperacionCoreAuditada({ ...a.params,
    releer: async (): Promise<{estado: typeof previo; dato: Resultado}> => { throw Error("sin red"); },
  }), (e: unknown) => e instanceof ErrorAuditoriaCore &&
    e.codigo === "CAMBIO_INDETERMINADO" && e.puedeEstarAplicado);
  assert.deepEqual(a.eventos.map(e => e.resultado), ["INTENTO", "INDETERMINADO"]);
});

test("auditoría Core: fallo en evento final nunca devuelve éxito", async () => {
  const a = fixture();
  await assert.rejects(ejecutarOperacionCoreAuditada({ ...a.params,
    registrar: async e => { if (e.resultado !== "INTENTO") throw Error("sin confirmar");
      return a.params.registrar(e); },
  }), (e: unknown) => e instanceof ErrorAuditoriaCore &&
    e.codigo === "AUDITORIA_FINAL" && e.puedeEstarAplicado);
  assert.equal(a.cuenta(), 1);
});

test("auditoría Core: actor, empresa y motivo se validan antes de escribir", async () => {
  const a = fixture();
  for (const cambio of [
    { actorId: "inventado" }, { empresaId: "inventado" }, { recursoId: "inventado" },
    { motivo: "corto" },
  ]) {
    await assert.rejects(ejecutarOperacionCoreAuditada({ ...a.params, ...cambio }),
      (e: unknown) => e instanceof ErrorAuditoriaCore && e.codigo === "AUDITORIA_INICIO");
  }
  assert.equal(a.cuenta(), 0);
  assert.equal(a.eventos.length, 0);
  assert.equal(motivoAuditoriaCore("sin"), null);
});

test("auditoría Core: acepta nuevos campos seguros, rechaza secretos y IDs falsos", () => {
  const a = fixture();
  const base: EntradaAuditoria = {
    operacionId: "e501527b-735c-4f6d-8d69-16e8e7ce69a3",
    actor: { usuarioId: ACTOR, usuario: ACTOR, tipo: "CLIENTE" },
    empresaId: EMPRESA, empresaNombre: "Empresa simulada", modulo: "CORE",
    accion: "USUARIO_EDITAR_ACCESOS", recursoTipo: "USUARIO", recursoId: id("U"),
    anterior: { ACTIVA: true, SUCURSALES: [SUCURSAL], SUCURSAL_PRINCIPAL: SUCURSAL,
      MODULOS_HABILITADOS: ["CORE"], PERMISOS: ["usuarios.ver"], VERSION: "a".repeat(64) },
    nuevo: { ACTIVA: true, SUCURSALES: [SUCURSAL], SUCURSAL_PRINCIPAL: SUCURSAL,
      MODULOS_HABILITADOS: ["CORE"], PERMISOS: ["usuarios.gestionar"], VERSION: "b".repeat(64) },
    motivo: "Cambio autorizado simulado", resultado: "INTENTO", origen: "PANEL",
  };
  assert.deepEqual(JSON.parse(prepararEventoAuditoria(base).fields.ESTADO_NUEVO).PERMISOS, ["usuarios.gestionar"]);
  assert.throws(() => prepararEventoAuditoria({ ...base, nuevo: { PASSWORD_HASH: "secreto" } as never }));
  assert.throws(() => prepararEventoAuditoria({ ...base, nuevo: { SUCURSALES: ["ajena"] } as never }));
  assert.throws(() => prepararEventoAuditoria({ ...base, nuevo: { PERMISOS: ["token.secreto privado"] } as never }));
  assert.equal(a.cuenta(), 0);
});

test("auditoría Core: altas con nuevo ID conservan identificador observado", async () => {
  const a = fixture();
  const observado = snapshotSucursal({ id: SUCURSAL, nombre: "Nueva Centro", activa: true });
  const p = { ...a.params, accion: "SUCURSAL_CREAR" as const, recursoTipo: "EMPRESA" as const,
    recursoId: EMPRESA, anterior: { ACTIVA: true } as const,
    propuesto: { ACTIVA: true, NOMBRE_SUCURSAL: "Nueva Centro" } as const,
    releer: async () => ({ estado: observado, dato: { nombre: "Nueva Centro" } }) };
  const r = await ejecutarOperacionCoreAuditada(p);
  assert.equal(r.dato.nombre, "Nueva Centro");
  assert.equal((a.eventos[1].nuevo as { SUCURSAL_ID?: string }).SUCURSAL_ID, SUCURSAL);
});
