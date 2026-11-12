/** OPTIMA 12C.18.4 - SOLO fixture contra PostgreSQL nuevo en /tmp/optima184.*.
 * Las identidades de este test son ficticias y NO autentican usuarios reales.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join,resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { persistirConAutorizacionComercial184,
  type IdentidadServidorComercial184,
} from '../core/seguridad-comercial-pg-12c184.js';
import type { PoolPgNode183 } from '../core/adaptador-pg-node-12c183.js';
import { iniciarHistorialComercialLocal, aprobarBorradorComercialLocal,
  activarVersionComercialLocal, type HistorialContratacionSimulado,
} from '../core/historial-contratacion-comercial-12c173.js';
import { crearBorradorComercialLocal } from '../core/borradores-contratacion-comercial-12c172.js';
const socket=process.env.OPTIMA_PG184_SOCKET;
const driver=process.env.OPTIMA_PG184_DRIVER;
if(!socket || !driver || !/^\/tmp\/optima184\.[A-Za-z0-9]+\/socket$/.test(socket) ||
   realpathSync(socket)!==socket ||
   !resolve(driver).startsWith(resolve(process.env.HOME??'/nonexistent')+'/.local/state/optima/'))
  throw Error('Instancia real de pruebas no aislada');
const {Pool}=createRequire(join(driver,'package.json'))('pg') as {
  Pool: new (config:Record<string,unknown>) => PoolPgNode183 & {
    query(sql:string,params?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount:number|null}>;
    end():Promise<void>;
  };
};
const pool=new Pool({host:socket,port:55434,database:'optima_pruebas',user:'optima_runtime_184',
  max:4,connectionTimeoutMillis:2500,idleTimeoutMillis:2500,statement_timeout:8000});
const EMP='rec'+'A'.repeat(14),OTRA='rec'+'Z'.repeat(14),APR='rec'+'B'.repeat(14),ACT='rec'+'C'.repeat(14);
function bien<T extends {ok:boolean}>(r:T):Extract<T,{ok:true}> {
  assert.equal(r.ok,true,JSON.stringify(r));return r as Extract<T,{ok:true}>;
}
function fixture(empresa:string) {
  const previo=bien(iniciarHistorialComercialLocal({empresaId:empresa,idContrato:'CTR-NODE-RLS184'})).historial;
  const borrador=bien(crearBorradorComercialLocal({idBorrador:'BOR-NODE-RLS184',empresaId:empresa,
    idContrato:null,versionBase:null,serviciosBase:[],
    serviciosPropuestos:[{modalidad:'SUBMODULO_INDEPENDIENTE',submodulo:'CHEQUES',nivel:'ESTANDAR'}],
    motivoCambio:'Prueba de aislacion entre empresas OPTIMA',ahoraIso:'2026-11-11T10:00:00.000Z',
  })).borrador;
  const aprobada=bien(aprobarBorradorComercialLocal({historial:previo,borrador,empresaId:empresa,
    actorUsuarioId:APR,idVersion:'VER-NODE-RLS184',revisionHistorialEsperada:0,
    ahoraIso:'2026-11-11T11:00:00.000Z'})).historial;
  const vigente=bien(activarVersionComercialLocal({historial:aprobada,empresaId:empresa,
    actorUsuarioId:ACT,idVersion:'VER-NODE-RLS184',revisionHistorialEsperada:1,
    ahoraIso:'2026-11-11T12:00:00.000Z'})).historial;
  return {previo,aprobada,vigente};
}
function sesion(usuarioId:string,empresaId:string,permisos:('APROBAR_CONTRATO'|'ACTIVAR_CONTRATO')[]):IdentidadServidorComercial184 {
  return {verificadaEnServidor:true,usuarioId,empresaId,permisos};
}
async function guardar(empresa:string,anterior:HistorialContratacionSimulado,
  siguiente:HistorialContratacionSimulado,usuarioId:string,permiso:'APROBAR_CONTRATO'|'ACTIVAR_CONTRATO',clave:string) {
  return persistirConAutorizacionComercial184(pool,async()=>sesion(usuarioId,empresa,[permiso]),
    {anterior,siguiente,claveIdempotencia:clave});
}
async function ver(empresa:string,contrato:string) {
  const c=await pool.connect();
  try {
    const sin=await c.query('SELECT count(*)::int AS n FROM optima_comercial.contratos');
    assert.equal(Number(sin.rows[0].n),0,'Sin contexto no debe leerse nada');
    await c.query('BEGIN');
    await c.query("SELECT set_config('optima.empresa_id', $1, true)",[empresa]);
    const conteos=[];
    for(const tabla of ['contratos','versiones','eventos','idempotencia']) {
      const r=await c.query(`SELECT count(*)::int AS n FROM optima_comercial.${tabla} WHERE id_contrato=$1`,[contrato]);
      conteos.push(Number(r.rows[0].n));
    }
    const ajeno=await c.query('SELECT count(*)::int AS n FROM optima_comercial.contratos WHERE empresa_id<>$1',[empresa]);
    assert.equal(Number(ajeno.rows[0].n),0);
    await c.query('COMMIT');
    const posterior=await c.query('SELECT count(*)::int AS n FROM optima_comercial.contratos');
    assert.equal(Number(posterior.rows[0].n),0,'El contexto local debe desaparecer al COMMIT');
    return conteos;
  } finally {c.release();}
}
async function principal() {
  const rol=await pool.query('SELECT current_user AS u,rolsuper AS super,rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user');
  assert.equal(rol.rows[0].u,'optima_runtime_184');
  assert.equal(rol.rows[0].super,false);
  assert.equal(rol.rows[0].bypass,false);
  const fA=fixture(EMP),fB=fixture(OTRA);
  const r1=await guardar(EMP,fA.previo,fA.aprobada,APR,'APROBAR_CONTRATO','OP-RLS184-APROBACION-A');
  assert.equal(r1.ok,true,JSON.stringify(r1));
  const r2=await guardar(EMP,fA.aprobada,fA.vigente,ACT,'ACTIVAR_CONTRATO','OP-RLS184-ACTIVACION-A');
  assert.equal(r2.ok,true,JSON.stringify(r2));
  const r3=await guardar(OTRA,fB.previo,fB.aprobada,APR,'APROBAR_CONTRATO','OP-RLS184-APROBACION-B');
  assert.equal(r3.ok,true,JSON.stringify(r3));
  assert.deepEqual(await ver(EMP,fA.previo.idContrato),[1,1,2,2]);
  assert.deepEqual(await ver(OTRA,fB.previo.idContrato),[1,1,1,1]);
  const otra=await guardar(OTRA,fA.previo,fA.aprobada,APR,'APROBAR_CONTRATO','OP-RLS184-AJENO-1');
  assert.deepEqual(otra,{ok:false,motivo:'EMPRESA_AJENA',accesoOperativoHabilitado:false});
  const sinPermiso=await persistirConAutorizacionComercial184(pool,async()=>sesion(APR,EMP,[]),
    {anterior:fA.previo,siguiente:fA.aprobada,claveIdempotencia:'OP-RLS184-SIN-PERMISO'});
  assert.deepEqual(sinPermiso,{ok:false,motivo:'PERMISO_INSUFICIENTE',accesoOperativoHabilitado:false});
  const reintento=await guardar(EMP,fA.previo,fA.aprobada,APR,'APROBAR_CONTRATO','OP-RLS184-APROBACION-A');
  assert.equal(reintento.ok,true);
  if(reintento.ok) assert.equal(reintento.repetida,true);
  assert.deepEqual(await ver(EMP,fA.previo.idContrato),[1,1,2,2]);
  console.log('Aislamiento real, aprobación, activación, rechazo e idempotencia: OK');
  console.log('RESULTADO: SEGURIDAD_NODE_PG_OK');
}
try {await principal();} finally {await pool.end();}
