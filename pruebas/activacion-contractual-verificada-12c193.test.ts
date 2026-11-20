import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';
import {activarContratoDesdeServidor193} from '../core/activacion-contractual-verificada-12c193.js';
import {
  iniciarHistorialComercialLocal, aprobarBorradorComercialLocal,
  type HistorialContratacionSimulado,
} from '../core/historial-contratacion-comercial-12c173.js';
import {crearBorradorComercialLocal} from '../core/borradores-contratacion-comercial-12c172.js';

const EMPRESA='emp_'+'e'.repeat(12);
const OTRA='emp_'+'o'.repeat(12);
const APROBADOR='rec'+'A'.repeat(14);
const ACTIVADOR='rec'+'B'.repeat(14);
const CONTRATO='CONTRATO-CORE-01';
const VERSION='VER-CORE01';
const CLAVE='OP-CORE123456';
const F0='2026-11-12T10:00:00.000Z';
const F1='2026-11-12T11:00:00.000Z';
const F2='2026-11-12T12:00:00.000Z';
const servicios=[{modalidad:'MODULO_PRINCIPAL',modulo:'INVENTARIO',nivel:'ESENCIAL'}] as const;
const h0=iniciarHistorialComercialLocal({empresaId:EMPRESA,idContrato:CONTRATO});
assert.equal(h0.ok,true);if(!h0.ok)throw Error('Fixture');
const b=crearBorradorComercialLocal({idBorrador:'BOR-CORE01',empresaId:EMPRESA,idContrato:null,
  versionBase:null,serviciosBase:[],serviciosPropuestos:servicios,
  motivoCambio:'Contratación inicial de prueba',ahoraIso:F0});
assert.equal(b.ok,true);if(!b.ok)throw Error('Fixture');
const h1=aprobarBorradorComercialLocal({historial:h0.historial,borrador:b.borrador,
  empresaId:EMPRESA,actorUsuarioId:APROBADOR,idVersion:VERSION,
  revisionHistorialEsperada:0,ahoraIso:F1});
assert.equal(h1.ok,true);if(!h1.ok)throw Error('Fixture');
const aprobado=h1.historial;

const intencion={idContrato:CONTRATO,idVersion:VERSION,claveIdempotencia:CLAVE} as const;
const identidad={verificadaEnServidor:true,usuarioId:ACTIVADOR,empresaId:EMPRESA,
  permisos:['ACTIVAR_CONTRATO']} as const;
const reloj=()=>F2;

