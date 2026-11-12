/** OPTIMA 12C.18.6 — fábrica DIFERIDA para lector PostgreSQL.
 * No introduce driver ni credenciales en frontend. No conecta al importar.
 * En producción requiere instalar 'pg' explícitamente, con rol dedicado SELECT.
 */
import {createRequire} from 'node:module';
import type {ConexionPgNode183,PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';

type PoolInterno=PoolPgNode183&{end():Promise<void>};
type PoolConstructor=new (config:Record<string,unknown>)=>PoolInterno;
export type ConfigLectura186=Readonly<{dsn:string;rol:string}>;
const ROL=/^optima_[a-z][a-z0-9_]{2,48}$/;
const TABLAS=['contratos','versiones','borradores','eventos','idempotencia'] as const;

/** Validación estricta: nunca usar rol administrador ni URL sin rol explícito. */
export function validarConfigLectura186(config:ConfigLectura186):boolean{
  if(!ROL.test(config.rol)||typeof config.dsn!=='string'||config.dsn.length>2048)return false;
  try{
    const url=new URL(config.dsn);
    return (url.protocol==='postgres:'||url.protocol==='postgresql:')&&
      url.username===config.rol&&Boolean(url.hostname)&&Boolean(url.pathname.slice(1))&&
      !url.hash;
  }catch{return false;}
}

const SQL_PERMISOS=`SELECT current_user AS usuario, r.rolsuper AS superusuario,
 r.rolbypassrls AS omite_rls,
 r.rolcreatedb AS crea_bd, r.rolcreaterole AS crea_rol, r.rolreplication AS replica,
 has_schema_privilege(current_user,'optima_comercial','USAGE') AS uso_esquema,
 ${TABLAS.map(t=>`has_table_privilege(current_user,'optima_comercial.${t}','SELECT') AS select_${t}` ).join(',\n ')},
 ${TABLAS.map(t=>`has_table_privilege(current_user,'optima_comercial.${t}','INSERT') AS insert_${t}` ).join(',\n ')},
 ${TABLAS.map(t=>`has_table_privilege(current_user,'optima_comercial.${t}','UPDATE') AS update_${t}` ).join(',\n ')},
 ${TABLAS.map(t=>`has_table_privilege(current_user,'optima_comercial.${t}','DELETE') AS delete_${t}` ).join(',\n ')}
 FROM pg_roles r WHERE r.rolname=current_user`;

export function validarRolLectura186(filas:readonly Record<string,unknown>[],rol:string):boolean{
  if(filas.length!==1||filas[0].usuario!==rol||filas[0].superusuario!==false||
    filas[0].omite_rls!==false||filas[0].crea_bd!==false||
    filas[0].crea_rol!==false||filas[0].replica!==false||filas[0].uso_esquema!==true)return false;
  const v=filas[0];
  return TABLAS.every(t=>v[`insert_${t}`]===false&&v[`update_${t}`]===false&&v[`delete_${t}`]===false&&
    v[`select_${t}`]===(t!=='idempotencia'));
}

export function crearPoolComercialLectura186(
  config:ConfigLectura186={dsn:process.env.OPTIMA_COMERCIAL_PG_READ_URL??'',
    rol:process.env.OPTIMA_COMERCIAL_PG_READ_ROLE??''},
  obtenerConstructor:()=>PoolConstructor=()=>{
    const mod=createRequire(import.meta.url)('pg') as {Pool?:PoolConstructor};
    if(typeof mod.Pool!=='function')throw Error('Driver PostgreSQL no disponible');
    return mod.Pool;
  },
):PoolPgNode183{
  let pool:PoolInterno|undefined;
  return {connect:async():Promise<ConexionPgNode183>=>{
    if(!validarConfigLectura186(config))throw Error('Lector comercial no configurado');
    if(!pool)pool=new (obtenerConstructor())({connectionString:config.dsn,
      max:3,connectionTimeoutMillis:4000,idleTimeoutMillis:30000,
      statement_timeout:10000,query_timeout:12000,application_name:'optima_comercial_read'});
    const conexion=await pool.connect();
    try{
      const res=await conexion.query(SQL_PERMISOS);
      if(!validarRolLectura186(res.rows,config.rol))throw Error('Rol PostgreSQL no es de solo lectura');
      return conexion;
    }catch(e){
      try{conexion.release();}catch{/* fallo cerrado */}
      throw e;
    }
  }};
}
