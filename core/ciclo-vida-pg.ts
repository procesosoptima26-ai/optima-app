/**
 * OPTIMA Core — lectura de los hechos del ciclo de vida de UNA empresa (Tarea 5.3).
 * Solo lee la tabla optima_comercial.ciclo_vida (creada por la migración 0004).
 * Misma disciplina que la lectura de contratos: rol de solo lectura, transacción
 * READ ONLY, aislamiento por empresa (RLS) y fallo cerrado. Nunca escribe.
 * Si la empresa NO tiene registro, el resultado es SIN_REGISTRO y quien llama debe DENEGAR.
 */
import type { PoolPgNode183 } from "./adaptador-pg-node-12c183.js";
import type { HechosCicloVida } from "./ciclo-vida-contrato.js";
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

export type LecturaCicloVida =
  | Readonly<{ ok: true; hechos: HechosCicloVida; revision: number }>
  | Readonly<{ ok: false; motivo: "SIN_REGISTRO" | "INCONSISTENTE" | "NO_DISPONIBLE" }>;

/** null se conserva como null; una fecha válida pasa a ISO UTC; cualquier otra cosa es inválida. */
function aIso(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : undefined;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isFinite(n) ? new Date(n).toISOString() : undefined;
  }
  return undefined;
}

export async function leerCicloVidaPg(pool: PoolPgNode183, empresaId: string): Promise<LecturaCicloVida> {
  if (!esIdEmpresaEstable(empresaId)) return { ok: false, motivo: "INCONSISTENTE" };
  let conexion: Awaited<ReturnType<PoolPgNode183["connect"]>> | undefined;
  let transaccion = false;
  let lectura: LecturaCicloVida = { ok: false, motivo: "NO_DISPONIBLE" };
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
        `SELECT empresa_id, periodo_hasta, suspendido_desde, cancelado_desde, revision
         FROM optima_comercial.ciclo_vida WHERE empresa_id = $1 LIMIT 2`,
        [empresaId],
      );
      if (r.rows.length === 0) lectura = { ok: false, motivo: "SIN_REGISTRO" };
      else if (r.rows.length !== 1 || r.rows[0].empresa_id !== empresaId) {
        lectura = { ok: false, motivo: "INCONSISTENTE" };
      } else {
        const f = r.rows[0];
        const periodoHasta = aIso(f.periodo_hasta);
        const suspendidoDesde = aIso(f.suspendido_desde);
        const canceladoDesde = aIso(f.cancelado_desde);
        const rev = typeof f.revision === "string" && /^\d{1,15}$/.test(f.revision) ? Number(f.revision)
          : typeof f.revision === "number" && Number.isSafeInteger(f.revision) && f.revision >= 0 ? f.revision : null;
        lectura = periodoHasta === undefined || suspendidoDesde === undefined || canceladoDesde === undefined || rev === null
          ? { ok: false, motivo: "INCONSISTENTE" }
          : { ok: true, hechos: { periodoHasta, suspendidoDesde, canceladoDesde }, revision: rev };
      }
    }
  } catch {
    lectura = { ok: false, motivo: "NO_DISPONIBLE" };
  } finally {
    if (conexion) {
      if (transaccion) { try { await conexion.query("ROLLBACK"); } catch { limpiezaCorrecta = false; } }
      try { conexion.release(); } catch { limpiezaCorrecta = false; }
    }
  }
  return limpiezaCorrecta ? lectura : { ok: false, motivo: "NO_DISPONIBLE" };
}
