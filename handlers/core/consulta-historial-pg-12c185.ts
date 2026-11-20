/** OPTIMA 12C.18.5 — Adaptador de consulta del historial comercial.
 * NO registrado en api/usuarios.ts ni en vercel.json. Sin ruta accesible.
 * NO se conecta a BD por sí solo: requiere un pool inyectado por backend.
 * La autenticación real reutiliza la cookie, Redis y el control de PLATAFORMA.
 * En una integración futura, el pool DEBE usar rol de solo lectura con RLS.
 */
import type { PoolPgNode183 } from '../../core/adaptador-pg-node-12c183.js';
import {leerHistorialComercialPg185} from '../../core/lectura-historial-pg-12c185.js';
import {leerIdEmpresaEstable,esIdEmpresaEstable} from '../../lib/empresa-estable.js';

const ID=/^rec[A-Za-z0-9]{14}$/;
const CONTRATO=/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
type Request185={method?:string;query?:Record<string,unknown>;cookies?:Record<string,unknown>};
type Response185={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
export type EstadoSesion185=
 | Readonly<{estado:'SIN_SESION'|'NO_AUTORIZADO'}>
 | Readonly<{estado:'OK';usuarioId:string;empresaPlataformaId:string}>;
export type DependenciasConsulta185=Readonly<{
  pool:PoolPgNode183;
  autenticar(req:Request185):Promise<EstadoSesion185>;
  empresaClienteValida(empresaId:string):Promise<boolean>;
  /** Opcional: si existe reemplaza a empresaClienteValida e informa el ID estable (clave en Neon). */
  resolverEmpresaCliente?(empresaId:string):Promise<EmpresaClienteMaestra185>;
}>;

/** El llamador no puede insertar funciones por HTTP: deps se registran en servidor.
 * No se permite empresaId de sesión del cliente: siempre se verifica admin global.
 */
export function crearConsultaHistorialComercial185(deps:DependenciasConsulta185) {
  return async(req:Request185,res:Response185):Promise<void>=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'){res.status(405).json({ok:false,error:'Método no permitido'});return;}
    try{
      const sesion=await deps.autenticar(req);
      if(sesion.estado==='SIN_SESION'){res.status(401).json({ok:false,error:'Iniciá sesión'});return;}
      if(sesion.estado!=='OK'||!ID.test(sesion.usuarioId)||!ID.test(sesion.empresaPlataformaId)){
        res.status(403).json({ok:false,error:'Consulta exclusiva de OPTIMA'});return;
      }
      const q=req.query??{};
      if(Object.keys(q).some(k=>k!=='empresaId'&&k!=='idContrato')||
        typeof q.empresaId!=='string'||!ID.test(q.empresaId)||
        typeof q.idContrato!=='string'||!CONTRATO.test(q.idContrato)||
        q.empresaId===sesion.empresaPlataformaId){
        res.status(400).json({ok:false,error:'Parámetros inválidos'});return;
      }
      let claveNeon:string=q.empresaId;
      if(deps.resolverEmpresaCliente){
        const empresa=await deps.resolverEmpresaCliente(q.empresaId);
        if(!empresa.activa){
          res.status(404).json({ok:false,error:'Empresa no encontrada'});return;
        }
        // Neon identifica a la empresa por su ID estable, nunca por el código de Airtable.
        if(!esIdEmpresaEstable(empresa.idEstable)){
          res.status(503).json({ok:false,error:'Consulta comercial temporalmente no disponible'});return;
        }
        claveNeon=empresa.idEstable;
      }else if(!await deps.empresaClienteValida(q.empresaId)){
        res.status(404).json({ok:false,error:'Empresa no encontrada'});return;
      }
      const result=await leerHistorialComercialPg185(deps.pool,claveNeon,q.idContrato);
      if(result.ok === false){
        if(result.motivo==='NO_ENCONTRADO'){
          res.status(404).json({ok:false,error:'No se encontró el contrato'});return;
        }
        res.status(503).json({ok:false,error:'No se pudo verificar el historial comercial'});return;
      }
      if(result.historial.empresaId!==claveNeon||result.historial.idContrato!==q.idContrato){
        res.status(503).json({ok:false,error:'Historial inconsistente'});return;
      }
      res.status(200).json({ok:true,soloConsulta:true,accesoOperativoHabilitado:false,
        historial:result.historial});
    }catch{
      res.status(503).json({ok:false,error:'No se pudo verificar el acceso al historial'});
    }
  };
}

