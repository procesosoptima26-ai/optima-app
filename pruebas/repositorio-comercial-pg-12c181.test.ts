import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { iniciarHistorialComercialLocal, aprobarBorradorComercialLocal,
  activarVersionComercialLocal, type HistorialContratacionSimulado } from "../core/historial-contratacion-comercial-12c173.js";
import { crearBorradorComercialLocal } from "../core/borradores-contratacion-comercial-12c172.js";
import { persistirPasoComercialPg12C181,
  type ClientePostgresDedicado, type SolicitudGuardadoComercialPg,
  type RespuestaSql } from "../core/repositorio-comercial-pg-12c181.js";

const EMP = 'emp_'+'a'.repeat(12);
const APR = `rec${"B".repeat(14)}`;
const ACT = `rec${"C".repeat(14)}`;
const OTR = `rec${"D".repeat(14)}`; // OTRO USUARIO (actor), no empresa
const CTR = "CTR-OPTIMA-0001";
const V1 = "VER-OPTIMA-0001";
const V2 = "VER-OPTIMA-0002";
const F = [
  "2026-11-11T10:00:00.000Z", "2026-11-11T11:00:00.000Z",
  "2026-11-11T12:00:00.000Z", "2026-11-11T13:00:00.000Z",
  "2026-11-11T14:00:00.000Z", "2026-11-11T15:00:00.000Z",
] as const;
function bien<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error("Operación de fixture fallida");
  return r as Extract<T, {ok:true}>;
}
function nueva(): HistorialContratacionSimulado {
  return bien(iniciarHistorialComercialLocal({ empresaId: EMP, idContrato: CTR })).historial;
}
function aprobar(previo: HistorialContratacionSimulado, idVersion = V1,
  fechaBorrador: string = F[0], fechaAprobacion: string = F[1],
  servicio = "CHEQUES"): HistorialContratacionSimulado {
  const vigente = previo.versiones.find(v => v.estado === "VIGENTE") ?? null;
  const bor = bien(crearBorradorComercialLocal({
    idBorrador: idVersion === V1 ? "BOR-OPTIMA-0001" : "BOR-OPTIMA-0002",
    empresaId: EMP, idContrato: vigente ? CTR : null,
    versionBase: vigente?.numero ?? null, serviciosBase: vigente?.servicios ?? [],
    serviciosPropuestos: [{ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: servicio, nivel: "ESTANDAR" }],
    motivoCambio: "Alta o cambio comercial de prueba local", ahoraIso: fechaBorrador,
  })).borrador;
  return bien(aprobarBorradorComercialLocal({
    historial: previo, borrador: bor, empresaId: EMP, actorUsuarioId: APR,
    idVersion, revisionHistorialEsperada: previo.revisionHistorial, ahoraIso: fechaAprobacion,
  })).historial;
}
function activar(previo: HistorialContratacionSimulado, idVersion = V1,
  fecha: string = F[2]): HistorialContratacionSimulado {
  return bien(activarVersionComercialLocal({
    historial: previo, empresaId: EMP, actorUsuarioId: ACT,
    idVersion, revisionHistorialEsperada: previo.revisionHistorial, ahoraIso: fecha,
  })).historial;
}
function solicitud(anterior: HistorialContratacionSimulado,
  siguiente: HistorialContratacionSimulado,
  claveIdempotencia = "OP-INTEGRACION-0001"): SolicitudGuardadoComercialPg {
  return { anterior, siguiente, claveIdempotencia,
    actorServidorId: siguiente.eventos.at(-1)!.actorUsuarioId };
}
function hash(x: unknown) {
  return createHash("sha256").update(JSON.stringify(x)).digest("hex");
}
type Config = {
  revision?: number;
  huella?: string;
  faltaContrato?: boolean;
  guardarIdempotencia?: "misma" | "distinta" | "rota" | "duplicada";
  fallarEn?: string;
  afectadasCeroEn?: string;
  errorRollback?: boolean;
};
class ClienteFalso implements ClientePostgresDedicado {
  llamadas: Array<{ sql: string; parametros: readonly unknown[] }> = [];
  constructor(public transicion: SolicitudGuardadoComercialPg, public opciones: Config = {}) {}
  async query<T extends object = Record<string, unknown>>(sql: string,
    parametros: readonly unknown[] = []): Promise<RespuestaSql<T>> {
    this.llamadas.push({ sql, parametros });
    if (this.opciones.errorRollback && sql === "ROLLBACK") throw Error("Falla rollback");
    if (this.opciones.fallarEn && sql.includes(this.opciones.fallarEn)) throw Error("Simulación de fallo de BD");
    const cero = !!this.opciones.afectadasCeroEn && sql.includes(this.opciones.afectadasCeroEn);
    if (sql.includes("SELECT revision, huella_historial")) {
      const row = { revision: String(this.opciones.revision ?? this.transicion.anterior.revisionHistorial),
        huella_historial: this.opciones.huella ?? hash(this.transicion.anterior) };
      return { rows: this.opciones.faltaContrato ? [] : [row as T], rowCount: this.opciones.faltaContrato ? 0 : 1 };
    }
    if (sql.includes("FROM optima_comercial.idempotencia")) {
      const tipo = this.opciones.guardarIdempotencia;
      if (!tipo) return { rows: [], rowCount: 0 };
      const s = this.transicion;
      const respuesta = { revisionAplicada: s.siguiente.revisionHistorial,
        idVersion: s.siguiente.eventos.at(-1)!.idVersion,
        tipo: s.siguiente.eventos.at(-1)!.tipo };
      const row = { huella_solicitud: tipo === "distinta" ? "0".repeat(64) :
        hash({ empresa: s.anterior.empresaId, contrato: s.anterior.idContrato,
          anterior: s.anterior, siguiente: s.siguiente, actorServidorId: s.actorServidorId }),
        revision_aplicada: respuesta.revisionAplicada,
        respuesta: tipo === "rota" ? { ...respuesta, revisionAplicada: 99 } : respuesta };
      return { rows: tipo === "duplicada" ? [row as T, row as T] : [row as T], rowCount: tipo === "duplicada" ? 2 : 1 };
    }
    return { rows: [], rowCount: cero ? 0 : 1 };
  }
  comandos() { return this.llamadas.map(x => x.sql); }
}
const inicial = nueva();
const a1 = aprobar(inicial);
const v1 = activar(a1);
const a2 = aprobar(v1, V2, F[3], F[4], "BANCOS");
const v2 = activar(a2, V2, F[5]);

