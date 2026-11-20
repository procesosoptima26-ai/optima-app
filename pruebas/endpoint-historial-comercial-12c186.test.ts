import test from 'node:test';
import assert from 'node:assert/strict';
import {crearEndpointHistorialComercial186} from '../lib/endpoint-historial-comercial-12c186.js';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';
import type {EstadoSesion185} from '../handlers/core/consulta-historial-pg-12c185.js';
const EMP='rec'+'A'.repeat(14),EST='emp_'+'a'.repeat(12),PLAT='rec'+'P'.repeat(14),USR='rec'+'B'.repeat(14);
const F='2026-11-11T15:00:00.000Z';
const SES:EstadoSesion185={estado:'OK',usuarioId:USR,empresaPlataformaId:PLAT};
function armar(opts:{activo?:boolean;sesion?:EstadoSesion185;empresa?:boolean;falla?:string}={}){
  const a={activo:opts.activo??true,sesion:opts.sesion??SES,empresa:opts.empresa??true,falla:opts.falla??''};
  let sesiones=0,validaciones=0,pools=0,conexiones=0;
  const pool:PoolPgNode183={connect:async()=>{
    conexiones++;
    if(a.falla==='pool')throw Error('dsn confidencial');
    return {query:async(sql:string)=>{
      const rows=sql.includes('FROM optima_comercial.contratos')?
        [{empresa_id:EST,id_contrato:'CTR-READ185',revision:'1'}]:
        sql.includes('FROM optima_comercial.versiones')?
        [{id_version:'VER-READ185',numero:1,estado:'APROBADA',aprobado_por_id:USR,
          aprobado_en_iso:F,vigente_desde_iso:null,vigente_hasta_iso:null,cantidad_servicios:1}]:
        sql.includes('FROM optima_comercial.eventos')?
        [{revision_antes:'0',revision_despues:'1',tipo:'APROBACION',id_version:'VER-READ185',actor_usuario_id:USR,fecha_iso:F}]:[];
      return {rows,rowCount:rows.length};
    },release(){}};
  }};
  const e=crearEndpointHistorialComercial186({
    habilitado:()=>{if(a.falla==='flag')throw Error('flag confidencial');return a.activo;},
    crearPool:()=>{pools++;return pool;},
    autenticar:async()=>{sesiones++;if(a.falla==='auth')throw Error('redis confidencial');return a.sesion;},
    empresaClienteValida:async()=>{validaciones++;if(a.falla==='empresa')throw Error('airtable confidencial');return a.empresa;},
    resolverEmpresaCliente:async()=>{validaciones++;if(a.falla==='empresa')throw Error('airtable confidencial');return {activa:a.empresa,idEstable:EST};},
  });
  async function llamar(req:Record<string,unknown>={method:'GET',query:{empresaId:EMP,idContrato:'CTR-READ185'}}){
    let status=0,datos:unknown;
    const headers:Record<string,string>={};
    await e(req,{setHeader(k,v){headers[k]=v;},status(n){status=n;return {json(x){datos=x;}};}});
    return {status,datos:datos as Record<string,unknown>,headers};
  }
  return {llamar,a,contar:()=>({sesiones,validaciones,pools,conexiones})};
}
const correcto=()=>({method:'GET',query:{empresaId:EMP,idContrato:'CTR-READ185'}});
test('por defecto / apagado devuelve 404 y no accede a nada',async()=>{
  const s=armar({activo:false});const r=await s.llamar();assert.equal(r.status,404);
  assert.deepEqual(s.contar(),{sesiones:0,validaciones:0,pools:0,conexiones:0});
});
test('apagado deniega incluso GET con parámetros válidos',async()=>{
  const s=armar({activo:false});assert.equal((await s.llamar(correcto())).status,404);
});
test('apagado deniega incluso POST',async()=>{
  const s=armar({activo:false});assert.equal((await s.llamar({method:'POST'})).status,404);
});
test('headers de seguridad incluso apagado',async()=>{
  const r=await armar({activo:false}).llamar();
  assert.equal(r.headers['Cache-Control'],'no-store, max-age=0');
  assert.equal(r.headers['Referrer-Policy'],'no-referrer');
  assert.equal(r.headers['X-Content-Type-Options'],'nosniff');
});
test('GET válido con admin da historial no operativo',async()=>{
  const s=armar();const r=await s.llamar();assert.equal(r.status,200);
  assert.equal(r.datos.ok,true);assert.equal(r.datos.accesoOperativoHabilitado,false);
  assert.equal(r.datos.soloConsulta,true);assert.equal(s.contar().conexiones,1);
});
test('respuesta no incluye precio ni secretos',async()=>{
  const r=await armar().llamar();assert.equal(r.status,200);
  assert.ok(!JSON.stringify(r.datos).includes('precio'));
  assert.ok(!JSON.stringify(r.datos).includes('token'));
});
test('POST 405 antes de sesión',async()=>{
  const s=armar();const r=await s.llamar({...correcto(),method:'POST'});
  assert.equal(r.status,405);assert.equal(r.headers.Allow,'GET');
  assert.equal(s.contar().sesiones,0);
});
for(const method of ['PUT','PATCH','DELETE','HEAD','OPTIONS']){
  test(`${method} nunca accede a la BD`,async()=>{
    const s=armar();const r=await s.llamar({...correcto(),method});
    assert.equal(r.status,405);assert.equal(s.contar().pools,0);
  });
}
test('GET con body rechazado',async()=>{
  const s=armar();const r=await s.llamar({...correcto(),body:{operacion:'APROBAR'}});
  assert.equal(r.status,400);assert.equal(s.contar().sesiones,0);
});
test('GET con body como texto rechazado',async()=>{
  const s=armar();const r=await s.llamar({...correcto(),body:'texto'});
  assert.equal(r.status,400);assert.equal(s.contar().pools,0);
});
test('sin cookie 401 sin pool',async()=>{
  const s=armar({sesion:{estado:'SIN_SESION'}});assert.equal((await s.llamar()).status,401);
  assert.equal(s.contar().pools,0);
});
test('cliente no autorizado 403 sin pool',async()=>{
  const s=armar({sesion:{estado:'NO_AUTORIZADO'}});assert.equal((await s.llamar()).status,403);
  assert.equal(s.contar().pools,0);
});
test('usuario inválido 403 sin pool',async()=>{
  const s=armar({sesion:{estado:'OK',usuarioId:'fake',empresaPlataformaId:PLAT}});
  assert.equal((await s.llamar()).status,403);assert.equal(s.contar().pools,0);
});
test('empresa propia de plataforma no consultable',async()=>{
  const s=armar();assert.equal((await s.llamar({method:'GET',query:{empresaId:PLAT,idContrato:'CTR-READ185'}})).status,400);
  assert.equal(s.contar().pools,0);
});
test('empresa inexistente 404 antes del pool',async()=>{
  const s=armar({empresa:false});assert.equal((await s.llamar()).status,404);
  assert.equal(s.contar().pools,0);
});
test('parámetro extra de rol inválido',async()=>{
  const s=armar();const r=await s.llamar({method:'GET',query:{...correcto().query,rol:'ADMIN'}});
  assert.equal(r.status,400);assert.equal(s.contar().pools,0);
});
test('inyección SQL bloqueada antes del pool',async()=>{
  const s=armar();const r=await s.llamar({method:'GET',query:{empresaId:EMP,idContrato:"'; DROP TABLE"}});
  assert.equal(r.status,400);assert.equal(s.contar().pools,0);
});
test('arreglos de query rechazados',async()=>{
  const s=armar();const r=await s.llamar({method:'GET',query:{empresaId:[EMP],idContrato:'CTR-READ185'}});
  assert.equal(r.status,400);assert.equal(s.contar().pools,0);
});
test('fallo de feature flag no filtra secretos',async()=>{
  const r=await armar({falla:'flag'}).llamar();assert.equal(r.status,503);
  assert.ok(!JSON.stringify(r.datos).includes('confidencial'));
});
test('fallo de Redis no filtra secretos',async()=>{
  const s=armar({falla:'auth'});const r=await s.llamar();assert.equal(r.status,503);
  assert.ok(!JSON.stringify(r.datos).includes('confidencial'));assert.equal(s.contar().pools,0);
});
test('fallo de Airtable no filtra secretos',async()=>{
  const s=armar({falla:'empresa'});const r=await s.llamar();assert.equal(r.status,503);
  assert.ok(!JSON.stringify(r.datos).includes('confidencial'));assert.equal(s.contar().pools,0);
});
test('fallo de PostgreSQL no filtra secretos',async()=>{
  const r=await armar({falla:'pool'}).llamar();assert.equal(r.status,503);
  assert.ok(!JSON.stringify(r.datos).includes('confidencial'));
});
test('dos consultas autorizadas son independientes',async()=>{
  const s=armar();assert.equal((await s.llamar()).status,200);
  assert.equal((await s.llamar()).status,200);assert.equal(s.contar().conexiones,2);
});
test('si se apaga la función la siguiente solicitud se bloquea',async()=>{
  const s=armar();assert.equal((await s.llamar()).status,200);
  s.a.activo=false;assert.equal((await s.llamar()).status,404);
  assert.equal(s.contar().conexiones,1);
});
