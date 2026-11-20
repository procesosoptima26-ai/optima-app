/**
 * OPTIMA Core — pool de ESCRITURA del ciclo de vida (Tarea 5.4), exclusivo de Preview.
 * Misma disciplina que el pool contractual: no abre conexiones al importarse, usa la URL
 * del ESCRITOR (nunca la del lector) y en cada conexión comprueba que el rol tenga
 * EXACTAMENTE los permisos mínimos sobre las dos tablas del ciclo de vida:
 *   ciclo_vida: leer, insertar, modificar (no borrar) · ciclo_vida_eventos: leer, insertar (no modificar/borrar).
 */
import { createRequire } from "node:module";
import type { ConexionPgNode183, PoolPgNode183 } from "../core/adaptador-pg-node-12c183.js";
import { validarConfigEscritura197, type ConfigEscritura197 } from "./pool-escritura-comercial-12c197.js";

type PoolInterno = PoolPgNode183 & { end(): Promise<void> };
type ConstructorPool = new (config: Record<string, unknown>) => PoolInterno;
const TABLAS = ["ciclo_vida", "ciclo_vida_eventos"] as const;
const ESPERADOS: Readonly<Record<string, readonly boolean[]>> = {
  ciclo_vida: [true, true, true, false],
  ciclo_vida_eventos: [true, true, false, false],
};
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

const SQL_CONTROL = `SELECT current_user AS usuario, session_user AS usuario_sesion,
 r.rolsuper AS superusuario, r.rolbypassrls AS omite_rls, r.rolcreatedb AS crea_bd,
 r.rolcreaterole AS crea_rol, r.rolreplication AS replica,
 has_schema_privilege(current_user,'optima_comercial','USAGE') AS uso_esquema,
 has_schema_privilege(current_user,'optima_comercial','CREATE') AS crea_esquema,
 has_sequence_privilege(current_user,'optima_comercial.ciclo_vida_eventos_id_evento_seq','USAGE') AS usa_secuencia,
 (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND
    pg_get_userbyid(c.relowner)<>current_user)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='optima_comercial' AND c.relkind='r'
      AND c.relname=ANY(ARRAY['ciclo_vida','ciclo_vida_eventos'])) AS rls_estricto,
 ${TABLAS.flatMap(t => PRIVS.map(p =>
   `has_table_privilege(current_user,'optima_comercial.${t}','${p}') AS ${p.toLowerCase()}_${t}`)).join(",\n ")}
 FROM pg_roles r WHERE r.rolname=current_user`;

export function validarRolCicloVida(rows: readonly Record<string, unknown>[], rol: string): boolean {
  if (rows.length !== 1) return false;
  const r = rows[0];
  if (r.usuario !== rol || r.usuario_sesion !== rol || r.superusuario !== false || r.omite_rls !== false ||
      r.crea_bd !== false || r.crea_rol !== false || r.replica !== false ||
      r.uso_esquema !== true || r.crea_esquema !== false || r.usa_secuencia !== true ||
      r.rls_estricto !== true) return false;
  return TABLAS.every(t => PRIVS.every((p, i) => r[`${p.toLowerCase()}_${t}`] === ESPERADOS[t][i]));
}

export function crearPoolCicloVidaEscritura(
  config: ConfigEscritura197 = { dsn: process.env.OPTIMA_COMERCIAL_PG_WRITE_URL ?? "",
    rol: process.env.OPTIMA_COMERCIAL_PG_WRITE_ROLE ?? "" },
  obtenerConstructor: () => ConstructorPool = () => {
    const mod = createRequire(import.meta.url)("pg") as { Pool?: ConstructorPool };
    if (typeof mod.Pool !== "function") throw Error("Driver PostgreSQL no disponible");
    return mod.Pool;
  },
): PoolPgNode183 {
  let pool: PoolInterno | undefined;
  return { connect: async (): Promise<ConexionPgNode183> => {
    if (!validarConfigEscritura197(config)) throw Error("Escritor de ciclo de vida sin configuración segura");
    if (!pool) pool = new (obtenerConstructor())({ connectionString: config.dsn,
      max: 2, connectionTimeoutMillis: 4000, idleTimeoutMillis: 30000,
      statement_timeout: 10000, query_timeout: 12000, application_name: "optima_ciclo_vida_write" });
    const conexion = await pool.connect();
    try {
      const r = await conexion.query(SQL_CONTROL);
      if (!validarRolCicloVida(r.rows, config.rol)) throw Error("Rol PostgreSQL sin privilegios mínimos verificables");
      return conexion;
    } catch (error) {
      try { conexion.release(); } catch { /* denegar */ }
      throw error;
    }
  } };
}
