import test from 'node:test';
import assert from 'node:assert/strict';
import {crearConsultaContratoCore195} from '../handlers/core/consulta-contratos-pg-12c195.js';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';
import type {ResultadoAccesoReal195} from '../lib/sesion-comercial-real-12c195.js';
import usuarios from '../api/usuarios.js';
import type {VercelRequest,VercelResponse} from '@vercel/node';

const U='rec'+'U'.repeat(14);
const E='rec'+'E'.repeat(14);
const EST='emp_'+'e'.repeat(12); // ID estable: clave de la empresa en Neon
const OTRO='rec'+'O'.repeat(14);
const fecha='2026-11-13T10:00:00.000Z';
type Opciones={habilitada?:boolean;permiso?:boolean;sesion?:boolean;noVigente?:boolean;
  baseCaida?:boolean;duplicado?:boolean;alterarEmpresa?:boolean;usuarioAjeno?:boolean;sinEstable?:boolean};
function fixture(opts:Opciones={}){
  const headers:Record<string,string>={};let status=0;let cuerpo:unknown=null;
  let autorizaciones=0,conexiones=0,liberadas=0,consultas=0;
  const pool:PoolPgNode183={async connect(){conexiones++;return {
    async query(sql:string,param?:unknown[]){
      consultas++;
      if(opts.baseCaida && sql.includes('FROM optima_comercial.contratos'))throw Error('no disponible');
      if(sql.includes('set_config')){assert.deepEqual(param,[EST]);return {rows:[{empresa_id:EST}],rowCount:1};}
      if(sql.includes('FROM optima_comercial.contratos')){
        const rows=opts.noVigente?[]:[{
          empresa_id:opts.alterarEmpresa?OTRO:EST,id_contrato:'CTO-PRUEBA',revision:'1',
          id_version:'VER-C1CLIENTE',numero:1,estado:'VIGENTE',
          servicios:[{modalidad:'MODULO_PRINCIPAL',modulo:'INVENTARIO',nivel:'ESENCIAL'}],
          vigente_desde:'2026-11-12T10:00:00.000Z',vigente_hasta:null,
          aprobado_por_id:U,aprobado_en:'2026-11-11T10:00:00.000Z'
        }];if(opts.duplicado)rows.push({...rows[0]});
        return {rows,rowCount:rows.length};
      }
      return {rows:[],rowCount:0};
    },release(){liberadas++;}
  };}};
  const autorizar=async()=>{
    autorizaciones++;
    if(opts.sesion===false)return {ok:false,motivo:'SIN_SESION'} as ResultadoAccesoReal195;
    if(opts.permiso===false)return {ok:false,motivo:'SIN_PERMISO'} as ResultadoAccesoReal195;
    return {ok:true,acceso:{usuarioId:opts.usuarioAjeno?OTRO:U,empresaId:E,
      ...(opts.sinEstable?{}:{empresaEstableId:EST}),
      permiso:'CONSULTAR_CONTRATOS'}} as const;
  };
  const handler=crearConsultaContratoCore195({
    habilitada:()=>opts.habilitada!==false,autorizar,crearPool:()=>pool,ahora:()=>fecha,
  });
  const res={setHeader(k:string,v:string){headers[k]=v;},status(code:number){status=code;return {
    json(value:unknown){cuerpo=value;return value;}
  };}};
  async function ejecutar(req: {method?:string;query?:Record<string,unknown>;body?:unknown;cookies?:Record<string,unknown>}){
    await handler(req,res);return {status,cuerpo,headers,autorizaciones,conexiones,consultas,liberadas};
  }
  return {ejecutar};
}
const solicitud={method:'GET',query:{empresaId:E}};
test('P3E: flag apagada no revela endpoint ni consulta sesión o PG',async()=>{
  const r=await fixture({habilitada:false}).ejecutar(solicitud);
  assert.equal(r.status,404);assert.equal(r.autorizaciones,0);assert.equal(r.conexiones,0);
});
test('P3E: solo permite GET y sin body ni parámetros extra',async()=>{
  for(const req of [{method:'POST',query:{empresaId:E}},
    {method:'GET',query:{empresaId:E},body:{usuarioId:U}},
    {method:'GET',query:{empresaId:E,usuarioId:U}},
    {method:'GET',query:{empresaId:'otra'}}]){
    const r=await fixture().ejecutar(req);
    assert.ok([400,405].includes(r.status));assert.equal(r.autorizaciones,0);assert.equal(r.conexiones,0);
  }
});
test('P3E: sesión vencida o permisos insuficientes no abren PG',async()=>{
  for(const opts of [{sesion:false},{permiso:false}]){
    const r=await fixture(opts).ejecutar(solicitud);
    assert.equal(r.status,opts.sesion===false?401:403);assert.equal(r.conexiones,0);
  }
});
test('P3E: contrato válido leído con RLS y salida sin datos económicos',async()=>{
  const r=await fixture().ejecutar(solicitud);
  assert.equal(r.status,200);assert.equal(r.conexiones,1);assert.equal(r.liberadas,1);
  assert.equal((r.cuerpo as {estado?:string}).estado,'VIGENTE');
  assert.equal((r.cuerpo as {accesoOperativoHabilitado?:unknown}).accesoOperativoHabilitado,false);
  assert.equal(JSON.stringify(r.cuerpo).includes('PASSWORD_HASH'),false);
  assert.equal(r.headers['Cache-Control'],'no-store, max-age=0');
});
test('P3E: ausencia de contrato responde SIN CONTRATO pero no habilita funciones',async()=>{
  const r=await fixture({noVigente:true}).ejecutar(solicitud);
  assert.equal(r.status,200);assert.equal((r.cuerpo as {estado?:string}).estado,'SIN_CONTRATO_VIGENTE');
  assert.equal(r.conexiones,1);
});
test('P3E: contratos múltiples, empresa ajena y caída de BD cierran acceso',async()=>{
  for(const c of [{duplicado:true},{alterarEmpresa:true},{baseCaida:true}]){
    const r=await fixture(c).ejecutar(solicitud);
    assert.equal(r.status,503);assert.equal(r.liberadas,1);
  }
});


