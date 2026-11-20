import test from 'node:test';
import assert from 'node:assert/strict';
import {leerHistorialComercialPg185} from '../core/lectura-historial-pg-12c185.js';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';
const EMP='emp_'+'a'.repeat(12), OTRA='emp_'+'z'.repeat(12),USR='rec'+'B'.repeat(14);
const FECHA='2026-11-11T15:00:00.000Z';
type Row=Record<string,unknown>;
function datos(){return {
  cab:[{empresa_id:EMP,id_contrato:'CTR-READ185',revision:'1'}] as Row[],
  versiones:[{id_version:'VER-READ185',numero:1,estado:'APROBADA',aprobado_por_id:USR,
    aprobado_en_iso:FECHA,vigente_desde_iso:null,vigente_hasta_iso:null,cantidad_servicios:2}] as Row[],
  eventos:[{revision_antes:'0',revision_despues:'1',tipo:'APROBACION',id_version:'VER-READ185',actor_usuario_id:USR,fecha_iso:FECHA}] as Row[],
  borradores:[{id_borrador:'BOR-READ185',revision_borrador:'1',estado:'APROBADO'}] as Row[],
};}
type Datos=ReturnType<typeof datos>;
function simular(cambio?:(datos:Datos)=>void,{fallar='',sinConexion=false}={}):{
  pool:PoolPgNode183;consultas:{sql:string;args:unknown[]}[];liberaciones:()=>number;conexiones:()=>number;
}{
  const d=datos();cambio?.(d);const consultas:{sql:string;args:unknown[]}[]=[];
  let liberado=0,abiertas=0;
  const pool:PoolPgNode183={connect:async()=>{
    abiertas++;
    if(sinConexion)throw Error('secreto de conexion');
    return {query:async(sql:string,args:unknown[]=[])=>{
      consultas.push({sql,args});
      if(fallar&&sql.includes(fallar))throw Error('PASSWORD_SECRETA');
      const rows=sql.includes('FROM optima_comercial.contratos')?d.cab:
        sql.includes('FROM optima_comercial.versiones')?d.versiones:
        sql.includes('FROM optima_comercial.eventos')?d.eventos:
        sql.includes('FROM optima_comercial.borradores')?d.borradores:[];
      return {rows,rowCount:rows.length};
    },release:()=>{liberado++;}};
  }};
  return {pool,consultas,liberaciones:()=>liberado,conexiones:()=>abiertas};
}
const leer=(pool:PoolPgNode183,empresa=EMP,contrato='CTR-READ185')=>leerHistorialComercialPg185(pool,empresa,contrato);

