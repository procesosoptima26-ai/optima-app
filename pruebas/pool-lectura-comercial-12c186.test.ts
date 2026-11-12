import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarConfigLectura186,validarRolLectura186,crearPoolComercialLectura186,
} from '../lib/pool-lectura-comercial-12c186.js';
const rol='optima_reader_186';
const dsn='postgresql://optima_reader_186:secret@localhost:5432/optima_pruebas';
const tablas=['contratos','versiones','borradores','eventos','idempotencia'];
function fila(){const o:Record<string,unknown>={usuario:rol,superusuario:false,omite_rls:false,
  crea_bd:false,crea_rol:false,replica:false,uso_esquema:true};
  for(const t of tablas){o[`select_${t}`]=t!=='idempotencia';o[`insert_${t}`]=false;
    o[`update_${t}`]=false;o[`delete_${t}`]=false;}
  return o;
}
test('dsn y rol de lector son válidos',()=>{
  assert.equal(validarConfigLectura186({dsn,rol}),true);
});
for(const d of ['', 'http://localhost/optima','postgresql://postgres@localhost/optima',
 'postgresql://optima_reader_186@localhost/', 'postgresql://optima_reader_186@/optima',
 'postgresql://optima_reader_186@localhost/optima#x']){
  test(`dsn no permitido: ${d.slice(0,32)}`,()=>{
    assert.equal(validarConfigLectura186({dsn:d,rol}),false);
  });
}
for(const r of ['postgres','root','optima_reader','optima_ADMIN','optima-a',
  'optima_reader_186_', 'optima_1reader']){
  test(`rol inválido ${r}`,()=>{
    assert.equal(validarConfigLectura186({dsn,rol:r}),false);
  });
}
test('rechaza dsn excesivo',()=>{
  assert.equal(validarConfigLectura186({dsn:dsn+'x'.repeat(2100),rol}),false);
});
test('rol PostgreSQL con SELECT mínimo se acepta',()=>{
  assert.equal(validarRolLectura186([fila()],rol),true);
});
test('rol no encontrado se rechaza',()=>{
  assert.equal(validarRolLectura186([],rol),false);
});
test('múltiples filas de rol se rechazan',()=>{
  assert.equal(validarRolLectura186([fila(),fila()],rol),false);
});
for(const [campo,valor] of [
  ['usuario','otro'],['superusuario',true],['omite_rls',true],['crea_bd',true],
  ['crea_rol',true],['replica',true],['uso_esquema',false],
  ['insert_contratos',true],['update_versiones',true],['delete_eventos',true],
  ['select_contratos',false],['select_idempotencia',true],
] as const){
  test(`rol con ${campo} incorrecto se rechaza`,()=>{
    assert.equal(validarRolLectura186([{...fila(),[campo]:valor}],rol),false);
  });
}
test('rol con datos incompletos se rechaza',()=>{
  assert.equal(validarRolLectura186([{usuario:rol,superusuario:false}],rol),false);
});
function montar(opciones:{configValida?:boolean;fila?:Record<string,unknown>;error?:boolean}={}){
  let construidos=0,conexiones=0,liberaciones=0,consultas=0;
  const clase=class{
    constructor(_config:Record<string,unknown>){construidos++;}
    async connect(){conexiones++;return {query:async(_sql:string)=>{
      consultas++;if(opciones.error)throw Error('falla interna');
      const rows=[opciones.fila??fila()];return {rows,rowCount:rows.length};
    },release(){liberaciones++;}};}
    async end(){}
  };
  const obj=crearPoolComercialLectura186({dsn:opciones.configValida===false?'':dsn,rol},
    ()=>clase as unknown as Parameters<typeof crearPoolComercialLectura186>[1] extends ()=>infer X?X:never);
  return {obj,contar:()=>({construidos,conexiones,liberaciones,consultas})};
}
test('crear pool no abre conexiones ni carga driver',()=>{
  const a=montar();assert.equal(a.contar().construidos,0);
});
test('config inválida falla antes de cargar driver',async()=>{
  const a=montar({configValida:false});await assert.rejects(()=>a.obj.connect());
  assert.equal(a.contar().construidos,0);
});
test('rol correcto devuelve conexión que llamador libera',async()=>{
  const a=montar();const c=await a.obj.connect();
  assert.equal(a.contar().construidos,1);assert.equal(a.contar().liberaciones,0);
  c.release();assert.equal(a.contar().liberaciones,1);
});
test('pool se reutiliza y conexiones se revalidan',async()=>{
  const a=montar();(await a.obj.connect()).release();(await a.obj.connect()).release();
  assert.deepEqual(a.contar(),{construidos:1,conexiones:2,liberaciones:2,consultas:2});
});
test('rol superusuario se rechaza y libera conexión',async()=>{
  const a=montar({fila:{...fila(),superusuario:true}});
  await assert.rejects(()=>a.obj.connect());assert.equal(a.contar().liberaciones,1);
});
test('si falla chequeo de rol libera conexión',async()=>{
  const a=montar({error:true});await assert.rejects(()=>a.obj.connect());
  assert.equal(a.contar().liberaciones,1);
});
test('constructor no es invocado por configuración inválida',async()=>{
  let n=0;const obj=crearPoolComercialLectura186({dsn:'',rol},()=>{n++;throw Error('No debió ejecutarse');});
  await assert.rejects(()=>obj.connect());assert.equal(n,0);
});
test('el endpoint no importa ni abre PostgreSQL automáticamente',async()=>{
  const a=montar();assert.equal(a.contar().conexiones,0);
});
