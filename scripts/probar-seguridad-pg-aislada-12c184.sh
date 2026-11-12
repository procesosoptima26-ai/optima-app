#!/usr/bin/env bash
# 12C.18.4: servidor PostgreSQL descartable, rol no privilegiado y RLS de 5 tablas.
# Solo unix socket aleatorio /tmp/optima184.*, sin usar servicios ni bases actuales.
set -euo pipefail
RAIZ="${OPTIMA_PROJECT_ROOT:-$HOME/proyectos/optima-inventario}"
cd "$RAIZ"
[[ -d .git && -f db/migrations/0001_optima_comercial_pg.sql && -f db/migrations/0002_optima_comercial_rls.sql ]] || { echo 'ERROR: Faltan migraciones'; exit 1; }
[[ $(id -u) -ne 0 ]] || { echo 'ERROR: No ejecutar como root';exit 1; }
ESTADO="$HOME/.local/state/optima";mkdir -p "$ESTADO"
LOG="$(mktemp -d "$ESTADO/12c184-real-XXXXXXXX")"
TEMP="$(mktemp -d /tmp/optima184.XXXXXXXX)";chmod 700 "$TEMP"
INICIADO=0;PG_BIN=''
limpiar() {
  if [[ "$INICIADO" == 1 && -n "$PG_BIN" ]]; then "$PG_BIN/pg_ctl" -D "$TEMP/data" -m immediate stop >/dev/null 2>&1 || :;fi
  if [[ "$TEMP" == /tmp/optima184.* && -d "$TEMP" ]];then rm -rf -- "$TEMP";fi
}
trap limpiar EXIT
error() { echo "ERROR: $*";echo "Log: $LOG";exit 1; }
for c in /usr/lib/postgresql/*/bin;do
  if [[ -x "$c/initdb" && -x "$c/pg_ctl" && -x "$c/createdb" && -x "$c/psql" ]];then PG_BIN="$c";break;fi
done
if [[ -z "$PG_BIN" ]];then echo 'RESULTADO: POSTGRES_REAL_PENDIENTE';exit 20;fi
DRIVER="$ESTADO/driver-pg-12c183"
if [[ ! -f "$DRIVER/node_modules/pg/package.json" ]];then
  echo 'RESULTADO: DRIVER_PG_PENDIENTE';exit 20
fi
if ! node -e 'const p=require(process.argv[1]);process.exit(p.version==="8.23.1"?0:1)' "$DRIVER/node_modules/pg/package.json";then
  echo 'RESULTADO: DRIVER_PG_PENDIENTE';exit 20
fi
"$PG_BIN/initdb" -D "$TEMP/data" -U optima_pruebas -A trust --no-instructions -E UTF8 >"$LOG/initdb.log" 2>&1 || error 'initdb'
mkdir -m 700 "$TEMP/socket"
"$PG_BIN/pg_ctl" -D "$TEMP/data" -l "$LOG/server.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$TEMP/socket' -c port=55434" \
  start >"$LOG/inicio.log" 2>&1 || error 'pg_ctl'
INICIADO=1
export PGHOST="$TEMP/socket" PGPORT=55434 PGUSER=optima_pruebas PGDATABASE=postgres
"$PG_BIN/createdb" -T template0 optima_pruebas >"$LOG/createdb.log" 2>&1 || error 'createdb'
export PGDATABASE=optima_pruebas
for mig in db/migrations/0001_optima_comercial_pg.sql db/migrations/0002_optima_comercial_rls.sql; do
  "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -f "$mig" >"$LOG/$(basename "$mig").log" 2>&1 || {
    tail -12 "$LOG/$(basename "$mig").log"; error "Migración $mig"; }
done
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 >"$LOG/preparacion.sql.log" 2>&1 <<'SQL'
CREATE ROLE optima_runtime_184 LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA optima_comercial TO optima_runtime_184;
-- Privilegios de laboratorio; recortar por columna y operación antes de producción.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA optima_comercial TO optima_runtime_184;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA optima_comercial TO optima_runtime_184;
INSERT INTO optima_comercial.contratos(empresa_id,id_contrato,revision,huella_historial)
VALUES ('recAAAAAAAAAAAAAA','CTR-SEED-RLS184',0,repeat('a',64)),
       ('recZZZZZZZZZZZZZZ','CTR-SEED-RLS184',0,repeat('a',64));
DO $$BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='optima_comercial' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) <> 5 THEN
    RAISE EXCEPTION 'Falta FORCE ROW LEVEL SECURITY en tablas comerciales';
  END IF;
END$$;
SQL
# Test como rol NO propietario, NO privilegiado, separado de runtime original.
PGUSER=optima_runtime_184 "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 >"$LOG/rls.sql.log" 2>&1 <<'SQL'
DO $$BEGIN
 IF (SELECT count(*) FROM optima_comercial.contratos) <> 0 THEN
   RAISE EXCEPTION 'Lectura sin tenant fue permitida';
 END IF;
END$$;
BEGIN;
SELECT set_config('optima.empresa_id','recAAAAAAAAAAAAAA',true);
DO $$DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM optima_comercial.contratos;
 IF n <> 1 THEN RAISE EXCEPTION 'No aisló empresa A'; END IF;
 SELECT count(*) INTO n FROM optima_comercial.contratos WHERE empresa_id='recZZZZZZZZZZZZZZ';
 IF n <> 0 THEN RAISE EXCEPTION 'Se ven registros de empresa ajena'; END IF;
 UPDATE optima_comercial.contratos SET revision=9 WHERE empresa_id='recZZZZZZZZZZZZZZ';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n <> 0 THEN RAISE EXCEPTION 'Se modificó un contrato ajeno'; END IF;
 BEGIN
   INSERT INTO optima_comercial.contratos(empresa_id,id_contrato,revision,huella_historial)
   VALUES('recZZZZZZZZZZZZZZ','CTR-MALICIOSO-184',0,repeat('b',64));
   RAISE EXCEPTION 'Inserción cruzada aceptada';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END$$;
COMMIT;
DO $$BEGIN
 IF (SELECT count(*) FROM optima_comercial.contratos) <> 0 THEN
   RAISE EXCEPTION 'SET LOCAL filtró datos fuera de transacción';
 END IF;
END$$;
BEGIN;
SELECT set_config('optima.empresa_id','recZZZZZZZZZZZZZZ',true);
DO $$DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM optima_comercial.contratos;
 IF n <> 1 THEN RAISE EXCEPTION 'No aisló empresa Z'; END IF;
 SELECT count(*) INTO n FROM optima_comercial.contratos WHERE empresa_id='recAAAAAAAAAAAAAA';
 IF n <> 0 THEN RAISE EXCEPTION 'Se ven datos de la empresa A'; END IF;
END$$;
ROLLBACK;
SQL
export OPTIMA_PG184_SOCKET="$TEMP/socket" OPTIMA_PG184_DRIVER="$DRIVER"
if ! npx --no-install tsx scripts/demo-seguridad-pg-real-12c184.ts >"$LOG/node-real.log" 2>&1; then
  tail -16 "$LOG/node-real.log";error 'Node con RLS real';
fi
grep -qx 'RESULTADO: SEGURIDAD_NODE_PG_OK' "$LOG/node-real.log" || error 'Node no confirmó RLS'
echo 'RLS PostgreSQL con dos empresas y sin contexto: OK'
echo 'Node autenticación simulada + RLS real aislado: OK'
echo "Log: $LOG"
echo 'RESULTADO: SEGURIDAD_PG_REAL_OK'
