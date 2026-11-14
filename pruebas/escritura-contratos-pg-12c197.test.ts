import test from 'node:test';
import assert from 'node:assert/strict';
import {crearOperacionContrato197,type AccionContrato197,type DependenciasContrato197} from
  '../handlers/core/escritura-contratos-pg-12c197.js';
import {validarConfigEscritura197,validarRolEscritura197,crearPoolComercialEscritura197} from
  '../lib/pool-escritura-comercial-12c197.js';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';

const E='rec'+'E'.repeat(14),U='rec'+'U'.repeat(14);
const ORIGEN='https://preview-optima.example.org';
const solicitudes={
  contrato_borrador:{idContrato:'CTR-P3G',idBorrador:'BOR-P3G0001',versionBase:null,
    serviciosPropuestos:[],motivoCambio:'Borrador de prueba de contrato'},
  contrato_aprobar:{idContrato:'CTR-P3G',idBorrador:'BOR-P3G0001',idVersion:'VER-P3G0001',
    revisionHistorialEsperada:0,revisionBorradorEsperada:1,claveIdempotencia:'OP-P3G00000001'},
  contrato_activar:{idContrato:'CTR-P3G',idVersion:'VER-P3G0001',
    claveIdempotencia:'OP-P3G00000002'},
};
const permiso={contrato_borrador:'GESTIONAR_BORRADORES',contrato_aprobar:'APROBAR_CONTRATO',
  contrato_activar:'ACTIVAR_CONTRATO'} as const;
