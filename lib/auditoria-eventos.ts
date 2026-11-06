/**
 * OPTIMA 12B.2 — motor aislado de auditoría. No expone una ruta HTTP.
 * Únicamente crea eventos nuevos; jamás edita ni elimina filas.
 * APAGADO por defecto: requiere OPTIMA_AUDIT_WRITES_ENABLED=true y tabla configurada.
 * El llamador debe obtener el actor de una sesión VERIFICADA por el servidor.
 */
import { randomUUID } from "node:crypto";

const ID_REGISTRO = /^rec[A-Za-z0-9]{14}$/;
const ID_BASE = /^app[A-Za-z0-9]{14}$/;
const ID_TABLA = /^tbl[A-Za-z0-9]{14}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODIGO = /^[A-Z][A-Z0-9_]{1,79}$/;
// Preservar las etiquetas reales de Airtable, incluidos alias heredados.
// No aceptar valores arbitrarios que podrían contener datos confidenciales.
const ETIQUETAS_MODULOS = new Set([
  "CORE", "USUARIO", "INVENTARIO", "MOVIMIENTOS", "CUENTAS_CORRIENTES",
  "CUENTAS CORRIENTES", "REPORTES", "AJUSTES", "CONFIGURACION", "CONFIGURACIÓN",
  "FACTURACION", "ADMINISTRACION", "AUTOMATIZACIONES", "AUTOMATIZACIONES E INTEGRACIONES",
]);
const ESTADOS = ["INTENTO", "CONFIRMADO", "RECHAZADO", "FALLIDO", "INDETERMINADO", "CONCILIADO"] as const;
const ORIGENES = ["API", "PANEL", "AUTOMATIZACION"] as const;
const TIPOS = ["PLATAFORMA", "CLIENTE", "SISTEMA"] as const;

export type EstadoAuditoria = (typeof ESTADOS)[number];
export type OrigenAuditoria = (typeof ORIGENES)[number];
export type ActorAuditoria = Readonly<{
  usuarioId: string; // rec... validado por el servidor; "SISTEMA" para procesos internos
  usuario: string;
  tipo: (typeof TIPOS)[number];
}>;

/** Snapshot limitado a campos técnicos permitidos: jamás datos personales o secretos. */
export type EstadoTecnicoAuditoria = Readonly<{
  MODULOS_CONTRATADOS?: readonly string[];
  ACTIVA?: boolean;
  VERSION?: string;
}>;

export type EntradaAuditoria = Readonly<{
  operacionId: string;
  actor: ActorAuditoria;
  empresaId: string;
  empresaNombre: string;
  modulo: string;
  accion: string;
  recursoTipo: string;
  recursoId: string;
  anterior?: EstadoTecnicoAuditoria | null;
  nuevo?: EstadoTecnicoAuditoria | null;
  motivo: string;
  resultado: EstadoAuditoria;
  detalle?: string; // SOLO código técnico sin información sensible, p. ej. VERSION_DESACTUALIZADA
  origen: OrigenAuditoria;
}>;

export type EventoAuditoriaPreparado = Readonly<{
  eventoId: string;
  operacionId: string;
  fields: Readonly<Record<string, string>>;
}>;

export class FalloAuditoria extends Error {
  constructor(
    public readonly codigo: "NO_HABILITADA" | "CONFIG_INVALIDA" | "EVENTO_INVALIDO" | "CONFIRMACION_INCIERTA",
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "FalloAuditoria";
  }
}

function invalido(): never {
  throw new FalloAuditoria("EVENTO_INVALIDO", "Evento de auditoría inválido o con datos no permitidos");
}

function texto(valor: unknown, maximo: number, minimo = 1): string {
  if (typeof valor !== "string" || valor.trim().length < minimo || valor.trim().length > maximo ||
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(valor)) return invalido();
  return valor.trim();
}

function codigo(valor: unknown): string {
  const limpio = texto(valor, 80, 2);
  if (!CODIGO.test(limpio)) return invalido();
  return limpio;
}

function snapshot(valor: unknown): string {
  if (valor === undefined || valor === null) return "";
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return invalido();
  const campos = valor as Record<string, unknown>;
  const keys = Object.keys(campos);
  if (!keys.length || keys.some(k => !["MODULOS_CONTRATADOS", "ACTIVA", "VERSION"].includes(k))) return invalido();
  const limpio: Record<string, unknown> = {};
  for (const key of keys) {
    const v = campos[key];
    if (key === "MODULOS_CONTRATADOS") {
      if (!Array.isArray(v) || v.length > 30 || !v.every(x => typeof x === "string" &&
          x.length >= 2 && x.length <= 80 && ETIQUETAS_MODULOS.has(x))) return invalido();
      limpio[key] = [...v];
    } else if (key === "ACTIVA") {
      if (typeof v !== "boolean") return invalido();
      limpio[key] = v;
    } else if (key === "VERSION") {
      if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) return invalido();
      limpio[key] = v;
    }
  }
  const json = JSON.stringify(limpio);
  if (json.length > 4000) return invalido();
  return json;
}

export function crearOperacionAuditoria(): string {
  return randomUUID();
}