async function correr(s: SolicitudGuardadoComercialPg, opciones?: Config) {
  const cliente = new ClienteFalso(s, opciones);
  const r = await persistirPasoComercialPg12C181(cliente, s);
  return { cliente, r };
}
function errorDe(r: Awaited<ReturnType<typeof persistirPasoComercialPg12C181>>,
  motivo: string) {
  assert.equal(r.ok, false, JSON.stringify(r));
  if (!r.ok) assert.equal(r.motivo, motivo);
  assert.equal(r.accesoOperativoHabilitado, false);
}

for (const [nombre, anterior, siguiente] of [
  ["aprobación inicial", inicial, a1],
  ["activación inicial", a1, v1],
  ["segunda aprobación", v1, a2],
  ["segunda activación", a2, v2],
] as const) {
  test(`12C.18.1: transacción exitosa para ${nombre}`, async () => {
    const { r, cliente } = await correr(solicitud(anterior, siguiente));
    assert.equal(r.ok, true, JSON.stringify(r));
    if (r.ok) {
      assert.equal(r.repetida, false);
      assert.equal(r.revisionAplicada, siguiente.revisionHistorial);
    }
    const comandos = cliente.comandos();
    assert.equal(comandos.at(0), "BEGIN");
    assert.equal(comandos.at(-1), "COMMIT");
    assert.equal(comandos.includes("ROLLBACK"), false);
    assert.equal(comandos.filter(q => q.includes("INSERT INTO optima_comercial.eventos")).length, 1);
    assert.equal(comandos.filter(q => q.includes("INSERT INTO optima_comercial.idempotencia")).length, 1);
    assert.equal(comandos.filter(q => q.includes("UPDATE optima_comercial.contratos SET revision")).length, 1);
    assert.ok(comandos.some(q => q.includes("FOR UPDATE")));
  });
}
for (const [nombre, anterior, siguiente, updates] of [
  ["aprobación", inicial, a1, 0],
  ["activación simple", a1, v1, 1],
  ["aprobación de cambio", v1, a2, 0],
  ["activación con histórico", a2, v2, 2],
] as const) {
  test(`12C.18.1: operaciones de versiones en ${nombre}`, async () => {
    const { cliente, r } = await correr(solicitud(anterior, siguiente));
    assert.equal(r.ok, true);
    const queries = cliente.comandos().filter(q => q.includes("optima_comercial.versiones"));
    assert.equal(queries.filter(q => q.trimStart().startsWith("UPDATE")).length, updates);
    assert.equal(queries.filter(q => q.trimStart().startsWith("INSERT")).length, updates ? 0 : 1);
    assert.ok(cliente.llamadas.every(x => !x.sql.includes(EMP) && !x.sql.includes(APR)));
  });
}
test("12C.18.1: sólo se inicializa contrato en primera aprobación", async () => {
  const nuevaDb = await correr(solicitud(inicial, a1));
  const existente = await correr(solicitud(a1, v1));
  assert.equal(nuevaDb.cliente.comandos().filter(q => q.includes("INSERT INTO optima_comercial.contratos")).length, 1);
  assert.equal(existente.cliente.comandos().filter(q => q.includes("INSERT INTO optima_comercial.contratos")).length, 0);
});
test("12C.18.1: rechazo local sin abrir transacción por clave inválida", async () => {
  const s = { ...solicitud(inicial, a1), claveIdempotencia: "NO" };
  const { r, cliente } = await correr(s);
  errorDe(r, "DATOS_INVALIDOS");
  assert.equal(cliente.llamadas.length, 0);
});
test("12C.18.1: rechazo local por actor distinto", async () => {
  const s = { ...solicitud(inicial, a1), actorServidorId: OTR };
  const { r, cliente } = await correr(s);
  errorDe(r, "IDENTIDAD_NO_COINCIDE");
  assert.equal(cliente.llamadas.length, 0);
});
test("12C.18.1: separación de funciones evita que aprobador active", async () => {
  const corrupta = structuredClone(v1);
  // Cambiar ambos actor y evento rompe la consistencia del propio historial.
  (corrupta.eventos[1] as { actorUsuarioId: string }).actorUsuarioId = APR;
  const s = solicitud(a1, corrupta);
  const { r, cliente } = await correr(s);
  errorDe(r, "SEPARACION_FUNCIONES");
  assert.equal(cliente.llamadas.length, 0);
});
test("12C.18.1: rechaza revisión antigua con rollback", async () => {
  const { r, cliente } = await correr(solicitud(a1, v1), { revision: 3 });
  errorDe(r, "REVISION_DESACTUALIZADA");
  assert.equal(cliente.comandos().at(-1), "ROLLBACK");
});
test("12C.18.1: hash diverge aunque coincida la revisión", async () => {
  const { r, cliente } = await correr(solicitud(a1, v1), { huella: "0".repeat(64) });
  errorDe(r, "ESTADO_DIVERGENTE");
  assert.equal(cliente.comandos().at(-1), "ROLLBACK");
});
test("12C.18.1: falta contrato impide escribir", async () => {
  const { r, cliente } = await correr(solicitud(a1, v1), { faltaContrato: true });
  errorDe(r, "REGISTRO_INCONSISTENTE");
  assert.equal(cliente.comandos().at(-1), "ROLLBACK");
});
test("12C.18.1: idempotencia válida devuelve resultado previo sin nuevas escrituras", async () => {
  const { r, cliente } = await correr(solicitud(a1, v1), { guardarIdempotencia: "misma", revision: 6 });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.repetida, true);
  assert.ok(!cliente.comandos().some(q => q.includes("INSERT INTO optima_comercial.eventos")));
  assert.equal(cliente.comandos().at(-1), "COMMIT");
});
test("12C.18.1: clave reutilizada con distinto contenido se rechaza", async () => {
  const { r, cliente } = await correr(solicitud(a1, v1), { guardarIdempotencia: "distinta" });
  errorDe(r, "CLAVE_REUTILIZADA_CON_CAMBIO");
  assert.equal(cliente.comandos().at(-1), "ROLLBACK");
});
test("12C.18.1: respuesta corrupta guardada bloquea el reintento", async () => {
  const { r } = await correr(solicitud(a1, v1), { guardarIdempotencia: "rota" });
  errorDe(r, "REGISTRO_INCONSISTENTE");
});
test("12C.18.1: duplicados inesperados se bloquean", async () => {
  const { r } = await correr(solicitud(a1, v1), { guardarIdempotencia: "duplicada" });
  errorDe(r, "REGISTRO_INCONSISTENTE");
});
for (const [nombre, fallarEn] of [
  ["lectura bajo bloqueo", "SELECT revision, huella_historial"],
  ["inserción de versión", "INSERT INTO optima_comercial.versiones"],
  ["inserción de evento", "INSERT INTO optima_comercial.eventos"],
  ["registro de idempotencia", "INSERT INTO optima_comercial.idempotencia"],
  ["actualización CAS", "UPDATE optima_comercial.contratos SET revision"],
  ["commit", "COMMIT"],
] as const) {
  test(`12C.18.1: fallo de ${nombre} obliga a rollback`, async () => {
    const { r, cliente } = await correr(solicitud(inicial, a1), { fallarEn });
    errorDe(r, "ERROR_BD");
    assert.equal(cliente.comandos().at(-1), "ROLLBACK");
  });
}
test("12C.18.1: fallo del rollback tampoco expone SQL", async () => {
  const { r } = await correr(solicitud(inicial, a1),
    { fallarEn: "INSERT INTO optima_comercial.eventos", errorRollback: true });
  errorDe(r, "ERROR_BD");
});
for (const [nombre, afectadasCeroEn] of [
  ["insertar versión", "INSERT INTO optima_comercial.versiones"],
  ["insertar evento", "INSERT INTO optima_comercial.eventos"],
  ["guardar idempotencia", "INSERT INTO optima_comercial.idempotencia"],
  ["actualizar contrato", "UPDATE optima_comercial.contratos SET revision"],
] as const) {
  test(`12C.18.1: cero filas al ${nombre} no se da por éxito`, async () => {
    const { r, cliente } = await correr(solicitud(inicial, a1), { afectadasCeroEn });
    errorDe(r, "ERROR_BD");
    assert.equal(cliente.comandos().at(-1), "ROLLBACK");
  });
}
test("12C.18.1: SQL usa parámetros para IDs, fechas y servicios", async () => {
  const { cliente, r } = await correr(solicitud(inicial, a1));
  assert.equal(r.ok, true);
  const insercion = cliente.llamadas.find(x => x.sql.includes("INSERT INTO optima_comercial.versiones"));
  assert.ok(insercion);
  assert.ok(insercion.sql.includes("$6::jsonb"));
  assert.equal(insercion.parametros[0], EMP);
  assert.equal(insercion.parametros[2], V1);
});
test("12C.18.1: migración documenta restricciones de unicidad", () => {
  const sql = readFileSync("db/migrations/0001_optima_comercial_pg.sql", "utf8");
  assert.ok(sql.includes("una_version_vigente_por_contrato"));
  assert.ok(sql.includes("una_version_aprobada_por_contrato"));
  assert.ok(sql.includes("eventos_inmutables"));
  assert.ok(sql.includes("versiones_cambios_controlados"));
  assert.ok(sql.includes("idempotencia_no_modificar"));
  assert.ok(sql.includes("REVOKE ALL ON SCHEMA optima_comercial FROM PUBLIC"));
  assert.ok(!sql.includes("DROP TABLE"));
  assert.ok(!sql.includes("AIRTABLE_TOKEN"));
});