test('ID estable: Neon se consulta con emp_..., nunca con el código rec de Airtable',async()=>{
  const r=await fixture().ejecutar(solicitud);
  assert.equal(r.status,200); // el pool simulado exige param [EST] en set_config
});
test('ID estable: empresa sin ID estable válido cierra acceso y NO abre PG',async()=>{
  const r=await fixture({sinEstable:true}).ejecutar(solicitud);
  assert.equal(r.status,503);assert.equal(r.conexiones,0);
  assert.deepEqual(r.cuerpo,{ok:false,error:'No se pudo verificar el contrato comercial'});
});

test('P3E v2: admite acción consolidada exacta y no admite otros parámetros',async()=>{
  const permitido=await fixture().ejecutar({method:'GET',query:{accion:'contratos_core',empresaId:E}});
  assert.equal(permitido.status,200);assert.equal(permitido.autorizaciones,1);
  for(const query of [
    {accion:'otra',empresaId:E},
    {accion:'contratos_core',empresaId:E,usuarioId:U},
    {empresaId:E,permisos:'CONSULTAR_CONTRATOS'},
  ]){
    const r=await fixture().ejecutar({method:'GET',query});
    assert.equal(r.status,400);assert.equal(r.autorizaciones,0);assert.equal(r.conexiones,0);
  }
});

test('P3E v2: consulta disponible en router existente, sin generar función API',async()=>{
  const anterior=process.env.OPTIMA_COMERCIAL_CONTRATOS_READ_ENABLED;
  process.env.OPTIMA_COMERCIAL_CONTRATOS_READ_ENABLED='false';
  let status=0;
  const res={setHeader(){return this;},status(n:number){status=n;return this;},json(){return this;}};
  try{
    await usuarios({method:'GET',query:{accion:'contratos_core',empresaId:E}} as unknown as VercelRequest,
      res as unknown as VercelResponse);
    assert.equal(status,404); // OFF por defecto; nunca sale a Redis/Airtable/PG.
  }finally{
    if(anterior===undefined)delete process.env.OPTIMA_COMERCIAL_CONTRATOS_READ_ENABLED;
    else process.env.OPTIMA_COMERCIAL_CONTRATOS_READ_ENABLED=anterior;
  }
});