function fixture(accion:AccionContrato197,opts:{habilitada?:boolean;sesion?:boolean;
  permiso?:boolean;caida?:boolean;resultado?:string;empresaAjena?:boolean;origen?:string}={}){
  let validaciones=0,fuentes=0,pools=0,operaciones=0,codigo=0,cuerpo:unknown;
  const pool={} as PoolPgNode183;
  const deps:DependenciasContrato197={
    habilitada:()=>opts.habilitada!==false,
    origenPermitido:()=>ORIGEN,
    verificar:async(_req,empresaId,p)=>{
      validaciones++;
      assert.equal(empresaId,E);assert.equal(p,permiso[accion]);
      return opts.sesion===false?{ok:false,motivo:'SIN_SESION'}:
        opts.permiso===false?{ok:false,motivo:'SIN_PERMISO'}:
        {ok:true,acceso:{usuarioId:U,empresaId:opts.empresaAjena?'rec'+'X'.repeat(14):E,
          permiso:p}};
    },
    fuente:(_req,empresaId,p)=>{
      fuentes++;assert.equal(empresaId,E);assert.equal(p,permiso[accion]);
      return async()=>({verificadaEnServidor:true,usuarioId:U,empresaId:E,permisos:[p]});
    },
    pool:()=>{pools++;return pool;},
    crear:async()=>{operaciones++;if(opts.caida)throw Error('No disponible');return {
      ok:!opts.resultado,motivo:opts.resultado,accesoOperativoHabilitado:false};},
    aprobar:async()=>{operaciones++;if(opts.caida)throw Error('No disponible');return {
      ok:!opts.resultado,motivo:opts.resultado,accesoOperativoHabilitado:false};},
    activar:async()=>{operaciones++;if(opts.caida)throw Error('No disponible');return {
      ok:!opts.resultado,motivo:opts.resultado,accesoOperativoHabilitado:false};},
  };
  const handler=crearOperacionContrato197(accion,deps);
  const req={method:'POST',query:{accion,empresaId:E},headers:{origin:opts.origen??ORIGEN,
    'content-type':'application/json'},body:solicitudes[accion]};
  const res={setHeader(_k:string,_v:string){return this;},status(n:number){codigo=n;return this;},
    json(o:unknown){cuerpo=o;return this;}};
  async function ejecutar(cambios:Record<string,unknown>={}){
    const override={...req,...cambios};
    await handler(override,res);
    return {codigo,cuerpo,validaciones,fuentes,pools,operaciones};
  }
  return {ejecutar};
}
for(const accion of ['contrato_borrador','contrato_aprobar','contrato_activar'] as const){
  test(`P3G ${accion}: OFF no lee sesión ni abre PostgreSQL`,async()=>{
    const r=await fixture(accion,{habilitada:false}).ejecutar();
    assert.equal(r.codigo,404);assert.equal(r.validaciones,0);assert.equal(r.pools,0);
  });
  test(`P3G ${accion}: sesión y permiso deben venir del servidor`,async()=>{
    for(const opts of [{sesion:false},{permiso:false},{empresaAjena:true}]){
      const r=await fixture(accion,opts).ejecutar();
      assert.equal(r.codigo,opts.sesion===false?401:403);
      assert.equal(r.pools,0);assert.equal(r.operaciones,0);
    }
  });
  test(`P3G ${accion}: rechaza inyección de identidad, método y query`,async()=>{
    const r0=await fixture(accion).ejecutar({method:'GET'});
    assert.equal(r0.codigo,405);assert.equal(r0.validaciones,0);
    for(const cambios of [
      {query:{accion,empresaId:E,usuarioId:U}},
      {query:{accion,empresaId:'mal'}},
      {body:{...solicitudes[accion],usuarioId:U}},
      {body:null},
      {headers:{origin:'https://attacker.invalid','content-type':'application/json'}},
      {headers:{origin:ORIGEN,'content-type':'text/plain'}},
    ]){
      const r=await fixture(accion).ejecutar(cambios);
      assert.ok([400,403].includes(r.codigo));assert.equal(r.validaciones,0);assert.equal(r.pools,0);
    }
  });
  test(`P3G ${accion}: ejecución autorizada no habilita módulos`,async()=>{
    const r=await fixture(accion).ejecutar();
    assert.equal(r.codigo,200);assert.equal(r.validaciones,1);
    assert.equal(r.fuentes,1);assert.equal(r.pools,1);assert.equal(r.operaciones,1);
    assert.equal((r.cuerpo as {accesoOperativoHabilitado:boolean}).accesoOperativoHabilitado,false);
  });
  test(`P3G ${accion}: fallos controlados y caída no exponen datos`,async()=>{
    const r=await fixture(accion,{caida:true}).ejecutar();
    assert.equal(r.codigo,503);assert.equal(JSON.stringify(r.cuerpo).includes('No disponible'),false);
    const conflicto=await fixture(accion,{resultado:'CONFLICTO_IDEMPOTENCIA'}).ejecutar();
    assert.equal(conflicto.codigo,409);
  });
}
test('P3G: solo acepta URL PostgreSQL con rol escritor dedicado',()=>{
  const base='postgresql://optima_writer_x:secret@127.0.0.1/optima_p3g';
  assert.equal(validarConfigEscritura197({rol:'optima_writer_x',dsn:base}),true);
  assert.equal(validarConfigEscritura197({rol:'postgres',dsn:base}),false);
  assert.equal(validarConfigEscritura197({rol:'optima_lector',dsn:base}),false);
  assert.equal(validarConfigEscritura197({rol:'optima_writer_x',dsn:base+'?options=-c%20something'}),false);
});
function filaRol(){
  const fila:Record<string,unknown>={usuario:'optima_writer_x',usuario_sesion:'optima_writer_x',
    superusuario:false,omite_rls:false,crea_bd:false,crea_rol:false,replica:false,hereda:false,
    crea_objetos_bd:false,uso_esquema:true,crea_esquema:false,usa_secuencia:true,rls_estricto:true};
  const matriz={contratos:[true,true,true,false],versiones:[true,true,true,false],
    borradores:[true,true,true,false],eventos:[true,true,false,false],
    idempotencia:[true,true,false,false]};
  for(const [t,vals] of Object.entries(matriz)){
    ['select','insert','update','delete'].forEach((p,i)=>fila[`${p}_${t}`]=vals[i]);
  }
  return fila;
}
test('P3G: rol con permiso extra, propietario o sin RLS no es válido',()=>{
  const correcto=filaRol();assert.equal(validarRolEscritura197([correcto],'optima_writer_x'),true);
  for(const cambio of [{omite_rls:true},{superusuario:true},{rls_estricto:false},
    {delete_eventos:true},{update_idempotencia:true},{usuario:'otro'},{usa_secuencia:false},
    {hereda:true},{crea_esquema:true}]){
    const r:Record<string,unknown>={...correcto,...cambio};
    assert.equal(validarRolEscritura197([r],'optima_writer_x'),false);
  }
});
test('P3G: fábrica del pool diferida y rechazo sin abrir conexiones',async()=>{
  let instancias=0,conexiones=0,liberadas=0;
  const pool=crearPoolComercialEscritura197({dsn:'',rol:''},()=>{
    instancias++;return class{
      async connect(){conexiones++;return {query:async()=>({rows:[],rowCount:0}),release(){liberadas++;}};}
      async end(){}
    };
  });
  assert.equal(instancias,0);
  await assert.rejects(pool.connect());
  assert.equal(instancias,0);assert.equal(conexiones,0);assert.equal(liberadas,0);
});
