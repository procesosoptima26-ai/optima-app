/**
 * OPTIMA DA-01 / P3G — pool de ESCRITURA contractual exclusivo para Preview.
 * No lee secretos ni abre conexiones al importar. Nunca usa la URL del lector.
 * No instala el driver ni modifica variables de entorno o la base de datos.
 * Permisos exactos, RLS forzado y rol no propietario se verifican en cada conexión.
 */
import {createRequire} from 'node:module';
import type {ConexionPgNode183,PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';

type PoolInterno=PoolPgNode183&{end():Promise<void>};
type ConstructorPool=new(config:Record<string,unknown>)=>PoolInterno;
export type ConfigEscritura197=Readonly<{dsn:string;rol:string}>;
const NOMBRE_ROL=/^optima_[a-z][a-z0-9_]{2,48}$/;
const TABLAS=['contratos','versiones','borradores','eventos','idempotencia'] as const;
const PERMISOS_ESPERADOS:Readonly<Record<string,readonly boolean[]>>={
  contratos:[true,true,true,false],
  versiones:[true,true,true,false],
  borradores:[true,true,true,false],
  eventos:[true,true,false,false],
  idempotencia:[true,true,false,false],
};

export function validarConfigEscritura197(config:ConfigEscritura197):boolean{
  if(typeof config.rol!=='string'||!NOMBRE_ROL.test(config.rol)||
    typeof config.dsn!=='string'||config.dsn.length>2048)return false;
  try{
    const url=new URL(config.dsn);
    return (url.protocol==='postgres:'||url.protocol==='postgresql:')&&
      url.username===config.rol&&Boolean(url.hostname)&&Boolean(url.pathname.slice(1))&&
      !url.hash&&!url.searchParams.has('options');
  }catch{return false;}
}

const SQL_CONTROL=`SELECT current_user AS usuario, session_user AS usuario_sesion,
 r.rolsuper AS superusuario, r.rolbypassrls AS omite_rls, r.rolcreatedb AS crea_bd,
 r.rolcreaterole AS crea_rol, r.rolreplication AS replica, r.rolinherit AS hereda,
 has_database_privilege(current_user,current_database(),'CREATE') AS crea_objetos_bd,
 has_schema_privilege(current_user,'optima_comercial','USAGE') AS uso_esquema,
 has_schema_privilege(current_user,'optima_comercial','CREATE') AS crea_esquema,
 has_sequence_privilege(current_user,'optima_comercial.eventos_id_evento_seq','USAGE') AS usa_secuencia,
 (SELECT count(*)=5 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND
    pg_get_userbyid(c.relowner)<>current_user)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='optima_comercial' AND c.relkind='r'
      AND c.relname=ANY(ARRAY['contratos','versiones','borradores','eventos','idempotencia']))
      AS rls_estricto,
 ${TABLAS.flatMap(t=>['SELECT','INSERT','UPDATE','DELETE'].map(p=>
   `has_table_privilege(current_user,'optima_comercial.${t}','${p}') AS ${p.toLowerCase()}_${t}`)).join(',\n ')}
 FROM pg_roles r WHERE r.rolname=current_user`;

export function validarRolEscritura197(rows:readonly Record<string,unknown>[],rol:string):boolean{
  if(rows.length!==1)return false;
  const r=rows[0];
  if(r.usuario!==rol||r.usuario_sesion!==rol||r.superusuario!==false||r.omite_rls!==false||
    r.crea_bd!==false||r.crea_rol!==false||r.replica!==false||r.hereda!==false||
    r.crea_objetos_bd!==false||r.uso_esquema!==true||r.crea_esquema!==false||
    r.usa_secuencia!==true||r.rls_estricto!==true)return false;
  return TABLAS.every(t=>['select','insert','update','delete'].every((p,i)=>
    r[`${p}_${t}`]===PERMISOS_ESPERADOS[t][i]));
}

/** Fabrica diferida; mantener UNA instancia del pool por proceso serverless. */
export function crearPoolComercialEscritura197(
  config:ConfigEscritura197={dsn:process.env.OPTIMA_COMERCIAL_PG_WRITE_URL??'',
    rol:process.env.OPTIMA_COMERCIAL_PG_WRITE_ROLE??''},
  obtenerConstructor:()=>ConstructorPool=()=>{
    const mod=createRequire(import.meta.url)('pg') as {Pool?:ConstructorPool};
    if(typeof mod.Pool!=='function')throw Error('Driver PostgreSQL no disponible');
    return mod.Pool;
  },
):PoolPgNode183{
  let pool:PoolInterno|undefined;
  return {connect:async():Promise<ConexionPgNode183>=>{
    if(!validarConfigEscritura197(config))throw Error('Escritor comercial sin configuración segura');
    if(!pool)pool=new (obtenerConstructor())({connectionString:config.dsn,
      max:3,connectionTimeoutMillis:4000,idleTimeoutMillis:30000,
      statement_timeout:10000,query_timeout:12000,application_name:'optima_comercial_write'});
    const conexion=await pool.connect();
    try{
      const resultado=await conexion.query(SQL_CONTROL);
      if(!validarRolEscritura197(resultado.rows,config.rol))
        throw Error('Rol PostgreSQL sin privilegios mínimos verificables');
      return conexion;
    }catch(error){
      try{conexion.release();}catch{/* denegar */}
      throw error;
    }
  }};
}
