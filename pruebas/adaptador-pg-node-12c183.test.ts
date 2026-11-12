/** Pruebas sin conexiones externas del adaptador 12C.18.3. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { persistirConPoolPgNode12C183, type ConexionPgNode183, type PoolPgNode183 } from '../core/adaptador-pg-node-12c183.js';
import type { SolicitudGuardadoComercialPg } from '../core/repositorio-comercial-pg-12c181.js';

const falso = {} as SolicitudGuardadoComercialPg;
function crearSimulado() {
  const llamadas: string[] = [];
  let liberadas = 0;
  const conn: ConexionPgNode183 = {
    async query(sql) { llamadas.push(sql); return { rows: [], rowCount: 0 }; },
    release() { liberadas++; },
  };
  const pool: PoolPgNode183 = { async connect() { return conn; } };
  return { llamadas, conn, pool, liberaciones: () => liberadas };
}
test('12C.18.3: conexión prestada se libera al fallar validación', async () => {
  const o = crearSimulado();
  const r = await persistirConPoolPgNode12C183(o.pool, falso);
  assert.equal(r.ok, false);
  assert.equal(o.liberaciones(), 1);
});
test('12C.18.3: solicitud inválida no inicia una transacción', async () => {
  const o = crearSimulado();
  await persistirConPoolPgNode12C183(o.pool, falso);
  assert.deepEqual(o.llamadas, []);
});
test('12C.18.3: resultado no habilita acceso operativo', async () => {
  const o = crearSimulado();
  const r = await persistirConPoolPgNode12C183(o.pool, falso);
  assert.equal(r.accesoOperativoHabilitado, false);
});
test('12C.18.3: error de conexión se devuelve sin secretos', async () => {
  const pool: PoolPgNode183 = { async connect() { throw Error('token privado'); } };
  const r = await persistirConPoolPgNode12C183(pool, falso);
  assert.deepEqual(r, { ok: false, motivo: 'ERROR_BD', accesoOperativoHabilitado: false });
});
test('12C.18.3: falla de release no escapa', async () => {
  const o = crearSimulado();
  const r = await persistirConPoolPgNode12C183({
    async connect() { return { ...o.conn, release() { throw Error('fallo al liberar'); } }; },
  }, falso);
  assert.equal(r.ok, false);
});
test('12C.18.3: no usa pool.query en vez de pool.connect', async () => {
  const o = crearSimulado();
  const pool = { ...o.pool, query() { throw Error('prohibido'); } };
  await persistirConPoolPgNode12C183(pool, falso);
  assert.equal(o.liberaciones(), 1);
});
test('12C.18.3: 12C.18.1 continúa siendo el repositorio único', () => {
  const fuente = readFileSync('core/adaptador-pg-node-12c183.ts', 'utf8');
  assert.match(fuente, /persistirPasoComercialPg12C181\(cliente, solicitud\)/);
});
test('12C.18.3: no escribe directo sobre Airtable', () => {
  const fuente = readFileSync('core/adaptador-pg-node-12c183.ts', 'utf8');
  assert.doesNotMatch(fuente, /fetch\(|axios|airtable\.com/);
});
test('12C.18.3: no carga secretos de archivos ni del entorno', () => {
  const fuente = readFileSync('core/adaptador-pg-node-12c183.ts', 'utf8');
  assert.doesNotMatch(fuente, /process\.env|dotenv|readFileSync|DATABASE_URL/);
});
test('12C.18.3: driver se inyecta y no se importa', () => {
  const fuente = readFileSync('core/adaptador-pg-node-12c183.ts', 'utf8');
  assert.doesNotMatch(fuente, /from ['"]pg['"]|require\(['"]pg['"]\)/);
});
test('12C.18.3: wrapper declara interfaz de conexión dedicada', () => {
  const fuente = readFileSync('core/adaptador-pg-node-12c183.ts', 'utf8');
  assert.match(fuente, /interface ConexionPgNode183/);
});
test('12C.18.3: wrapper declara interfaz de pool', () => {
  const fuente = readFileSync('core/adaptador-pg-node-12c183.ts', 'utf8');
  assert.match(fuente, /interface PoolPgNode183/);
});
test('12C.18.3: conexión liberada en finally', () => {
  const fuente = readFileSync('core/adaptador-pg-node-12c183.ts', 'utf8');
  assert.match(fuente, /finally\s*\{/);
  assert.match(fuente, /conexion\.release\(\)/);
});
test('12C.18.3: conversión de parámetros preserva lectura sin mutación', () => {
  const fuente = readFileSync('core/adaptador-pg-node-12c183.ts', 'utf8');
  assert.match(fuente, /\[\.\.\.parametros\]/);
});
test('12C.18.3: runner usa instancia efímera y sólo socket Unix', () => {
  const sh = readFileSync('scripts/probar-node-pg-aislado-12c183.sh', 'utf8');
  assert.match(sh, /mktemp -d \/tmp\/optima183\./);
  assert.match(sh, /listen_addresses=''/);
});
test('12C.18.3: runner limpia incluso al fallar', () => {
  const sh = readFileSync('scripts/probar-node-pg-aislado-12c183.sh', 'utf8');
  assert.match(sh, /trap limpiar EXIT/);
  assert.match(sh, /pg_ctl.*stop/);
});
test('12C.18.3: runner no instala paquetes mediante sudo', () => {
  const sh = readFileSync('scripts/probar-node-pg-aislado-12c183.sh', 'utf8');
  assert.doesNotMatch(sh, /\bsudo\b|apt-get/);
});
test('12C.18.3: runner no modifica package.json', () => {
  const sh = readFileSync('scripts/probar-node-pg-aislado-12c183.sh', 'utf8');
  assert.doesNotMatch(sh, /npm install(?!.*--prefix)|npm i --save/);
});
test('12C.18.3: instancia no lee DATABASE_URL', () => {
  const ts = readFileSync('scripts/demo-node-pg-real-12c183.ts', 'utf8');
  assert.doesNotMatch(ts, /DATABASE_URL|AIRTABLE_TOKEN/);
});
test('12C.18.3: usa driver pg y socket de prueba controlado', () => {
  const ts = readFileSync('scripts/demo-node-pg-real-12c183.ts', 'utf8');
  assert.match(ts, /createRequire/);
  assert.match(ts, /OPTIMA_PG183_SOCKET/);
});
test('12C.18.3: runtime mantiene las operaciones reales fuera de una API', () => {
  const ts = readFileSync('scripts/demo-node-pg-real-12c183.ts', 'utf8');
  assert.doesNotMatch(ts, /createServer|app\.post|router\.post/);
});
