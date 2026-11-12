/** OPTIMA 12C.18.7 — integración en LABORATORIO.
 * PostgreSQL real efímero; el código REAL de cookie/Redis/Airtable de OPTIMA
 * se ejercita mediante fetch interceptado, sin servicios externos ni secretos.
 * Esto NO prueba autenticación contra Redis/Airtable reales ni un despliegue.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {crearEndpointHistorialComercial186} from '../lib/endpoint-historial-comercial-12c186.js';
import {crearPoolComercialLectura186} from '../lib/pool-lectura-comercial-12c186.js';
import {autenticarPlataformaReal185,empresaClienteMaestra185} from '../handlers/core/consulta-historial-pg-12c185.js';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';

const socket=process.env.OPTIMA_PG187_SOCKET;
const driver=process.env.OPTIMA_PG187_DRIVER;
if(!socket||!driver||!/^\/tmp\/optima187\.[A-Za-z0-9]+\/socket$/.test(socket)||
    realpathSync(socket)!==socket||
    !resolve(driver).startsWith(resolve(process.env.HOME??'/nonexistent')+'/.local/state/optima/'))
 throw Error('Laboratorio PostgreSQL no está aislado');

const USR='rec'+'B'.repeat(14),PLAT='rec'+'P'.repeat(14);
const EMP='rec'+'A'.repeat(14),OTRA='rec'+'Z'.repeat(14);
const BASE='app'+'Q'.repeat(14),USRS='tbl'+'U'.repeat(14),EMPS='tbl'+'C'.repeat(14);
const COOKIE='T'.repeat(43);
const HASH=createHash('sha256').update(COOKIE).digest('hex');
const ROL='optima_reader_187';
const URL='postgresql://optima_reader_187@localhost/optima_pruebas';

// Solo afectan a ESTE proceso temporal; nunca se persisten en archivos .env.
Object.assign(process.env,{
 OPTIMA_PLATFORM_ADMIN_USER_ID:USR,OPTIMA_PLATFORM_COMPANY_ID:PLAT,
 AIRTABLE_TOKEN:'TOKEN_FICTICIO_187',AIRTABLE_USERS_BASE_ID:BASE,
 AIRTABLE_USERS_TABLE_ID:USRS,AIRTABLE_COMPANIES_TABLE_ID:EMPS,
 UPSTASH_REDIS_KV_REST_API_URL:'https://redis.lab.invalid',
 UPSTASH_REDIS_KV_REST_API_TOKEN:'TOKEN_FICTICIO_REDIS_187',
 OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED:'false',
});
const mod=createRequire(join(driver,'package.json'))('pg') as {
 Pool:new(config:Record<string,unknown>)=>PoolPgNode183 & {
  query(sql:string,parametros?:unknown[]):Promise<{rows:Record<string,unknown>[]}>;
  end():Promise<void>;
 }
};
const pools:Array<{end():Promise<void>}> = [];
class PoolTemporal187 {
 private interno:PoolPgNode183 & {end():Promise<void>};
 constructor(_config:Record<string,unknown>){
   this.interno=new mod.Pool({host:socket,port:55437,database:'optima_pruebas',
     user:ROL,max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,statement_timeout:8000});
   pools.push(this.interno);
 }
 connect(){return this.interno.connect();}
 end(){return this.interno.end();}
}
const fetchAnterior=globalThis.fetch;
let consultasExternas=0,usuarioActivo=true,versionSesion=0,empresaActiva=true;
const json=(valor:unknown,status=200)=>new Response(JSON.stringify(valor),{
 status,headers:{'Content-Type':'application/json'},
});

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
 const url=String(input);
 // Captura TODO el transporte remoto. Ninguna solicitud sale a la red.
 consultasExternas++;
 if(url==='https://redis.lab.invalid'&&init?.method==='POST'){
   const cmd=JSON.parse(String(init.body)) as unknown;
   if(!Array.isArray(cmd)||cmd[0]!=='GET'||typeof cmd[1]!=='string')throw Error('Redis no esperado');
   if(cmd[1]===`optima:sesion:${HASH}`)return json({result:JSON.stringify({usuarioId:USR,versionSesion:0})});
   if(cmd[1]===`optima:version-sesion:${USR}`)return json({result:versionSesion===0?null:versionSesion});
   throw Error('Clave Redis no prevista');
 }
 if(url.startsWith(`https://api.airtable.com/v0/${BASE}/`)&&init?.method==='GET'){
   if(url===`https://api.airtable.com/v0/${BASE}/${USRS}/${USR}`)
     return json({id:USR,fields:{ACTIVO:usuarioActivo,ROL:'ADMIN',EMPRESA:[PLAT],
       SUCURSALES_AUTORIZADAS:[],SUCURSAL_PREDETERMINADA:[],USUARIO:'prueba',NOMBRE:'Prueba'}});
   if(url===`https://api.airtable.com/v0/${BASE}/${EMPS}/${PLAT}`)
     return json({id:PLAT,fields:{ACTIVA:true,CLAVE_EMPRESA:'OPTIMA_LAB',NOMBRE_COMERCIAL:'OPTIMA LAB'}});
   if(url===`https://api.airtable.com/v0/${BASE}/${EMPS}/${EMP}`)
     return json({id:EMP,fields:{ACTIVA:empresaActiva}});
   if(url===`https://api.airtable.com/v0/${BASE}/${EMPS}/${OTRA}`)
     return json({id:OTRA,fields:{ACTIVA:true}});
   return json({error:'Sin registro'},404);
 }
 throw Error('Solicitud de red prohibida en laboratorio');
};

let habilitado=false,poolSolicitado=0;
const endpoint=crearEndpointHistorialComercial186({
 habilitado:()=>habilitado,
 crearPool:()=>{
   poolSolicitado++;
   return crearPoolComercialLectura186({dsn:URL,rol:ROL},
     ()=>PoolTemporal187 as unknown as Parameters<typeof crearPoolComercialLectura186>[1] extends ()=>infer X?X:never);
 },
 autenticar:autenticarPlataformaReal185,
 empresaClienteValida:empresaClienteMaestra185,
});
type Peticion={method:string;query?:Record<string,unknown>;cookies?:Record<string,unknown>;body?:unknown};
async function llamar(req:Peticion):Promise<{status:number;body:Record<string,unknown>}>{
 let status=0,body:unknown={};
 await endpoint(req,{setHeader:()=>undefined,status:(n:number)=>{
   status=n;return {json:(v:unknown)=>{body=v;return undefined;}};
 }});
 return {status,body:body as Record<string,unknown>};
}
const req=(empresaId=EMP,idContrato='CTR-READ185'):Peticion=>({
 method:'GET',cookies:{optima_sesion:COOKIE},query:{empresaId,idContrato},
});

async function principal(){
 assert.equal((await llamar(req())).status,404,'apagado por defecto');
 assert.equal(poolSolicitado,0);assert.equal(consultasExternas,0);
 habilitado=true; // SOLAMENTE objeto inyectado en proceso ficticio.
 assert.equal((await llamar({...req(),method:'POST'})).status,405);
 assert.equal(poolSolicitado,0,'POST no abre pool');
 const anterior=poolSolicitado;
 assert.equal((await llamar({method:'GET',query:req().query})).status,401);
 assert.equal(poolSolicitado,anterior);
 versionSesion=1;
 assert.equal((await llamar(req())).status,401,'sesión revocada');
 assert.equal(poolSolicitado,anterior);
 versionSesion=0;usuarioActivo=false;
 assert.equal((await llamar(req())).status,403,'admin desactivado');
 assert.equal(poolSolicitado,anterior);
 usuarioActivo=true;empresaActiva=false;
 assert.equal((await llamar(req())).status,404,'empresa desactivada');
 assert.equal(poolSolicitado,anterior);
 empresaActiva=true;
 const a=await llamar(req());
 assert.equal(a.status,200,JSON.stringify(a.body));
 assert.equal(a.body.soloConsulta,true);assert.equal(a.body.accesoOperativoHabilitado,false);
 const historial=a.body.historial as {revision:number;versiones:unknown[];empresaId:string};
 assert.equal(historial.empresaId,EMP);assert.equal(historial.revision,1);
 assert.equal(historial.versiones.length,1);
 assert.ok(!JSON.stringify(a.body).includes('TOKEN_FICTICIO'));
 const b=await llamar(req(OTRA));
 assert.equal(b.status,200,JSON.stringify(b.body));
 const hb=b.body.historial as {empresaId:string;revision:number;versiones:unknown[]};
 assert.equal(hb.empresaId,OTRA);assert.equal(hb.revision,0);assert.equal(hb.versiones.length,0);
 assert.equal((await llamar(req(EMP,'CTR-AUSENTE'))).status,404);
 // Comprobación real SQL, incluso después de consultas autorizadas.
 const directo=new mod.Pool({host:socket,port:55437,database:'optima_pruebas',user:ROL,max:1});
 try{
   const sin=await directo.query('SELECT count(*)::int AS n FROM optima_comercial.contratos');
   assert.equal(Number(sin.rows[0].n),0,'no persiste contexto de empresa');
   await assert.rejects(()=>directo.query(
     'INSERT INTO optima_comercial.contratos(empresa_id,id_contrato,revision,huella_historial) VALUES ($1,$2,0,$3)',
     [EMP,'CTR-PROHIBIDO','a'.repeat(64)]), 'lector no puede escribir');
 }finally{await directo.end();}
 console.log('Cookie/Redis/administrador OPTIMA simulados usando lógica real: OK');
 console.log('PostgreSQL real + rol SELECT + RLS entre empresas: OK');
 console.log('Sin red externa, sin credenciales ni endpoint operativo: OK');
 console.log('RESULTADO: ENDPOINT_PG187_REAL_OK');
}
try{await principal();}finally{
 globalThis.fetch=fetchAnterior;
 await Promise.all(pools.map(p=>p.end()));
}
