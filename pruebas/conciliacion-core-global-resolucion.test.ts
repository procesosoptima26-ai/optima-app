import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { prepararEventoAuditoria, type EntradaAuditoria } from "../lib/auditoria-eventos.js";
import { analizarAuditoriaGlobal, type SnapshotAuditoriaCore } from "../lib/conciliacion-core-global.js";
import { diagnosticarIncidenciaCore, registrarResolucionCore, ErrorResolucionCoreGlobal } from "../lib/resolucion-core-global.js";
import type { RegistroAuditoriaAirtable } from "../lib/conciliacion-modulos.js";

const id = (x: string) => `rec${x.repeat(14)}`;
const empresa = id("E"), usuario = id("U"), sucursal = id("S"), admin = id("A");
const anterior: SnapshotAuditoriaCore = { ACTIVA: true, SUCURSALES: [sucursal], SUCURSAL_PRINCIPAL: sucursal,
  MODULOS_HABILITADOS: ["CORE"], PERMISOS: [], VERSION: "a".repeat(64) };
const propuesto: SnapshotAuditoriaCore = { ...anterior, PERMISOS: ["usuarios.ver"], VERSION: "b".repeat(64) };
const renombreAntes: SnapshotAuditoriaCore = { ACTIVA: true, NOMBRE_SUCURSAL: "Antes", SUCURSAL_ID: sucursal };
const renombreDespues: SnapshotAuditoriaCore = { ...renombreAntes, NOMBRE_SUCURSAL: "Después" };
const bajarDespues: SnapshotAuditoriaCore = { ...renombreAntes, ACTIVA: false };
let consecutivo = 0;
function evento(operacionId: string, accion: string, fase: EntradaAuditoria["resultado"],
  antes: SnapshotAuditoriaCore, despues: SnapshotAuditoriaCore | null, actorTipo: "CLIENTE" | "PLATAFORMA" = "CLIENTE",
  detalle?: string): RegistroAuditoriaAirtable {
  const tipo = accion.startsWith("SUCURSAL_") && accion !== "SUCURSAL_CREAR" ? "SUCURSAL" :
    accion === "USUARIO_INVITAR" || accion === "SUCURSAL_CREAR" ? "EMPRESA" : "USUARIO";
  const e = prepararEventoAuditoria({ operacionId, actor: { usuarioId: actorTipo === "PLATAFORMA" ? admin : usuario,
    usuario: "ADMINISTRADOR", tipo: actorTipo }, empresaId: empresa, empresaNombre: "Comercio ficticio",
    modulo: "CORE", accion, recursoTipo: tipo, recursoId: tipo === "SUCURSAL" ? sucursal :
      tipo === "EMPRESA" ? empresa : usuario, anterior: antes, nuevo: despues,
    motivo: "Revisión manual controlada", origen: "PANEL", resultado: fase,
    detalle: detalle ?? (fase === "INTENTO" ? "INICIO" : "ESTADO_INCIERTO") });
  return { id: `rec${String(++consecutivo).padStart(14, "0")}`, fields: { ...e.fields } };
}
function arr(accion = "USUARIO_EDITAR_ACCESOS", antes = anterior, despues = propuesto) {
  const op = randomUUID();
  return { op, registros: [evento(op, accion, "INTENTO", antes, despues)] as RegistroAuditoriaAirtable[] };
}
function errorCon(codigo: ErrorResolucionCoreGlobal["codigo"]) {
  return (e: unknown) => e instanceof ErrorResolucionCoreGlobal && e.codigo === codigo;
}

test("Core: INTENTO pendiente con acceso actualizado obtiene diagnóstico APLICADO", () => {
  const x = arr();
  const d = diagnosticarIncidenciaCore(empresa, x.op, x.registros, propuesto);
  assert.equal(d.estadoDetectado, "APLICADO");
  assert.match(d.huellaActual, /^[a-f0-9]{64}$/);
  assert.equal(analizarAuditoriaGlobal(empresa, x.registros).bloqueada, true);
});

test("Core: INTENTO sin efectos puede diagnosticarse NO_APLICADO", () => {
  const x = arr();
  assert.equal(diagnosticarIncidenciaCore(empresa, x.op, x.registros, anterior).estadoDetectado, "NO_APLICADO");
});

test("Core: cambio de permisos más reciente distinto no puede conciliarse", () => {
  const x = arr();
  assert.throws(() => diagnosticarIncidenciaCore(empresa, x.op, x.registros,
    { ...propuesto, VERSION: "f".repeat(64) }), errorCon("ESTADO_NO_COINCIDE"));
});

test("Core: sin cierre, indeterminado, y cierre verificado liberan solo la operación", async () => {
  const x = arr();
  x.registros.push(evento(x.op, "USUARIO_EDITAR_ACCESOS", "INDETERMINADO", anterior, null));
  const d = diagnosticarIncidenciaCore(empresa, x.op, x.registros, propuesto);
  const recibido: EntradaAuditoria[] = [];
  const resultado = await registrarResolucionCore(d, { usuarioId: admin, usuario: "PLATAFORMA", tipo: "PLATAFORMA" },
    "Empresa ficticia", "Verificado contra maestro y registro", async e => {
      recibido.push(e);
      const p = prepararEventoAuditoria(e);
      x.registros.push({ id: id("Z"), fields: { ...p.fields } });
      return { eventoId: p.eventoId, operacionId: e.operacionId, registroId: id("Z") };
    });
  assert.equal(resultado.operacionId, x.op);
  assert.equal(recibido.length, 1);
  assert.equal(recibido[0].resultado, "CONCILIADO");
  assert.equal(recibido[0].detalle, "CONCILIADO_APLICADO");
  assert.equal(analizarAuditoriaGlobal(empresa, x.registros).bloqueada, false);
  assert.equal(JSON.stringify(recibido).includes("PASSWORD_HASH"), false);
});

