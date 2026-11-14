import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { PoolPgNode183 } from '../core/adaptador-pg-node-12c183.js';
import { reconstruirHistorialComercialPg192 } from '../core/reconstruccion-historial-pg-12c192.js';
import { persistirCambioComercialVerificado192 } from '../core/escritura-comercial-verificada-12c192.js';
import {
  iniciarHistorialComercialLocal, aprobarBorradorComercialLocal, activarVersionComercialLocal,
  type HistorialContratacionSimulado,
} from '../core/historial-contratacion-comercial-12c173.js';
import { crearBorradorComercialLocal } from '../core/borradores-contratacion-comercial-12c172.js';

const E = 'rec'+'E'.repeat(14);
const OTRA = 'rec'+'O'.repeat(14);
const A = 'rec'+'A'.repeat(14);
const B = 'rec'+'B'.repeat(14);
const C = 'CONTRATO-CORE-01';
const F0 = '2026-11-12T10:00:00.000Z';
const F1 = '2026-11-12T11:00:00.000Z';
const F2 = '2026-11-12T12:00:00.000Z';
const F3 = '2026-11-12T13:00:00.000Z';
const S = [{ modalidad:'MODULO_PRINCIPAL', modulo:'INVENTARIO', nivel:'ESENCIAL' }] as const;
const inicial = iniciarHistorialComercialLocal({empresaId:E,idContrato:C});
assert.equal(inicial.ok,true);
if(!inicial.ok)throw Error('Fixture inicial inválida');
const borrador = crearBorradorComercialLocal({
  idBorrador:'BOR-CORE01',empresaId:E,idContrato:null,versionBase:null,
  serviciosBase:[],serviciosPropuestos:S,motivoCambio:'Contratación inicial de prueba',ahoraIso:F0,
});
assert.equal(borrador.ok,true);
if(!borrador.ok)throw Error('Fixture borrador inválida');
const aprobado = aprobarBorradorComercialLocal({
  historial:inicial.historial,borrador:borrador.borrador,empresaId:E,
  actorUsuarioId:A,idVersion:'VER-CORE01',revisionHistorialEsperada:0,ahoraIso:F1,
});
assert.equal(aprobado.ok,true);
if(!aprobado.ok)throw Error('Fixture aprobación inválida');
const hA = aprobado.historial;
const activado = activarVersionComercialLocal({
  historial:hA,empresaId:E,actorUsuarioId:B,
  idVersion:'VER-CORE01',revisionHistorialEsperada:1,ahoraIso:F2,
});
assert.equal(activado.ok,true);
if(!activado.ok)throw Error('Fixture activación inválida');
const hV = activado.historial;

function filas(h:HistorialContratacionSimulado){
  return {
    header:{empresa_id:E,id_contrato:C,revision:String(h.revisionHistorial),
      huella_historial:createHash('sha256').update(JSON.stringify(h)).digest('hex')},
    versiones:h.versiones.map(v=>({
      empresa_id:E,id_contrato:C,id_version:v.idVersion,numero:v.numero,estado:v.estado,
      // Imitar serialización JSONB con orden de claves distinto.
      servicios:v.servicios.map(({nivel,...resto})=>({nivel,...resto})),
      motivo_cambio:v.motivoCambio,aprobado_por_id:v.aprobadoPorId,
      aprobado_en_iso:v.aprobadoEnIso,vigente_desde_iso:v.vigenteDesdeIso,
      vigente_hasta_iso:v.vigenteHastaIso,sustituida_por_id:v.sustituidaPorId,
    })),
    eventos:h.eventos.map((e,i)=>({
      empresa_id:E,id_contrato:C,revision_antes:String(i),revision_despues:String(i+1),
      tipo:e.tipo,id_version:e.idVersion,id_version_anterior:e.idVersionAnterior,
      actor_usuario_id:e.actorUsuarioId,fecha_iso:e.fechaIso,
    })),
  };
}
type Opciones = {
  filas?: ReturnType<typeof filas>;
  consultaFallida?: string;
  rollbackFallido?: boolean;
  releaseFallido?: boolean;
  cabeceraEscritura?: {revision:string;huella_historial:string};
  sinContrato?: boolean;
};
function simular(opciones:Opciones={}) {
  const datos=opciones.filas??filas(hA);
  const queries:string[]=[];
  const parametros:unknown[][]=[];
  let conexiones=0,liberadas=0,escrituras=0;
  const pool:PoolPgNode183={
    async connect(){conexiones++;return {
      async query(sql:string,param?:unknown[]){
        queries.push(sql);parametros.push(param??[]);
        if(opciones.consultaFallida && sql.includes(opciones.consultaFallida))throw Error('pg falla');
        if(opciones.rollbackFallido && sql==='ROLLBACK')throw Error('rollback incierto');
        if(sql.includes('set_config')){assert.deepEqual(param,[E]);return {rows:[{empresa_id:E}],rowCount:1};}
        if(sql.includes('huella_historial') && sql.includes('LIMIT 2')){
          const h=opciones.sinContrato?[]:[datos.header];return {rows:h,rowCount:h.length};
        }
        if(sql.includes('FROM optima_comercial.versiones') && sql.includes('ORDER BY numero')){
          assert.deepEqual(param,[E,C]);return {rows:datos.versiones,rowCount:datos.versiones.length};
        }
        if(sql.includes('FROM optima_comercial.eventos') && sql.includes('ORDER BY revision_despues')){
          assert.deepEqual(param,[E,C]);return {rows:datos.eventos,rowCount:datos.eventos.length};
        }
        if(sql.includes('FOR UPDATE')){
          const h=opciones.cabeceraEscritura??{revision:datos.header.revision,huella_historial:datos.header.huella_historial};
          return {rows:[h],rowCount:1};
        }
        if(sql.includes('FROM optima_comercial.idempotencia'))return {rows:[],rowCount:0};
        if(/INSERT INTO|UPDATE optima_comercial/.test(sql)){escrituras++;return {rows:[],rowCount:1};}
        return {rows:[],rowCount:0};
      },release(){liberadas++;if(opciones.releaseFallido)throw Error('release incierto');},
    };},
  };
  return {pool,queries,parametros,conexiones:()=>conexiones,liberadas:()=>liberadas,escrituras:()=>escrituras};
}

