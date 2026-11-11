/**
 * OPTIMA 12C.18.1 — Repositorio transaccional PostgreSQL, SIN CONEXIÓN AUTOMÁTICA.
 *
 * Este módulo solo puede ejecutar SQL si otro módulo INYECTA explícitamente
 * una conexión dedicada de PostgreSQL. No crea cliente/pool, no lee secretos,
 * no monta rutas, no llama Airtable ni habilita servicios operativos.
 *
 * REQUISITOS ANTES DE USARLO EN UNA API REAL:
 *  - el backend autentica sesión, empresa, rol y separación de funciones;
 *  - actorServidorId se obtiene de la sesión (NO del cuerpo enviado por UI);
 *  - conexión dedicada, PostgreSQL con migración 0001 aplicada, transacciones;
 *  - pruebas en PostgreSQL real con dos conexiones concurrentes, fallos y RLS;
 *  - una base PREVIEW separada de Frioteka y permisos de BD mínimos.
 *
 * NOTA: utiliza instantáneas validadas del motor simulado 12C.17, no su
 * mecanismo de permisos simulados. Nunca usar una instantánea enviada por el
 * navegador como estado confiable de la BD; el backend debe reconstruirla.
 */
import { createHash } from "node:crypto";
import {
  compararTransicionDeHistorialLocal,
} from "./proyeccion-persistencia-comercial-12c175.js";
import {
  type HistorialContratacionSimulado,
  type VersionContratacionSimulada,
} from "./historial-contratacion-comercial-12c173.js";

export type RespuestaSql<T extends object = Record<string, unknown>> = Readonly<{
  rows: readonly T[];
  rowCount: number | null;
}>;
export type ClientePostgresDedicado = Readonly<{
  query: <T extends object = Record<string, unknown>>(
    sql: string, parametros?: readonly unknown[],
  ) => Promise<RespuestaSql<T>>;
}>;
export type SolicitudGuardadoComercialPg = Readonly<{
  anterior: HistorialContratacionSimulado;
  siguiente: HistorialContratacionSimulado;
  claveIdempotencia: string;
  /** Identidad que el backend DEBERÁ derivar y autorizar desde la sesión. */
  actorServidorId: string;
}>;
export type ResultadoGuardadoComercialPg =
  | Readonly<{ ok: true; repetida: boolean; revisionAplicada: number;
      idVersion: string; tipo: "APROBACION" | "ACTIVACION"; accesoOperativoHabilitado: false }>
  | Readonly<{ ok: false; motivo: "DATOS_INVALIDOS" | "TRANSICION_INVALIDA" |
      "IDENTIDAD_NO_COINCIDE" | "SEPARACION_FUNCIONES" | "REVISION_DESACTUALIZADA" |
      "ESTADO_DIVERGENTE" | "CLAVE_REUTILIZADA_CON_CAMBIO" | "REGISTRO_INCONSISTENTE" |
      "ERROR_BD"; accesoOperativoHabilitado: false }>;

const ID_USUARIO = /^rec[A-Za-z0-9]{14}$/;
const CLAVE = /^OP-[A-Za-z0-9_-]{8,72}$/;
const HASH = /^[0-9a-f]{64}$/;
const ERROR = (motivo: Extract<ResultadoGuardadoComercialPg, {ok:false}>["motivo"]): ResultadoGuardadoComercialPg =>
  ({ ok: false, motivo, accesoOperativoHabilitado: false });
function digest(dato: unknown): string {
  return createHash("sha256").update(JSON.stringify(dato)).digest("hex");
}
function filasAfectadas(respuesta: RespuestaSql): boolean { return respuesta.rowCount === 1; }
function idempotenciaRespuestaValida(v: unknown): v is {
  revisionAplicada: number; idVersion: string; tipo: "APROBACION" | "ACTIVACION";
} {
  return typeof v === "object" && v !== null && !Array.isArray(v) &&
    Object.keys(v).length === 3 &&
    "revisionAplicada" in v && typeof v.revisionAplicada === "number" &&
    Number.isSafeInteger(v.revisionAplicada) && v.revisionAplicada >= 1 &&
    "idVersion" in v && typeof v.idVersion === "string" &&
    "tipo" in v && (v.tipo === "APROBACION" || v.tipo === "ACTIVACION");
}
/**
 * Ejecuta UNA transición comercial, VERSION + EVENTO + RESPUESTA IDEMPOTENTE
 * dentro de UNA MISMA transacción, serializada por SELECT FOR UPDATE del contrato.
 * La revisión y la huella se comparan con el estado que existe en PostgreSQL.
 *
 * Fallos de BD devuelven ERROR_BD sin exponer SQL ni datos sensibles.
 * NO es un endpoint, NO autentica, NO configura una BD, NO activa permisos.
 */
