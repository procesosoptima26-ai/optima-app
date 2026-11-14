import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';
import {
  crearBorradorContractualPg194,
  aprobarBorradorContractualPg194,
} from '../core/borradores-aprobacion-pg-12c194.js';
import {iniciarHistorialComercialLocal} from '../core/historial-contratacion-comercial-12c173.js';

const EMP='rec'+'E'.repeat(14),AJENA='rec'+'X'.repeat(14),ADMIN='rec'+'A'.repeat(14);
const CONTRATO='CORE-PRUEBA-01', BOR='BOR-P3D0001', VER='VER-P3D0001';
const T0='2026-11-13T18:00:00.000Z',T1='2026-11-13T19:00:00.000Z';
const S=[{modalidad:'MODULO_PRINCIPAL',modulo:'INVENTARIO',nivel:'ESENCIAL'}];
const solicitud={idContrato:CONTRATO,idBorrador:BOR,versionBase:null,serviciosPropuestos:S,
  motivoCambio:'Contratación inicial integrada'};
const aprobacion={idContrato:CONTRATO,idBorrador:BOR,idVersion:VER,
  revisionHistorialEsperada:0,revisionBorradorEsperada:1,claveIdempotencia:'OP-P3D000001'};
const identidad=(permiso:string,empresaId=EMP)=>async()=>({verificadaEnServidor:true,
  usuarioId:ADMIN,empresaId,permisos:[permiso]});
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const h0=iniciarHistorialComercialLocal({empresaId:EMP,idContrato:CONTRATO});
assert.equal(h0.ok,true);if(!h0.ok)throw Error('Historial inicial incorrecto');

type Draft={empresa_id:string;id_contrato:string;id_borrador:string;revision_borrador:string;
  version_base:number|null;servicios_propuestos:unknown;motivo_cambio:string;estado:string;
  creado_por_id:string;creado_en:string;actualizado_en:string};
function simular(opts:{fallo?:string;otraEmpresa?:boolean;rollBackFalla?:boolean;alterarHuella?:boolean}={}){
  let header:null|{empresa_id:string;id_contrato:string;revision:string;huella_historial:string}=null;
  let draft:Draft|null=null;
  let idem:null|{huella_solicitud:string;revision_aplicada:string;respuesta:unknown}=null;
  let version:Record<string,unknown>|null=null;
  let evento:Record<string,unknown>|null=null;
  const consultas:string[]=[],acciones:string[]=[];
  let conexiones=0,liberaciones=0;
  const pool:PoolPgNode183={async connect(){conexiones++;return {
    async query(sql:string,param:unknown[]=[]){
      consultas.push(sql);if(opts.fallo&&sql.includes(opts.fallo))throw Error('SQL forzado');
      if(sql==='ROLLBACK'&&opts.rollBackFalla)throw Error('rollback sin confirmación');
      if(sql==='BEGIN'||sql.startsWith('BEGIN TRANSACTION')){
        acciones.push('BEGIN');return {rows:[],rowCount:0};
      }
      if(sql==='COMMIT'||sql==='ROLLBACK'){
        acciones.push(sql);return {rows:[],rowCount:0};
      }
      if(sql.includes('set_config')){
        const v=param[0] as string;
        return {rows:[{empresa_id:opts.otraEmpresa?AJENA:v}],rowCount:1};
      }
      if(sql.includes('FROM optima_comercial.contratos')&&sql.includes('LIMIT 2')){
        return {rows:header?[header]:[],rowCount:header?1:0};
      }
      if(sql.includes('INSERT INTO optima_comercial.contratos')){
        if(!header)header={empresa_id:param[0] as string,id_contrato:param[1] as string,
          revision:'0',huella_historial:param[2] as string};
        return {rows:[],rowCount:1};
      }
      if(sql.includes('FROM optima_comercial.contratos')&&sql.includes('FOR UPDATE')){
        return {rows:header?[{...header,huella_historial:opts.alterarHuella?'a'.repeat(64):header.huella_historial}]:[],
          rowCount:header?1:0};
      }
      if(sql.includes('FROM optima_comercial.versiones')&&sql.includes('ORDER BY numero')){
        return {rows:version?[version]:[],rowCount:version?1:0};
      }
      if(sql.includes('FROM optima_comercial.eventos')&&sql.includes('ORDER BY revision_despues')){
        return {rows:evento?[evento]:[],rowCount:evento?1:0};
      }
      if(sql.includes('FROM optima_comercial.borradores')&&sql.includes('estado=\'BORRADOR\'')){
        return {rows:draft&&draft.estado==='BORRADOR'?[{id_borrador:draft.id_borrador}]:[],rowCount:draft&&draft.estado==='BORRADOR'?1:0};
      }
      if(sql.includes('FROM optima_comercial.borradores')&&sql.includes('FOR UPDATE')){
        return {rows:draft?[draft]:[],rowCount:draft?1:0};
      }
      if(sql.includes('INSERT INTO optima_comercial.borradores')){
        draft={empresa_id:param[0] as string,id_contrato:param[1] as string,id_borrador:param[2] as string,
          revision_borrador:'1',version_base:param[3] as number|null,
          servicios_propuestos:JSON.parse(param[4] as string),motivo_cambio:param[5] as string,
          estado:'BORRADOR',creado_por_id:param[6] as string,creado_en:param[7] as string,
          actualizado_en:param[7] as string};
        acciones.push('BORRADOR');return {rows:[],rowCount:1};
      }
      if(sql.includes('FROM optima_comercial.idempotencia')){
        return {rows:idem?[idem]:[],rowCount:idem?1:0};
      }
      if(sql.includes('INSERT INTO optima_comercial.versiones')){
        version={empresa_id:param[0],id_contrato:param[1],id_version:param[2],numero:param[3],
          estado:param[4],servicios:JSON.parse(param[5] as string),motivo_cambio:param[6],
          aprobado_por_id:param[7],aprobado_en_iso:param[8],vigente_desde_iso:param[9],
          vigente_hasta_iso:param[10],sustituida_por_id:param[11]};
        acciones.push('VERSION');return {rows:[],rowCount:1};
      }
      if(sql.includes('INSERT INTO optima_comercial.eventos')){
        evento={empresa_id:param[0],id_contrato:param[1],revision_antes:String(param[2]),
          revision_despues:String(param[3]),tipo:param[4],id_version:param[5],
          id_version_anterior:param[6],actor_usuario_id:param[7],fecha_iso:param[8]};
        acciones.push('EVENTO');return {rows:[],rowCount:1};
      }
      if(sql.includes('UPDATE optima_comercial.borradores')){
        if(draft){draft.estado='APROBADO';draft.actualizado_en=param[4] as string;}
        acciones.push('BORRADOR_APROBADO');return {rows:[],rowCount:1};
      }
      if(sql.includes('INSERT INTO optima_comercial.idempotencia')){
        idem={huella_solicitud:param[3] as string,revision_aplicada:String(param[5]),
          respuesta:JSON.parse(param[4] as string)};
        acciones.push('IDEMPOTENCIA');return {rows:[],rowCount:1};
      }
      if(sql.includes('UPDATE optima_comercial.contratos')){
        if(header){header.revision=String(param[2]);header.huella_historial=param[3] as string;}
        acciones.push('CABECERA');return {rows:[],rowCount:1};
      }
      throw Error(`SQL no previsto: ${sql}`);
    },
    release(){liberaciones++;},
  };}};
  return {pool,acciones,consultas,get header(){return header;},get draft(){return draft;},
    get version(){return version;},get idem(){return idem;},conexiones:()=>conexiones,liberaciones:()=>liberaciones};
}