test("Core: renombre de sucursal se puede conciliar con lectura idéntica", () => {
  const x = arr("SUCURSAL_RENOMBRAR", renombreAntes, renombreDespues);
  const d = diagnosticarIncidenciaCore(empresa, x.op, x.registros, renombreDespues);
  assert.equal(d.accion, "SUCURSAL_RENOMBRAR");
  assert.equal(d.estadoDetectado, "APLICADO");
});

test("Core: baja de sucursal no aplicada puede conciliarse sin repetir DELETE", () => {
  const x = arr("SUCURSAL_DESACTIVAR", renombreAntes, bajarDespues);
  const d = diagnosticarIncidenciaCore(empresa, x.op, x.registros, renombreAntes);
  assert.equal(d.estadoDetectado, "NO_APLICADO");
});

test("Core: identidad sigue bloqueada hasta evidencia externa", () => {
  const x = arr("USUARIO_ACTIVAR", { ACTIVA: false, CREDENCIAL_ACTUALIZADA: false },
    { ACTIVA: true, CREDENCIAL_ACTUALIZADA: true });
  assert.throws(() => diagnosticarIncidenciaCore(empresa, x.op, x.registros,
    { ACTIVA: true, CREDENCIAL_ACTUALIZADA: true }), errorCon("VERIFICACION_EXTERNA"));
});

test("Core: invitaciones y altas de sucursal NO se desbloquean por suposición", () => {
  for (const accion of ["USUARIO_INVITAR", "SUCURSAL_CREAR"]) {
    const x = arr(accion, { ACTIVA: false }, { ACTIVA: true });
    assert.throws(() => diagnosticarIncidenciaCore(empresa, x.op, x.registros, { ACTIVA: true }),
      errorCon("VERIFICACION_EXTERNA"));
  }
});

test("Core: falso cierre desde CLIENTE NO libera la empresa", () => {
  const x = arr();
  x.registros.push(evento(x.op, "USUARIO_EDITAR_ACCESOS", "CONCILIADO", anterior, propuesto,
    "CLIENTE", "CONCILIADO_APLICADO"));
  assert.equal(analizarAuditoriaGlobal(empresa, x.registros).bloqueada, true);
});

test("Core: doble CONCILIADO y cierre con snapshot extraño mantienen bloqueo", () => {
  const x = arr();
  x.registros.push(evento(x.op, "USUARIO_EDITAR_ACCESOS", "CONCILIADO", anterior,
    { ...propuesto, VERSION: "c".repeat(64) }, "PLATAFORMA", "CONCILIADO_APLICADO"));
  assert.equal(analizarAuditoriaGlobal(empresa, x.registros).bloqueada, true);
  x.registros.push(evento(x.op, "USUARIO_EDITAR_ACCESOS", "CONCILIADO", anterior, propuesto,
    "PLATAFORMA", "CONCILIADO_APLICADO"));
  assert.equal(analizarAuditoriaGlobal(empresa, x.registros).bloqueada, true);
});

test("Core: cierre con actor cliente, incluso en registrar, se rechaza", async () => {
  const x = arr();
  const d = diagnosticarIncidenciaCore(empresa, x.op, x.registros, propuesto);
  let llamadas = 0;
  await assert.rejects(registrarResolucionCore(d,
    { usuarioId: usuario, usuario: "CLIENTE", tipo: "CLIENTE" },
    "Empresa ficticia", "Motivo verificado correctamente", async e => {
      llamadas++;
      return { eventoId: randomUUID(), operacionId: e.operacionId, registroId: id("Z") };
    }), errorCon("SNAPSHOT_INCONSISTENTE"));
  assert.equal(llamadas, 0);
});

test("Core: historial con duplicados se bloquea antes de cualquier cierre", () => {
  const x = arr();
  x.registros.push({ ...x.registros[0] });
  assert.throws(() => diagnosticarIncidenciaCore(empresa, x.op, x.registros, propuesto),
    errorCon("HISTORIAL_INVALIDO"));
});

test("Core: operación ya finalizada NO se reconcilia de nuevo", () => {
  const x = arr();
  x.registros.push(evento(x.op, "USUARIO_EDITAR_ACCESOS", "CONFIRMADO", anterior, propuesto));
  assert.throws(() => diagnosticarIncidenciaCore(empresa, x.op, x.registros, propuesto),
    errorCon("NO_CONCILIABLE"));
});

test("Core: no acepta un cierre de operación cuya propuesta no cambie accesos", () => {
  const x = arr("USUARIO_EDITAR_ACCESOS", anterior, anterior);
  assert.throws(() => diagnosticarIncidenciaCore(empresa, x.op, x.registros, anterior),
    errorCon("SNAPSHOT_INCONSISTENTE"));
});