export async function persistirPasoComercialPg12C181(
  cliente: ClientePostgresDedicado,
  solicitud: SolicitudGuardadoComercialPg,
): Promise<ResultadoGuardadoComercialPg> {
  if (!solicitud || typeof solicitud !== "object" ||
      typeof solicitud.claveIdempotencia !== "string" || !CLAVE.test(solicitud.claveIdempotencia) ||
      typeof solicitud.actorServidorId !== "string" || !ID_USUARIO.test(solicitud.actorServidorId))
    return ERROR("DATOS_INVALIDOS");
  const { anterior, siguiente, actorServidorId } = solicitud;
  const comparacion = compararTransicionDeHistorialLocal({
    anterior, siguiente, empresaId: anterior?.empresaId,
    revisionAnteriorEsperada: anterior?.revisionHistorial,
  });
  if (!comparacion.ok) return ERROR("TRANSICION_INVALIDA");
  const evento = siguiente.eventos[siguiente.eventos.length - 1];
  if (!evento || evento.actorUsuarioId !== actorServidorId)
    return ERROR("IDENTIDAD_NO_COINCIDE");
  const destino = siguiente.versiones.find(v => v.idVersion === evento.idVersion);
  if (!destino) return ERROR("TRANSICION_INVALIDA");
  if (evento.tipo === "ACTIVACION" && destino.aprobadoPorId === actorServidorId)
    return ERROR("SEPARACION_FUNCIONES");

  const empresa = anterior.empresaId;
  const contrato = anterior.idContrato;
  const hashAnterior = digest(anterior);
  const hashSiguiente = digest(siguiente);
  const huellaSolicitud = digest({
    empresa, contrato, anterior, siguiente, actorServidorId,
  });
  const respuesta = {
    revisionAplicada: siguiente.revisionHistorial,
    idVersion: evento.idVersion,
    tipo: evento.tipo,
  } as const;
  let transaccionIniciada = false;
  try {
    await cliente.query("BEGIN");
    transaccionIniciada = true;

    // Inicialización exclusiva para un historial nuevo de revisión 0.
    if (anterior.revisionHistorial === 0 && anterior.versiones.length === 0) {
      await cliente.query(
        `INSERT INTO optima_comercial.contratos
          (empresa_id, id_contrato, revision, huella_historial)
          VALUES ($1, $2, 0, $3) ON CONFLICT DO NOTHING`,
        [empresa, contrato, hashAnterior],
      );
    }
    // Esto serializa escrituras del MISMO contrato incluso en distintos servidores.
    const bloqueado = await cliente.query<{ revision: string | number; huella_historial: string }>(
      `SELECT revision, huella_historial FROM optima_comercial.contratos
       WHERE empresa_id = $1 AND id_contrato = $2 FOR UPDATE`,
      [empresa, contrato],
    );
    if (bloqueado.rows.length !== 1) {
      await cliente.query("ROLLBACK"); transaccionIniciada = false;
      return ERROR("REGISTRO_INCONSISTENTE");
    }
    // La idempotencia se revisa ANTES del conflicto por revisión: reintentos viejos
    // devuelven el resultado guardado, sin aplicar ni registrar nada nuevo.
    const almacenada = await cliente.query<{
      huella_solicitud: string; revision_aplicada: string | number; respuesta: unknown;
    }>(
      `SELECT huella_solicitud, revision_aplicada, respuesta
       FROM optima_comercial.idempotencia
       WHERE empresa_id = $1 AND id_contrato = $2 AND clave = $3`,
      [empresa, contrato, solicitud.claveIdempotencia],
    );
    if (almacenada.rows.length > 1) {
      await cliente.query("ROLLBACK"); transaccionIniciada = false;
      return ERROR("REGISTRO_INCONSISTENTE");
    }
    if (almacenada.rows.length === 1) {
      const guardada = almacenada.rows[0];
      if (guardada.huella_solicitud !== huellaSolicitud) {
        await cliente.query("ROLLBACK"); transaccionIniciada = false;
        return ERROR("CLAVE_REUTILIZADA_CON_CAMBIO");
      }
      if (!idempotenciaRespuestaValida(guardada.respuesta) ||
          String(guardada.revision_aplicada) !== String(guardada.respuesta.revisionAplicada) ||
          guardada.respuesta.revisionAplicada !== respuesta.revisionAplicada ||
          guardada.respuesta.idVersion !== respuesta.idVersion ||
          guardada.respuesta.tipo !== respuesta.tipo) {
        await cliente.query("ROLLBACK"); transaccionIniciada = false;
        return ERROR("REGISTRO_INCONSISTENTE");
      }
      await cliente.query("COMMIT"); transaccionIniciada = false;
      return { ok: true, repetida: true, ...respuesta, accesoOperativoHabilitado: false };
    }
    const fila = bloqueado.rows[0];
    if (String(fila.revision) !== String(anterior.revisionHistorial)) {
      await cliente.query("ROLLBACK"); transaccionIniciada = false;
      return ERROR("REVISION_DESACTUALIZADA");
    }
    if (fila.huella_historial !== hashAnterior || !HASH.test(fila.huella_historial)) {
      await cliente.query("ROLLBACK"); transaccionIniciada = false;
      return ERROR("ESTADO_DIVERGENTE");
    }

    if (evento.tipo === "APROBACION") {
      if (siguiente.versiones.length !== anterior.versiones.length + 1 ||
          destino.estado !== "APROBADA") {
        await cliente.query("ROLLBACK"); transaccionIniciada = false;
        return ERROR("TRANSICION_INVALIDA");
      }
      const resultado = await cliente.query(
        `INSERT INTO optima_comercial.versiones
         (empresa_id, id_contrato, id_version, numero, estado, servicios,
          motivo_cambio, aprobado_por_id, aprobado_en, vigente_desde,
          vigente_hasta, sustituida_por_id)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
        [empresa, contrato, destino.idVersion, destino.numero, destino.estado,
          JSON.stringify(destino.servicios), destino.motivoCambio, destino.aprobadoPorId,
          destino.aprobadoEnIso, destino.vigenteDesdeIso, destino.vigenteHastaIso,
          destino.sustituidaPorId],
      );
      if (!filasAfectadas(resultado)) throw Error("Cantidad de versiones inesperada");
    } else {
      const previa = anterior.versiones.find(v => v.estado === "VIGENTE") ?? null;
      if (previa) {
        const archivada = siguiente.versiones.find(v => v.idVersion === previa.idVersion);
        if (!archivada || archivada.estado !== "HISTORICA") throw Error("Histórica inexistente");
        const r = await cliente.query(
          `UPDATE optima_comercial.versiones SET estado = 'HISTORICA',
           vigente_hasta = $4, sustituida_por_id = $5
           WHERE empresa_id = $1 AND id_contrato = $2 AND id_version = $3
             AND estado = 'VIGENTE' AND vigente_hasta IS NULL`,
          [empresa, contrato, previa.idVersion, archivada.vigenteHastaIso, archivada.sustituidaPorId],
        );
        if (!filasAfectadas(r)) throw Error("Versión previa incongruente");
      }
      const r = await cliente.query(
        `UPDATE optima_comercial.versiones
         SET estado = 'VIGENTE', vigente_desde = $4
         WHERE empresa_id = $1 AND id_contrato = $2 AND id_version = $3
         AND estado = 'APROBADA' AND vigente_desde IS NULL`,
        [empresa, contrato, destino.idVersion, destino.vigenteDesdeIso],
      );
      if (!filasAfectadas(r)) throw Error("Versión aprobada incongruente");
    }

    const registro = await cliente.query(
      `INSERT INTO optima_comercial.eventos
       (empresa_id, id_contrato, revision_antes, revision_despues,
        tipo, id_version, id_version_anterior, actor_usuario_id, fecha_evento)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [empresa, contrato, anterior.revisionHistorial, siguiente.revisionHistorial,
        evento.tipo, evento.idVersion, evento.idVersionAnterior,
        actorServidorId, evento.fechaIso],
    );
    if (!filasAfectadas(registro)) throw Error("Evento no persistido");

    const idempotencia = await cliente.query(
      `INSERT INTO optima_comercial.idempotencia
       (empresa_id, id_contrato, clave, huella_solicitud, respuesta, revision_aplicada)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [empresa, contrato, solicitud.claveIdempotencia,
        huellaSolicitud, JSON.stringify(respuesta), siguiente.revisionHistorial],
    );
    if (!filasAfectadas(idempotencia)) throw Error("Idempotencia no persistida");

    const revision = await cliente.query(
      `UPDATE optima_comercial.contratos SET revision = $4,
       huella_historial = $5, actualizado_en = now()
       WHERE empresa_id = $1 AND id_contrato = $2
         AND revision = $3 AND huella_historial = $6`,
      [empresa, contrato, anterior.revisionHistorial,
        siguiente.revisionHistorial, hashSiguiente, hashAnterior],
    );
    if (!filasAfectadas(revision)) throw Error("CAS de contrato rechazado");
    await cliente.query("COMMIT"); transaccionIniciada = false;
    return { ok: true, repetida: false, ...respuesta, accesoOperativoHabilitado: false };
  } catch {
    if (transaccionIniciada) {
      try { await cliente.query("ROLLBACK"); } catch { /* devolver fallo cerrado */ }
    }
    return ERROR("ERROR_BD");
  }
}
