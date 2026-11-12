import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticarEndpointComercial187} from '../lib/diagnostico-endpoint-comercial-12c187.js';
const PLAT='rec'+'P'.repeat(14),USUARIO='rec'+'B'.repeat(14);
const BUENAS={
 OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED:'false',
 OPTIMA_COMERCIAL_PG_READ_ROLE:'optima_reader_187',
 OPTIMA_COMERCIAL_PG_READ_URL:'postgresql://optima_reader_187:secreto@localhost:5432/laboratorio',
 OPTIMA_PLATFORM_ADMIN_USER_ID:USUARIO,
 OPTIMA_PLATFORM_COMPANY_ID:PLAT,
 AIRTABLE_TOKEN:'secreto-airtable-laboratorio',
 AIRTABLE_USERS_BASE_ID:'app'+'Q'.repeat(14),
 AIRTABLE_USERS_TABLE_ID:'tbl'+'U'.repeat(14),
 AIRTABLE_COMPANIES_TABLE_ID:'tbl'+'C'.repeat(14),
 UPSTASH_REDIS_KV_REST_API_URL:'https://redis.laboratorio.invalid',
 UPSTASH_REDIS_KV_REST_API_TOKEN:'secreto-redis-laboratorio',
};
const check=(v:Record<string,string|undefined>)=>diagnosticarEndpointComercial187(v);
test('endpoint apagado se mantiene apagado aunque todo esté configurado',()=>{
 const r=check(BUENAS);assert.equal(r.estado,'APAGADO');assert.equal(r.habilitado,false);
});
test('no declara nunca aptitud para publicar',()=>{
 assert.equal(check({...BUENAS,OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED:'true'}).aptoParaPublicar,false);
});
test('encendido exige revisión humana aun con configuración completa',()=>{
 const r=check({...BUENAS,OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED:'true'});
 assert.equal(r.estado,'REVISION_OBLIGATORIA');assert.deepEqual(r.nombresFaltantes,[]);
});
test('encendido sin configuración se declara incompleto',()=>{
 const r=check({OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED:'true'});
 assert.equal(r.estado,'CONFIG_INCOMPLETA');assert.ok(r.nombresFaltantes.length>5);
});
for(const flag of ['TRUE','1','on','','0','false','True']){
 test(`bandera ${flag||'(vacía)'} no activa endpoint`,()=>{
  assert.equal(check({...BUENAS,OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED:flag}).habilitado,false);
 });
}
for(const nombre of ['AIRTABLE_TOKEN','UPSTASH_REDIS_KV_REST_API_TOKEN',
 'OPTIMA_PLATFORM_ADMIN_USER_ID','OPTIMA_PLATFORM_COMPANY_ID',
 'AIRTABLE_USERS_BASE_ID','AIRTABLE_USERS_TABLE_ID','AIRTABLE_COMPANIES_TABLE_ID',
 'OPTIMA_COMERCIAL_PG_READ_URL','OPTIMA_COMERCIAL_PG_READ_ROLE']){
 test(`falta ${nombre} impide dar por configurado`,()=>{
  const r=check({...BUENAS,[nombre]:'' ,OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED:'true'});
  assert.equal(r.estado,'CONFIG_INCOMPLETA');assert.ok(r.nombresFaltantes.includes(nombre));
 });
}
for(const [nombre,valor] of [
 ['OPTIMA_PLATFORM_ADMIN_USER_ID','recincorrecto'],
 ['OPTIMA_PLATFORM_COMPANY_ID','empresa_inventada'],
 ['AIRTABLE_USERS_BASE_ID','x'],
 ['AIRTABLE_USERS_TABLE_ID','tabla'],
 ['AIRTABLE_COMPANIES_TABLE_ID','123'],
 ['OPTIMA_COMERCIAL_PG_READ_ROLE','postgres'],
 ['OPTIMA_COMERCIAL_PG_READ_URL','https://otra'],
] as const){
 test(`valor inválido en ${nombre} bloquea diagnóstico`,()=>{
  const r=check({...BUENAS,[nombre]:valor,OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED:'true'});
  assert.equal(r.estado,'CONFIG_INCOMPLETA');assert.ok(r.nombresFaltantes.includes(nombre));
 });
}
test('no expone secretos en el resultado serializado',()=>{
 const r=check({...BUENAS,OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED:'true'});
 const s=JSON.stringify(r);
 for(const secreto of ['secreto-airtable-laboratorio','secreto-redis-laboratorio','secreto@localhost']){
  assert.equal(s.includes(secreto),false);
 }
});
test('siempre requiere pruebas reales de sesión',()=>{
 assert.equal(check(BUENAS).requierePruebasDeAutenticacionReal,true);
});
test('siempre requiere aprobación de despliegue',()=>{
 assert.equal(check(BUENAS).requiereControlDeDespliegue,true);
});
test('informa estructura válida del lector sin abrir conexiones',()=>{
 assert.equal(check(BUENAS).lectorEstructuralValido,true);
});
test('deniega uso de rol postgres aunque URL sea válida',()=>{
 assert.equal(check({...BUENAS,OPTIMA_COMERCIAL_PG_READ_ROLE:'postgres'}).lectorEstructuralValido,false);
});
test('no modifica el objeto de variables',()=>{
 const original={...BUENAS};check(original);assert.deepEqual(original,BUENAS);
});
test('resultado no puede mutarse accidentalmente',()=>{
 const r=check(BUENAS);assert.equal(Object.isFrozen(r),true);
 assert.equal(Object.isFrozen(r.nombresFaltantes),true);
});