test('P3D: crea contrato inicial y borrador persistido, sin activar funcionalidades',async()=>{
  const db=simular();const r=await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  assert.deepEqual(r,{ok:true,idBorrador:BOR,revisionBorrador:1,accesoOperativoHabilitado:false});
  assert.equal(db.header?.revision,'0');assert.equal(db.header?.huella_historial,hash(h0.historial));
  assert.equal(db.draft?.estado,'BORRADOR');assert.equal(db.acciones.at(-1),'COMMIT');
  assert.equal(db.liberaciones(),2);assert.equal(db.consultas.some(x=>x.includes('set_config')),true);
});
test('P3D: aprobación lee borrador real y persiste versión+evento+estado+idempotencia',async()=>{
  const db=simular();await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  const r=await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),aprobacion,()=>T1);
  assert.deepEqual(r,{ok:true,idVersion:VER,revisionAplicada:1,repetida:false,accesoOperativoHabilitado:false});
  assert.equal(db.draft?.estado,'APROBADO');assert.equal(db.version?.estado,'APROBADA');
  assert.equal(db.header?.revision,'1');assert.equal(db.acciones.at(-1),'COMMIT');
  for(const x of ['VERSION','EVENTO','BORRADOR_APROBADO','IDEMPOTENCIA','CABECERA'])assert.ok(db.acciones.includes(x));
});
test('P3D: un reintento de aprobación con la misma clave no crea otro evento',async()=>{
  const db=simular();await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),aprobacion,()=>T1);
  const n=db.acciones.filter(x=>x==='EVENTO').length;
  const r=await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),aprobacion,()=>T1);
  assert.equal(r.ok,true);if(r.ok)assert.equal(r.repetida,true);
  assert.equal(db.acciones.filter(x=>x==='EVENTO').length,n);
});
test('P3D: duplicación de borrador activo se bloquea',async()=>{
  const db=simular();await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  const r=await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),{
    ...solicitud,idBorrador:'BOR-P3D0002'},()=>T1);
  assert.equal(r.ok,false);if(!r.ok)assert.equal(r.motivo,'BORRADOR_ACTIVO_EXISTENTE');
  assert.equal(db.acciones.filter(x=>x==='BORRADOR').length,1);
});
test('P3D: faltan sesión o permisos, no se generan operaciones',async()=>{
  for(const ses of [async()=>null,identidad('APROBAR_CONTRATO')]){
    const db=simular();const r=await crearBorradorContractualPg194(db.pool,ses,solicitud,()=>T0);
    assert.equal(r.ok,false);assert.equal(db.acciones.includes('BORRADOR'),false);
    assert.equal(db.conexiones(),0);
  }
});
test('P3D: una sesión de empresa distinta no aprueba borradores ajenos',async()=>{
  const db=simular();
  await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  const r=await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO',AJENA),aprobacion,()=>T1);
  assert.equal(r.ok,false);assert.equal(db.acciones.includes('VERSION'),false);
});
test('P3D: ataque de identidad desde el body y servicios inválidos se rechaza',async()=>{
  const db=simular();for(const req of [
    {...solicitud,empresaId:AJENA},{...solicitud,actorUsuarioId:ADMIN},
    {...solicitud,serviciosPropuestos:[{modalidad:'MODULO_PRINCIPAL',modulo:'INVENTARIO',nivel:'ILEGAL'}]},
    {...solicitud,versionBase:2},
  ]){
    const r=await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),req,()=>T0);
    assert.equal(r.ok,false);
  }
  assert.equal(db.acciones.includes('BORRADOR'),false);
});
test('P3D: no autoriza una transacción sin confirmar el RLS',async()=>{
  const db=simular({otraEmpresa:true});
  const r=await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  assert.equal(r.ok,false);assert.equal(db.acciones.includes('BORRADOR'),false);
  assert.equal(db.acciones.includes('ROLLBACK'),true);
});
test('P3D: error al insertar borrador revierte el proceso',async()=>{
  const db=simular({fallo:'INSERT INTO optima_comercial.borradores'});
  const r=await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  assert.equal(r.ok,false);assert.equal(db.acciones.includes('COMMIT'),false);
  assert.equal(db.acciones.includes('ROLLBACK'),true);
});
test('P3D: error al insertar evento impide confirmar aprobación',async()=>{
  const db=simular({fallo:'INSERT INTO optima_comercial.eventos'});
  await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  const r=await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),aprobacion,()=>T1);
  assert.equal(r.ok,false);assert.equal(db.acciones.filter(x=>x==='COMMIT').length,1);
  assert.equal(db.acciones.at(-1),'ROLLBACK');
});
test('P3D: no admite aprobar una revisión anterior ni un borrador inexistente',async()=>{
  const db=simular();await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  for(const req of [{...aprobacion,revisionBorradorEsperada:2},
    {...aprobacion,revisionHistorialEsperada:1},{...aprobacion,idBorrador:'BOR-P3D9999'}]){
    const r=await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),req,()=>T1);
    assert.equal(r.ok,false);
  }
  assert.equal(db.acciones.filter(x=>x==='EVENTO').length,0);
});
test('P3D: no permite reutilizar clave idempotente con otra solicitud',async()=>{
  const db=simular();await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),aprobacion,()=>T1);
  const r=await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),{
    ...aprobacion,revisionBorradorEsperada:2},()=>T1);
  assert.equal(r.ok,false);if(!r.ok)assert.equal(r.motivo,'CONFLICTO_IDEMPOTENCIA');
  assert.equal(db.acciones.filter(x=>x==='EVENTO').length,1);
});
test('P3D: un hash contractual alterado impide escribir',async()=>{
  const db=simular({alterarHuella:true});
  const r=await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  assert.equal(r.ok,false);assert.equal(db.acciones.includes('BORRADOR'),false);
});
test('P3D: borrador adulterado en PostgreSQL no se aprueba',async()=>{
  const db=simular();await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  if(db.draft)db.draft.servicios_propuestos=[{modalidad:'MODULO_PRINCIPAL',modulo:'INVENTARIO',nivel:'SUPERADMIN'}];
  const r=await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),aprobacion,()=>T1);
  assert.equal(r.ok,false);assert.equal(db.acciones.includes('VERSION'),false);
});
test('P3D: empresa de borrador inconsistente no da acceso al contrato',async()=>{
  const db=simular();await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  if(db.draft)db.draft.empresa_id=AJENA;
  const r=await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),aprobacion,()=>T1);
  assert.equal(r.ok,false);assert.equal(db.acciones.includes('VERSION'),false);
});

test('P3D: la idempotencia no depende del orden de propiedades del objeto',async()=>{
  const db=simular();await crearBorradorContractualPg194(db.pool,identidad('GESTIONAR_BORRADORES'),solicitud,()=>T0);
  await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),aprobacion,()=>T1);
  const req={claveIdempotencia:aprobacion.claveIdempotencia,
    revisionBorradorEsperada:1,revisionHistorialEsperada:0,
    idVersion:VER,idBorrador:BOR,idContrato:CONTRATO};
  const r=await aprobarBorradorContractualPg194(db.pool,identidad('APROBAR_CONTRATO'),req,()=>T1);
  assert.equal(r.ok,true);if(r.ok)assert.equal(r.repetida,true);
  assert.equal(db.acciones.filter(x=>x==='EVENTO').length,1);
});
