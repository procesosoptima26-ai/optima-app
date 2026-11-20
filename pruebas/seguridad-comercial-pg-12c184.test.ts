import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarHistorialComercialLocal, aprobarBorradorComercialLocal,
  activarVersionComercialLocal, type HistorialContratacionSimulado,
} from '../core/historial-contratacion-comercial-12c173.js';
import { crearBorradorComercialLocal } from '../core/borradores-contratacion-comercial-12c172.js';
import { persistirConAutorizacionComercial184, poolLimitadoAEmpresa184,
  type IdentidadServidorComercial184, type TransicionParaAutorizar184,
} from '../core/seguridad-comercial-pg-12c184.js';
import type { PoolPgNode183 } from '../core/adaptador-pg-node-12c183.js';

const EMP = 'emp_'+'a'.repeat(12);
const OTRA = 'emp_'+'z'.repeat(12);
const APR = 'rec' + 'B'.repeat(14);
const ACT = 'rec' + 'C'.repeat(14);
const FECHAS = ['2026-11-11T10:00:00.000Z', '2026-11-11T11:00:00.000Z', '2026-11-11T12:00:00.000Z'];
function bien<T extends {ok:boolean}>(r:T): Extract<T,{ok:true}> {
  assert.equal(r.ok,true,JSON.stringify(r));
  return r as Extract<T,{ok:true}>;
}
function estados(empresa=EMP) {
  const previo = bien(iniciarHistorialComercialLocal({empresaId:empresa,idContrato:'CTR-SEG-184'})).historial;
  const borrador = bien(crearBorradorComercialLocal({
    idBorrador:'BOR-SEGURIDAD-184', empresaId:empresa,idContrato:null,
    versionBase:null,serviciosBase:[],
    serviciosPropuestos:[{modalidad:'SUBMODULO_INDEPENDIENTE',submodulo:'CHEQUES',nivel:'ESTANDAR'}],
    motivoCambio:'Alta comercial ficticia para controles de seguridad', ahoraIso:FECHAS[0],
  })).borrador;
  const aprobada = bien(aprobarBorradorComercialLocal({
    historial:previo,borrador,empresaId:empresa,actorUsuarioId:APR,
    idVersion:'VER-SEGURIDAD-184',revisionHistorialEsperada:0,ahoraIso:FECHAS[1],
  })).historial;
  const vigente = bien(activarVersionComercialLocal({
    historial:aprobada,empresaId:empresa,actorUsuarioId:ACT,
    idVersion:'VER-SEGURIDAD-184',revisionHistorialEsperada:1,ahoraIso:FECHAS[2],
  })).historial;
  return {previo,aprobada,vigente};
}
const F = estados();
function sesion(usuarioId=APR,empresaId=EMP,permisos:('APROBAR_CONTRATO'|'ACTIVAR_CONTRATO')[]=['APROBAR_CONTRATO']):IdentidadServidorComercial184 {
  return {verificadaEnServidor:true,usuarioId,empresaId,permisos};
}
function solicitud(anterior=F.previo,siguiente=F.aprobada):TransicionParaAutorizar184 {
  return {anterior,siguiente,claveIdempotencia:'OP-SEGURIDAD-184-001'};
}
function observador() {
  const llamadas: {sql:string;parametros:unknown[]}[]=[];
  let conexiones=0, liberaciones=0;
  const pool:PoolPgNode183 = {connect:async()=>{
    conexiones++;
    return {query:async(sql:string,parametros?:unknown[])=>{
      llamadas.push({sql,parametros:parametros??[]});
      return {rows:[],rowCount:0};
    },release:()=>{liberaciones++;}};
  }};
  return {pool,llamadas,get conexiones(){return conexiones;},get liberaciones(){return liberaciones;}};
}
const DENEGACIONES: Array<[string,unknown,string]> = [
  ['sin sesión',null,'SESION_NO_VERIFICADA'],
  ['sesión incompleta',{},'SESION_NO_VERIFICADA'],
  ['verificación falsa',{...sesion(),verificadaEnServidor:false},'SESION_NO_VERIFICADA'],
  ['usuario de formato inválido',{...sesion(),usuarioId:'123'},'SESION_NO_VERIFICADA'],
  ['empresa de formato inválido',{...sesion(),empresaId:'123'},'SESION_NO_VERIFICADA'],
  ['sin empresa',{...sesion(),empresaId:null},'SESION_NO_VERIFICADA'],
  ['sin permisos',{...sesion(),permisos:null},'SESION_NO_VERIFICADA'],
  ['permiso desconocido',{...sesion(),permisos:['SUPERADMIN']},'SESION_NO_VERIFICADA'],
  ['permisos duplicados',{...sesion(),permisos:['APROBAR_CONTRATO','APROBAR_CONTRATO']},'SESION_NO_VERIFICADA'],
  ['permisos extraños',{...sesion(),permisos:[42]},'SESION_NO_VERIFICADA'],
  ['propiedad adicional',{...sesion(),token:'inventado'},'SESION_NO_VERIFICADA'],
  ['empresa ajena',sesion(APR,OTRA),'EMPRESA_AJENA'],
  ['actor ajeno',sesion(ACT,EMP,['APROBAR_CONTRATO']),'IDENTIDAD_NO_COINCIDE'],
  ['permiso insuficiente',sesion(APR,EMP,[]),'PERMISO_INSUFICIENTE'],
  ['permiso distinto',sesion(APR,EMP,['ACTIVAR_CONTRATO']),'PERMISO_INSUFICIENTE'],
];
for (const [nombre,principal,motivo] of DENEGACIONES) {
  test(`denegar ${nombre} antes de conectar`,async()=>{
    const o=observador();
    const r=await persistirConAutorizacionComercial184(o.pool,async()=>principal,solicitud());
    assert.deepEqual(r,{ok:false,motivo,accesoOperativoHabilitado:false});
    assert.equal(o.conexiones,0);
  });
}

