import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crearVerificadorAccesoComercialReal195, crearFuenteContratoReal195,
  type DependenciasSesionComercial195,
} from '../lib/sesion-comercial-real-12c195.js';

const A = 'rec'+'A'.repeat(14);
const E = 'rec'+'E'.repeat(14);
const C = 'rec'+'C'.repeat(14);
const X = 'rec'+'X'.repeat(14);
const req = {cookies:{optima_sesion:'token-protegido'}};
const PERMISOS = ['CONSULTAR_CONTRATOS','GESTIONAR_BORRADORES','APROBAR_CONTRATO','ACTIVAR_CONTRATO'];
function fixture(cambios: Record<string, unknown>={}) {
  const llamadas = {sesion:0,plataforma:0,usuario:0,empresa:0};
  let campos: Record<string,unknown> = {
    ACTIVO:true,ROL:'ADMIN',EMPRESA:[E],PERMISOS_CONTRATOS:PERMISOS,
  };
  if (cambios.campos && typeof cambios.campos==='object') campos={...campos,...cambios.campos as Record<string,unknown>};
  if (cambios.sinCampo) delete campos.PERMISOS_CONTRATOS;
  const deps:DependenciasSesionComercial195 = {
    leerToken:()=>cambios.sinToken?null:'token',
    async buscarSesion(){llamadas.sesion++;if (cambios.falloRedis) throw Error('Redis');
      return cambios.sinSesion?null:{usuarioId:A};},
    async leerPlataforma(){llamadas.plataforma++;if(cambios.falloPlataforma)throw Error('Airtable');
      return cambios.sinPlataforma?null:{usuarioId: cambios.actorAjeno?X:A,empresaId:E};},
    async leerUsuario(){llamadas.usuario++;if(cambios.falloUsuario)throw Error('Airtable');
      return cambios.sinUsuario?null:{id:cambios.idAjeno?X:A,fields:campos};},
    async empresaClienteActiva(){llamadas.empresa++;if(cambios.falloEmpresa)throw Error('Airtable');
      return cambios.empresaInactiva?false:true;},
  };
  return {deps,llamadas,verificar:crearVerificadorAccesoComercialReal195(deps)};
}

