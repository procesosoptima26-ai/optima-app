import test from 'node:test';
import assert from 'node:assert/strict';
import { leerContratoOperativoPg, describirFalloSeguro } from '../core/contrato-vigente-pg-12c19.js';

const EMPRESA = 'emp_s84ng12hqeq1';
const AHORA = '2026-11-20T12:00:00.000Z';

async function capturar(fn: () => Promise<unknown>): Promise<string> {
  const original = console.error;
  const lineas: string[] = [];
  console.error = (...a: unknown[]) => { lineas.push(a.map(String).join(' ')); };
  try { await fn(); } finally { console.error = original; }
  return lineas.join('\n');
}

test('fallo de conexión: registra tipo y código, NO el usuario ni el mensaje', async () => {
  const error = Object.assign(new Error('password authentication failed for user "optima_secreto" host ep-xyz.neon.tech'), { code: '28P01' });
  const pool = { connect: async () => { throw error; } };
  let r: unknown;
  const salida = await capturar(async () => { r = await leerContratoOperativoPg(pool as never, EMPRESA, AHORA); });
  assert.deepEqual(r, { ok: false, motivo: 'NO_DISPONIBLE' });
  assert.match(salida, /etapa=conectar/);
  assert.match(salida, /tipo=AUTENTICACION/);
  assert.match(salida, /codigo=28P01/);
  assert.doesNotMatch(salida, /optima_secreto|neon\.tech|password authentication/);
});

test('módulo pg ausente se clasifica sin exponer rutas', () => {
  const e = Object.assign(new Error("Cannot find module 'pg' /var/task/node_modules"), { code: 'MODULE_NOT_FOUND' });
  const d = describirFalloSeguro(e);
  assert.equal(d.tipo, 'MODULO_NO_ENCONTRADO');
  assert.equal(d.codigo, 'MODULE_NOT_FOUND');
});

test('configuración inválida y rol no solo-lectura se distinguen', () => {
  assert.equal(describirFalloSeguro(new Error('Lector comercial no configurado')).tipo, 'CONFIG_URL_O_ROL_INVALIDA');
  assert.equal(describirFalloSeguro(new Error('Rol PostgreSQL no es de solo lectura')).tipo, 'ROL_NO_ES_SOLO_LECTURA');
});

test('código con texto raro o secreto no se registra', () => {
  const d = describirFalloSeguro(Object.assign(new Error('x'), { code: 'postgres://u:p@h/db' }));
  assert.equal(d.codigo, 'SIN_CODIGO');
});

test('fallo en la consulta se registra con etapa=consulta', async () => {
  let n = 0;
  const conexion = {
    query: async (sql: string) => {
      n++;
      if (sql.startsWith('BEGIN') || sql === 'ROLLBACK') return { rows: [], rowCount: null };
      if (sql.includes('set_config')) return { rows: [{ empresa_id: EMPRESA }], rowCount: 1 };
      throw Object.assign(new Error('permission denied for table versiones'), { code: '42501' });
    },
    release: () => {},
  };
  const salida = await capturar(async () => { await leerContratoOperativoPg({ connect: async () => conexion } as never, EMPRESA, AHORA); });
  assert.match(salida, /etapa=consulta tipo=PERMISO_DENEGADO codigo=42501/);
  assert.doesNotMatch(salida, /versiones/);
});

test('camino feliz sin contrato vigente no registra fallos', async () => {
  const conexion = {
    query: async (sql: string) => sql.includes('set_config')
      ? { rows: [{ empresa_id: EMPRESA }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
    release: () => {},
  };
  let r: { ok: boolean; motivo?: string } | undefined;
  const salida = await capturar(async () => { r = await leerContratoOperativoPg({ connect: async () => conexion } as never, EMPRESA, AHORA) as never; });
  assert.deepEqual(r, { ok: false, motivo: 'NO_VIGENTE' });
  assert.equal(salida, '');
});
