/**
 * OPTIMA 12C.18.4 — Puerta de autorización y contexto RLS de PostgreSQL.
 *
 * NO ES UN ENDPOINT. `resolverSesion` DEBE consultar la sesión autenticada
 * del backend, nunca un objeto recibido del navegador. El booleano
 * `verificadaEnServidor` es un contrato entre capas, NO autentica por sí solo.
 *
 * Todavía no apto para producción: las instantáneas anterior/siguiente son
 * simuladas. Un backend futuro DEBE reconstruir el historial desde PostgreSQL
 * dentro de una lectura autorizada antes de persistir, validar permisos
 * contra la fuente canónica, y usar rol BD sin BYPASSRLS/propiedad del esquema.
 * Nunca concede módulos o acceso operativo al aprobar un contrato.
 */
import { persistirConPoolPgNode12C183, type PoolPgNode183 } from './adaptador-pg-node-12c183.js';
import type { HistorialContratacionSimulado } from './historial-contratacion-comercial-12c173.js';
import { esHistorialComercialLocalValido } from './historial-contratacion-comercial-12c173.js';
import type { SolicitudGuardadoComercialPg, ResultadoGuardadoComercialPg } from './repositorio-comercial-pg-12c181.js';

export type PermisoComercial184 = 'APROBAR_CONTRATO' | 'ACTIVAR_CONTRATO';
/** ÚNICAMENTE datos devueltos por la capa confiable de autenticación. */
export type IdentidadServidorComercial184 = Readonly<{
  verificadaEnServidor: true;
  usuarioId: string;
  empresaId: string;
  permisos: readonly PermisoComercial184[];
}>;
export type FuenteSesionServidor184 = () => Promise<unknown>;
/** No acepta actorServidorId desde el cliente: se deriva de la sesión real. */
export type TransicionParaAutorizar184 = Readonly<{
  anterior: HistorialContratacionSimulado;
  siguiente: HistorialContratacionSimulado;
  claveIdempotencia: string;
}>;
export type RechazoSeguridad184 = 'SESION_NO_VERIFICADA' | 'EMPRESA_AJENA' |
  'PERMISO_INSUFICIENTE' | 'IDENTIDAD_NO_COINCIDE' |
  'SEPARACION_FUNCIONES' | 'TRANSICION_INVALIDA' | 'ERROR_AUTORIZACION';
export type ResultadoSeguroComercial184 = ResultadoGuardadoComercialPg |
  Readonly<{ ok: false; motivo: RechazoSeguridad184; accesoOperativoHabilitado: false }>;

const ID = /^rec[A-Za-z0-9]{14}$/;
const CLAVE = /^OP-[A-Za-z0-9_-]{8,72}$/;
const FALLO = (motivo: RechazoSeguridad184): ResultadoSeguroComercial184 =>
  Object.freeze({ ok: false, motivo, accesoOperativoHabilitado: false });
const PERMISOS: readonly PermisoComercial184[] = ['APROBAR_CONTRATO', 'ACTIVAR_CONTRATO'];

function identidadValida(valor: unknown): valor is IdentidadServidorComercial184 {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const v = valor as Record<string, unknown>;
  return Object.keys(v).length === 4 && v.verificadaEnServidor === true &&
    typeof v.usuarioId === 'string' && ID.test(v.usuarioId) &&
    typeof v.empresaId === 'string' && ID.test(v.empresaId) &&
    Array.isArray(v.permisos) && v.permisos.length <= PERMISOS.length &&
    v.permisos.every(p => typeof p === 'string' && PERMISOS.includes(p as PermisoComercial184)) &&
    new Set(v.permisos).size === v.permisos.length;
}

/**
 * Prepara un guardia de lectura/ejecución que fija el tenant sólo después de
 * BEGIN y en la MISMA conexión transaccional del repositorio anterior.
 * PostgreSQL SET LOCAL (set_config true) desaparece al COMMIT/ROLLBACK.
 * El rol SQL tiene que estar configurado SIN SUPERUSER ni BYPASSRLS.
 */
export function poolLimitadoAEmpresa184(pool: PoolPgNode183, empresaId: string): PoolPgNode183 {
  if (!ID.test(empresaId)) throw Error('Empresa inválida');
  return {
    connect: async () => {
      const conexion = await pool.connect();
      return {
        query: async (sql: string, parametros?: unknown[]) => {
          if (sql === 'BEGIN') {
            const inicio = await conexion.query(sql, parametros);
            try {
              await conexion.query("SELECT set_config('optima.empresa_id', $1, true)", [empresaId]);
            } catch (error) {
              try { await conexion.query('ROLLBACK'); } catch { /* el repositorio falla cerrado */ }
              throw error;
            }
            return inicio;
          }
          return conexion.query(sql, parametros);
        },
        release: () => conexion.release(),
      };
    },
  };
}

/**
 * Control PREVIO sin efectos ante accesos ajenos; el repositorio mantiene el
 * bloqueo de escritura, idempotencia y separación entre aprobador/activador.
 * No integrar en rutas HTTP hasta tener sesión y lectura canónica de BD.
 */
export async function persistirConAutorizacionComercial184(
  pool: PoolPgNode183,
  resolverSesion: FuenteSesionServidor184,
  transicion: TransicionParaAutorizar184,
): Promise<ResultadoSeguroComercial184> {
  if (!transicion || typeof transicion !== 'object' ||
      typeof transicion.claveIdempotencia !== 'string' ||
      !CLAVE.test(transicion.claveIdempotencia) ||
      !esHistorialComercialLocalValido(transicion.anterior) ||
      !esHistorialComercialLocalValido(transicion.siguiente)) return FALLO('TRANSICION_INVALIDA');
  if (transicion.anterior.empresaId !== transicion.siguiente.empresaId ||
      transicion.anterior.idContrato !== transicion.siguiente.idContrato)
    return FALLO('TRANSICION_INVALIDA');

  let sesion: unknown;
  try { sesion = await resolverSesion(); }
  catch { return FALLO('ERROR_AUTORIZACION'); }
  if (!identidadValida(sesion)) return FALLO('SESION_NO_VERIFICADA');
  if (sesion.empresaId !== transicion.anterior.empresaId) return FALLO('EMPRESA_AJENA');
  const evento = transicion.siguiente.eventos.at(-1);
  if (!evento || (evento.tipo !== 'APROBACION' && evento.tipo !== 'ACTIVACION'))
    return FALLO('TRANSICION_INVALIDA');
  if (evento.actorUsuarioId !== sesion.usuarioId) return FALLO('IDENTIDAD_NO_COINCIDE');
  const requerido: PermisoComercial184 = evento.tipo === 'APROBACION' ? 'APROBAR_CONTRATO' : 'ACTIVAR_CONTRATO';
  if (!sesion.permisos.includes(requerido)) return FALLO('PERMISO_INSUFICIENTE');
  const destino = transicion.siguiente.versiones.find(v => v.idVersion === evento.idVersion);
  if (!destino) return FALLO('TRANSICION_INVALIDA');
  if (evento.tipo === 'ACTIVACION' && destino.aprobadoPorId === sesion.usuarioId)
    return FALLO('SEPARACION_FUNCIONES');
  const solicitud: SolicitudGuardadoComercialPg = {
    ...transicion,
    actorServidorId: sesion.usuarioId,
  };
  return persistirConPoolPgNode12C183(poolLimitadoAEmpresa184(pool, sesion.empresaId), solicitud);
}
