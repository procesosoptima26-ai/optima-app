#!/usr/bin/env bash
# OPTIMA 12C.18.5: PostgreSQL DESCARTABLE; nunca usa servicio existente.
set -euo pipefail
RAIZ="${OPTIMA_PROJECT_ROOT:-$HOME/proyectos/optima-inventario}"
cd "$RAIZ"
[[ $(id -u) -ne 0 && -d .git ]] || { echo 'ERROR: Proyecto o usuario inválido';exit 1; }
[[ -f db/migrations/0001_optima_comercial_pg.sql && -f db/migrations/0002_optima_comercial_rls.sql ]] || { echo 'ERROR: Falta migración';exit 1; }
ESTADO="$HOME/.local/state/optima";mkdir -p "$ESTADO"
LOG="$(mktemp -d "$ESTADO/12c185-real-XXXXXXXX")"
TEMP="$(mktemp -d /tmp/optima185.XXXXXXXX)";chmod 700 "$TEMP"
INICIADO=0;PG_BIN=''
limpiar() {
  if [[ "$INICIADO" == 1 && -n "$PG_BIN" ]];then "$PG_BIN/pg_ctl" -D "$TEMP/data" -m immediate stop >/dev/null 2>&1 || :;fi
  if [[ "$TEMP" == /tmp/optima185.* && -d "$TEMP" ]];then rm -rf -- "$TEMP";fi
}
trap limpiar EXIT
error() { echo "ERROR: $*";echo "Log: $LOG";exit 1; }
for c in /usr/lib/postgresql/*/bin;do
  if [[ -x "$c/initdb" && -x "$c/pg_ctl" && -x "$c/createdb" && -x "$c/psql" ]];then PG_BIN="$c";break;fi
done
if [[ -z "$PG_BIN" ]];then echo 'RESULTADO: POSTGRES_REAL_PENDIENTE';exit 20;fi
DRIVER="$ESTADO/driver-pg-12c183"
if [[ ! -f "$DRIVER/node_modules/pg/package.json" ]];then echo 'RESULTADO: DRIVER_PG_PENDIENTE';exit 20;fi
if ! node -e 'const p=require(process.argv[1]);process.exit(p.version==="8.23.1"?0:1)' "$DRIVER/node_modules/pg/package.json";then
  echo 'RESULTADO: DRIVER_PG_PENDIENTE';exit 20;fi
"$PG_BIN/initdb" -D "$TEMP/data" -U optima_pruebas -A trust --no-instructions -E UTF8 >"$LOG/initdb.log" 2>&1 || error 'initdb'
mkdir -m 700 "$TEMP/socket"
"$PG_BIN/pg_ctl" -D "$TEMP/data" -l "$LOG/server.log" -o "-c listen_addresses='' -c unix_socket_directories='$TEMP/socket' -c port=55435" start >"$LOG/inicio.log" 2>&1 || error 'pg_ctl'
INICIADO=1
export PGHOST="$TEMP/socket" PGPORT=55435 PGUSER=optima_pruebas PGDATABASE=postgres
"$PG_BIN/createdb" -T template0 optima_pruebas >"$LOG/createdb.log" 2>&1 || error 'createdb'
export PGDATABASE=optima_pruebas
for mig in db/migrations/0001_optima_comercial_pg.sql db/migrations/0002_optima_comercial_rls.sql;do
  "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -f "$mig" >"$LOG/$(basename "$mig").log" 2>&1 || error "Migración $mig"
done
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 >"$LOG/preparacion.sql.log" 2>&1 <<'SQL'
CREATE ROLE optima_reader_185 LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA optima_comercial TO optima_reader_185;
GRANT SELECT ON optima_comercial.contratos,optima_comercial.versiones,
  optima_comercial.eventos,optima_comercial.borradores TO optima_reader_185;
INSERT INTO optima_comercial.contratos(empresa_id,id_contrato,revision,huella_historial)
VALUES ('recAAAAAAAAAAAAAA','CTR-READ185',1,repeat('a',64)),
       ('recZZZZZZZZZZZZZZ','CTR-READ185',0,repeat('b',64));
INSERT INTO optima_comercial.versiones(empresa_id,id_contrato,id_version,numero,estado,servicios,
  motivo_cambio,aprobado_por_id,aprobado_en)
VALUES ('recAAAAAAAAAAAAAA','CTR-READ185','VER-READ185',1,'APROBADA',
  '[{"modalidad":"SUBMODULO_INDEPENDIENTE"}]'::jsonb,'Alta de prueba de historial comercial',
  'recBBBBBBBBBBBBBB','2026-11-11T15:00:00.000Z'::timestamptz);
INSERT INTO optima_comercial.eventos(empresa_id,id_contrato,revision_antes,revision_despues,
  tipo,id_version,actor_usuario_id,fecha_evento)
VALUES ('recAAAAAAAAAAAAAA','CTR-READ185',0,1,'APROBACION','VER-READ185',
  'recBBBBBBBBBBBBBB','2026-11-11T15:00:00.000Z'::timestamptz);
DO $$BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='optima_comercial' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity) <> 5 THEN
    RAISE EXCEPTION 'Faltan políticas RLS';END IF;
END$$;
SQL
PGUSER=optima_reader_185 "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 >"$LOG/rol-lectura.log" 2>&1 <<'SQL'
DO $$BEGIN
  IF (SELECT count(*) FROM optima_comercial.contratos) <> 0 THEN RAISE EXCEPTION 'Sin contexto hay lectura';END IF;
END$$;
BEGIN READ ONLY;
SELECT set_config('optima.empresa_id','recAAAAAAAAAAAAAA',true);
DO $$BEGIN
  IF (SELECT count(*) FROM optima_comercial.contratos)<>1 THEN RAISE EXCEPTION 'Empresa A no aislada';END IF;
  IF (SELECT count(*) FROM optima_comercial.contratos WHERE empresa_id='recZZZZZZZZZZZZZZ')<>0 THEN
    RAISE EXCEPTION 'Fuga de empresa Z';END IF;
END$$;
ROLLBACK;
DO $$BEGIN
  IF (SELECT count(*) FROM optima_comercial.contratos) <> 0 THEN RAISE EXCEPTION 'Contexto perdurado';END IF;
END$$;
SQL
export OPTIMA_PG185_SOCKET="$TEMP/socket" OPTIMA_PG185_DRIVER="$DRIVER"
if ! npx --no-install tsx scripts/demo-lectura-pg-real-12c185.ts >"$LOG/node-real.log" 2>&1;then
  tail -14 "$LOG/node-real.log";error 'Demo Node lectura real';fi
grep -qx 'RESULTADO: LECTURA_NODE_PG_REAL_OK' "$LOG/node-real.log" || error 'Node no confirmó lectura'
echo 'RLS con rol SELECT sin permisos de escritura: OK'
echo 'Lectura de dos empresas aisladas en Node + PostgreSQL: OK'
echo "Log: $LOG"
echo 'RESULTADO: LECTURA_PG_REAL_OK'
