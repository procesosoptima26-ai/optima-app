/**
 * OPTIMA DA-01 / P3D — borrador persistido y aprobación transaccional.
 * Sin rutas HTTP, sin conexión automática y SIN habilitación operativa.
 *
 * Contrato PostgreSQL: migraciones 0001/0002 existentes.
 * Las credenciales y el actor se resuelven en el backend autenticado; esta
 * interfaz NO autentica por sí sola ni puede recibir un usuario del navegador.
 * Prohibido conectar a Production antes de validar PostgreSQL real, RLS,
 * roles mínimos y aprobación explícita de habilitaciones.
 *
 * P3D cubre creación de UN borrador activo por contrato y su APROBACIÓN.
 * La edición posterior del borrador y la suspensión son flujos separados.
 */
import { createHash } from 'node:crypto';
import type { PoolPgNode183 } from './adaptador-pg-node-12c183.js';
import {
  iniciarHistorialComercialLocal,
  aprobarBorradorComercialLocal,
  type HistorialContratacionSimulado,
} from './historial-contratacion-comercial-12c173.js';
import { crearBorradorComercialLocal } from './borradores-contratacion-comercial-12c172.js';
import { reconstruirHistorialComercialPg192 } from './reconstruccion-historial-pg-12c192.js';
import { simularPropuestaComercial } from './simulador-contratacion-comercial-12c17.js';
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

const ID=/^rec[A-Za-z0-9]{14}$/;
const CONTRATO=/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const BORRADOR=/^BOR-[A-Za-z0-9_-]{4,60}$/;
const VERSION=/^VER-[A-Za-z0-9_-]{4,60}$/;
const CLAVE=/^OP-[A-Za-z0-9_-]{8,72}$/;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const SHA=/^[a-f0-9]{64}$/;
type Permiso194='GESTIONAR_BORRADORES'|'APROBAR_CONTRATO';
type Identidad194=Readonly<{verificadaEnServidor:true;usuarioId:string;empresaId:string;permisos:readonly Permiso194[]}>;
export type FuenteIdentidad194=()=>Promise<unknown>;
export type SolicitudBorrador194=Readonly<{
  idContrato:string; idBorrador:string; versionBase:number|null;
  serviciosPropuestos:unknown; motivoCambio:string;
}>;
export type SolicitudAprobacion194=Readonly<{
  idContrato:string;idBorrador:string;idVersion:string;
  revisionHistorialEsperada:number;revisionBorradorEsperada:number;
  claveIdempotencia:string;
}>;
export type Error194='SOLICITUD_INVALIDA'|'SESION_NO_VERIFICADA'|'PERMISO_INSUFICIENTE'|
  'HISTORIAL_NO_VERIFICADO'|'VERSION_BASE_INVALIDA'|'BORRADOR_ACTIVO_EXISTENTE'|
  'BORRADOR_NO_VERIFICADO'|'REVISION_DESACTUALIZADA'|'CONFLICTO_IDEMPOTENCIA'|
  'TRANSICION_INVALIDA'|'ERROR_BD';
export type ResultadoCrear194=Readonly<{ok:true;idBorrador:string;revisionBorrador:1;accesoOperativoHabilitado:false}>|
  Readonly<{ok:false;motivo:Error194;accesoOperativoHabilitado:false}>;
export type ResultadoAprobar194=Readonly<{ok:true;idVersion:string;revisionAplicada:number;repetida:boolean;accesoOperativoHabilitado:false}>|
  Readonly<{ok:false;motivo:Error194;accesoOperativoHabilitado:false}>;