test('P3B: reconstruye aprobación de PostgreSQL y comprueba huella SHA256',async()=>{
  const db=simular();const r=await reconstruirHistorialComercialPg192(db.pool,E,C);
  assert.equal(r.ok,true);
  if(r.ok)assert.deepEqual(r.historial,hA);
  assert.equal(db.queries[0],'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.ok(db.queries.some(q=>q.includes("set_config('optima.empresa_id', $1, true)")));
  assert.equal(db.queries.at(-1),'ROLLBACK');
  assert.equal(db.liberadas(),1);assert.equal(db.escrituras(),0);
});
test('P3B: reconstruye la versión activada y eventos consecutivos',async()=>{
  const db=simular({filas:filas(hV)});
  const r=await reconstruirHistorialComercialPg192(db.pool,E,C);
  assert.equal(r.ok,true);if(r.ok)assert.deepEqual(r.historial,hV);
});
test('P3B: no inventa un contrato si la base está vacía',async()=>{
  const db=simular({sinContrato:true});
  assert.deepEqual(await reconstruirHistorialComercialPg192(db.pool,E,C),{ok:false,motivo:'SIN_CONTRATO'});
  assert.equal(db.escrituras(),0);
});
test('P3B: empresa y contrato de entrada inválidos no consultan PostgreSQL',async()=>{
  const db=simular();
  assert.deepEqual(await reconstruirHistorialComercialPg192(db.pool,'empresa',C),{ok:false,motivo:'DATOS_INVALIDOS'});
  assert.deepEqual(await reconstruirHistorialComercialPg192(db.pool,E,'@contrato'),{ok:false,motivo:'DATOS_INVALIDOS'});
  assert.equal(db.conexiones(),0);
});
test('P3B: rechaza huella distinta, evento alterado y revisiones incompletas',async()=>{
  const casos=[
    {...filas(hA),header:{...filas(hA).header,huella_historial:'0'.repeat(64)}},
    {...filas(hA),eventos:filas(hA).eventos.map(x=>({...x,actor_usuario_id:B}))},
    {...filas(hA),eventos:[]},
    {...filas(hA),versiones:filas(hA).versiones.map(x=>({...x,empresa_id:OTRA}))},
    {...filas(hA),versiones:filas(hA).versiones.map(x=>({...x,servicios:[{modalidad:'MODULO_PRINCIPAL',modulo:'INVENTARIO',nivel:'NO_VALIDO'}]}))},
  ];
  for(const f of casos){const r=await reconstruirHistorialComercialPg192(simular({filas:f as ReturnType<typeof filas>}).pool,E,C);
    assert.equal(r.ok,false);if(r.ok === false)assert.equal(r.motivo,'HISTORIAL_INCONSISTENTE');}
});
test('P3B: error SQL, rollback o release incierto bloquea resultado',async()=>{
  for(const opts of [{consultaFallida:'FROM optima_comercial.eventos'},
    {rollbackFallido:true},{releaseFallido:true}]){
    const db=simular(opts);
    const r=await reconstruirHistorialComercialPg192(db.pool,E,C);
    assert.equal(r.ok,false);
    assert.equal(db.liberadas(),1);
  }
});
test('P3B: interpreta versiones históricas y activación de reemplazo',async()=>{
  const nuevo = crearBorradorComercialLocal({
    idBorrador:'BOR-CORE02',empresaId:E,idContrato:C,versionBase:1,
    serviciosBase:hV.versiones[0].servicios,
    serviciosPropuestos:[{modalidad:'MODULO_PRINCIPAL',modulo:'INVENTARIO',nivel:'GESTION'}],
    motivoCambio:'Ampliación comprobada en laboratorio',ahoraIso:F3,
  });
  assert.equal(nuevo.ok,true);
  const pasoA=aprobarBorradorComercialLocal({historial:hV,borrador:nuevo.borrador,
    empresaId:E,actorUsuarioId:A,idVersion:'VER-CORE02',revisionHistorialEsperada:2,
    ahoraIso:'2026-11-12T14:00:00.000Z'});
  assert.equal(pasoA.ok,true);
  const pasoB=activarVersionComercialLocal({historial:pasoA.historial,empresaId:E,
    actorUsuarioId:B,idVersion:'VER-CORE02',revisionHistorialEsperada:3,
    ahoraIso:'2026-11-12T15:00:00.000Z'});
  assert.equal(pasoB.ok,true);
  const db=simular({filas:filas(pasoB.historial)});
  const r=await reconstruirHistorialComercialPg192(db.pool,E,C);
  assert.equal(r.ok,true);
  if(r.ok)assert.deepEqual(r.historial,pasoB.historial);
  assert.equal(db.escrituras(),0);
});

test('P3B: corta resultados truncados o filas duplicadas',async()=>{
  const data=filas(hA);
  for(const f of [
    {...data,versiones:[...data.versiones,data.versiones[0]]},
    {...data,eventos:[...data.eventos,data.eventos[0]]},
    {...data,versiones:Array.from({length:101},()=>data.versiones[0])},
  ]){
    const db=simular({filas:f});
    const r=await reconstruirHistorialComercialPg192(db.pool,E,C);
    assert.equal(r.ok,false);
    assert.equal(db.escrituras(),0);
  }
});

test('P3B: acceso ajeno o sesión no verificada no genera consultas ni escrituras',async()=>{
  const db=simular();const t={anterior:hA,siguiente:hV,claveIdempotencia:'OP-CORE123456'};
  const sesiones=[null,{verificadaEnServidor:true,usuarioId:B,empresaId:OTRA,permisos:['ACTIVAR_CONTRATO']},
    {verificadaEnServidor:true,usuarioId:B,empresaId:E,permisos:[]}];
  for(const s of sesiones){const r=await persistirCambioComercialVerificado192(db.pool,async()=>s,t);
    assert.equal(r.ok,false);}
  assert.equal(db.conexiones(),0);assert.equal(db.escrituras(),0);
});
test('P3B: una transicion vieja se rechaza antes de escribir',async()=>{
  const db=simular({filas:filas(hV)});
  const r=await persistirCambioComercialVerificado192(db.pool,async()=>({
    verificadaEnServidor:true,usuarioId:B,empresaId:E,permisos:['ACTIVAR_CONTRATO'],
  }),{anterior:hA,siguiente:hV,claveIdempotencia:'OP-CORE123456'});
  assert.deepEqual(r,{ok:false,motivo:'REVISION_DESACTUALIZADA',accesoOperativoHabilitado:false});
  assert.equal(db.escrituras(),0);
});
test('P3B: si el contrato falta o está adulterado no habilita escritura',async()=>{
  const t={anterior:hA,siguiente:hV,claveIdempotencia:'OP-CORE123456'};
  for(const opts of [{sinContrato:true},{filas:{...filas(hA),header:{...filas(hA).header,huella_historial:'f'.repeat(64)}}}]){
    const db=simular(opts);
    const r=await persistirCambioComercialVerificado192(db.pool,async()=>({
      verificadaEnServidor:true,usuarioId:B,empresaId:E,permisos:['ACTIVAR_CONTRATO'],
    }),t);
    assert.equal(r.ok,false);assert.equal(db.escrituras(),0);
  }
});
test('P3B: transición autorizada usa CAS bajo FOR UPDATE y RLS en la misma conexión',async()=>{
  const db=simular();
  const r=await persistirCambioComercialVerificado192(db.pool,async()=>({
    verificadaEnServidor:true,usuarioId:B,empresaId:E,permisos:['ACTIVAR_CONTRATO'],
  }),{anterior:hA,siguiente:hV,claveIdempotencia:'OP-CORE123456'});
  assert.equal(r.ok,true);
  assert.ok(db.queries.some(x=>x.includes('FOR UPDATE')));
  assert.ok(db.queries.some(x=>x.includes("set_config('optima.empresa_id', $1, true)")));
  assert.equal(db.escrituras()>0,true);
  assert.equal(db.liberadas(),2);
});
test('P3B: cambio concurrente entre lectura y escritura se rechaza por CAS',async()=>{
  const db=simular({cabeceraEscritura:{revision:'2',huella_historial:'a'.repeat(64)}});
  const r=await persistirCambioComercialVerificado192(db.pool,async()=>({
    verificadaEnServidor:true,usuarioId:B,empresaId:E,permisos:['ACTIVAR_CONTRATO'],
  }),{anterior:hA,siguiente:hV,claveIdempotencia:'OP-CORE123456'});
  assert.equal(r.ok,false);
  assert.equal(db.escrituras(),0);
});