test('P3E: sin token o sin sesión niega antes de consultar Airtable',async()=>{
  for(const caso of [{sinToken:true},{sinSesion:true}]){
    const f=fixture(caso);
    const r=await f.verificar(req,C,'APROBAR_CONTRATO');
    assert.deepEqual(r,{ok:false,motivo:'SIN_SESION'});
    assert.equal(f.llamadas.usuario,0);
  }
});
test('P3E: valida IDs de cliente antes de salir a la red',async()=>{
  const f=fixture();assert.deepEqual(await f.verificar(req,'C','ACTIVAR_CONTRATO'),
    {ok:false,motivo:'EMPRESA_INVALIDA'});assert.equal(f.llamadas.sesion,0);
});
test('P3E: únicamente plataforma y no ADMIN de cliente puede administrar contratos',async()=>{
  for(const c of [{sinPlataforma:true},{actorAjeno:true},{campos:{ROL:'USUARIO'}},
    {campos:{ACTIVO:false}},{idAjeno:true},{campos:{EMPRESA:[C]}},
    {campos:{EMPRESA:[E,C]}}]){
    const r=await fixture(c).verificar(req,C,'APROBAR_CONTRATO');
    assert.deepEqual(r,{ok:false,motivo:'SIN_PERMISO'});
  }
});
test('P3E: prohíbe usar empresa de plataforma como objetivo y no consulta cliente',async()=>{
  const f=fixture();const r=await f.verificar(req,E,'APROBAR_CONTRATO');
  assert.deepEqual(r,{ok:false,motivo:'SIN_PERMISO'});assert.equal(f.llamadas.empresa,0);
});
test('P3E: ausencia de campo explícito no convierte ADMIN en aprobador',async()=>{
  const f=fixture({sinCampo:true});const r=await f.verificar(req,C,'APROBAR_CONTRATO');
  assert.deepEqual(r,{ok:false,motivo:'SIN_PERMISO'});
  assert.equal(f.llamadas.empresa,0);
});
test('P3E: permisos inválidos, duplicados, arrays vacíos y objetos se rechazan íntegramente',async()=>{
  for(const valores of [[],['APROBAR_CONTRATO','APROBAR_CONTRATO'],
    ['APROBAR_CONTRATO','ADMIN_TOTAL'],[{name:'APROBAR_CONTRATO'}], 'APROBAR_CONTRATO']){
    const r=await fixture({campos:{PERMISOS_CONTRATOS:valores}}).verificar(req,C,'APROBAR_CONTRATO');
    assert.deepEqual(r,{ok:false,motivo:'SIN_PERMISO'});
  }
});
test('P3E: deniega permiso insuficiente aun con otro permiso autorizado',async()=>{
  const f=fixture({campos:{PERMISOS_CONTRATOS:['CONSULTAR_CONTRATOS']}});
  assert.deepEqual(await f.verificar(req,C,'ACTIVAR_CONTRATO'),{ok:false,motivo:'SIN_PERMISO'});
  assert.equal(f.llamadas.empresa,0);
});
test('P3E: cliente suspendido/inactivo bloquea acceso aun con permiso',async()=>{
  const f=fixture({empresaInactiva:true});
  assert.deepEqual(await f.verificar(req,C,'CONSULTAR_CONTRATOS'),{ok:false,motivo:'EMPRESA_INVALIDA'});
});
test('P3E: cada caída de Redis/Airtable niega sin inventar permisos',async()=>{
  for(const caso of ['falloRedis','falloPlataforma','falloUsuario','falloEmpresa']){
    const r=await fixture({[caso]:true}).verificar(req,C,'APROBAR_CONTRATO');
    assert.deepEqual(r,{ok:false,motivo:'FUENTE_NO_DISPONIBLE'});
  }
});
test('P3E: consulta permitida identifica solo actor y empresa destino verificados',async()=>{
  const f=fixture({campos:{PERMISOS_CONTRATOS:['CONSULTAR_CONTRATOS']}});
  assert.deepEqual(await f.verificar(req,C,'CONSULTAR_CONTRATOS'),{
    ok:true,acceso:{usuarioId:A,empresaId:C,permiso:'CONSULTAR_CONTRATOS'}
  });
  assert.equal(f.llamadas.usuario,1);assert.equal(f.llamadas.empresa,1);
});
test('P3E: fuente para P3C y P3D revalida sesión y emite solo permiso exigido',async()=>{
  let veces=0;
  const f=fixture();
  const fuente=crearFuenteContratoReal195(req,C,'ACTIVAR_CONTRATO',async(r,e,p)=>{
    veces++;return f.verificar(r,e,p);
  });
  const uno=await fuente(),dos=await fuente();
  const esperado={verificadaEnServidor:true,usuarioId:A,empresaId:C,permisos:['ACTIVAR_CONTRATO']};
  assert.deepEqual(uno,esperado);assert.deepEqual(dos,esperado);assert.equal(veces,2);
});
test('P3E: fuente no devuelve identidad cuando sesión perdió autorización',async()=>{
  const fuente=crearFuenteContratoReal195(req,C,'GESTIONAR_BORRADORES',
    fixture({sinCampo:true}).verificar);
  await assert.rejects(fuente(),/No se verificó/);
});

test('ID estable: resolverEmpresaCliente devuelve el ID estable en el acceso',async()=>{
  const f=fixture();
  const verificar=crearVerificadorAccesoComercialReal195({...f.deps,
    async resolverEmpresaCliente(){return {activa:true,idEstable:'emp_xngaq4y32jji'};}});
  const r=await verificar(req,C,'CONSULTAR_CONTRATOS');
  assert.deepEqual(r,{ok:true,acceso:{usuarioId:A,empresaId:C,empresaEstableId:'emp_xngaq4y32jji',permiso:'CONSULTAR_CONTRATOS'}});
  assert.equal(f.llamadas.empresa,0); // no se consulta dos veces a Airtable
});
test('ID estable: ID faltante o inválido NO inventa uno (el acceso sale sin él)',async()=>{
  for(const idEstable of [null,'rec'+'C'.repeat(14),'EMP_XNGAQ4Y32JJI','']){
    const f=fixture();
    const verificar=crearVerificadorAccesoComercialReal195({...f.deps,
      async resolverEmpresaCliente(){return {activa:true,idEstable};}});
    const r=await verificar(req,C,'CONSULTAR_CONTRATOS');
    assert.equal(r.ok,true);
    assert.equal('empresaEstableId' in (r as {acceso:object}).acceso,false);
  }
});
test('ID estable: empresa inactiva o caída de Airtable siguen negando',async()=>{
  const f=fixture();
  const inactiva=crearVerificadorAccesoComercialReal195({...f.deps,
    async resolverEmpresaCliente(){return {activa:false,idEstable:'emp_xngaq4y32jji'};}});
  assert.deepEqual(await inactiva(req,C,'CONSULTAR_CONTRATOS'),{ok:false,motivo:'EMPRESA_INVALIDA'});
  const caida=crearVerificadorAccesoComercialReal195({...f.deps,
    async resolverEmpresaCliente(){throw Error('Airtable');}});
  assert.deepEqual(await caida(req,C,'CONSULTAR_CONTRATOS'),{ok:false,motivo:'FUENTE_NO_DISPONIBLE'});
});
