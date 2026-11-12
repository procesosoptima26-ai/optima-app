/** 12C.18.5 — ensayo de lectura con PostgreSQL descartable, NO production. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {leerHistorialComercialPg185} from '../core/lectura-historial-pg-12c185.js';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';
const socket=process.env.OPTIMA_PG185_SOCKET,driver=process.env.OPTIMA_PG185_DRIVER;
if(!socket||!driver||!/^\/tmp\/optima185\.[A-Za-z0-9]+\/socket$/.test(socket)||
   realpathSync(socket)!==socket||!resolve(driver).startsWith(resolve(process.env.HOME??'/nonexistent')+'/.local/state/optima/'))
  throw Error('Prueba no aislada');
const {Pool}=createRequire(join(driver,'package.json'))('pg') as {Pool:new(config:Record<string,unknown>)=>
  PoolPgNode183&{query(sql:string,args?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount:number|null}>;end():Promise<void>}};
const pool=new Pool({host:socket,port:55435,database:'optima_pruebas',user:'optima_reader_185',
  max:3,connectionTimeoutMillis:2500,idleTimeoutMillis:2500,statement_timeout:8000});
const EMP='rec'+'A'.repeat(14),OTRA='rec'+'Z'.repeat(14);
async function principal(){
  const rol=await pool.query('SELECT current_user AS usuario,rolsuper AS super,rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user');
  assert.equal(rol.rows[0].usuario,'optima_reader_185');
  assert.equal(rol.rows[0].super,false);assert.equal(rol.rows[0].bypass,false);
  const sin=await pool.query('SELECT count(*)::int AS n FROM optima_comercial.contratos');
  assert.equal(Number(sin.rows[0].n),0);
  const a=await leerHistorialComercialPg185(pool,EMP,'CTR-READ185');
  assert.equal(a.ok,true,JSON.stringify(a));
  if(a.ok){assert.equal(a.historial.revision,1);assert.equal(a.historial.versiones.length,1);
    assert.equal(a.historial.eventos.length,1);assert.equal(a.historial.versiones[0].cantidadServicios,1);
    assert.equal(a.historial.soloConsulta,true);
    assert.ok(!JSON.stringify(a).includes('precio'));}
  const b=await leerHistorialComercialPg185(pool,OTRA,'CTR-READ185');
  assert.equal(b.ok,true,JSON.stringify(b));
  if(b.ok){assert.equal(b.historial.revision,0);assert.equal(b.historial.versiones.length,0);}
  const desconocido=await leerHistorialComercialPg185(pool,EMP,'CTR-SIN-CONTRATO');
  assert.deepEqual(desconocido,{ok:false,motivo:'NO_ENCONTRADO',accesoOperativoHabilitado:false});
  await assert.rejects(async()=>pool.query("INSERT INTO optima_comercial.contratos(empresa_id,id_contrato,revision,huella_historial) VALUES ($1,'CTR-MAL185',0,$2)",[EMP,'a'.repeat(64)]));
  const despues=await pool.query('SELECT count(*)::int AS n FROM optima_comercial.contratos');
  assert.equal(Number(despues.rows[0].n),0,'SET LOCAL filtrado fuera de transacción');
  console.log('Lectura canónica + aislamiento + rol SELECT + sin contexto: OK');
  console.log('RESULTADO: LECTURA_NODE_PG_REAL_OK');
}
try{await principal();}finally{await pool.end();}
