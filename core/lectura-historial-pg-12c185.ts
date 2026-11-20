/** OPTIMA 12C.18.5 — Lectura CANÓNICA de historial comercial PostgreSQL.
 * Read-only, sin endpoints ni credenciales; SQL siempre parametrizado.
 * Requiere rol NO privilegiado con RLS y sesión de empresa autorizada por backend.
 * No expone servicios, precios, idempotencia ni datos económicos.
 * NO modifica habilitaciones técnicas de OPTIMA.
 */
import type { PoolPgNode183 } from './adaptador-pg-node-12c183.js';
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const CONTRATO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const VERSION = /^VER-[A-Za-z0-9_-]{4,60}$/;
const BORRADOR = /^[A-Za-z0-9][A-Za-z0-9_-]{2,119}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAX_FILAS = 100;
const APROBACION = new Set(['APROBACION', 'ACTIVACION']);
const ESTADOS = new Set(['APROBADA','VIGENTE','HISTORICA']);
const BORRADOR_ESTADOS = new Set(['BORRADOR','DESCARTADO','APROBADO']);

type VersionVista = Readonly<{
  idVersion:string; numero:number; estado:'APROBADA'|'VIGENTE'|'HISTORICA';
  aprobadoPorId:string; aprobadoEn:string; vigenteDesde:string|null;
  vigenteHasta:string|null; cantidadServicios:number;
}>;
type EventoVista = Readonly<{
  revisionAntes:number; revisionDespues:number; tipo:'APROBACION'|'ACTIVACION';
  idVersion:string; actorUsuarioId:string; fecha:string;
}>;
type BorradorVista = Readonly<{idBorrador:string; revision:number; estado:'BORRADOR'|'DESCARTADO'|'APROBADO'}>;
export type VistaHistorialComercial185 = Readonly<{
  empresaId:string; idContrato:string; revision:number;
  versiones:readonly VersionVista[]; eventos:readonly EventoVista[]; borradores:readonly BorradorVista[];
  soloConsulta:true; accesoOperativoHabilitado:false;
}>;
export type ResultadoLecturaHistorial185 =
 | Readonly<{ok:true; historial:VistaHistorialComercial185}>
 | Readonly<{ok:false; motivo:'DATOS_INVALIDOS'|'NO_ENCONTRADO'|'HISTORIAL_INCONSISTENTE'|'ERROR_BD'; accesoOperativoHabilitado:false}>;
const fallo=(motivo:Extract<ResultadoLecturaHistorial185,{ok:false}>['motivo']):ResultadoLecturaHistorial185=>
  ({ok:false,motivo,accesoOperativoHabilitado:false});
