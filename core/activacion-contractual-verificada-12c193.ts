/**
 * OPTIMA DA-01 / P3C — Activación contractual construida íntegramente en servidor.
 *
 * NO es un endpoint y NO está habilitada en Production.
 * Solo recibe la intención mínima del operador. Empresa y actor proceden de una
 * sesión verificada por la capa servidora, nunca del body del navegador.
 * Lee PostgreSQL con RLS, deriva el siguiente historial con el motor validado y
 * escribe con CAS + idempotencia transaccional del repositorio 12C.18.1.
 * La aprobación de borradores persistidos y la creación inicial son otros flujos:
 * no se simulan ni se autorizan desde este módulo.
 */
import type { PoolPgNode183 } from './adaptador-pg-node-12c183.js';
import {
  activarVersionComercialLocal,
} from './historial-contratacion-comercial-12c173.js';
import { reconstruirHistorialComercialPg192 } from './reconstruccion-historial-pg-12c192.js';
import {
  persistirCambioComercialVerificado192,
  type ResultadoEscrituraVerificada192,
} from './escritura-comercial-verificada-12c192.js';
import type { FuenteSesionServidor184, IdentidadServidorComercial184 } from './seguridad-comercial-pg-12c184.js';
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const CONTRATO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const VERSION = /^VER-[A-Za-z0-9_-]{4,60}$/;
const CLAVE = /^OP-[A-Za-z0-9_-]{8,72}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

export type IntencionActivacion193 = Readonly<{
  idContrato: string;
  idVersion: string;
  claveIdempotencia: string;
}>;

export type ResultadoActivacion193 =
  | Extract<ResultadoEscrituraVerificada192, {ok: true}>
  | Readonly<{ ok: false;
      motivo: 'SOLICITUD_INVALIDA' | 'SESION_NO_VERIFICADA' | 'PERMISO_INSUFICIENTE' |
        'CONTRATO_NO_VERIFICADO' | 'VERSION_NO_APROBADA' | 'SEPARACION_FUNCIONES' |
        'FECHA_INVALIDA' | 'TRANSICION_INVALIDA' | 'ERROR_BD' | 'CONFLICTO_CONCURRENCIA';
      accesoOperativoHabilitado: false }>;

const error = (motivo: Extract<ResultadoActivacion193,{ok:false}>['motivo']): ResultadoActivacion193 =>
  ({ok:false,motivo,accesoOperativoHabilitado:false});

function objeto(v: unknown): v is Record<string,unknown> {
  return v!==null && typeof v==='object' && !Array.isArray(v);
}
function solicitudValida(v: unknown): v is IntencionActivacion193 {
  return objeto(v) && Object.keys(v).length===3 &&
    Object.hasOwn(v,'idContrato') && Object.hasOwn(v,'idVersion') &&
    Object.hasOwn(v,'claveIdempotencia') &&
    typeof v.idContrato==='string' && CONTRATO.test(v.idContrato) &&
    typeof v.idVersion==='string' && VERSION.test(v.idVersion) &&
    typeof v.claveIdempotencia==='string' && CLAVE.test(v.claveIdempotencia);
}
function sesionValida(v: unknown): v is IdentidadServidorComercial184 {
  return objeto(v) && Object.keys(v).length===4 &&
    v.verificadaEnServidor===true && typeof v.usuarioId==='string' && ID.test(v.usuarioId) &&
    typeof v.empresaId==='string' && esIdEmpresaEstable(v.empresaId) &&
    Array.isArray(v.permisos) && v.permisos.length<=2 &&
    v.permisos.every(p=>p==='APROBAR_CONTRATO'||p==='ACTIVAR_CONTRATO') &&
    new Set(v.permisos).size===v.permisos.length;
}
function fechaValida(v: unknown): v is string {
  return typeof v==='string' && ISO.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
}

/**
 * La función resolverSesion debe provenir del adaptador backend autenticado.
 * El reloj se inyecta SOLO desde código de servidor para permitir pruebas.
 * Una llamada HTTP no debe aceptar ni resolverSesion ni reloj desde el cliente.
 */
export async function activarContratoDesdeServidor193(
  pool: PoolPgNode183,
  resolverSesion: FuenteSesionServidor184,
  intencion: unknown,
  relojServidor: () => string = () => new Date().toISOString(),
): Promise<ResultadoActivacion193> {
  if (!solicitudValida(intencion)) return error('SOLICITUD_INVALIDA');
  let identidad: unknown;
  try { identidad=await resolverSesion(); }
  catch { return error('SESION_NO_VERIFICADA'); }
  if (!sesionValida(identidad)) return error('SESION_NO_VERIFICADA');
  if (!identidad.permisos.includes('ACTIVAR_CONTRATO')) return error('PERMISO_INSUFICIENTE');

  let ahoraIso: string;
  try { ahoraIso=relojServidor(); }
  catch { return error('FECHA_INVALIDA'); }
  if (!fechaValida(ahoraIso)) return error('FECHA_INVALIDA');

  const actual=await reconstruirHistorialComercialPg192(pool, identidad.empresaId, intencion.idContrato);
  if (actual.ok===false) return error('CONTRATO_NO_VERIFICADO');
  const version=actual.historial.versiones.find(v=>v.idVersion===intencion.idVersion);
  if (!version || version.estado!=='APROBADA') return error('VERSION_NO_APROBADA');
  if (version.aprobadoPorId===identidad.usuarioId) return error('SEPARACION_FUNCIONES');

  const proyectado=activarVersionComercialLocal({
    historial:actual.historial,
    empresaId:identidad.empresaId,
    actorUsuarioId:identidad.usuarioId,
    idVersion:intencion.idVersion,
    revisionHistorialEsperada:actual.historial.revisionHistorial,
    ahoraIso,
  });
  if (proyectado.ok===false) return error('TRANSICION_INVALIDA');

  // Relectura contra PostgreSQL y escritura bajo FOR UPDATE/CAS. Jamás confiar
  // únicamente en la proyección previa: otro operador pudo modificar el contrato.
  const resultado=await persistirCambioComercialVerificado192(pool,
    async()=>identidad,{
      anterior:actual.historial,
      siguiente:proyectado.historial,
      claveIdempotencia:intencion.claveIdempotencia,
    });
  if (resultado.ok===true) return resultado;
  if (resultado.motivo==='REVISION_DESACTUALIZADA' || resultado.motivo==='ESTADO_DIVERGENTE')
    return error('CONFLICTO_CONCURRENCIA');
  if (resultado.motivo==='ERROR_BD') return error('ERROR_BD');
  return error('TRANSICION_INVALIDA');
}