test('historial completo autorizado y saneado',async()=>{
  const s=simular();const r=await leer(s.pool);assert.equal(r.ok,true);
  if(r.ok){assert.equal(r.historial.revision,1);assert.equal(r.historial.versiones.length,1);
    assert.equal(r.historial.versiones[0].cantidadServicios,2);
    assert.equal(r.historial.eventos.length,1);assert.equal(r.historial.borradores.length,1);
    assert.equal(r.historial.soloConsulta,true);assert.equal(r.historial.accesoOperativoHabilitado,false);
    assert.equal(JSON.stringify(r).includes('servicios'),false);}
});
test('solo lectura transaccional repeatable read',async()=>{
  const s=simular();await leer(s.pool);
  assert.equal(s.consultas[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  assert.equal(s.consultas[1].sql,"SELECT set_config('optima.empresa_id', $1, true)");
  assert.equal(s.consultas.at(-1)?.sql,'ROLLBACK');
  assert.ok(!s.consultas.some(q=>/\b(INSERT|UPDATE|DELETE|COMMIT)\b/i.test(q.sql)));
});
test('identificador de empresa via parametro SQL',async()=>{
  const s=simular();await leer(s.pool);
  assert.deepEqual(s.consultas[1].args,[EMP]);
  assert.ok(s.consultas.filter(x=>x.sql.includes('FROM optima_comercial.')).every(x=>x.args[0]===EMP&&x.args[1]==='CTR-READ185'));
});
test('contexto transaccional se limpia y conexion se libera',async()=>{
  const s=simular();await leer(s.pool);assert.equal(s.liberaciones(),1);assert.equal(s.consultas.at(-1)?.sql,'ROLLBACK');
});
test('identificador invalido no abre conexion',async()=>{
  const s=simular();const r=await leer(s.pool,'otra-empresa');assert.equal(r.ok,false);assert.equal(s.conexiones(),0);
});
test('ID de contrato invalido no abre conexion',async()=>{
  const s=simular();const r=await leer(s.pool,EMP,'CTR;DROP TABLE');assert.equal(r.ok,false);assert.equal(s.conexiones(),0);
});
test('inexistente retorna no encontrado',async()=>{
  const s=simular(d=>{d.cab=[];});const r=await leer(s.pool);
  assert.deepEqual(r,{ok:false,motivo:'NO_ENCONTRADO',accesoOperativoHabilitado:false});
  assert.equal(s.consultas.at(-1)?.sql,'ROLLBACK');
});
test('error SQL se oculta y cierra transaccion',async()=>{
  const s=simular(undefined,{fallar:'FROM optima_comercial.eventos'});
  assert.deepEqual(await leer(s.pool),{ok:false,motivo:'ERROR_BD',accesoOperativoHabilitado:false});
  assert.equal(s.consultas.at(-1)?.sql,'ROLLBACK');assert.equal(s.liberaciones(),1);
});
test('error conexión no expone secretos',async()=>{
  const s=simular(undefined,{sinConexion:true});assert.equal(JSON.stringify(await leer(s.pool)).includes('secreto'),false);
});
test('cabecera de otra empresa se rechaza',async()=>{
  const s=simular(d=>{d.cab[0].empresa_id=OTRA;});const r=await leer(s.pool);
  assert.deepEqual(r,{ok:false,motivo:'HISTORIAL_INCONSISTENTE',accesoOperativoHabilitado:false});
});
test('dos cabeceras inconsistentes',async()=>{
  const s=simular(d=>{d.cab.push({...d.cab[0]});});assert.equal((await leer(s.pool)).ok,false);
});
test('revisión no numérica rechazada',async()=>{
  const s=simular(d=>{d.cab[0].revision='abc';});assert.equal((await leer(s.pool)).ok,false);
});
test('revisión fuera de límite rechazada',async()=>{
  const s=simular(d=>{d.cab[0].revision='101';});assert.equal((await leer(s.pool)).ok,false);
});
test('sin eventos pero revisión uno se rechaza',async()=>{
  const s=simular(d=>{d.eventos=[];});assert.equal((await leer(s.pool)).ok,false);
});
test('eventos con revisión salteada se rechazan',async()=>{
  const s=simular(d=>{d.eventos[0].revision_despues='2';});assert.equal((await leer(s.pool)).ok,false);
});
test('evento de versión ajena se rechaza',async()=>{
  const s=simular(d=>{d.eventos[0].id_version='VER-AJENA185';});assert.equal((await leer(s.pool)).ok,false);
});
test('fecha inválida se rechaza',async()=>{
  const s=simular(d=>{d.eventos[0].fecha_iso='fecha';});assert.equal((await leer(s.pool)).ok,false);
});
test('versión sin aprobador se rechaza',async()=>{
  const s=simular(d=>{d.versiones[0].aprobado_por_id='usuario';});assert.equal((await leer(s.pool)).ok,false);
});
test('versiones con número salteado se rechazan',async()=>{
  const s=simular(d=>{d.versiones[0].numero=2;});assert.equal((await leer(s.pool)).ok,false);
});
test('aprobada con vigencia se rechaza',async()=>{
  const s=simular(d=>{d.versiones[0].vigente_desde_iso=FECHA;});assert.equal((await leer(s.pool)).ok,false);
});
test('vigente sin inicio se rechaza',async()=>{
  const s=simular(d=>{d.versiones[0].estado='VIGENTE';});assert.equal((await leer(s.pool)).ok,false);
});
test('número negativo de servicios se rechaza',async()=>{
  const s=simular(d=>{d.versiones[0].cantidad_servicios=-1;});assert.equal((await leer(s.pool)).ok,false);
});
test('borrador inválido se rechaza',async()=>{
  const s=simular(d=>{d.borradores[0].revision_borrador='0';});assert.equal((await leer(s.pool)).ok,false);
});
test('más de 100 borradores se rechazan',async()=>{
  const s=simular(d=>{d.borradores=Array.from({length:101},(_,i)=>({...d.borradores[0],id_borrador:`BOR-READ-${i}`}));});
  assert.equal((await leer(s.pool)).ok,false);
});
test('historial vacío revisión 0 legítimo',async()=>{
  const s=simular(d=>{d.cab[0].revision='0';d.versiones=[];d.eventos=[];d.borradores=[];});
  const r=await leer(s.pool);assert.equal(r.ok,true);
  if(r.ok)assert.equal(r.historial.revision,0);
});
test('activación válida y estado VIGENTE aceptados',async()=>{
  const s=simular(d=>{
    d.versiones[0].estado='VIGENTE';d.versiones[0].vigente_desde_iso=FECHA;
    d.eventos[0].tipo='ACTIVACION';
  });assert.equal((await leer(s.pool)).ok,true);
});
test('contexto limitado no vuelve a COMMIT',async()=>{
  const s=simular();await leer(s.pool);assert.ok(s.consultas.every(c=>!/^COMMIT$/.test(c.sql)));
});