test('fallo al leer sesión: cerrado, sin acceder a base',async()=>{
  const o=observador();
  const r=await persistirConAutorizacionComercial184(o.pool,async()=>{throw Error('token');},solicitud());
  assert.deepEqual(r,{ok:false,motivo:'ERROR_AUTORIZACION',accesoOperativoHabilitado:false});
  assert.equal(o.conexiones,0);
});

test('paso de aprobación: la sesión decide actor y empresa, contexto LOCAL en la misma conexión',async()=>{
  const o=observador();
  const r=await persistirConAutorizacionComercial184(o.pool,async()=>sesion(),solicitud());
  assert.equal(r.ok,false); // simulación: faltan filas ficticias en mock
  assert.equal(o.conexiones,1);
  assert.equal(o.liberaciones,1);
  assert.equal(o.llamadas[0].sql,'BEGIN');
  assert.equal(o.llamadas[1].sql,"SELECT set_config('optima.empresa_id', $1, true)");
  assert.deepEqual(o.llamadas[1].parametros,[EMP]);
  assert.ok(o.llamadas.some(c=>c.sql==='ROLLBACK'));
});

test('activación válida autoriza al activador, no al aprobador',async()=>{
  const o=observador();
  await persistirConAutorizacionComercial184(o.pool,async()=>sesion(ACT,EMP,['ACTIVAR_CONTRATO']),solicitud(F.aprobada,F.vigente));
  assert.equal(o.conexiones,1);
  const denegado=observador();
  const r=await persistirConAutorizacionComercial184(denegado.pool,async()=>sesion(APR,EMP,['ACTIVAR_CONTRATO']),solicitud(F.aprobada,F.vigente));
  assert.equal(r.ok,false);assert.equal(denegado.conexiones,0);
});

test('activación sin permiso no conecta',async()=>{
  const o=observador();
  const r=await persistirConAutorizacionComercial184(o.pool,async()=>sesion(ACT,EMP,['APROBAR_CONTRATO']),solicitud(F.aprobada,F.vigente));
  assert.deepEqual(r,{ok:false,motivo:'PERMISO_INSUFICIENTE',accesoOperativoHabilitado:false});
  assert.equal(o.conexiones,0);
});

test('separación de funciones ante cambios maliciosos al aprobador',async()=>{
  const o=observador();
  const modificada={...F.vigente,versiones:F.vigente.versiones.map(v=>({...v,aprobadoPorId:ACT}))} as HistorialContratacionSimulado;
  const r=await persistirConAutorizacionComercial184(o.pool,async()=>sesion(ACT,EMP,['ACTIVAR_CONTRATO']),solicitud(F.aprobada,modificada));
  assert.equal(r.ok,false);assert.equal(o.conexiones,0);
});