function filas(h:HistorialContratacionSimulado){
  return {
    cabecera:{empresa_id:h.empresaId,id_contrato:h.idContrato,
      revision:String(h.revisionHistorial),
      huella_historial:createHash('sha256').update(JSON.stringify(h)).digest('hex')},
    versiones:h.versiones.map(v=>({
      empresa_id:h.empresaId,id_contrato:h.idContrato,id_version:v.idVersion,
      numero:v.numero,estado:v.estado,servicios:v.servicios.map(({nivel,...resto})=>({nivel,...resto})),
      motivo_cambio:v.motivoCambio,aprobado_por_id:v.aprobadoPorId,
      aprobado_en_iso:v.aprobadoEnIso,vigente_desde_iso:v.vigenteDesdeIso,
      vigente_hasta_iso:v.vigenteHastaIso,sustituida_por_id:v.sustituidaPorId,
    })),
    eventos:h.eventos.map((e,i)=>({
      empresa_id:h.empresaId,id_contrato:h.idContrato,revision_antes:String(i),
      revision_despues:String(i+1),tipo:e.tipo,id_version:e.idVersion,
      id_version_anterior:e.idVersionAnterior,actor_usuario_id:e.actorUsuarioId,fecha_iso:e.fechaIso,
    })),
  };
}
function base(options:{
  estado?:HistorialContratacionSimulado;
  errorEn?:string;
  cambioConcurrente?:boolean;
  estadoInvalido?:boolean;
  sinContrato?:boolean;
  consultasFallidas?:number;
}={}){
  const data=filas(options.estado??aprobado);
  const queries:string[]=[];
  const parametros:unknown[][]=[];
  let conexiones=0,liberadas=0,escrituras=0;
  let consultasHistorial=0;
  const pool:PoolPgNode183={
    async connect(){conexiones++;return {
      async query(sql:string,param?:unknown[]){
        queries.push(sql);parametros.push(param??[]);
        if(options.errorEn && sql.includes(options.errorEn))throw Error('PG no disponible');
        if(sql.includes('set_config'))return {rows:[{empresa_id:EMPRESA}],rowCount:1};
        if(sql.includes('huella_historial') && /LIMIT 2\s*$/.test(sql)){
          consultasHistorial++;
          if(options.sinContrato)return {rows:[],rowCount:0};
          return {rows:[options.estadoInvalido?{...data.cabecera,huella_historial:'f'.repeat(64)}:data.cabecera],rowCount:1};
        }
        if(sql.includes('FROM optima_comercial.versiones') && sql.includes('ORDER BY numero'))
          return {rows:data.versiones,rowCount:data.versiones.length};
        if(sql.includes('FROM optima_comercial.eventos') && sql.includes('ORDER BY revision_despues'))
          return {rows:data.eventos,rowCount:data.eventos.length};
        if(sql.includes('FOR UPDATE')){
          const cab=options.cambioConcurrente?{...data.cabecera,revision:'2'}:data.cabecera;
          return {rows:[cab],rowCount:1};
        }
        if(sql.includes('FROM optima_comercial.idempotencia'))return {rows:[],rowCount:0};
        if(/INSERT INTO|UPDATE optima_comercial/.test(sql)){
          escrituras++;return {rows:[],rowCount:1};
        }
        return {rows:[],rowCount:0};
      },
      release(){liberadas++;},
    };},
  };
  return {pool,queries,parametros,conexiones:()=>conexiones,liberadas:()=>liberadas,
    escrituras:()=>escrituras,consultasHistorial:()=>consultasHistorial};
}

