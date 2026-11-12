/**
 * OPTIMA 12C.18.3 - pruebas REALES del repositorio Node contra clúster efímero.
 * No sirve como endpoint: inyecta identidades FICTICIAS de una demostración.
 * No tiene URL ni credenciales de producción y sólo acepta socket /tmp/optima183.*
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { realpathSync } from 'node:fs';
import {
  persistirConPoolPgNode12C183,
  type PoolPgNode183,
  type ConexionPgNode183,
} from '../core/adaptador-pg-node-12c183.js';
import { iniciarHistorialComercialLocal, aprobarBorradorComercialLocal,
  activarVersionComercialLocal, type HistorialContratacionSimulado,
} from '../core/historial-contratacion-comercial-12c173.js';
import { crearBorradorComercialLocal } from '../core/borradores-contratacion-comercial-12c172.js';
import type { SolicitudGuardadoComercialPg } from '../core/repositorio-comercial-pg-12c181.js';

const socket = process.env.OPTIMA_PG183_SOCKET;
const driverRoot = process.env.OPTIMA_PG183_DRIVER;
if (!socket || !driverRoot || !/^\/tmp\/optima183\.[A-Za-z0-9]+\/socket$/.test(socket) ||
    realpathSync(socket) !== socket || !resolve(driverRoot).startsWith(resolve(process.env.HOME ?? '/nonexistent') + '/.local/state/optima/')) {
  throw Error('Entorno de PostgreSQL de prueba aislado no verificado');
}
const pg = createRequire(join(driverRoot, 'package.json'))('pg') as {
  Pool: new (config: Record<string, unknown>) => PoolPgNode183 & {
    query(sql: string, valores?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
    end(): Promise<void>;
  };
};
const pool = new pg.Pool({
  host: socket, port: 55433, database: 'optima_pruebas', user: 'optima_pruebas',
  max: 4, connectionTimeoutMillis: 2500, idleTimeoutMillis: 3000,
  statement_timeout: 8000, query_timeout: 9000,
});
const EMP = 'rec' + 'A'.repeat(14);
const EMP2 = 'rec' + 'Z'.repeat(14);
const APR = 'rec' + 'B'.repeat(14);
const ACT = 'rec' + 'C'.repeat(14);
const FECHAS = [
  '2026-11-11T10:00:00.000Z','2026-11-11T11:00:00.000Z',
  '2026-11-11T12:00:00.000Z','2026-11-11T13:00:00.000Z',
  '2026-11-11T14:00:00.000Z','2026-11-11T15:00:00.000Z',
] as const;
function bien<T extends {ok:boolean}>(r:T): Extract<T,{ok:true}> {
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw Error('Fixture comercial inválido');
  return r as Extract<T,{ok:true}>;
}
function iniciar(empresa=EMP, contrato='CTR-NODE-PG183'):HistorialContratacionSimulado {
  return bien(iniciarHistorialComercialLocal({empresaId: empresa, idContrato: contrato})).historial;
}
function aprobar(prev: HistorialContratacionSimulado, idVersion: string,
                 borradorId: string, fechaBorrador: string, fechaAprobado: string,
                 submodulo: string):HistorialContratacionSimulado {
  const vigente = prev.versiones.find(v=>v.estado==='VIGENTE') ?? null;
  const bor = bien(crearBorradorComercialLocal({
    idBorrador: borradorId, empresaId: prev.empresaId,
    idContrato: vigente ? prev.idContrato : null,
    versionBase: vigente?.numero ?? null,
    serviciosBase: vigente?.servicios ?? [],
    serviciosPropuestos: [{modalidad:'SUBMODULO_INDEPENDIENTE',submodulo,nivel:'ESTANDAR'}],
    motivoCambio:'Cambio comercial de prueba PostgreSQL aislado', ahoraIso:fechaBorrador,
  })).borrador;
  return bien(aprobarBorradorComercialLocal({
    historial:prev, borrador:bor, empresaId:prev.empresaId,
    actorUsuarioId:APR, idVersion, revisionHistorialEsperada:prev.revisionHistorial,
    ahoraIso:fechaAprobado,
  })).historial;
}
function activar(prev:HistorialContratacionSimulado,idVersion:string,fecha:string):HistorialContratacionSimulado {
  return bien(activarVersionComercialLocal({
    historial:prev, empresaId:prev.empresaId, actorUsuarioId:ACT,
    idVersion, revisionHistorialEsperada:prev.revisionHistorial, ahoraIso:fecha,
  })).historial;
}
function solicitud(anterior:HistorialContratacionSimulado,siguiente:HistorialContratacionSimulado,clave:string): SolicitudGuardadoComercialPg {
  return {anterior,siguiente,claveIdempotencia:clave,actorServidorId:siguiente.eventos.at(-1)!.actorUsuarioId};
}
function huella(objeto:unknown) {return createHash('sha256').update(JSON.stringify(objeto)).digest('hex');}
async function contar(tabla:string,empresa:string,contrato:string):Promise<number> {
  assert.match(tabla, /^(contratos|versiones|eventos|idempotencia)$/);
  const r=await pool.query(`SELECT count(*)::int AS n FROM optima_comercial.${tabla} WHERE empresa_id=$1 AND id_contrato=$2`,[empresa,contrato]);
  return Number(r.rows[0].n);
}
async function guardar(s: SolicitudGuardadoComercialPg) {
  return persistirConPoolPgNode12C183(pool,s);
}
async function principal() {
  const verificacion=await pool.query("SELECT current_database() AS db, current_user AS usuario, inet_server_addr() IS NULL AS solo_socket, current_setting('listen_addresses') AS escucha");
  assert.equal(verificacion.rows[0].db,'optima_pruebas');
  assert.equal(verificacion.rows[0].usuario,'optima_pruebas');
  assert.equal(verificacion.rows[0].solo_socket,true);
  assert.equal(verificacion.rows[0].escucha,'');

  const h0=iniciar();
  const h1=aprobar(h0,'VER-NODE183-0001','BOR-NODE183-0001',FECHAS[0],FECHAS[1],'CHEQUES');
  const h2=activar(h1,'VER-NODE183-0001',FECHAS[2]);
  const h3=aprobar(h2,'VER-NODE183-0002','BOR-NODE183-0002',FECHAS[3],FECHAS[4],'BANCOS');
  const h4=activar(h3,'VER-NODE183-0002',FECHAS[5]);
  const estados=[h0,h1,h2,h3,h4];
  for (let i=0;i<4;i++) {
    const r=await guardar(solicitud(estados[i],estados[i+1],`OP-NODE183-REAL-0${i+1}`));
    assert.equal(r.ok,true,JSON.stringify(r));
    if (r.ok) {assert.equal(r.repetida,false); assert.equal(r.revisionAplicada,i+1);}
    assert.equal(await contar('eventos',EMP,h0.idContrato),i+1);
  }
  assert.equal(await contar('contratos',EMP,h0.idContrato),1);
  assert.equal(await contar('versiones',EMP,h0.idContrato),2);
  assert.equal(await contar('idempotencia',EMP,h0.idContrato),4);
  const final=await pool.query('SELECT revision,huella_historial FROM optima_comercial.contratos WHERE empresa_id=$1 AND id_contrato=$2',[EMP,h0.idContrato]);
  assert.equal(Number(final.rows[0].revision),4);
  assert.equal(final.rows[0].huella_historial,huella(h4));
  const versiones=await pool.query('SELECT numero,estado,sustituida_por_id FROM optima_comercial.versiones WHERE empresa_id=$1 AND id_contrato=$2 ORDER BY numero',[EMP,h0.idContrato]);
  assert.deepEqual(versiones.rows.map(v=>v.estado),['HISTORICA','VIGENTE']);
  assert.equal(versiones.rows[0].sustituida_por_id,'VER-NODE183-0002');
  console.log('Aprobación, activación, reemplazo e historial real: OK');

  const repetida=await guardar(solicitud(h0,h1,'OP-NODE183-REAL-01'));
  assert.equal(repetida.ok,true);
  if(repetida.ok) assert.equal(repetida.repetida,true);
  assert.equal(await contar('eventos',EMP,h0.idContrato),4);
  assert.equal(await contar('idempotencia',EMP,h0.idContrato),4);
  const stale=await guardar(solicitud(h0,h1,'OP-NODE183-REINTENTO-VIEJO'));
  assert.deepEqual(stale,{ok:false,motivo:'REVISION_DESACTUALIZADA',accesoOperativoHabilitado:false});
  const reutilizada=await guardar(solicitud(h1,h2,'OP-NODE183-REAL-01'));
  assert.deepEqual(reutilizada,{ok:false,motivo:'CLAVE_REUTILIZADA_CON_CAMBIO',accesoOperativoHabilitado:false});
  assert.equal(await contar('eventos',EMP,h0.idContrato),4);
  console.log('Idempotencia durable y revisión desactualizada: OK');

  // Concurrencia REAL, conexiones distintas del pool. Nunca se aceptan ambas.
  const c0=iniciar(EMP,'CTR-CONC-NODE183');
  const c1=aprobar(c0,'VER-CONC-NODE183','BOR-CONC-NODE183',FECHAS[0],FECHAS[1],'CHEQUES');
  const [rA,rB]=await Promise.all([
    guardar(solicitud(c0,c1,'OP-NODE183-CONC-A')),
    guardar(solicitud(c0,c1,'OP-NODE183-CONC-B')),
  ]);
  const motivos=[rA,rB].filter(r=>!r.ok).map(r=>r.ok?'':r.motivo);
  assert.equal([rA,rB].filter(r=>r.ok).length,1,JSON.stringify([rA,rB]));
  assert.deepEqual(motivos,['REVISION_DESACTUALIZADA']);
  assert.equal(await contar('eventos',EMP,c0.idContrato),1);
  assert.equal(await contar('versiones',EMP,c0.idContrato),1);
  console.log('Dos conexiones y control atómico: OK');

  // Error inyectado en evento: versión e idempotencia deben revertirse juntas.
  const f0=iniciar(EMP,'CTR-ROLLBACK-NODE183');
  const f1=aprobar(f0,'VER-ROLL-NODE183','BOR-ROLL-NODE183',FECHAS[0],FECHAS[1],'CHEQUES');
  const poolError: PoolPgNode183={connect:async()=>{
    const c=await pool.connect();
    return {
      query:async(sql:string,parametros?:unknown[])=> {
        if(sql.includes('INSERT INTO optima_comercial.eventos')) throw Error('fallo de BD inyectado');
        return c.query(sql,parametros);
      },
      release:()=>c.release(),
    } satisfies ConexionPgNode183;
  }};
  const falla=await persistirConPoolPgNode12C183(poolError,solicitud(f0,f1,'OP-NODE183-ROLLBACK'));
  assert.deepEqual(falla,{ok:false,motivo:'ERROR_BD',accesoOperativoHabilitado:false});
  for(const t of ['contratos','versiones','eventos','idempotencia'])
    assert.equal(await contar(t,EMP,f0.idContrato),0,`Rollback incompleto en ${t}`);
  console.log('Rollback completo después de error real: OK');

  // Aislamiento por EMPRESA sobre PK compuesta: sin confundir con RLS (pendiente).
  const e0=iniciar(EMP2,h0.idContrato);
  const e1=aprobar(e0,'VER-OTRA-NODE183','BOR-OTRA-NODE183',FECHAS[0],FECHAS[1],'CHEQUES');
  const otra=await guardar(solicitud(e0,e1,'OP-NODE183-OTRA-EMPRESA'));
  assert.equal(otra.ok,true,JSON.stringify(otra));
  assert.equal(await contar('eventos',EMP,h0.idContrato),4);
  assert.equal(await contar('eventos',EMP2,e0.idContrato),1);
  console.log('Separación de claves por empresa: OK (RLS aún pendiente)');
  console.log('RESULTADO: NODE_PG_REAL_OK');
}
try { await principal(); } finally { await pool.end(); }