/** Integración REAL con sesión OPTIMA, aún SIN registrar endpoint. La cookie
 * viene de la request HTTP; su autenticidad se comprueba con buscarSesion,
 * la autorización se vuelve a consultar con leerAccesoPlataforma.
 * No se aceptan identidad, roles ni permisos desde query/body.
 */
export async function autenticarPlataformaReal185(req:Request185):Promise<EstadoSesion185>{
  const [{buscarSesion,leerTokenSesion},{leerAccesoPlataforma}]=await Promise.all([
    import('../../lib/session.js'),import('../../core/acceso-plataforma.js'),
  ]);
  const token=leerTokenSesion(req as Parameters<typeof leerTokenSesion>[0]);
  if(!token)return {estado:'SIN_SESION'};
  const sesion=await buscarSesion(token);
  if(!sesion||!ID.test(sesion.usuarioId))return {estado:'SIN_SESION'};
  const acceso=await leerAccesoPlataforma(sesion.usuarioId);
  if(!acceso)return {estado:'NO_AUTORIZADO'};
  return {estado:'OK',usuarioId:acceso.usuarioId,empresaPlataformaId:acceso.empresaId};
}

/** Validación contra fuente canónica (Base Maestra), sin escribir. Es obligatorio
 * que la empresa esté activa. Solo ejecutarla tras autenticar a PLATAFORMA.
 */
export type EmpresaClienteMaestra185=Readonly<{activa:boolean;idEstable:string|null}>;

/** Lee UNA vez la empresa cliente en la Base Maestra: si está activa y su ID estable. */
export async function resolverEmpresaClienteMaestra185(empresaId:string):Promise<EmpresaClienteMaestra185>{
  if(!ID.test(empresaId))return {activa:false,idEstable:null};
  const base=process.env.AIRTABLE_USERS_BASE_ID?.trim()??'';
  const tabla=process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim()??'';
  const token=process.env.AIRTABLE_TOKEN?.trim()??'';
  if(!/^app[A-Za-z0-9]{14}$/.test(base)||!/^tbl[A-Za-z0-9]{14}$/.test(tabla)||!token)
    throw Error('Base Maestra no configurada');
  const r=await fetch(`https://api.airtable.com/v0/${base}/${tabla}/${empresaId}`,{
    method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(10000),
  });
  if(r.status===404)return {activa:false,idEstable:null};
  if(!r.ok)throw Error('No se pudo verificar empresa');
  const valor:unknown=await r.json();
  if(!valor||typeof valor!=='object'||Array.isArray(valor))throw Error('Empresa inválida');
  const reg=valor as {id?:unknown;fields?:unknown};
  const activa=reg.id===empresaId&&
    (reg.fields as {ACTIVA?:unknown}|undefined)?.ACTIVA===true;
  return {activa,idEstable:activa?leerIdEmpresaEstable(reg.fields):null};
}

export async function empresaClienteMaestra185(empresaId:string):Promise<boolean>{
  return (await resolverEmpresaClienteMaestra185(empresaId)).activa;
}

/** Preparado para un futuro router: las dependencias de BD se suministran
 * desde la configuración SERVIDOR, nunca desde la petición del navegador.
 */
export function prepararHandlerReal185(pool:PoolPgNode183){
  return crearConsultaHistorialComercial185({pool,autenticar:autenticarPlataformaReal185,
    empresaClienteValida:empresaClienteMaestra185,
    resolverEmpresaCliente:resolverEmpresaClienteMaestra185});
}
