/**
 * OPTIMA DA-01 / 12C.19.2: reconstrucción CANÓNICA desde PostgreSQL.
 * Obtiene un snapshot completo y comprueba la huella SHA-256 creada por 12C.18.1.
 * - Solo lectura: no crea contratos ni habilita módulos.
 * - Misma conexión, REPEATABLE READ y SET LOCAL RLS para la empresa del servidor.
 * - Ningún resultado parcial puede autorizar una escritura.
 * - No conectar directamente a HTTP: la empresa debe venir de sesión autenticada.
 * - Antes de usar con BD real: verificar roles SELECT, RLS, backup y aislamiento.
 */
import { createHash } from 'node:crypto';
import type { PoolPgNode183 } from './adaptador-pg-node-12c183.js';
import {
  esHistorialComercialLocalValido,
  type HistorialContratacionSimulado,
  type VersionContratacionSimulada,
  type EventoHistorialSimulado,
} from './historial-contratacion-comercial-12c173.js';
import { validarContrataciones } from './reglas-comerciales.js';
import { CATALOGO_SUBMODULOS_CONTRATACION } from './catalogo-comercial-jerarquico.js';
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

const EMPRESA = /^rec[A-Za-z0-9]{14}$/;
const CONTRATO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const VERSION = /^VER-[A-Za-z0-9_-]{4,60}$/;
const HUella = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAX_VERSIONES = 100;
const MAX_EVENTOS = 200;
const LIMITE_VERSIONES = MAX_VERSIONES + 1;
const LIMITE_EVENTOS = MAX_EVENTOS + 1;

type Fila = Record<string, unknown>;
export type ResultadoReconstruccionPg =
  | Readonly<{ ok: true; historial: HistorialContratacionSimulado; huella: string }>
  | Readonly<{ ok: false; motivo: 'DATOS_INVALIDOS' | 'SIN_CONTRATO' | 'HISTORIAL_INCONSISTENTE' | 'BD_NO_DISPONIBLE' }>;
const fallo = (motivo: Extract<ResultadoReconstruccionPg, { ok: false }>['motivo']): ResultadoReconstruccionPg =>
  ({ ok: false, motivo });

