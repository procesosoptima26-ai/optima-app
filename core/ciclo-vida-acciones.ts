/**
 * OPTIMA Core — acciones de OPTIMA sobre el ciclo de vida de una empresa (Tarea 5.4).
 *
 * Acciones: RENOVACION, SUSPENSION, LEVANTAR_SUSPENSION, CANCELACION, REACTIVACION.
 * Parte 1 (pura): decide si la acción es válida desde el estado actual y calcula los
 * nuevos hechos. No toca ninguna base ni usa el reloj (la fecha llega como dato).
 * Parte 2 (PostgreSQL): aplica el cambio en UNA transacción, con bloqueo de la fila,
 * control de revisión (si dos personas actúan a la vez, una falla en vez de pisarse)
 * y deja el registro inmodificable de quién, cuándo y por qué.
 * Fallo cerrado: ante cualquier duda no cambia nada.
 */
import type { PoolPgNode183 } from "./adaptador-pg-node-12c183.js";
import { evaluarCicloVida, type HechosCicloVida, type EstadoAcceso } from "./ciclo-vida-contrato.js";
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

export type AccionCicloVida =
  "RENOVACION" | "SUSPENSION" | "LEVANTAR_SUSPENSION" | "CANCELACION" | "REACTIVACION";
export const ACCIONES_CICLO_VIDA: readonly AccionCicloVida[] =
  ["RENOVACION", "SUSPENSION", "LEVANTAR_SUSPENSION", "CANCELACION", "REACTIVACION"];

export type SolicitudCicloVida = Readonly<{
  empresaId: string;
  accion: AccionCicloVida;
  motivo: string;
  /** Revisión que el operador vio (0 si la empresa aún no tiene registro). */
  revisionEsperada: number;
  /** Obligatoria en RENOVACION y REACTIVACION: nuevo fin del período pagado (ISO UTC). */
  nuevoPeriodoHasta?: string;
}>;

export type MotivoRechazoAccion =
  "SOLICITUD_INVALIDA" | "TRANSICION_INVALIDA" | "REVISION_DESACTUALIZADA" | "ERROR_BD";
