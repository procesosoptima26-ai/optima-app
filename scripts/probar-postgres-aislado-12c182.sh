#!/usr/bin/env bash
# OPTIMA 12C.18.2 — instancia NUEVA, temporal, sin TCP ni bases ajenas.
set -euo pipefail
RAIZ="${OPTIMA_PROJECT_ROOT:-$HOME/proyectos/optima-inventario}"
cd "$RAIZ"
[[ -f db/migrations/0001_optima_comercial_pg.sql && -f pruebas/postgres-aislado-12c182.sql ]] || {
  echo 'ERROR: Faltan SQL de esta etapa.'; exit 1;
}
ESTADO="$HOME/.local/state/optima"
mkdir -p "$ESTADO"
LOG="$(mktemp -d "$ESTADO/12c182-pg-XXXXXXXX")"
TEMP="$(mktemp -d /tmp/optima182.XXXXXX)"
chmod 700 "$TEMP"
CONTENEDOR=""
MODO=""
PG_BIN=""
PID_A=""
limpiar() {
  if [[ -n "$PID_A" ]]; then wait "$PID_A" 2>/dev/null || :; fi
  if [[ -n "$CONTENEDOR" ]]; then docker rm -f "$CONTENEDOR" >/dev/null 2>&1 || :; fi
  if [[ "$MODO" == 'local' ]]; then
    "$PG_BIN/pg_ctl" -D "$TEMP/data" -m immediate stop >/dev/null 2>&1 || :
  fi
  [[ "$TEMP" == /tmp/optima182.* ]] && rm -rf -- "$TEMP"
}
trap limpiar EXIT
error() { echo "ERROR POSTGRES REAL: $*"; echo "Logs: $LOG"; exit 1; }