function registro(v: unknown): v is Fila {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function entero(v: unknown, max: number): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  if (typeof v === 'string' && !/^\d{1,16}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : null;
}
function fecha(v: unknown): v is string {
  return typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString() === v;
}

/** Mantener el orden canónico de claves de servicio al convertir JSONB. */
function leerVersion(f: Fila, empresaId: string, idContrato: string, indice: number): VersionContratacionSimulada | null {
  if (f.empresa_id !== empresaId || f.id_contrato !== idContrato ||
      typeof f.id_version !== 'string' || !VERSION.test(f.id_version) ||
      entero(f.numero, MAX_VERSIONES) !== indice + 1 ||
      !['APROBADA', 'VIGENTE', 'HISTORICA'].includes(String(f.estado)) ||
      typeof f.motivo_cambio !== 'string' ||
      typeof f.aprobado_por_id !== 'string' || !EMPRESA.test(f.aprobado_por_id) ||
      !fecha(f.aprobado_en_iso) ||
      (f.vigente_desde_iso !== null && !fecha(f.vigente_desde_iso)) ||
      (f.vigente_hasta_iso !== null && !fecha(f.vigente_hasta_iso)) ||
      (f.sustituida_por_id !== null && (typeof f.sustituida_por_id !== 'string' || !VERSION.test(f.sustituida_por_id)))) {
    return null;
  }
  const servicios = validarContrataciones(f.servicios, CATALOGO_SUBMODULOS_CONTRATACION);
  if (!servicios.ok || servicios.contrataciones.length === 0) return null;
  return {
    idVersion: f.id_version, numero: indice + 1, empresaId, idContrato,
    estado: f.estado as VersionContratacionSimulada['estado'],
    servicios: servicios.contrataciones,
    motivoCambio: f.motivo_cambio,
    aprobadoPorId: f.aprobado_por_id,
    aprobadoEnIso: f.aprobado_en_iso,
    vigenteDesdeIso: f.vigente_desde_iso as string | null,
    vigenteHastaIso: f.vigente_hasta_iso as string | null,
    sustituidaPorId: f.sustituida_por_id as string | null,
  };
}
function leerEvento(f: Fila, empresaId: string, idContrato: string, indice: number): EventoHistorialSimulado | null {
  if (f.empresa_id !== empresaId || f.id_contrato !== idContrato ||
      entero(f.revision_antes, MAX_EVENTOS) !== indice ||
      entero(f.revision_despues, MAX_EVENTOS) !== indice + 1 ||
      (f.tipo !== 'APROBACION' && f.tipo !== 'ACTIVACION') ||
      typeof f.id_version !== 'string' || !VERSION.test(f.id_version) ||
      (f.id_version_anterior !== null && (typeof f.id_version_anterior !== 'string' || !VERSION.test(f.id_version_anterior))) ||
      typeof f.actor_usuario_id !== 'string' || !EMPRESA.test(f.actor_usuario_id) ||
      !fecha(f.fecha_iso)) return null;
  return {
    tipo: f.tipo,
    idVersion: f.id_version,
    idVersionAnterior: f.id_version_anterior as string | null,
    actorUsuarioId: f.actor_usuario_id,
    fechaIso: f.fecha_iso,
  };
}

/** Retorna el estado histórico íntegro, o un rechazo sin compartir registros. */
export async function reconstruirHistorialComercialPg192(
  pool: PoolPgNode183, empresaId: string, idContrato: string,
): Promise<ResultadoReconstruccionPg> {
  if (!esIdEmpresaEstable(empresaId) || !CONTRATO.test(idContrato)) return fallo('DATOS_INVALIDOS');
  let conexion: Awaited<ReturnType<PoolPgNode183['connect']>> | undefined;
  let transaccion = false;
  let cierreValido = true;
  let resultado: ResultadoReconstruccionPg = fallo('BD_NO_DISPONIBLE');
  try {
    conexion = await pool.connect();
    const c = conexion;
    await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaccion = true;
    const alcance = await c.query("SELECT set_config('optima.empresa_id', $1, true) AS empresa_id", [empresaId]);
    if (alcance.rows.length !== 1 || alcance.rows[0].empresa_id !== empresaId) {
      resultado = fallo('HISTORIAL_INCONSISTENTE');
    } else {
      const cabecera = await c.query(`SELECT empresa_id, id_contrato, revision::text AS revision, huella_historial
        FROM optima_comercial.contratos WHERE empresa_id=$1 AND id_contrato=$2 LIMIT 2`, [empresaId, idContrato]);
      if (cabecera.rows.length === 0) {
        resultado = fallo('SIN_CONTRATO');
      } else if (cabecera.rows.length !== 1 || !registro(cabecera.rows[0]) ||
          cabecera.rows[0].empresa_id !== empresaId || cabecera.rows[0].id_contrato !== idContrato) {
        resultado = fallo('HISTORIAL_INCONSISTENTE');
      } else {
        const revision = entero(cabecera.rows[0].revision, MAX_EVENTOS);
        const huella = cabecera.rows[0].huella_historial;
        if (revision === null || typeof huella !== 'string' || !HUella.test(huella)) {
          resultado = fallo('HISTORIAL_INCONSISTENTE');
        } else {
          const v = await c.query(`SELECT empresa_id,id_contrato,id_version,numero,estado,servicios,
            motivo_cambio,aprobado_por_id,
            to_char(aprobado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS aprobado_en_iso,
            CASE WHEN vigente_desde IS NULL THEN NULL ELSE
              to_char(vigente_desde AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS vigente_desde_iso,
            CASE WHEN vigente_hasta IS NULL THEN NULL ELSE
              to_char(vigente_hasta AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS vigente_hasta_iso,
            sustituida_por_id FROM optima_comercial.versiones
            WHERE empresa_id=$1 AND id_contrato=$2 ORDER BY numero ASC LIMIT ${LIMITE_VERSIONES}`,
            [empresaId, idContrato]);
          const e = await c.query(`SELECT empresa_id,id_contrato,revision_antes::text AS revision_antes,
            revision_despues::text AS revision_despues,tipo,id_version,id_version_anterior,actor_usuario_id,
            to_char(fecha_evento AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_iso
            FROM optima_comercial.eventos WHERE empresa_id=$1 AND id_contrato=$2
            ORDER BY revision_despues ASC LIMIT ${LIMITE_EVENTOS}`, [empresaId, idContrato]);
          const versiones: VersionContratacionSimulada[] = [];
          const eventos: EventoHistorialSimulado[] = [];
          if (v.rows.length > MAX_VERSIONES || e.rows.length > MAX_EVENTOS || e.rows.length !== revision) {
            resultado = fallo('HISTORIAL_INCONSISTENTE');
          } else {
            for (const fila of v.rows) {
              const version = leerVersion(fila, empresaId, idContrato, versiones.length);
              if (!version) break;
              versiones.push(version);
            }
            for (const fila of e.rows) {
              const evento = leerEvento(fila, empresaId, idContrato, eventos.length);
              if (!evento) break;
              eventos.push(evento);
            }
            if (versiones.length !== v.rows.length || eventos.length !== e.rows.length) {
              resultado = fallo('HISTORIAL_INCONSISTENTE');
            } else {
              const historial: HistorialContratacionSimulado = {
                empresaId, idContrato, revisionHistorial: revision,
                versiones, eventos, simulacion: true, accesoOperativoHabilitado: false,
              };
              // Nunca confiar en el digest por sí solo: validar también el grafo de eventos.
              const recalculada = createHash('sha256').update(JSON.stringify(historial)).digest('hex');
              resultado = esHistorialComercialLocalValido(historial) && recalculada === huella
                ? { ok: true, historial, huella }
                : fallo('HISTORIAL_INCONSISTENTE');
            }
          }
        }
      }
    }
  } catch {
    resultado = fallo('BD_NO_DISPONIBLE');
  } finally {
    if (conexion) {
      if (transaccion) {
        try { await conexion.query('ROLLBACK'); } catch { cierreValido = false; }
      }
      try { conexion.release(); } catch { cierreValido = false; }
    }
  }
  return cierreValido ? resultado : fallo('BD_NO_DISPONIBLE');
}