const fallo=(motivo:Error194):{ok:false;motivo:Error194;accesoOperativoHabilitado:false}=>
  ({ok:false,motivo,accesoOperativoHabilitado:false});
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function objeto(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function claves(v:Record<string,unknown>,esperadas:readonly string[]):boolean{
  return Object.keys(v).length===esperadas.length&&esperadas.every(k=>Object.hasOwn(v,k));
}
function fecha(v:unknown):v is string{
  return typeof v==='string'&&ISO.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
}
function entero(v:unknown):number|null{
  if(typeof v!=='string'&&typeof v!=='number')return null;
  if(typeof v==='string'&&!/^\d{1,15}$/.test(v))return null;
  const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:null;
}
function sesionValida(v:unknown):v is Identidad194{
  if(!objeto(v)||!claves(v,['verificadaEnServidor','usuarioId','empresaId','permisos']))return false;
  return v.verificadaEnServidor===true&&typeof v.usuarioId==='string'&&ID.test(v.usuarioId)&&
    typeof v.empresaId==='string'&&esIdEmpresaEstable(v.empresaId)&&Array.isArray(v.permisos)&&
    v.permisos.length>=1&&v.permisos.length<=2&&
    v.permisos.every(p=>p==='GESTIONAR_BORRADORES'||p==='APROBAR_CONTRATO')&&
    new Set(v.permisos).size===v.permisos.length;
}
function solicitudBorradorValida(v:unknown):v is SolicitudBorrador194{
  return objeto(v)&&claves(v,['idContrato','idBorrador','versionBase','serviciosPropuestos','motivoCambio'])&&
    typeof v.idContrato==='string'&&CONTRATO.test(v.idContrato)&&
    typeof v.idBorrador==='string'&&BORRADOR.test(v.idBorrador)&&
    (v.versionBase===null||(typeof v.versionBase==='number'&&Number.isSafeInteger(v.versionBase)&&v.versionBase>0))&&
    typeof v.motivoCambio==='string'&&v.motivoCambio.length>=10&&v.motivoCambio.length<=500&&
    Array.isArray(v.serviciosPropuestos);
}
function solicitudAprobacionValida(v:unknown):v is SolicitudAprobacion194{
  return objeto(v)&&claves(v,['idContrato','idBorrador','idVersion','revisionHistorialEsperada',
      'revisionBorradorEsperada','claveIdempotencia'])&&
    typeof v.idContrato==='string'&&CONTRATO.test(v.idContrato)&&
    typeof v.idBorrador==='string'&&BORRADOR.test(v.idBorrador)&&
    typeof v.idVersion==='string'&&VERSION.test(v.idVersion)&&
    typeof v.claveIdempotencia==='string'&&CLAVE.test(v.claveIdempotencia)&&
    typeof v.revisionHistorialEsperada==='number'&&Number.isSafeInteger(v.revisionHistorialEsperada)&&
    v.revisionHistorialEsperada>=0&&
    typeof v.revisionBorradorEsperada==='number'&&Number.isSafeInteger(v.revisionBorradorEsperada)&&
    v.revisionBorradorEsperada>=1;
}
function normalizarFecha(v:unknown):string|null{
  const n=v instanceof Date?v:typeof v==='string'?new Date(v):null;
  if(!n||!Number.isFinite(n.getTime()))return null;
  const s=n.toISOString();return fecha(s)?s:null;
}
async function identidad(fuente:FuenteIdentidad194,permiso:Permiso194):Promise<Identidad194|Error194>{
  let v:unknown;
  try{v=await fuente();}catch{return 'SESION_NO_VERIFICADA';}
  if(!sesionValida(v))return 'SESION_NO_VERIFICADA';
  return v.permisos.includes(permiso)?v:'PERMISO_INSUFICIENTE';
}
async function fijarEmpresa(c:Awaited<ReturnType<PoolPgNode183['connect']>>,empresaId:string):Promise<boolean>{
  const r=await c.query("SELECT set_config('optima.empresa_id', $1, true) AS empresa_id",[empresaId]);
  return r.rows.length===1&&r.rows[0].empresa_id===empresaId;
}
function versionBase(h:HistorialContratacionSimulado):{version:number|null;servicios:readonly unknown[]}|null{
  if(h.versiones.some(v=>v.estado==='APROBADA'))return null;
  const vigente=h.versiones.find(v=>v.estado==='VIGENTE');
  if(h.versiones.length>0&&!vigente)return null;
  return {version:vigente?.numero??null,servicios:vigente?.servicios??[]};
}
/** Crea un borrador DURABLE con RLS. Nunca activa el contrato. */
export async function crearBorradorContractualPg194(
  pool:PoolPgNode183,fuente:FuenteIdentidad194,solicitud:unknown,
  reloj:()=>string=()=>new Date().toISOString(),
):Promise<ResultadoCrear194>{
  if(!solicitudBorradorValida(solicitud))return fallo('SOLICITUD_INVALIDA');
  const actor=await identidad(fuente,'GESTIONAR_BORRADORES');
  if(typeof actor==='string')return fallo(actor);
  let ahora:string;try{ahora=reloj();}catch{return fallo('SOLICITUD_INVALIDA');}
  if(!fecha(ahora))return fallo('SOLICITUD_INVALIDA');
  const leido=await reconstruirHistorialComercialPg192(pool,actor.empresaId,solicitud.idContrato);
  if(leido.ok===false&&leido.motivo!=='SIN_CONTRATO')return fallo('HISTORIAL_NO_VERIFICADO');
  const nuevoContrato=leido.ok===false;
  const inicial=iniciarHistorialComercialLocal({empresaId:actor.empresaId,idContrato:solicitud.idContrato});
  if(!inicial.ok)return fallo('HISTORIAL_NO_VERIFICADO');
  const historial=leido.ok?leido.historial:inicial.historial;
  const base=versionBase(historial);
  if(!base||base.version!==solicitud.versionBase)return fallo('VERSION_BASE_INVALIDA');
  const borrador=crearBorradorComercialLocal({
    idBorrador:solicitud.idBorrador,empresaId:actor.empresaId,
    idContrato:base.version===null?null:solicitud.idContrato,
    versionBase:base.version,serviciosBase:base.servicios,
    serviciosPropuestos:solicitud.serviciosPropuestos,
    motivoCambio:solicitud.motivoCambio,ahoraIso:ahora,
  });
  if(!borrador.ok)return fallo('SOLICITUD_INVALIDA');
  let c:Awaited<ReturnType<PoolPgNode183['connect']>>|undefined;
  let transaccion=false;let error:Error194|null=null;let terminado=false;
  try{
    c=await pool.connect();await c.query('BEGIN');transaccion=true;
    if(!await fijarEmpresa(c,actor.empresaId)){error='HISTORIAL_NO_VERIFICADO';}
    else{
      if(nuevoContrato){
        await c.query(`INSERT INTO optima_comercial.contratos
          (empresa_id,id_contrato,revision,huella_historial) VALUES ($1,$2,0,$3)
          ON CONFLICT DO NOTHING`,[actor.empresaId,solicitud.idContrato,hash(inicial.historial)]);
      }
      const h=await c.query(`SELECT revision::text AS revision,huella_historial
        FROM optima_comercial.contratos WHERE empresa_id=$1 AND id_contrato=$2 FOR UPDATE`,
        [actor.empresaId,solicitud.idContrato]);
      if(h.rows.length!==1||entero(h.rows[0].revision)!==historial.revisionHistorial||
          h.rows[0].huella_historial!==hash(historial))error='REVISION_DESACTUALIZADA';
      else{
        const activo=await c.query(`SELECT id_borrador FROM optima_comercial.borradores
          WHERE empresa_id=$1 AND id_contrato=$2 AND estado='BORRADOR' LIMIT 2`,
          [actor.empresaId,solicitud.idContrato]);
        if(activo.rows.length!==0)error='BORRADOR_ACTIVO_EXISTENTE';
        else{
          const r=await c.query(`INSERT INTO optima_comercial.borradores
            (empresa_id,id_contrato,id_borrador,revision_borrador,version_base,
             servicios_propuestos,motivo_cambio,estado,creado_por_id,creado_en,actualizado_en)
            VALUES($1,$2,$3,1,$4,$5::jsonb,$6,'BORRADOR',$7,$8,$8)`,
            [actor.empresaId,solicitud.idContrato,solicitud.idBorrador,base.version,
             JSON.stringify(borrador.borrador.serviciosPropuestos),solicitud.motivoCambio,actor.usuarioId,ahora]);
          if(r.rowCount!==1)error='ERROR_BD';
        }
      }
    }
    if(!error){await c.query('COMMIT');transaccion=false;terminado=true;}
  }catch{error='ERROR_BD';}
  finally{if(c){if(transaccion){try{await c.query('ROLLBACK');}catch{error='ERROR_BD';}}
    try{c.release();}catch{error='ERROR_BD';}}}
  return terminado&&!error?
    {ok:true,idBorrador:solicitud.idBorrador,revisionBorrador:1,accesoOperativoHabilitado:false}:
    fallo(error??'ERROR_BD');
}

/**
 * Aprueba únicamente los servicios del BORRADOR EN POSTGRESQL; en una sola
 * transacción inserta versión+evento+idempotencia, actualiza cabecera y marca
 * borrador APROBADO. Un error revierte TODO. No realiza activación.
 */
export async function aprobarBorradorContractualPg194(
  pool:PoolPgNode183,fuente:FuenteIdentidad194,solicitud:unknown,
  reloj:()=>string=()=>new Date().toISOString(),
):Promise<ResultadoAprobar194>{
  if(!solicitudAprobacionValida(solicitud))return fallo('SOLICITUD_INVALIDA');
  const actor=await identidad(fuente,'APROBAR_CONTRATO');
  if(typeof actor==='string')return fallo(actor);
  let ahora:string;try{ahora=reloj();}catch{return fallo('SOLICITUD_INVALIDA');}
  if(!fecha(ahora))return fallo('SOLICITUD_INVALIDA');
  const leido=await reconstruirHistorialComercialPg192(pool,actor.empresaId,solicitud.idContrato);
  if(!leido.ok)return fallo('HISTORIAL_NO_VERIFICADO');
  const inicial=leido.historial;
  const claveHash=hash({
    accion:'APROBAR_BORRADOR',empresaId:actor.empresaId,usuarioId:actor.usuarioId,
    idContrato:solicitud.idContrato,idBorrador:solicitud.idBorrador,
    idVersion:solicitud.idVersion,revisionHistorialEsperada:solicitud.revisionHistorialEsperada,
    revisionBorradorEsperada:solicitud.revisionBorradorEsperada,
    claveIdempotencia:solicitud.claveIdempotencia,
  });
  let c:Awaited<ReturnType<PoolPgNode183['connect']>>|undefined;
  let transaccion=false;let error:Error194|null=null;
  let exito:Extract<ResultadoAprobar194,{ok:true}>|null=null;
  try{
    c=await pool.connect();await c.query('BEGIN');transaccion=true;
    if(!await fijarEmpresa(c,actor.empresaId))error='HISTORIAL_NO_VERIFICADO';
    else{
      const h=await c.query(`SELECT revision::text AS revision,huella_historial
        FROM optima_comercial.contratos WHERE empresa_id=$1 AND id_contrato=$2 FOR UPDATE`,
        [actor.empresaId,solicitud.idContrato]);
      if(h.rows.length!==1||!SHA.test(String(h.rows[0].huella_historial)))error='HISTORIAL_NO_VERIFICADO';
      else{
        // Revisar idempotencia ANTES de la revisión: un reintento exacto no duplica eventos.
        const duplicada=await c.query(`SELECT huella_solicitud,revision_aplicada::text AS revision_aplicada,respuesta
          FROM optima_comercial.idempotencia
          WHERE empresa_id=$1 AND id_contrato=$2 AND clave=$3`,
          [actor.empresaId,solicitud.idContrato,solicitud.claveIdempotencia]);
        if(duplicada.rows.length>1)error='HISTORIAL_NO_VERIFICADO';
        else if(duplicada.rows.length===1){
          const d=duplicada.rows[0],r=d.respuesta;
          if(d.huella_solicitud!==claveHash||!objeto(r)||
              !claves(r,['revisionAplicada','idVersion','tipo'])||r.tipo!=='APROBACION'||
              r.idVersion!==solicitud.idVersion||entero(r.revisionAplicada)===null||
              entero(d.revision_aplicada)!==r.revisionAplicada)error='CONFLICTO_IDEMPOTENCIA';
          else exito={ok:true,idVersion:solicitud.idVersion,revisionAplicada:r.revisionAplicada as number,
            repetida:true,accesoOperativoHabilitado:false};
        }else if(entero(h.rows[0].revision)!==inicial.revisionHistorial||
            h.rows[0].huella_historial!==hash(inicial)||
            solicitud.revisionHistorialEsperada!==inicial.revisionHistorial)error='REVISION_DESACTUALIZADA';
        else{
          const q=await c.query(`SELECT empresa_id,id_contrato,id_borrador,revision_borrador::text AS revision_borrador,
              version_base,servicios_propuestos,motivo_cambio,estado,creado_por_id,creado_en,actualizado_en
            FROM optima_comercial.borradores
            WHERE empresa_id=$1 AND id_contrato=$2 AND id_borrador=$3 FOR UPDATE`,
            [actor.empresaId,solicitud.idContrato,solicitud.idBorrador]);
          if(q.rows.length!==1)error='BORRADOR_NO_VERIFICADO';
          else{
            const f=q.rows[0];const rev=entero(f.revision_borrador);
            const creado=normalizarFecha(f.creado_en),actualizado=normalizarFecha(f.actualizado_en);
            const base=versionBase(inicial);
            if(f.empresa_id!==actor.empresaId||f.id_contrato!==solicitud.idContrato||
                f.id_borrador!==solicitud.idBorrador||f.estado!=='BORRADOR'||
                !base||rev===null||rev<1||rev!==solicitud.revisionBorradorEsperada||
                f.version_base!==base.version||!creado||!actualizado||actualizado<creado||actualizado>ahora||
                typeof f.creado_por_id!=='string'||!ID.test(f.creado_por_id)||
                typeof f.motivo_cambio!=='string')error='BORRADOR_NO_VERIFICADO';
            else{
              const propuesta=simularPropuestaComercial(f.servicios_propuestos);
              const b=propuesta.ok?crearBorradorComercialLocal({
                idBorrador:solicitud.idBorrador,empresaId:actor.empresaId,
                idContrato:base.version===null?null:solicitud.idContrato,
                versionBase:base.version,serviciosBase:base.servicios,
                serviciosPropuestos:propuesta.propuesta,motivoCambio:f.motivo_cambio,ahoraIso:creado,
              }):null;
              if(!b?.ok)error='BORRADOR_NO_VERIFICADO';
              else{
                const guardado={...b.borrador,revisionLocal:rev,actualizadoEnIso:actualizado};
                const aprobacion=aprobarBorradorComercialLocal({
                  historial:inicial,borrador:guardado,empresaId:actor.empresaId,
                  actorUsuarioId:actor.usuarioId,idVersion:solicitud.idVersion,
                  revisionHistorialEsperada:inicial.revisionHistorial,ahoraIso:ahora,
                });
                if(!aprobacion.ok)error='TRANSICION_INVALIDA';
                else{
                  const siguiente=aprobacion.historial;
                  const v=siguiente.versiones[siguiente.versiones.length-1];
                  const e=siguiente.eventos[siguiente.eventos.length-1];
                  const insert=await c.query(`INSERT INTO optima_comercial.versiones
                    (empresa_id,id_contrato,id_version,numero,estado,servicios,motivo_cambio,
                     aprobado_por_id,aprobado_en,vigente_desde,vigente_hasta,sustituida_por_id)
                    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
                    [actor.empresaId,solicitud.idContrato,v.idVersion,v.numero,v.estado,
                     JSON.stringify(v.servicios),v.motivoCambio,v.aprobadoPorId,v.aprobadoEnIso,
                     v.vigenteDesdeIso,v.vigenteHastaIso,v.sustituidaPorId]);
                  if(insert.rowCount!==1)throw Error('Versión no persistida');
                  const evento=await c.query(`INSERT INTO optima_comercial.eventos
                    (empresa_id,id_contrato,revision_antes,revision_despues,tipo,id_version,
                     id_version_anterior,actor_usuario_id,fecha_evento)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                    [actor.empresaId,solicitud.idContrato,inicial.revisionHistorial,siguiente.revisionHistorial,
                     e.tipo,e.idVersion,e.idVersionAnterior,e.actorUsuarioId,e.fechaIso]);
                  if(evento.rowCount!==1)throw Error('Evento no persistido');
                  const actualizadoB=await c.query(`UPDATE optima_comercial.borradores
                    SET estado='APROBADO',actualizado_en=$5
                    WHERE empresa_id=$1 AND id_contrato=$2 AND id_borrador=$3
                      AND revision_borrador=$4 AND estado='BORRADOR'`,
                    [actor.empresaId,solicitud.idContrato,solicitud.idBorrador,rev,ahora]);
                  if(actualizadoB.rowCount!==1)throw Error('Borrador no marcado');
                  const respuesta={revisionAplicada:siguiente.revisionHistorial,idVersion:v.idVersion,tipo:'APROBACION'};
                  const idem=await c.query(`INSERT INTO optima_comercial.idempotencia
                    (empresa_id,id_contrato,clave,huella_solicitud,respuesta,revision_aplicada)
                    VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
                    [actor.empresaId,solicitud.idContrato,solicitud.claveIdempotencia,
                     claveHash,JSON.stringify(respuesta),siguiente.revisionHistorial]);
                  if(idem.rowCount!==1)throw Error('Idempotencia no persistida');
                  const cabecera=await c.query(`UPDATE optima_comercial.contratos
                    SET revision=$3,huella_historial=$4,actualizado_en=now()
                    WHERE empresa_id=$1 AND id_contrato=$2 AND revision=$5 AND huella_historial=$6`,
                    [actor.empresaId,solicitud.idContrato,siguiente.revisionHistorial,hash(siguiente),
                     inicial.revisionHistorial,hash(inicial)]);
                  if(cabecera.rowCount!==1)throw Error('Revisión concurrente');
                  exito={ok:true,idVersion:v.idVersion,revisionAplicada:siguiente.revisionHistorial,
                    repetida:false,accesoOperativoHabilitado:false};
                }
              }
            }
          }
        }
      }
    }
    if(exito&&!error){await c.query('COMMIT');transaccion=false;}
  }catch{error='ERROR_BD';}
  finally{if(c){if(transaccion){try{await c.query('ROLLBACK');}catch{error='ERROR_BD';}}
    try{c.release();}catch{error='ERROR_BD';}}}
  return exito&&!error?exito:fallo(error??'ERROR_BD');
}