# Opción A: PostgreSQL local de la instalación, pero en clúster PROPIO,
# sin utilizar el clúster del sistema, su puerto ni sus credenciales.
for candidato in /usr/lib/postgresql/*/bin; do
  if [[ -x "$candidato/initdb" && -x "$candidato/pg_ctl" && -x "$candidato/psql" && $(id -u) -ne 0 ]]; then
    PG_BIN="$candidato"; MODO='local'; break
  fi
done
if [[ "$MODO" == 'local' ]]; then
  if ! "$PG_BIN/initdb" -D "$TEMP/data" -U optima_pruebas -A trust \
      --no-instructions -E UTF8 >"$LOG/inicio.log" 2>&1; then error 'initdb'; fi
  mkdir -m 700 "$TEMP/socket"
  if ! "$PG_BIN/pg_ctl" -D "$TEMP/data" -l "$LOG/servidor.log" \
      -o "-c listen_addresses='' -c unix_socket_directories='$TEMP/socket' -c port=55432" \
      start >>"$LOG/inicio.log" 2>&1; then error 'pg_ctl'; fi
  export PGHOST="$TEMP/socket" PGPORT=55432 PGUSER=optima_pruebas PGDATABASE=postgres
  "$PG_BIN/createdb" -T template0 optima_pruebas >"$LOG/base.log" 2>&1 || error 'creación de base temporal'
  export PGDATABASE=optima_pruebas
  psql_aislado() { "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -A -t "$@"; }
else
  # Opción B: usa solamente la imagen de Docker YA descargada.
  # No hace pull, no publica puertos, no monta volúmenes ni conecta redes.
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1 ||
      ! docker image inspect postgres:16-alpine >/dev/null 2>&1; then
    echo 'POSTGRES REAL: PENDIENTE (no hay PostgreSQL local ni imagen Docker preinstalada)'
    echo 'Opción Ubuntu: instalar los paquetes postgresql y postgresql-client; después ejecutar este script.'
    echo 'Opción Docker: descargar previamente la imagen postgres:16-alpine; después ejecutar este script.'
    echo "RESULTADO: POSTGRES_REAL_PENDIENTE"
    exit 20
  fi
  MODO='docker'
  if ! CONTENEDOR=$(docker run -d --rm --network none \
      --tmpfs /var/lib/postgresql/data:rw,nosuid,size=256m \
      --name "optima-pg182-$$" \
      -e POSTGRES_HOST_AUTH_METHOD=trust \
      -e POSTGRES_USER=optima_pruebas -e POSTGRES_DB=optima_pruebas \
      postgres:16-alpine 2>"$LOG/docker.log"); then error 'docker run'; fi
  psql_aislado() { docker exec -i "$CONTENEDOR" psql -X -U optima_pruebas \
      -d optima_pruebas -v ON_ERROR_STOP=1 -A -t "$@"; }
  listo=0
  for _ in $(seq 1 60); do
    if docker exec "$CONTENEDOR" pg_isready -U optima_pruebas -d optima_pruebas \
        >/dev/null 2>&1; then listo=1; break; fi
    sleep 0.5
  done
  [[ "$listo" == 1 ]] || error 'Docker PostgreSQL no inició'
fi

echo '=== OPTIMA 12C.18.2 — POSTGRESQL REAL AISLADO ==='
echo "Motor temporal: $MODO"
psql_aislado < db/migrations/0001_optima_comercial_pg.sql >"$LOG/migracion.log" 2>&1 || error 'migración SQL'
echo 'Migración SQL: OK'
psql_aislado < pruebas/postgres-aislado-12c182.sql >"$LOG/constraints.log" 2>&1 || error 'constraints, triggers y rollback'
grep -qx 'PRUEBAS_SQL_OK_12C182' "$LOG/constraints.log" || error 'resultado SQL no confirmado'
echo 'Integridad, historial, idempotencia y rollback: OK'

# Concurrencia: transacción A retiene SELECT FOR UPDATE mientras B intenta NOWAIT.
psql_aislado -c "INSERT INTO optima_comercial.contratos
  (empresa_id,id_contrato,revision,huella_historial)
  VALUES ('recAAAAAAAAAAAAAA','CTR-CONCURRENCIA-182',0,repeat('a',64))" \
  >"$LOG/semilla.log" 2>&1 || error 'crear contrato de concurrencia'
cat > "$TEMP/sesion-a.sql" <<'SQL'
BEGIN;
SELECT revision FROM optima_comercial.contratos
 WHERE empresa_id='recAAAAAAAAAAAAAA' AND id_contrato='CTR-CONCURRENCIA-182'
 FOR UPDATE;
SELECT pg_sleep(3);
UPDATE optima_comercial.contratos SET revision=1
 WHERE empresa_id='recAAAAAAAAAAAAAA' AND id_contrato='CTR-CONCURRENCIA-182' AND revision=0;
COMMIT;
SQL
psql_aislado < "$TEMP/sesion-a.sql" >"$LOG/sesion-a.log" 2>&1 &
PID_A=$!
sleep 0.9
if psql_aislado -c "BEGIN; SELECT revision FROM optima_comercial.contratos
   WHERE empresa_id='recAAAAAAAAAAAAAA' AND id_contrato='CTR-CONCURRENCIA-182'
   FOR UPDATE NOWAIT; ROLLBACK;" >"$LOG/sesion-b-bloqueo.log" 2>&1; then
  error 'Sesión B pudo adquirir un lock que A debía retener'
fi
wait "$PID_A" || error 'Sesión A falló'
PID_A=""
REVISION=$(psql_aislado -c "SELECT revision FROM optima_comercial.contratos
 WHERE empresa_id='recAAAAAAAAAAAAAA' AND id_contrato='CTR-CONCURRENCIA-182'" | tr -d '[:space:]')
[[ "$REVISION" == '1' ]] || error 'Revisión tras COMMIT no coincide'
CAS=$(psql_aislado -c "WITH actualizado AS (
 UPDATE optima_comercial.contratos SET revision=2
 WHERE empresa_id='recAAAAAAAAAAAAAA' AND id_contrato='CTR-CONCURRENCIA-182'
 AND revision=0 RETURNING 1) SELECT count(*) FROM actualizado" | tr -d '[:space:]')
[[ "$CAS" == '0' ]] || error 'CAS con revisión vieja fue aceptado'
echo 'Bloqueo entre dos conexiones y revisión obsoleta: OK'
echo 'Conexiones a bases existentes: NINGUNA'
echo "Logs: $LOG"
echo 'RESULTADO: POSTGRES_REAL_OK'
