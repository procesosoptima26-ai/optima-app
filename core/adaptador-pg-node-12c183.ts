/**
 * OPTIMA 12C.18.3 - adaptación mínima para un pool PostgreSQL de Node.
 *
 * Este módulo NO abre conexiones, NO usa variables de entorno ni registra rutas.
 * Recibe un pool proporcionado externamente y presta UNA conexión dedicada
 * durante la transacción del repositorio 12C.18.1.
 *
 * Todavía NO constituye un endpoint seguro: los historiales provienen de
 * simulaciones y la identidad no se obtiene de una sesión autenticada.
 * NO habilitar para tráfico operativo sin implementar 12C.18.4 y posteriores.
 */
import {
  persistirPasoComercialPg12C181,
  type ClientePostgresDedicado,
  type RespuestaSql,
  type ResultadoGuardadoComercialPg,
  type SolicitudGuardadoComercialPg,
} from './repositorio-comercial-pg-12c181.js';

export interface ConexionPgNode183 {
  query(sql: string, parametros?: unknown[]): Promise<{
    rows: readonly Record<string, unknown>[];
    rowCount: number | null;
  }>;
  release(): void;
}

export interface PoolPgNode183 {
  connect(): Promise<ConexionPgNode183>;
}

/** Una conexión por llamada: nunca ejecutar BEGIN/COMMIT con pool.query(). */
export async function persistirConPoolPgNode12C183(
  pool: PoolPgNode183,
  solicitud: SolicitudGuardadoComercialPg,
): Promise<ResultadoGuardadoComercialPg> {
  let conexion: ConexionPgNode183 | undefined;
  try {
    conexion = await pool.connect();
    const actual = conexion;
    const cliente: ClientePostgresDedicado = {
      query: async <T extends object = Record<string, unknown>>(
        sql: string, parametros?: readonly unknown[],
      ): Promise<RespuestaSql<T>> => {
        const resultado = await actual.query(sql, parametros ? [...parametros] : []);
        return { rows: resultado.rows as readonly T[], rowCount: resultado.rowCount };
      },
    };
    return await persistirPasoComercialPg12C181(cliente, solicitud);
  } catch {
    return { ok: false, motivo: 'ERROR_BD', accesoOperativoHabilitado: false };
  } finally {
    if (conexion) {
      try { conexion.release(); } catch { /* no exponer detalles de driver */ }
    }
  }
}
