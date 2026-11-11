/** OPTIMA 12C.18.2 — guardas estructurales previas a una prueba en PostgreSQL real.
 * NO reemplazan las pruebas reales del archivo .sql ni la ejecución del runner.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const base = readFileSync('db/migrations/0001_optima_comercial_pg.sql', 'utf8');
const sql = readFileSync('pruebas/postgres-aislado-12c182.sql', 'utf8');
const runner = readFileSync('scripts/probar-postgres-aislado-12c182.sh', 'utf8');
const instalador = readFileSync('scripts/probar-postgres-aislado-12c182.sh', 'utf8');

test('12C.18.2: esquema comercial separado', () => {
  assert.match(base, /CREATE SCHEMA optima_comercial/);
});
test('12C.18.2: migración transaccional', () => {
  assert.match(base, /BEGIN;/); assert.match(base, /COMMIT;/);
});
test('12C.18.2: tablas de contratos y versiones', () => {
  assert.match(base, /CREATE TABLE optima_comercial\.contratos/);
  assert.match(base, /CREATE TABLE optima_comercial\.versiones/);
});
test('12C.18.2: tablas de borradores y auditoría', () => {
  assert.match(base, /CREATE TABLE optima_comercial\.borradores/);
  assert.match(base, /CREATE TABLE optima_comercial\.eventos/);
});
test('12C.18.2: índice único de vigencia', () => {
  assert.match(base, /CREATE UNIQUE INDEX una_version_vigente_por_contrato/);
});
test('12C.18.2: índice único de aprobación', () => {
  assert.match(base, /CREATE UNIQUE INDEX una_version_aprobada_por_contrato/);
});
test('12C.18.2: tabla única de idempotencia', () => {
  assert.match(base, /CREATE TABLE optima_comercial\.idempotencia/);
  assert.match(base, /PRIMARY KEY \(empresa_id, id_contrato, clave\)/);
});
test('12C.18.2: protección de eventos anteriores', () => {
  assert.match(base, /eventos_inmutables BEFORE UPDATE OR DELETE/);
});
test('12C.18.2: protección de versiones aprobadas', () => {
  assert.match(base, /controlar_transicion_version/);
  assert.match(base, /versiones_cambios_controlados BEFORE UPDATE/);
});
test('12C.18.2: sin privilegios generales para PUBLIC', () => {
  assert.match(base, /REVOKE ALL ON SCHEMA optima_comercial FROM PUBLIC/);
  assert.match(base, /REVOKE ALL ON ALL TABLES IN SCHEMA optima_comercial FROM PUBLIC/);
});
test('12C.18.2: SQL prueba restricciones reales', () => {
  assert.match(sql, /WHEN unique_violation/);
  assert.match(sql, /WHEN check_violation/);
  assert.match(sql, /WHEN foreign_key_violation/);
});
test('12C.18.2: SQL comprueba inmutabilidad', () => {
  assert.match(sql, /WHEN raise_exception/);
  assert.match(sql, /Auditoría editable/);
});
test('12C.18.2: SQL verifica separación de empresas', () => {
  assert.match(sql, /Aislamiento por empresa incorrecto/);
});
test('12C.18.2: SQL revierte los datos de prueba', () => {
  assert.match(sql, /\bROLLBACK;/);
  assert.match(sql, /ROLLBACK no eliminó las filas de prueba/);
});
test('12C.18.2: no usa URL ni clave de producción', () => {
  assert.doesNotMatch(runner, /DATABASE_URL|AIRTABLE_TOKEN|AIRTABLE_BASE_ID/);
});
test('12C.18.2: clúster local nuevo sin TCP', () => {
  assert.match(runner, /initdb/);
  assert.match(runner, /listen_addresses=''[^\n]*/);
});
test('12C.18.2: Docker aislado sin puertos publicados', () => {
  assert.match(runner, /--network none/);
  assert.match(runner, /--tmpfs \/var\/lib\/postgresql\/data/);
  assert.doesNotMatch(runner, /docker pull|--publish|--publish-all/);
});
test('12C.18.2: aislamiento y limpieza automática', () => {
  assert.match(instalador, /mktemp -d \/tmp\/optima182\./);
  assert.match(instalador, /trap limpiar EXIT/);
});
test('12C.18.2: dos sesiones prueban FOR UPDATE NOWAIT', () => {
  assert.match(runner, /FOR UPDATE;/);
  assert.match(runner, /FOR UPDATE NOWAIT/);
});
test('12C.18.2: conflicto de revisión antigua no actualiza', () => {
  assert.match(runner, /AND revision=0 RETURNING 1/);
  assert.match(runner, /\[\[ "\$CAS" == '0' \]\]/);
});