/** Puro: prepara y valida; nunca usa red, Airtable o variables de entorno. */
export function prepararEventoAuditoria(entrada: EntradaAuditoria): EventoAuditoriaPreparado {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return invalido();
  const permitidos = ["operacionId", "actor", "empresaId", "empresaNombre", "modulo", "accion",
    "recursoTipo", "recursoId", "anterior", "nuevo", "motivo", "resultado", "detalle", "origen"];
  if (Object.keys(entrada).some(k => !permitidos.includes(k))) return invalido();
  if (!UUID_V4.test(entrada.operacionId) || !ID_REGISTRO.test(entrada.empresaId) ||
      !ID_REGISTRO.test(entrada.recursoId)) return invalido();
  const actor = entrada.actor;
  if (!actor || typeof actor !== "object" || Array.isArray(actor) ||
      Object.keys(actor).some(k => !["usuarioId", "usuario", "tipo"].includes(k)) ||
      !TIPOS.includes(actor.tipo) ||
      (actor.tipo === "SISTEMA" ? actor.usuarioId !== "SISTEMA" : !ID_REGISTRO.test(actor.usuarioId))) return invalido();
  if (!ESTADOS.includes(entrada.resultado) || !ORIGENES.includes(entrada.origen)) return invalido();
  const motivo = texto(entrada.motivo, 500, 10);
  const detalle = entrada.detalle === undefined ? "" : codigo(entrada.detalle);
  const eventoId = randomUUID();
  const fields: Record<string, string> = {
    ID_EVENTO: eventoId,
    OPERACION_ID: entrada.operacionId,
    FECHA_HORA_UTC: new Date().toISOString(),
    ACTOR_USUARIO_ID: actor.usuarioId,
    ACTOR_USUARIO: texto(actor.usuario, 100),
    ACTOR_TIPO: actor.tipo,
    EMPRESA_ID: entrada.empresaId,
    EMPRESA_NOMBRE: texto(entrada.empresaNombre, 120),
    MODULO: codigo(entrada.modulo),
    ACCION: codigo(entrada.accion),
    RECURSO_TIPO: codigo(entrada.recursoTipo),
    RECURSO_ID: entrada.recursoId,
    ESTADO_ANTERIOR: snapshot(entrada.anterior),
    ESTADO_NUEVO: snapshot(entrada.nuevo),
    MOTIVO: motivo,
    RESULTADO: entrada.resultado,
    DETALLE: detalle,
    ORIGEN: entrada.origen,
    ESQUEMA_VERSION: "1",
  };
  return { eventoId, operacionId: entrada.operacionId, fields };
}

function configuracion() {
  if (process.env.OPTIMA_AUDIT_WRITES_ENABLED !== "true") {
    throw new FalloAuditoria("NO_HABILITADA", "Auditoría de escritura todavía deshabilitada");
  }
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
  const tabla = process.env.AIRTABLE_AUDITORIA_TABLE_ID?.trim() ?? "";
  const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
  if (!ID_BASE.test(base) || !ID_TABLA.test(tabla) || !token) {
    throw new FalloAuditoria("CONFIG_INVALIDA", "La Base Maestra no tiene configurada la auditoría");
  }
  return { base, tabla, token };
}

/**
 * Sólo INSERT en AUDITORIA_EVENTOS. Nunca reintenta una escritura incierta.
 * Ante timeout o respuesta inválida, consultar OPERACION_ID antes de actuar de nuevo.
 * No llamar con campos provenientes directamente del navegador.
 */
export async function registrarEventoAuditoria(entrada: EntradaAuditoria): Promise<Readonly<{
  eventoId: string; operacionId: string; registroId: string;
}>> {
  const cfg = configuracion();
  const evento = prepararEventoAuditoria(entrada);
  try {
    const respuesta = await fetch(`https://api.airtable.com/v0/${cfg.base}/${cfg.tabla}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields: evento.fields }], typecast: false }),
      signal: AbortSignal.timeout(10000),
    });
    if (!respuesta.ok) throw new Error("Auditoría no confirmada");
    const data: unknown = await respuesta.json();
    if (!data || typeof data !== "object" || !("records" in data) ||
        !Array.isArray(data.records) || data.records.length !== 1) throw new Error("Respuesta de auditoría inválida");
    const record: unknown = data.records[0];
    if (!record || typeof record !== "object" || !("id" in record) ||
        typeof record.id !== "string" || !ID_REGISTRO.test(record.id) ||
        !("fields" in record) || !record.fields || typeof record.fields !== "object" ||
        !("ID_EVENTO" in record.fields) || record.fields.ID_EVENTO !== evento.eventoId ||
        !("OPERACION_ID" in record.fields) || record.fields.OPERACION_ID !== evento.operacionId) {
      throw new Error("Airtable no confirmó el evento exacto");
    }
    return { eventoId: evento.eventoId, operacionId: evento.operacionId, registroId: record.id };
  } catch {
    // La escritura pudo ocurrir aunque la respuesta no haya llegado: nunca reintentar automáticamente.
    throw new FalloAuditoria("CONFIRMACION_INCIERTA",
      "No se pudo confirmar el evento; conciliar en Airtable por OPERACION_ID antes de reintentar");
  }
}
