/**
 * OPTIMA DA-01: frontera segura para futuras transacciones contractuales.
 * No registra rutas HTTP. Exige una sesión resuelta en SERVIDOR, lee el estado
 * íntegro desde PostgreSQL, verifica hash/historia y luego reutiliza el writer
 * transaccional 12C.18.1 que valida revisión + hash bajo FOR UPDATE (CAS).
 *
 * Aún NO habilitar en producción: el ciclo contractual, roles y BD aislada
 * requieren la etapa de pruebas reales del DA-01. Un contrato que todavía
 * no existe se rechaza: creación inicial será un flujo distinto.
 */
import type { PoolPgNode183 } from './adaptador-pg-node-12c183.js';
import {
  esHistorialComercialLocalValido,
} from './historial-contratacion-comercial-12c173.js';
import {
  persistirConAutorizacionComercial184,
  type FuenteSesionServidor184,
  type IdentidadServidorComercial184,
  type TransicionParaAutorizar184,
  type ResultadoSeguroComercial184,
} from './seguridad-comercial-pg-12c184.js';
import { reconstruirHistorialComercialPg192 } from './reconstruccion-historial-pg-12c192.js';
import { compararTransicionDeHistorialLocal } from './proyeccion-persistencia-comercial-12c175.js';

export type ResultadoEscrituraVerificada192 = ResultadoSeguroComercial184 |
  Readonly<{ ok: false; motivo: 'SESION_NO_VERIFICADA' | 'HISTORIAL_NO_VERIFICADO' |
    'SIN_CONTRATO' | 'REVISION_DESACTUALIZADA' | 'TRANSICION_INVALIDA'; accesoOperativoHabilitado: false }>;
const ID = /^rec[A-Za-z0-9]{14}$/;
const fallar = (motivo: Extract<ResultadoEscrituraVerificada192, {ok: false}>['motivo']): ResultadoEscrituraVerificada192 =>
  ({ ok: false, motivo, accesoOperativoHabilitado: false });

function sesionApta(v: unknown): v is IdentidadServidorComercial184 {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  return Object.keys(s).length === 4 && s.verificadaEnServidor === true &&
    typeof s.usuarioId === 'string' && ID.test(s.usuarioId) &&
    typeof s.empresaId === 'string' && ID.test(s.empresaId) &&
    Array.isArray(s.permisos) && s.permisos.length > 0 && s.permisos.length <= 2 &&
    s.permisos.every(p => p === 'APROBAR_CONTRATO' || p === 'ACTIVAR_CONTRATO') &&
    new Set(s.permisos).size === s.permisos.length;
}

/** Nunca acepta el "estado anterior" del navegador como autoridad de escritura. */
export async function persistirCambioComercialVerificado192(
  pool: PoolPgNode183,
  resolverSesion: FuenteSesionServidor184,
  transicion: TransicionParaAutorizar184,
): Promise<ResultadoEscrituraVerificada192> {
  if (!transicion || !esHistorialComercialLocalValido(transicion.anterior) ||
      !esHistorialComercialLocalValido(transicion.siguiente)) return fallar('TRANSICION_INVALIDA');
  let sesion: unknown;
  try { sesion = await resolverSesion(); }
  catch { return fallar('SESION_NO_VERIFICADA'); }
  if (!sesionApta(sesion) ||
      transicion.anterior.empresaId !== sesion.empresaId ||
      transicion.siguiente.empresaId !== sesion.empresaId ||
      transicion.anterior.idContrato !== transicion.siguiente.idContrato) {
    return fallar('SESION_NO_VERIFICADA');
  }
  const evento = transicion.siguiente.eventos.at(-1);
  const requerido = evento?.tipo === 'APROBACION' ? 'APROBAR_CONTRATO' :
    evento?.tipo === 'ACTIVACION' ? 'ACTIVAR_CONTRATO' : null;
  if (!requerido || !sesion.permisos.includes(requerido) || evento?.actorUsuarioId !== sesion.usuarioId) {
    return fallar('SESION_NO_VERIFICADA');
  }
  const actual = await reconstruirHistorialComercialPg192(
    pool, sesion.empresaId, transicion.anterior.idContrato,
  );
  if (actual.ok === false) {
    return fallar(actual.motivo === 'SIN_CONTRATO' ? 'SIN_CONTRATO' : 'HISTORIAL_NO_VERIFICADO');
  }
  if (JSON.stringify(actual.historial) !== JSON.stringify(transicion.anterior)) {
    return fallar('REVISION_DESACTUALIZADA');
  }
  const transicionValida = compararTransicionDeHistorialLocal({
    anterior: actual.historial, siguiente: transicion.siguiente,
    empresaId: sesion.empresaId, revisionAnteriorEsperada: actual.historial.revisionHistorial,
  });
  if (transicionValida.ok === false) return fallar('TRANSICION_INVALIDA');
  // El repositorio vuelve a comparar revisión y huella bajo FOR UPDATE.
  // Una modificación concurrente entre lectura y escritura se rechaza por CAS.
  return persistirConAutorizacionComercial184(pool, async () => sesion, {
    ...transicion, anterior: actual.historial,
  });
}
