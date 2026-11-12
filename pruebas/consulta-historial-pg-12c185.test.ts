import test from 'node:test';
import assert from 'node:assert/strict';
import {crearConsultaHistorialComercial185} from '../handlers/core/consulta-historial-pg-12c185.js';
import type {EstadoSesion185} from '../handlers/core/consulta-historial-pg-12c185.js';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';
const EMP='rec'+'A'.repeat(14),PLAT='rec'+'P'.repeat(14),USR='rec'+'C'.repeat(14);
const FECHA='2026-11-11T15:00:00.000Z';
function montar(estado:EstadoSesion185={estado:'OK',usuarioId:USR,empresaPlataformaId:PLAT},
    existe=true, falla='') {
  let conexiones=0,validaciones=0,autenticaciones=0;
  const pool:PoolPgNode183={connect:async()=>{
    conexiones++;
    return {query:async(sql:string)=>{
      if(falla==='base')throw Error('CLAVE_DE_BASE_SECRETA');
      const rows=sql.includes('FROM optima_comercial.contratos')?
        [{empresa_id:EMP,id_contrato:'CTR-READ185',revision:'1'}]:
        sql.includes('FROM optima_comercial.versiones')?
        [{id_version:'VER-READ185',numero:1,estado:'APROBADA',aprobado_por_id:USR,
          aprobado_en_iso:FECHA,vigente_desde_iso:null,vigente_hasta_iso:null,cantidad_servicios:1}]:
        sql.includes('FROM optima_comercial.eventos')?
        [{revision_antes:'0',revision_despues:'1',tipo:'APROBACION',id_version:'VER-READ185',actor_usuario_id:USR,fecha_iso:FECHA}]:[];
      return {rows,rowCount:rows.length};
    },release(){}};
  }};
  const handler=crearConsultaHistorialComercial185({pool,
    autenticar:async()=>{autenticaciones++;if(falla==='auth')throw Error('token sensible');return estado;},
    empresaClienteValida:async()=>{validaciones++;if(falla==='empresa')throw Error('token airtable');return existe;},
  });
  const responder=async(req:Record<string,unknown>)=>{
    const h:Record<string,string>={};let codigo=0,datos:unknown;
    await handler(req,{setHeader:(k:string,v:string)=>{h[k]=v;},status:(n:number)=>{codigo=n;return {json:(x:unknown)=>{datos=x;}};}});
    return {codigo,datos:datos as Record<string,unknown>,h};
  };
  const req=()=>({method:'GET',query:{empresaId:EMP,idContrato:'CTR-READ185'}});
  return {responder,req,conexiones:()=>conexiones,validaciones:()=>validaciones,autenticaciones:()=>autenticaciones};
}

test('consulta correcta de plataforma solo lectura',async()=>{
  const s=montar();const r=await s.responder(s.req());assert.equal(r.codigo,200);
  assert.equal(r.datos.ok,true);assert.equal(r.datos.soloConsulta,true);assert.equal(r.datos.accesoOperativoHabilitado,false);
  assert.equal(s.conexiones(),1);assert.equal(r.h['Cache-Control'],'no-store');
});
test('POST rechazado antes de autenticar',async()=>{
  const s=montar();const r=await s.responder({...s.req(),method:'POST'});assert.equal(r.codigo,405);
  assert.equal(s.autenticaciones(),0);assert.equal(s.conexiones(),0);
});
test('sin sesión no conecta',async()=>{
  const s=montar({estado:'SIN_SESION'});assert.equal((await s.responder(s.req())).codigo,401);assert.equal(s.conexiones(),0);
});
test('usuario cliente no accede',async()=>{
  const s=montar({estado:'NO_AUTORIZADO'});assert.equal((await s.responder(s.req())).codigo,403);assert.equal(s.conexiones(),0);
});
test('empresa de plataforma como objetivo denegada',async()=>{
  const s=montar();const r=await s.responder({...s.req(),query:{empresaId:PLAT,idContrato:'CTR-READ185'}});
  assert.equal(r.codigo,400);assert.equal(s.conexiones(),0);
});
test('empresa incorrecta sin consultar PostgreSQL',async()=>{
  const s=montar(undefined,false);assert.equal((await s.responder(s.req())).codigo,404);assert.equal(s.conexiones(),0);
});
test('query adicional rechazado',async()=>{
  const s=montar();const r=await s.responder({...s.req(),query:{...s.req().query,rol:'ADMIN'}});
  assert.equal(r.codigo,400);assert.equal(s.validaciones(),0);
});
test('id de empresa mal formado rechazado',async()=>{
  const s=montar();const r=await s.responder({...s.req(),query:{empresaId:'123',idContrato:'CTR-READ185'}});
  assert.equal(r.codigo,400);assert.equal(s.conexiones(),0);
});
test('contrato con SQL rechazado',async()=>{
  const s=montar();const r=await s.responder({...s.req(),query:{empresaId:EMP,idContrato:"';DROP TABLE"}});
  assert.equal(r.codigo,400);assert.equal(s.conexiones(),0);
});
test('parámetros tipo arreglo rechazados',async()=>{
  const s=montar();const r=await s.responder({...s.req(),query:{empresaId:[EMP],idContrato:'CTR-READ185'}});
  assert.equal(r.codigo,400);assert.equal(s.conexiones(),0);
});
test('sesión supuestamente válida sin usuario no basta',async()=>{
  const s=montar({estado:'OK',usuarioId:'fake',empresaPlataformaId:PLAT});
  assert.equal((await s.responder(s.req())).codigo,403);assert.equal(s.conexiones(),0);
});
test('fallo de Redis no expone credenciales',async()=>{
  const s=montar(undefined,true,'auth');const r=await s.responder(s.req());assert.equal(r.codigo,503);
  assert.ok(!JSON.stringify(r.datos).includes('token sensible'));assert.equal(s.conexiones(),0);
});
test('fallo de Airtable no expone credenciales',async()=>{
  const s=montar(undefined,true,'empresa');const r=await s.responder(s.req());assert.equal(r.codigo,503);
  assert.ok(!JSON.stringify(r.datos).includes('token airtable'));assert.equal(s.conexiones(),0);
});
test('fallo de PostgreSQL no expone credenciales',async()=>{
  const s=montar(undefined,true,'base');const r=await s.responder(s.req());assert.equal(r.codigo,503);
  assert.ok(!JSON.stringify(r.datos).includes('CLAVE_DE_BASE_SECRETA'));
});
test('la solicitud no admite usuarioId desde el navegador',async()=>{
  const s=montar();const r=await s.responder({...s.req(),query:{...s.req().query,usuarioId:USR}});
  assert.equal(r.codigo,400);assert.equal(s.conexiones(),0);
});
test('no permite método DELETE',async()=>{
  const s=montar();assert.equal((await s.responder({...s.req(),method:'DELETE'})).codigo,405);assert.equal(s.conexiones(),0);
});
