/**
 * OPTIMA DA-01 / P3G — puente HTTP limitado para contratos comerciales.
 * SOLO Preview y SOLO bajo habilitación explícita. Ninguna llamada concede módulos.
 * Actor/empresa autorizada se obtienen del servidor; nunca desde el body.
 */
import type {PoolPgNode183} from '../../core/adaptador-pg-node-12c183.js';
import {crearBorradorContractualPg194,aprobarBorradorContractualPg194} from
  '../../core/borradores-aprobacion-pg-12c194.js';
import {activarContratoDesdeServidor193} from '../../core/activacion-contractual-verificada-12c193.js';
import {crearFuenteContratoReal195,verificarAccesoComercialReal195} from
  '../../lib/sesion-comercial-real-12c195.js';
import type {PermisoContrato195,PeticionSesion195,ResultadoAccesoReal195} from
  '../../lib/sesion-comercial-real-12c195.js';
import {crearPoolComercialEscritura197} from '../../lib/pool-escritura-comercial-12c197.js';

const ID=/^rec[A-Za-z0-9]{14}$/;
const MAX_BYTES=65536;
export type AccionContrato197='contrato_borrador'|'contrato_aprobar'|'contrato_activar';
export type PeticionContrato197=PeticionSesion195 & Readonly<{
  method?:string;query?:Record<string,unknown>;body?:unknown;
  headers?:Record<string,string|string[]|undefined>;
}>;
export type RespuestaContrato197={
  setHeader(nombre:string,valor:string):unknown;
  status(codigo:number):{json(datos:unknown):unknown};
};
type ResultadoOperacion197=Readonly<{ok:boolean;motivo?:string;accesoOperativoHabilitado:false}>;
export type DependenciasContrato197=Readonly<{
  habilitada():boolean;
  origenPermitido():string;
  verificar(req:PeticionContrato197,empresaId:string,permiso:PermisoContrato195):
    Promise<ResultadoAccesoReal195>;
  fuente(req:PeticionContrato197,empresaId:string,permiso:
    'GESTIONAR_BORRADORES'|'APROBAR_CONTRATO'|'ACTIVAR_CONTRATO'):()=>Promise<unknown>;
  pool():PoolPgNode183;
  crear(pool:PoolPgNode183,fuente:()=>Promise<unknown>,solicitud:unknown):
    Promise<ResultadoOperacion197>;
  aprobar(pool:PoolPgNode183,fuente:()=>Promise<unknown>,solicitud:unknown):
    Promise<ResultadoOperacion197>;
  activar(pool:PoolPgNode183,fuente:()=>Promise<unknown>,solicitud:unknown):
    Promise<ResultadoOperacion197>;
}>;

const REQUERIDOS:Readonly<Record<AccionContrato197,readonly string[]>>={
  contrato_borrador:['idContrato','idBorrador','versionBase','serviciosPropuestos','motivoCambio'],
  contrato_aprobar:['idContrato','idBorrador','idVersion','revisionHistorialEsperada',
    'revisionBorradorEsperada','claveIdempotencia'],
  contrato_activar:['idContrato','idVersion','claveIdempotencia'],
};
const PERMISO:Readonly<Record<AccionContrato197,
  'GESTIONAR_BORRADORES'|'APROBAR_CONTRATO'|'ACTIVAR_CONTRATO'>>={
  contrato_borrador:'GESTIONAR_BORRADORES',
  contrato_aprobar:'APROBAR_CONTRATO',
  contrato_activar:'ACTIVAR_CONTRATO',
};
function solicitudEstructuralValida(accion:AccionContrato197,body:unknown):boolean{
  if(typeof body!=='object'||body===null||Array.isArray(body))return false;
  const obj=body as Record<string,unknown>;
  const esperadas=REQUERIDOS[accion];
  const claves=Object.keys(obj);
  if(claves.length!==esperadas.length||claves.some(k=>!esperadas.includes(k)))return false;
  try{return Buffer.byteLength(JSON.stringify(body),'utf8')<=MAX_BYTES;}catch{return false;}
}
function origenValido(req:PeticionContrato197,esperado:string):boolean{
  const origin=req.headers?.origin;
  if(typeof origin!=='string'||typeof esperado!=='string')return false;
  try{
    const solicitado=new URL(origin),permitido=new URL(esperado);
    return solicitado.protocol==='https:'&&permitido.protocol==='https:'&&
      solicitado.origin===permitido.origin&&origin===solicitado.origin&&
      esperado===permitido.origin;
  }catch{return false;}
}
function errorHttp(res:RespuestaContrato197,codigo:number):void{
  res.status(codigo).json({ok:false,accesoOperativoHabilitado:false,
    error:codigo===400?'Solicitud inválida':codigo===404?'Ruta no disponible':
      codigo===405?'Método no permitido':codigo===401?'Sesión requerida':
      codigo===403?'Operación no autorizada':codigo===409?'Conflicto contractual':
      'Operación contractual no disponible'});
}
function statusResultado(resultado:ResultadoOperacion197):number{
  if(resultado.ok)return 200;
  if(resultado.motivo==='SOLICITUD_INVALIDA'||resultado.motivo==='VERSION_BASE_INVALIDA')return 400;
  if(resultado.motivo==='SESION_NO_VERIFICADA'||resultado.motivo==='PERMISO_INSUFICIENTE')return 403;
  if(['REVISION_DESACTUALIZADA','BORRADOR_ACTIVO_EXISTENTE','BORRADOR_NO_VERIFICADO',
    'CONFLICTO_IDEMPOTENCIA','CONFLICTO_CONCURRENCIA','SEPARACION_FUNCIONES',
    'VERSION_NO_APROBADA'].includes(resultado.motivo??''))return 409;
  return 503;
}

