#!/usr/bin/env bash
# OPTIMA 12C.18.3 - pg de Node + PostgreSQL NUEVO y efímero, sólo socket Unix.
set -euo pipefail
RAIZ="${OPTIMA_PROJECT_ROOT:-$HOME/proyectos/optima-inventario}"
cd "$RAIZ"
[[ -d .git && -f db/migrations/0001_optima_comercial_pg.sql && -f scripts/demo-node-pg-real-12c183.ts ]] || {
  echo 'ERROR: Falta OPTIMA o su migración SQL'; exit 1;
}
[[ $(id -u) -ne 0 ]] || { echo 'ERROR: no ejecutar como root'; exit 1; }
ESTADO="$HOME/.local/state/optima"
mkdir -p "$ESTADO"
LOG="$(mktemp -d "$ESTADO/12c183-XXXXXXXX")"
TEMP="$(mktemp -d /tmp/optima183.XXXXXXXX)"
chmod 700 "$TEMP"
PG_BIN=""
INICIADO=0
limpiar() {
  if [[ "$INICIADO" == 1 && -n "$PG_BIN" ]]; then
    "$PG_BIN/pg_ctl" -D "$TEMP/data" -m immediate stop >/dev/null 2>&1 || :
  fi
  if [[ "$TEMP" == /tmp/optima183.* && -d "$TEMP" ]]; then rm -rf -- "$TEMP"; fi
}
trap limpiar EXIT
error() { echo "ERROR: $*"; echo "Log: $LOG"; exit 1; }

for c in /usr/lib/postgresql/*/bin; do
  if [[ -x "$c/initdb" && -x "$c/pg_ctl" && -x "$c/createdb" && -x "$c/psql" ]]; then
    PG_BIN="$c"; break
  fi
done
if [[ -z "$PG_BIN" ]]; then
  echo 'PostgreSQL local no encontrado. Esta prueba requiere las herramientas del 12C.18.2.'
  echo 'RESULTADO: POSTGRES_REAL_PENDIENTE'
  exit 20
fi
command -v npm >/dev/null 2>&1 || error 'Falta npm'
DRIVER="$ESTADO/driver-pg-12c183"
mkdir -p "$DRIVER"
if [[ ! -f "$DRIVER/node_modules/pg/package.json" ]] || \
   ! node -e 'const p=require(process.argv[1]);process.exit(p.version==="8.23.1"?0:1)' \
     "$DRIVER/node_modules/pg/package.json" >/dev/null 2>&1; then
  echo 'Preparando driver Node pg aislado (sin cambiar package.json)...'
  if ! npm install --prefix "$DRIVER" --no-save --package-lock=false \
      --ignore-scripts --no-audit --no-fund --silent pg@8.23.1 \
      >"$LOG/npm-driver.log" 2>&1; then
    echo 'RESULTADO: DRIVER_PG_PENDIENTE'
    echo "Detalle: $LOG/npm-driver.log"
    exit 20
  fi
fi

if ! "$PG_BIN/initdb" -D "$TEMP/data" -U optima_pruebas -A trust --no-instructions \
    -E UTF8 >"$LOG/initdb.log" 2>&1; then error 'initdb'; fi
mkdir -m 700 "$TEMP/socket"
if ! "$PG_BIN/pg_ctl" -D "$TEMP/data" -l "$LOG/servidor.log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$TEMP/socket' -c port=55433" \
    start >>"$LOG/initdb.log" 2>&1; then error 'pg_ctl'; fi
INICIADO=1
export PGHOST="$TEMP/socket" PGPORT=55433 PGUSER=optima_pruebas PGDATABASE=postgres
if ! "$PG_BIN/createdb" -T template0 optima_pruebas >"$LOG/createdb.log" 2>&1; then error 'createdb'; fi
export PGDATABASE=optima_pruebas
if ! "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -f db/migrations/0001_optima_comercial_pg.sql \
    >"$LOG/migracion.log" 2>&1; then
  tail -12 "$LOG/migracion.log"; error 'migración SQL';
fi
printf 'Migración temporal: OK\n'
export OPTIMA_PG183_SOCKET="$TEMP/socket"
export OPTIMA_PG183_DRIVER="$DRIVER"
if ! npx --no-install tsx scripts/demo-node-pg-real-12c183.ts \
    >"$LOG/node-real.log" 2>&1; then
  echo 'ERROR: Repositorio Node contra PostgreSQL real'; tail -18 "$LOG/node-real.log"; error 'pruebas Node';
fi
if ! grep -qx 'RESULTADO: NODE_PG_REAL_OK' "$LOG/node-real.log"; then error 'resultado Node faltante'; fi
cat "$LOG/node-real.log"
echo 'Instancia temporal eliminada al salir; sin TCP, sin PostgreSQL existente.'
echo "Log: $LOG"
echo 'RESULTADO: NODE_PG_REAL_OK'