test('P3C: activación derivada del estado PostgreSQL, con CAS e identidad del servidor',async()=>{
  const db=base();
  const r=await activarContratoDesdeServidor193(db.pool,async()=>identidad,intencion,reloj);
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(db.consultasHistorial(),2);
  assert.ok(db.queries.some(q=>q.includes('FOR UPDATE')));
  assert.ok(db.queries.some(q=>q.includes('INSERT INTO optima_comercial.eventos')));
  assert.ok(db.queries.some(q=>q.includes('INSERT INTO optima_comercial.idempotencia')));
  assert.equal(db.conexiones(),3);
  assert.equal(db.liberadas(),3);
  assert.ok(db.parametros.some(p=>p.includes(ACTIVADOR)));
  assert.ok(!db.parametros.some(p=>p.includes(OTRA)));
});
test('P3C: no acepta identidad, empresa ni historial inyectados en solicitud',async()=>{
  const db=base();
  for(const extra of [{empresaId:OTRA},{actorUsuarioId:APROBADOR},{anterior:aprobado},{siguiente:aprobado},
    {relojServidor:F0},{permisos:['ACTIVAR_CONTRATO']}]){
    const r=await activarContratoDesdeServidor193(db.pool,async()=>identidad,{...intencion,...extra},reloj);
    assert.deepEqual(r,{ok:false,motivo:'SOLICITUD_INVALIDA',accesoOperativoHabilitado:false});
  }
  assert.equal(db.conexiones(),0);
});
test('P3C: solicitud mal formada no consulta la sesión ni PostgreSQL',async()=>{
  const db=base();let sesiones=0;
  for(const v of [null,{}, {idContrato:'@',idVersion:VERSION,claveIdempotencia:CLAVE},
    {...intencion,claveIdempotencia:'mal'},
    {...intencion,idVersion:'VER-invalid$'},
  ]){
    const r=await activarContratoDesdeServidor193(db.pool,async()=>{sesiones++;return identidad;},v,reloj);
    assert.equal(r.ok,false);
  }
  assert.equal(sesiones,0);assert.equal(db.conexiones(),0);
});
test('P3C: sesión vencida, incompleta o de estructura desconocida bloquea sin consultar BD',async()=>{
  const db=base();
  for(const s of [null,undefined,{}, {...identidad,verificadaEnServidor:false},
    {...identidad,usuarioId:'x'}, {...identidad,permisos:['ACTIVAR_CONTRATO','ACTIVAR_CONTRATO']},
    {...identidad,token:'no-leer'}, {...identidad,permisos:['usuarios.gestionar']},
  ]){
    const r=await activarContratoDesdeServidor193(db.pool,async()=>s,intencion,reloj);
    assert.equal(r.ok,false);
  }
  assert.equal(db.conexiones(),0);
});
test('P3C: sin permiso de activación se rechaza antes de PostgreSQL',async()=>{
  const db=base();
  const r=await activarContratoDesdeServidor193(db.pool,
    async()=>({...identidad,permisos:['APROBAR_CONTRATO']}),intencion,reloj);
  assert.deepEqual(r,{ok:false,motivo:'PERMISO_INSUFICIENTE',accesoOperativoHabilitado:false});
  assert.equal(db.conexiones(),0);
});
test('P3C: la empresa sale de la sesión; un contrato ajeno no pasa el RLS',async()=>{
  const db=base();
  const r=await activarContratoDesdeServidor193(db.pool,
    async()=>({...identidad,empresaId:OTRA}),intencion,reloj);
  assert.equal(r.ok,false);
  assert.equal(db.escrituras(),0);
});
test('P3C: no puede activar quien aprobó esa misma versión',async()=>{
  const db=base();
  const r=await activarContratoDesdeServidor193(db.pool,
    async()=>({...identidad,usuarioId:APROBADOR}),intencion,reloj);
  assert.deepEqual(r,{ok:false,motivo:'SEPARACION_FUNCIONES',accesoOperativoHabilitado:false});
  assert.equal(db.escrituras(),0);
});
test('P3C: versión distinta o inexistente no produce escritura',async()=>{
  const db=base();
  const r=await activarContratoDesdeServidor193(db.pool,async()=>identidad,
    {...intencion,idVersion:'VER-CORE02'},reloj);
  assert.equal(r.ok,false);
  assert.equal(db.escrituras(),0);
});
test('P3C: si no hay contrato, se rechaza sin crearlo',async()=>{
  const db=base({sinContrato:true});
  const r=await activarContratoDesdeServidor193(db.pool,async()=>identidad,intencion,reloj);
  assert.deepEqual(r,{ok:false,motivo:'CONTRATO_NO_VERIFICADO',accesoOperativoHabilitado:false});
  assert.equal(db.escrituras(),0);
});
test('P3C: historial alterado bloquea la activación',async()=>{
  const db=base({estadoInvalido:true});
  const r=await activarContratoDesdeServidor193(db.pool,async()=>identidad,intencion,reloj);
  assert.equal(r.ok,false);assert.equal(db.escrituras(),0);
});
test('P3C: PostgreSQL caído, sesión con error y reloj inválido fallan cerrado',async()=>{
  const db=base({errorEn:'FROM optima_comercial.versiones'});
  assert.equal((await activarContratoDesdeServidor193(db.pool,async()=>identidad,intencion,reloj)).ok,false);
  const d2=base();
  assert.equal((await activarContratoDesdeServidor193(d2.pool,async()=>{throw Error('sesion');},intencion,reloj)).ok,false);
  assert.equal((await activarContratoDesdeServidor193(d2.pool,async()=>identidad,intencion,()=>F0)).ok,false);
  assert.equal(d2.escrituras(),0);
});
test('P3C: cambio concurrente es rechazado por el CAS',async()=>{
  const db=base({cambioConcurrente:true});
  const r=await activarContratoDesdeServidor193(db.pool,async()=>identidad,intencion,reloj);
  assert.deepEqual(r,{ok:false,motivo:'CONFLICTO_CONCURRENCIA',accesoOperativoHabilitado:false});
  assert.equal(db.escrituras(),0);
});