export function crearOperacionContrato197(accion:AccionContrato197,deps:DependenciasContrato197){
  return async(req:PeticionContrato197,res:RespuestaContrato197):Promise<void>=>{
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    try{
      if(!deps.habilitada()){errorHttp(res,404);return;}
      if(req.method!=='POST'){
        res.setHeader('Allow','POST');errorHttp(res,405);return;
      }
      if(!origenValido(req,deps.origenPermitido())){errorHttp(res,403);return;}
      const tipo=req.headers?.['content-type'];
      if(typeof tipo!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(tipo)){
        errorHttp(res,400);return;
      }
      const q=req.query??{};
      if(Object.keys(q).length!==2||q.accion!==accion||
        typeof q.empresaId!=='string'||!ID.test(q.empresaId)||
        !solicitudEstructuralValida(accion,req.body)){
        errorHttp(res,400);return;
      }
      const permiso=PERMISO[accion];
      const acceso=await deps.verificar(req,q.empresaId,permiso);
      if(!acceso.ok){
        errorHttp(res,acceso.motivo==='SIN_SESION'?401:
          acceso.motivo==='FUENTE_NO_DISPONIBLE'?503:403);return;
      }
      if(acceso.acceso.empresaId!==q.empresaId||acceso.acceso.permiso!==permiso||
        !ID.test(acceso.acceso.usuarioId)){
        errorHttp(res,403);return;
      }
      // Se vuelve a validar el actor por servidor dentro de la llamada al motor.
      const fuente=deps.fuente(req,q.empresaId,permiso);
      const pool=deps.pool();
      const resultado=accion==='contrato_borrador'?
        await deps.crear(pool,fuente,req.body):accion==='contrato_aprobar'?
        await deps.aprobar(pool,fuente,req.body):await deps.activar(pool,fuente,req.body);
      if(!resultado.ok){errorHttp(res,statusResultado(resultado));return;}
      // Mantener respuesta del motor: idempotencia/revisión. Nunca habilitar módulos por HTTP.
      res.status(200).json({...resultado,accesoOperativoHabilitado:false});
    }catch{
      errorHttp(res,503);
    }
  };
}

/** Pool compartido y diferido. Nunca se abre cuando el feature flag está OFF. */
const poolEscritura=crearPoolComercialEscritura197();
const reales:DependenciasContrato197={
  habilitada:()=>process.env.VERCEL_ENV==='preview'&&
    process.env.OPTIMA_COMERCIAL_CONTRATOS_WRITE_ENABLED==='true',
  origenPermitido:()=>process.env.OPTIMA_COMERCIAL_WRITE_ORIGIN??'',
  verificar:verificarAccesoComercialReal195,
  fuente:(req,empresaId,permiso)=>crearFuenteContratoReal195(req,empresaId,permiso),
  pool:()=>poolEscritura,
  crear:crearBorradorContractualPg194,
  aprobar:aprobarBorradorContractualPg194,
  activar:activarContratoDesdeServidor193,
};
export const contratoBorradorCore197=crearOperacionContrato197('contrato_borrador',reales);
export const contratoAprobarCore197=crearOperacionContrato197('contrato_aprobar',reales);
export const contratoActivarCore197=crearOperacionContrato197('contrato_activar',reales);