test('historial de otra empresa jamás llega a SQL',async()=>{
  const o=observador();const otro=estados(OTRA);
  const r=await persistirConAutorizacionComercial184(o.pool,async()=>sesion(),solicitud(otro.previo,otro.aprobada));
  assert.deepEqual(r,{ok:false,motivo:'EMPRESA_AJENA',accesoOperativoHabilitado:false});
  assert.equal(o.conexiones,0);
});

test('dos empresas mezcladas se rechazan antes de autenticar',async()=>{
  const o=observador();const otro=estados(OTRA);
  let llamadas=0;
  const r=await persistirConAutorizacionComercial184(o.pool,async()=>{llamadas++;return sesion();},solicitud(F.previo,otro.aprobada));
  assert.deepEqual(r,{ok:false,motivo:'TRANSICION_INVALIDA',accesoOperativoHabilitado:false});
  assert.equal(llamadas,0); assert.equal(o.conexiones,0);
});

test('clave de idempotencia inválida detiene el acceso a sesión y BD',async()=>{
  const o=observador();let llamadas=0;
  const r=await persistirConAutorizacionComercial184(o.pool,async()=>{llamadas++;return sesion();},{...solicitud(),claveIdempotencia:'123'});
  assert.deepEqual(r,{ok:false,motivo:'TRANSICION_INVALIDA',accesoOperativoHabilitado:false});
  assert.equal(llamadas,0);assert.equal(o.conexiones,0);
});

test('instantánea corrupta se rechaza',async()=>{
  const o=observador();
  const r=await persistirConAutorizacionComercial184(o.pool,async()=>sesion(),{...solicitud(),anterior:{...F.previo,revisionHistorial:123}});
  assert.deepEqual(r,{ok:false,motivo:'TRANSICION_INVALIDA',accesoOperativoHabilitado:false});
  assert.equal(o.conexiones,0);
});

test('sin actor suministrado por UI: se inyecta desde el servidor',async()=>{
  const o=observador();
  const r=await persistirConAutorizacionComercial184(o.pool,async()=>sesion(),{...solicitud(),actorServidorId:ACT} as TransicionParaAutorizar184);
  assert.equal(r.ok,false);
  assert.equal(o.conexiones,1);
  assert.deepEqual(o.llamadas[1].parametros,[EMP]);
});

test('pool con empresa inválida se rechaza',()=>{
  assert.throws(()=>poolLimitadoAEmpresa184(observador().pool,'cualquier'),/Empresa inválida/);
});

test('SET LOCAL se aplica después de BEGIN y se libera la conexión',async()=>{
  const o=observador();
  const limitado=poolLimitadoAEmpresa184(o.pool,EMP);
  const c=await limitado.connect();
  await c.query('BEGIN'); await c.query('SELECT 1');await c.query('ROLLBACK');c.release();
  assert.deepEqual(o.llamadas.map(x=>x.sql),['BEGIN',"SELECT set_config('optima.empresa_id', $1, true)",'SELECT 1','ROLLBACK']);
  assert.equal(o.liberaciones,1);
});

test('si set_config falla se intenta revertir transacción',async()=>{
  const sqls:string[]=[];
  const pool:PoolPgNode183={connect:async()=>({query:async sql=>{
    sqls.push(sql);
    if(sql.includes('set_config')) throw Error('GUC');
    return {rows:[],rowCount:0};
  },release:()=>{}})};
  const c=await poolLimitadoAEmpresa184(pool,EMP).connect();
  await assert.rejects(()=>c.query('BEGIN'));
  assert.deepEqual(sqls,['BEGIN',"SELECT set_config('optima.empresa_id', $1, true)",'ROLLBACK']);
});

test('si la conexión falla no se divulga error sensible',async()=>{
  const pool:PoolPgNode183={connect:async()=>{throw Error('secreto del driver');}};
  const r=await persistirConAutorizacionComercial184(pool,async()=>sesion(),solicitud());
  assert.deepEqual(r,{ok:false,motivo:'ERROR_BD',accesoOperativoHabilitado:false});
});

test('sin permisos se rechaza aun si el actor parece correcto',async()=>{
  const o=observador();const r=await persistirConAutorizacionComercial184(o.pool,async()=>sesion(APR,EMP,[]),solicitud());
  assert.equal(r.ok,false);assert.equal(o.conexiones,0);
});
