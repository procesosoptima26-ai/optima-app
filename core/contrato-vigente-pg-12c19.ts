/**
 * OPTIMA 12C.19 — Lectura transaccional, por empresa, de UN contrato operativo.
 * Fuente exclusiva de contrataciones: PostgreSQL. Nunca recurre a Airtable.
 * Sin writes, sin endpoints, sin cache. Rol lector NO propietario + RLS obligatorio.
 */
import type { PoolPgNode183 } from "./adaptador-pg-node-12c183.js";
import { validarContrataciones, type ContratacionComercial } from "./reglas-comerciales.js";
import { CATALOGO_SUBMODULOS_CONTRATACION } from "./catalogo-comercial-jerarquico.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const CONTRATO_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const VERSION_ID = /^VER-[A-Za-z0-9_-]{4,60}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;

type Fila = Record<string, unknown>;
export type ContratoOperativo = Readonly<{
  empresaId: string;
  idContrato: string;
  idVersion: string;
  numero: number;
  servicios: readonly ContratacionComercial[];
}>;
export type LecturaContratoOperativo = Readonly<{
  ok: true; contrato: ContratoOperativo;
}> | Readonly<{ ok: false; motivo: "NO_VIGENTE" | "INCONSISTENTE" | "NO_DISPONIBLE" }>;

function instante(v: unknown): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v !== "string" || !ISO.test(v)) return null;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}
function entero(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  if (typeof v === "string" && !/^\d{1,16}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function interpretarFila(f: Fila, empresaId: string, ahora: number): LecturaContratoOperativo {
  if (f.empresa_id !== empresaId || typeof f.id_contrato !== "string" ||
      !CONTRATO_ID.test(f.id_contrato) || typeof f.id_version !== "string" ||
      !VERSION_ID.test(f.id_version) || f.estado !== "VIGENTE") {
    return { ok: false, motivo: "INCONSISTENTE" };
  }
  const numero = entero(f.numero);
  const revision = entero(f.revision);
  const desde = instante(f.vigente_desde);
  const aprobacion = instante(f.aprobado_en);
  if (numero === null || revision === null || desde === null || aprobacion === null ||
      !ID.test(String(f.aprobado_por_id)) || aprobacion > desde ||
      aprobacion > ahora || desde > ahora || f.vigente_hasta !== null) {
    return { ok: false, motivo: "INCONSISTENTE" };
  }
  // El driver PostgreSQL entrega JSONB como arreglo; nunca evalúa texto del usuario.
  const validado = validarContrataciones(f.servicios, CATALOGO_SUBMODULOS_CONTRATACION);
  if (!validado.ok || validado.contrataciones.length === 0) {
    return { ok: false, motivo: "INCONSISTENTE" };
  }
  return { ok: true, contrato: {
    empresaId,
    idContrato: f.id_contrato,
    idVersion: f.id_version,
    numero,
    servicios: validado.contrataciones,
  } };
}

/**
 * RLS: SET LOCAL se ejecuta en la MISMA conexión y transacción de lectura.
 * Si hay dos contratos vigentes para la empresa, nunca elige silenciosamente.
 * No es posible otorgar acceso a través de datos de la request HTTP.
 */
export async function leerContratoOperativoPg(
  pool: PoolPgNode183, empresaId: string, ahoraIso: string,
): Promise<LecturaContratoOperativo> {
  const ahora = instante(ahoraIso);
  if (!ID.test(empresaId) || ahora === null) return { ok: false, motivo: "INCONSISTENTE" };
  let conexion: Awaited<ReturnType<PoolPgNode183["connect"]>> | undefined;
  let transaccion = false;
  let lectura: LecturaContratoOperativo = { ok: false, motivo: "NO_DISPONIBLE" };
  let limpiezaCorrecta = true;
  try {
    conexion = await pool.connect();
    await conexion.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaccion = true;
    const alcance = await conexion.query(
      "SELECT set_config('optima.empresa_id', $1, true) AS empresa_id", [empresaId],
    );
    if (alcance.rows.length !== 1 || alcance.rows[0].empresa_id !== empresaId) {
      lectura = { ok: false, motivo: "INCONSISTENTE" };
    } else {
      const r = await conexion.query(
        `SELECT c.empresa_id, c.id_contrato, c.revision, v.id_version, v.numero,
           v.estado, v.servicios, v.vigente_desde, v.vigente_hasta,
           v.aprobado_por_id, v.aprobado_en
         FROM optima_comercial.contratos c
         JOIN optima_comercial.versiones v ON
           v.empresa_id = c.empresa_id AND v.id_contrato = c.id_contrato
         WHERE c.empresa_id = $1 AND v.estado = 'VIGENTE'
         ORDER BY c.id_contrato, v.numero LIMIT 2`,
        [empresaId],
      );
      if (r.rows.length === 0) lectura = { ok: false, motivo: "NO_VIGENTE" };
      else if (r.rows.length !== 1) lectura = { ok: false, motivo: "INCONSISTENTE" };
      else lectura = interpretarFila(r.rows[0], empresaId, ahora);
    }
  } catch {
    lectura = { ok: false, motivo: "NO_DISPONIBLE" };
  } finally {
    if (conexion) {
      if (transaccion) {
        try { await conexion.query("ROLLBACK"); }
        catch { limpiezaCorrecta = false; }
      }
      try { conexion.release(); } catch { limpiezaCorrecta = false; }
    }
  }
  // Un fallo al terminar la transacción también prohíbe otorgar acceso.
  return limpiezaCorrecta ? lectura : { ok: false, motivo: "NO_DISPONIBLE" };
}