export type ResultadoAccionCicloVida =
  | Readonly<{ ok: true; revision: number; estado: EstadoAcceso; hechos: HechosCicloVida }>
  | Readonly<{ ok: false; motivo: MotivoRechazoAccion }>;

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const ACTOR = /^rec[A-Za-z0-9]{14}$/;
const instante = (v: unknown): number | null => {
  if (typeof v !== "string" || !ISO.test(v)) return null;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
export function motivoValido(m: unknown): m is string {
  // 10 a 500 caracteres, sin caracteres de control (evita ensuciar el registro).
  return typeof m === "string" && m === m.trim() && m.length >= 10 && m.length <= 500 &&
    !/[\u0000-\u001f\u007f]/.test(m);
}

/** Parte pura: nuevos hechos o rechazo. `actual` null = la empresa todavía no tiene registro. */
export function calcularTransicion(
  actual: HechosCicloVida | null, accion: AccionCicloVida, ahoraIso: string, nuevoPeriodoHasta?: string,
): { ok: true; hechos: HechosCicloVida } | { ok: false; motivo: "SOLICITUD_INVALIDA" | "TRANSICION_INVALIDA" } {
  const ahora = instante(ahoraIso);
  if (ahora === null || !ACCIONES_CICLO_VIDA.includes(accion)) return { ok: false, motivo: "SOLICITUD_INVALIDA" };
  const nuevo = nuevoPeriodoHasta === undefined ? null : instante(nuevoPeriodoHasta);
  const necesitaFecha = accion === "RENOVACION" || accion === "REACTIVACION";
  if (necesitaFecha ? (nuevo === null || nuevo <= ahora) : nuevoPeriodoHasta !== undefined) {
    return { ok: false, motivo: "SOLICITUD_INVALIDA" };
  }
  const nuevoIso = nuevo === null ? null : new Date(nuevo).toISOString();
  const invalida = { ok: false, motivo: "TRANSICION_INVALIDA" } as const;
  let hechos: HechosCicloVida;
  if (actual === null) {
    // Primera vez: solo se puede dar de alta renovando (fija el período pagado).
    if (accion !== "RENOVACION") return invalida;
    hechos = { periodoHasta: nuevoIso, suspendidoDesde: null, canceladoDesde: null };
  } else {
    const cancelada = actual.canceladoDesde !== null;
    const suspendida = actual.suspendidoDesde !== null;
    switch (accion) {
      case "RENOVACION": {
        const actualHasta = actual.periodoHasta === null ? null : instante(actual.periodoHasta);
        // Renovar no acorta un período ya pagado ni reactiva una cancelada.
        if (cancelada || actualHasta === null || (nuevo as number) <= actualHasta) return invalida;
        hechos = { ...actual, periodoHasta: nuevoIso };
        break;
      }
      case "SUSPENSION":
        if (cancelada || suspendida) return invalida;
        hechos = { ...actual, suspendidoDesde: new Date(ahora).toISOString() };
        break;
      case "LEVANTAR_SUSPENSION":
        if (!suspendida) return invalida;
        hechos = { ...actual, suspendidoDesde: null };
        break;
      case "CANCELACION":
        if (cancelada) return invalida;
        hechos = { ...actual, canceladoDesde: new Date(ahora).toISOString() };
        break;
      case "REACTIVACION":
        if (!cancelada) return invalida;
        hechos = { ...actual, canceladoDesde: null, periodoHasta: nuevoIso };
        break;
    }
  }
  // Salvaguarda: el resultado tiene que ser un estado evaluable.
  return evaluarCicloVida(hechos, ahoraIso).ok ? { ok: true, hechos } : { ok: false, motivo: "SOLICITUD_INVALIDA" };
}

function aIso(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : undefined;
  if (typeof v === "string") { const n = Date.parse(v); return Number.isFinite(n) ? new Date(n).toISOString() : undefined; }
  return undefined;
}
const entero = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/**
 * Aplica la acción en la base. `actorUsuarioId` sale SIEMPRE de la sesión verificada
 * en el servidor, nunca del cuerpo de la petición.
 */
export async function aplicarAccionCicloVidaPg(
  pool: PoolPgNode183, actorUsuarioId: string, solicitud: SolicitudCicloVida,
  relojServidor: () => string = () => new Date().toISOString(),
): Promise<ResultadoAccionCicloVida> {
  const rechazo = (motivo: MotivoRechazoAccion): ResultadoAccionCicloVida => ({ ok: false, motivo });
  if (!ACTOR.test(actorUsuarioId) || !solicitud || typeof solicitud !== "object" ||
      !esIdEmpresaEstable(solicitud.empresaId) || !ACCIONES_CICLO_VIDA.includes(solicitud.accion) ||
      !motivoValido(solicitud.motivo) || entero(solicitud.revisionEsperada) === null) {
    return rechazo("SOLICITUD_INVALIDA");
  }
  const ahoraIso = relojServidor();
  if (instante(ahoraIso) === null) return rechazo("SOLICITUD_INVALIDA");
  const revisionEsperada = entero(solicitud.revisionEsperada) as number;

  let conexion: Awaited<ReturnType<PoolPgNode183["connect"]>> | undefined;
  let abierta = false;
  let resultado: ResultadoAccionCicloVida = rechazo("ERROR_BD");
  try {
    conexion = await pool.connect();
    await conexion.query("BEGIN");
    abierta = true;
    const alcance = await conexion.query("SELECT set_config('optima.empresa_id', $1, true) AS empresa_id", [solicitud.empresaId]);
    if (alcance.rows.length !== 1 || alcance.rows[0].empresa_id !== solicitud.empresaId) throw new Error("alcance");

    const leida = await conexion.query(
      `SELECT empresa_id, periodo_hasta, suspendido_desde, cancelado_desde, revision
       FROM optima_comercial.ciclo_vida WHERE empresa_id = $1 FOR UPDATE`, [solicitud.empresaId]);
    let actual: HechosCicloVida | null = null;
    let revisionActual = 0;
    if (leida.rows.length > 1) throw new Error("duplicada");
    if (leida.rows.length === 1) {
      const f = leida.rows[0];
      const h = [aIso(f.periodo_hasta), aIso(f.suspendido_desde), aIso(f.cancelado_desde)];
      const rev = entero(f.revision);
      if (f.empresa_id !== solicitud.empresaId || h.includes(undefined) || rev === null) throw new Error("inconsistente");
      actual = { periodoHasta: h[0] as string | null, suspendidoDesde: h[1] as string | null, canceladoDesde: h[2] as string | null };
      revisionActual = rev;
    }
    if (revisionActual !== revisionEsperada) {
      resultado = rechazo("REVISION_DESACTUALIZADA");
    } else {
      const t = calcularTransicion(actual, solicitud.accion, ahoraIso, solicitud.nuevoPeriodoHasta);
      if (!t.ok) {
        resultado = rechazo(t.motivo);
      } else {
        const nueva = revisionActual + 1;
        if (actual === null) {
          await conexion.query(
            `INSERT INTO optima_comercial.ciclo_vida
               (empresa_id, periodo_hasta, suspendido_desde, cancelado_desde, revision)
             VALUES ($1, $2, $3, $4, $5)`,
            [solicitud.empresaId, t.hechos.periodoHasta, t.hechos.suspendidoDesde, t.hechos.canceladoDesde, nueva]);
        } else {
          const u = await conexion.query(
            `UPDATE optima_comercial.ciclo_vida
             SET periodo_hasta = $2, suspendido_desde = $3, cancelado_desde = $4,
                 revision = $5, actualizado_en = now()
             WHERE empresa_id = $1 AND revision = $6`,
            [solicitud.empresaId, t.hechos.periodoHasta, t.hechos.suspendidoDesde, t.hechos.canceladoDesde, nueva, revisionActual]);
          if (u.rowCount !== 1) throw new Error("concurrencia");
        }
        await conexion.query(
          `INSERT INTO optima_comercial.ciclo_vida_eventos
             (empresa_id, revision_despues, tipo, actor_usuario_id, motivo,
              periodo_hasta_despues, suspendido_desde_despues, cancelado_desde_despues, fecha_evento)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [solicitud.empresaId, nueva, solicitud.accion, actorUsuarioId, solicitud.motivo,
           t.hechos.periodoHasta, t.hechos.suspendidoDesde, t.hechos.canceladoDesde, ahoraIso]);
        await conexion.query("COMMIT");
        abierta = false;
        const ev = evaluarCicloVida(t.hechos, ahoraIso);
        resultado = ev.ok ? { ok: true, revision: nueva, estado: ev.estado, hechos: t.hechos } : rechazo("ERROR_BD");
      }
    }
  } catch {
    resultado = rechazo("ERROR_BD");
  } finally {
    if (conexion) {
      // Todo lo que no terminó en COMMIT se deshace: nunca queda un cambio a medias.
      if (abierta) { try { await conexion.query("ROLLBACK"); } catch { resultado = rechazo("ERROR_BD"); } }
      try { conexion.release(); } catch { /* idem */ }
    }
  }
  return resultado;
}
