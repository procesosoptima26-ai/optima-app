#!/usr/bin/env bash
# OPTIMA 12C.18.7: sólo PostgreSQL temporal por socket privado; sin red TCP.
# Reusa código REAL de sesión OPTIMA con fetch falso (Redis/Airtable ficticios).
set -euo pipefail
cd "${OPTIMA_PROJECT_ROOT:-$HOME/proyectos/optima-inventario}"
[[ $(id -u) -ne 0 && -d .git ]] || { echo 'ERROR: usuario/proyecto inválido';exit 1; }
[[ -f db/migrations/0001_optima_comercial_pg.sql && -f db/migrations/0002_optima_comercial_rls.sql ]] || { echo 'ERROR: faltan migraciones';exit 1; }
ESTADO="$HOME/.local/state/optima";mkdir -p "$ESTADO"
LOG=$(mktemp -d "$ESTADO/12c187-real-XXXXXXXX")
TEMP=$(mktemp -d /tmp/optima187.XXXXXXXX);chmod 700 "$TEMP"
PG_BIN='';INICIADO=0
limpiar(){
 if [[ "$INICIADO" == 1 && -n "$PG_BIN" ]];then "$PG_BIN/pg_ctl" -D "$TEMP/data" -m immediate stop >/dev/null 2>&1 || :;fi
 if [[ "$TEMP" == /tmp/optima187.* && -d "$TEMP" ]];then rm -rf -- "$TEMP";fi
}
trap limpiar EXIT
error(){ echo "ERROR: $*";echo "Log: $LOG";exit 1; }
for c in /usr/lib/postgresql/*/bin;do
 if [[ -x "$c/initdb" && -x "$c/pg_ctl" && -x "$c/createdb" && -x "$c/psql" ]];then PG_BIN="$c";break;fi
done
if [[ -z "$PG_BIN" ]];then echo 'RESULTADO: POSTGRES_REAL_PENDIENTE';exit 20;fi
DRIVER="$ESTADO/driver-pg-12c183"
if [[ ! -f "$DRIVER/node_modules/pg/package.json" ]] ||
   ! node -e 'const p=require(process.argv[1]);process.exit(p.version==="8.23.1"?0:1)' "$DRIVER/node_modules/pg/package.json";then
 echo 'RESULTADO: DRIVER_PG_PENDIENTE';exit 20
fi
"$PG_BIN/initdb" -D "$TEMP/data" -U optima_pruebas -A trust --no-instructions -E UTF8 >"$LOG/initdb.log" 2>&1 || error initdb
mkdir -m 700 "$TEMP/socket"
"$PG_BIN/pg_ctl" -D "$TEMP/data" -l "$LOG/server.log" \
 -o "-c listen_addresses='' -c unix_socket_directories='$TEMP/socket' -c port=55437" start >"$LOG/inicio.log" 2>&1 || error pg_ctl
INICIADO=1
export PGHOST="$TEMP/socket" PGPORT=55437 PGUSER=optima_pruebas PGDATABASE=postgres
"$PG_BIN/createdb" -T template0 optima_pruebas >"$LOG/createdb.log" 2>&1 || error createdb
export PGDATABASE=optima_pruebas
for mig in db/migrations/0001_optima_comercial_pg.sql db/migrations/0002_optima_comercial_rls.sql;do
 "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -f "$mig" >"$LOG/$(basename "$mig").log" 2>&1 || error "Migración temporal $mig"
done
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 >"$LOG/preparacion.sql.log" 2>&1 <<'SQL' || error 'Datos ficticios'
CREATE ROLE optima_reader_187 LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA optima_comercial TO optima_reader_187;
GRANT SELECT ON optima_comercial.contratos,optima_comercial.versiones,
 optima_comercial.eventos,optima_comercial.borradores TO optima_reader_187;
INSERT INTO optima_comercial.contratos(empresa_id,id_contrato,revision,huella_historial)
VALUES ('recAAAAAAAAAAAAAA','CTR-READ185',1,repeat('a',64)),
       ('recZZZZZZZZZZZZZZ','CTR-READ185',0,repeat('b',64));
INSERT INTO optima_comercial.versiones(empresa_id,id_contrato,id_version,numero,estado,servicios,
 motivo_cambio,aprobado_por_id,aprobado_en)
VALUES ('recAAAAAAAAAAAAAA','CTR-READ185','VER-READ185',1,'APROBADA',
 '[{"modalidad":"SUBMODULO_INDEPENDIENTE"}]'::jsonb,'Laboratorio de consulta comercial',
 'recBBBBBBBBBBBBBB','2026-11-11T15:00:00.000Z'::timestamptz);
INSERT INTO optima_comercial.eventos(empresa_id,id_contrato,revision_antes,revision_despues,
 tipo,id_version,actor_usuario_id,fecha_evento)
VALUES ('recAAAAAAAAAAAAAA','CTR-READ185',0,1,'APROBACION','VER-READ185',
 'recBBBBBBBBBBBBBB','2026-11-11T15:00:00.000Z'::timestamptz);
DO $$BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='optima_comercial' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity)<>5 THEN
  RAISE EXCEPTION 'RLS incompleto';END IF;
END$$;
SQL
# Nunca heredar credenciales reales de Airtable/Redis ni DSN comercial.
if ! env -u AIRTABLE_TOKEN -u AIRTABLE_USERS_BASE_ID \
 -u AIRTABLE_USERS_TABLE_ID -u AIRTABLE_COMPANIES_TABLE_ID \
 -u UPSTASH_REDIS_KV_REST_API_URL -u UPSTASH_REDIS_KV_REST_API_TOKEN \
 -u OPTIMA_COMERCIAL_PG_READ_URL -u OPTIMA_COMERCIAL_PG_READ_ROLE \
 -u OPTIMA_PLATFORM_ADMIN_USER_ID -u OPTIMA_PLATFORM_COMPANY_ID \
 -u OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED \
 OPTIMA_PG187_SOCKET="$TEMP/socket" OPTIMA_PG187_DRIVER="$DRIVER" \
 npx --no-install tsx scripts/demo-endpoint-pg-aislado-12c187.ts >"$LOG/demo.log" 2>&1;then
 tail -12 "$LOG/demo.log";error 'Endpoint de laboratorio'
fi
for esperado in \
 'Cookie/Redis/administrador OPTIMA simulados usando lógica real: OK' \
 'PostgreSQL real + rol SELECT + RLS entre empresas: OK' \
 'Sin red externa, sin credenciales ni endpoint operativo: OK' \
 'RESULTADO: ENDPOINT_PG187_REAL_OK';do
 grep -Fxq "$esperado" "$LOG/demo.log" || error 'Resultado incompleto de integración'
done
cat "$LOG/demo.log"
echo "Log: $LOG"
echo 'RESULTADO: ENDPOINT_PG187_REAL_OK'