function entero(v:unknown):number|null {
  if(typeof v!=='number'&&!(typeof v==='string'&&/^\d{1,16}$/.test(v)))return null;
  const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:null;
}
function fecha(v:unknown): v is string {return typeof v==='string'&&ISO.test(v)&&!Number.isNaN(Date.parse(v));}
function objeto(v:unknown):v is Record<string,unknown> {return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function exactamenteUna(r:readonly Record<string,unknown>[]):boolean {return r.length===1;}
function versionesValidas(rows:readonly Record<string,unknown>[]):VersionVista[]|null {
  if(rows.length>MAX_FILAS)return null;
  const out:VersionVista[]=[];let num=0;let vigentes=0;let aprobadas=0;
  for(const v of rows){
    const n=entero(v.numero),c=entero(v.cantidad_servicios);
    if(!VERSION.test(String(v.id_version))||n===null||n!==num+1||c===null||
      !ESTADOS.has(String(v.estado))||typeof v.aprobado_por_id!=='string'||!ID.test(v.aprobado_por_id)||
      !fecha(v.aprobado_en_iso)||(v.vigente_desde_iso!==null&&!fecha(v.vigente_desde_iso))||
      (v.vigente_hasta_iso!==null&&!fecha(v.vigente_hasta_iso)))return null;
    if(v.estado==='VIGENTE')vigentes++;
    if(v.estado==='APROBADA')aprobadas++;
    if(v.estado==='APROBADA'&&(v.vigente_desde_iso!==null||v.vigente_hasta_iso!==null))return null;
    if(v.estado==='VIGENTE'&&(v.vigente_desde_iso===null||v.vigente_hasta_iso!==null))return null;
    if(v.estado==='HISTORICA'&&(v.vigente_desde_iso===null||v.vigente_hasta_iso===null))return null;
    out.push({idVersion:v.id_version as string,numero:n,estado:v.estado as VersionVista['estado'],
      aprobadoPorId:v.aprobado_por_id,aprobadoEn:v.aprobado_en_iso,
      vigenteDesde:v.vigente_desde_iso as string|null,vigenteHasta:v.vigente_hasta_iso as string|null,
      cantidadServicios:c});num=n;
  }
  return vigentes>1||aprobadas>1?null:out;
}
function eventosValidos(rows:readonly Record<string,unknown>[],versiones:readonly VersionVista[],revision:number):EventoVista[]|null {
  if(rows.length>MAX_FILAS||rows.length!==revision)return null;
  const out:EventoVista[]=[];
  for(const r of rows){
    const a=entero(r.revision_antes),d=entero(r.revision_despues);
    if(a===null||d===null||a!==out.length||d!==a+1||
      !APROBACION.has(String(r.tipo))||!VERSION.test(String(r.id_version))||
      !versiones.some(v=>v.idVersion===r.id_version)||
      typeof r.actor_usuario_id!=='string'||!ID.test(r.actor_usuario_id)||!fecha(r.fecha_iso))return null;
    out.push({revisionAntes:a,revisionDespues:d,tipo:r.tipo as EventoVista['tipo'],
      idVersion:r.id_version as string,actorUsuarioId:r.actor_usuario_id,fecha:r.fecha_iso});
  }
  return out;
}
function borradoresValidos(rows:readonly Record<string,unknown>[]):BorradorVista[]|null {
  if(rows.length>MAX_FILAS)return null;
  const out:BorradorVista[]=[];
  for(const r of rows){
    const n=entero(r.revision_borrador);
    if(!BORRADOR.test(String(r.id_borrador))||n===null||n<1||
      !BORRADOR_ESTADOS.has(String(r.estado)))return null;
    out.push({idBorrador:r.id_borrador as string,revision:n,estado:r.estado as BorradorVista['estado']});
  }
  return out;
}

/** La misma conexión usa una transacción REPEATABLE READ READ ONLY y SET LOCAL.
 * ROL runtime: sin SUPERUSER, sin BYPASSRLS, no propietario y con GRANT SELECT.
 * Si algo falla, no devuelve datos parciales ni mensajes SQL.
 */
export async function leerHistorialComercialPg185(
  pool:PoolPgNode183, empresaId:string, idContrato:string,
):Promise<ResultadoLecturaHistorial185> {
  if(!esIdEmpresaEstable(empresaId)||!CONTRATO.test(idContrato))return fallo('DATOS_INVALIDOS');
  let conexion:Awaited<ReturnType<PoolPgNode183['connect']>>|undefined;
  let transaccion=false;
  let inconsistente=false;
  try {
    conexion=await pool.connect();
    const c=conexion;
    await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    transaccion=true;
    await c.query("SELECT set_config('optima.empresa_id', $1, true)",[empresaId]);
    const cabecera=await c.query(`SELECT empresa_id,id_contrato,revision::text AS revision
      FROM optima_comercial.contratos WHERE empresa_id=$1 AND id_contrato=$2 LIMIT 2`,[empresaId,idContrato]);
    if(cabecera.rows.length===0){await c.query('ROLLBACK');transaccion=false;return fallo('NO_ENCONTRADO');}
    if(!exactamenteUna(cabecera.rows)||!objeto(cabecera.rows[0])||
      cabecera.rows[0].empresa_id!==empresaId||cabecera.rows[0].id_contrato!==idContrato)
      {inconsistente=true;throw Error('Cabecera inesperada');}
    const revision=entero(cabecera.rows[0].revision);
    if(revision===null||revision>MAX_FILAS){inconsistente=true;throw Error('Revision invalida');}
    const rVersiones=await c.query(`SELECT id_version,numero,estado,aprobado_por_id,
      to_char(aprobado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS aprobado_en_iso,
      CASE WHEN vigente_desde IS NULL THEN NULL ELSE
        to_char(vigente_desde AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS vigente_desde_iso,
      CASE WHEN vigente_hasta IS NULL THEN NULL ELSE
        to_char(vigente_hasta AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS vigente_hasta_iso,
      jsonb_array_length(servicios) AS cantidad_servicios
      FROM optima_comercial.versiones WHERE empresa_id=$1 AND id_contrato=$2
      ORDER BY numero ASC LIMIT 101`,[empresaId,idContrato]);
    const versiones=versionesValidas(rVersiones.rows);
    if(!versiones){inconsistente=true;throw Error('Versiones invalidas');}
    const rEventos=await c.query(`SELECT revision_antes::text AS revision_antes,
      revision_despues::text AS revision_despues,tipo,id_version,actor_usuario_id,
      to_char(fecha_evento AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_iso
      FROM optima_comercial.eventos WHERE empresa_id=$1 AND id_contrato=$2
      ORDER BY revision_despues ASC LIMIT 101`,[empresaId,idContrato]);
    const eventos=eventosValidos(rEventos.rows,versiones,revision);
    if(!eventos){inconsistente=true;throw Error('Eventos invalidos');}
    const rBorradores=await c.query(`SELECT id_borrador,revision_borrador::text AS revision_borrador,estado
      FROM optima_comercial.borradores WHERE empresa_id=$1 AND id_contrato=$2
      ORDER BY creado_en ASC, id_borrador ASC LIMIT 101`,[empresaId,idContrato]);
    const borradores=borradoresValidos(rBorradores.rows);
    if(!borradores){inconsistente=true;throw Error('Borradores invalidos');}
    await c.query('ROLLBACK');transaccion=false;
    return {ok:true,historial:{empresaId,idContrato,revision,versiones,eventos,borradores,
      soloConsulta:true,accesoOperativoHabilitado:false}};
  }catch{
    if(transaccion&&conexion){try{await conexion.query('ROLLBACK');}catch{/* fallo cerrado */}}
    return fallo(inconsistente?'HISTORIAL_INCONSISTENTE':'ERROR_BD');
  }finally{if(conexion){try{conexion.release();}catch{/* no revelar */}}}
}
