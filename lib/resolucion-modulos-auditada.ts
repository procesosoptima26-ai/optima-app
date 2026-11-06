/** 12B.4.3 — conciliación explícita, sin modificar EMPRESAS ni repetir un PATCH. */
import { leerEstadoModulos, type EstadoModulos } from "../core/gestion-modulos.js";
import { analizarHistorialAuditoria, type RegistroAuditoriaAirtable } from "./conciliacion-modulos.js";
import { registrarEventoAuditoria, type ActorAuditoria } from "./auditoria-eventos.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type DiagnosticoConciliacion = Readonly<{
  operacionId: string;
  empresaId: string;
  accion: string;
  modulo: string;
  estadoDetectado: "APLICADO" | "NO_APLICADO";
  versionActual: string;
  modulosActuales: readonly string[];
  estadoAnterior: readonly string[];
  estadoPropuesto: readonly string[];
}>;
export class ErrorResolucionAuditoria extends Error {
  constructor(public readonly codigo: "HISTORIAL_INVALIDO" | "INCIDENCIA_NO_CONCILIABLE" |
    "ESTADO_NO_COINCIDE" | "DATOS_INCONSISTENTES") {
    super(`Conciliación requiere revisión: ${codigo}`);
    this.name = "ErrorResolucionAuditoria";
  }
}
function error(codigo: ErrorResolucionAuditoria["codigo"]): never {
  throw new ErrorResolucionAuditoria(codigo);
}
function interpretarSnapshot(valor: unknown, empresaId: string): EstadoModulos {
  if (typeof valor !== "string" || !valor || valor.length > 4000) return error("DATOS_INCONSISTENTES");
  let dato: unknown;
  try { dato = JSON.parse(valor); } catch { return error("DATOS_INCONSISTENTES"); }
  if (!dato || typeof dato !== "object" || Array.isArray(dato)) return error("DATOS_INCONSISTENTES");
  const f = dato as Record<string, unknown>;
  if (Object.keys(f).sort().join(",") !== "ACTIVA,MODULOS_CONTRATADOS,VERSION" || f.ACTIVA !== true ||
      typeof f.VERSION !== "string") return error("DATOS_INCONSISTENTES");
  const calculado = leerEstadoModulos(empresaId, true, f.MODULOS_CONTRATADOS);
  if (!calculado.ok || calculado.estado.version !== f.VERSION) return error("DATOS_INCONSISTENTES");
  return calculado.estado;
}

/** Sólo dos diagnósticos evidentes son conciliables; no adivina estados intermedios. */
export function diagnosticarOperacionPendiente(
  empresaId: string, operacionId: string,
  registros: readonly RegistroAuditoriaAirtable[], actual: EstadoModulos,
): DiagnosticoConciliacion {
  if (!ID.test(empresaId) || !UUID.test(operacionId) || actual.id !== empresaId)
    return error("DATOS_INCONSISTENTES");
  const historial = analizarHistorialAuditoria(empresaId, registros);
  if (historial.incidencias.some(i => i.operacionId === null)) return error("HISTORIAL_INVALIDO");
  const incidente = historial.incidencias.find(i => i.operacionId === operacionId);
  if (!incidente || !["SIN_RESULTADO", "INDETERMINADO"].includes(incidente.causa))
    return error("INCIDENCIA_NO_CONCILIABLE");
  const relacionados = registros.filter(r => r.fields.OPERACION_ID === operacionId);
  const comienzos = relacionados.filter(r => r.fields.RESULTADO === "INTENTO");
  const indeterminados = relacionados.filter(r => r.fields.RESULTADO === "INDETERMINADO");
  if (comienzos.length !== 1 || indeterminados.length > 1 || relacionados.length !== 1 + indeterminados.length)
    return error("INCIDENCIA_NO_CONCILIABLE");
  const inicio = comienzos[0].fields;
  if (typeof inicio.ACCION !== "string" || typeof inicio.MODULO !== "string" ||
      !/^MODULO_(HABILITAR|SUSPENDER|REACTIVAR)$/.test(inicio.ACCION))
    return error("DATOS_INCONSISTENTES");
  const antes = interpretarSnapshot(inicio.ESTADO_ANTERIOR, empresaId);
  const propuesto = interpretarSnapshot(inicio.ESTADO_NUEVO, empresaId);
  if (antes.version === propuesto.version) return error("DATOS_INCONSISTENTES");
  for (const indeterminado of indeterminados) {
    const valor = indeterminado.fields.ESTADO_NUEVO;
    if (valor && valor !== inicio.ESTADO_ANTERIOR && valor !== inicio.ESTADO_NUEVO)
      return error("DATOS_INCONSISTENTES");
  }
  const estadoDetectado = actual.version === propuesto.version ? "APLICADO"
    : actual.version === antes.version ? "NO_APLICADO" : null;
  if (!estadoDetectado) return error("ESTADO_NO_COINCIDE");
  return { operacionId, empresaId, accion: inicio.ACCION, modulo: inicio.MODULO,
    estadoDetectado, versionActual: actual.version, modulosActuales: [...actual.originales],
    estadoAnterior: [...antes.originales], estadoPropuesto: [...propuesto.originales] };
}

/** Llamar exclusivamente desde backend con sesión global validada, bajo lock Redis. */
export async function registrarResolucionConciliada(
  diagnostico: DiagnosticoConciliacion,
  actor: ActorAuditoria, empresaNombre: string, motivo: string,
): Promise<{ operacionId: string; registroId: string }> {
  const anterior = leerEstadoModulos(diagnostico.empresaId, true, diagnostico.estadoAnterior);
  const observado = leerEstadoModulos(diagnostico.empresaId, true, diagnostico.modulosActuales);
  if (!anterior.ok || !observado.ok || observado.estado.version !== diagnostico.versionActual ||
      actor.tipo !== "PLATAFORMA") return error("DATOS_INCONSISTENTES");
  const result = await registrarEventoAuditoria({
    operacionId: diagnostico.operacionId, actor, empresaId: diagnostico.empresaId,
    empresaNombre, modulo: diagnostico.modulo, accion: diagnostico.accion,
    recursoTipo: "EMPRESA", recursoId: diagnostico.empresaId,
    anterior: { MODULOS_CONTRATADOS: anterior.estado.originales, ACTIVA: true, VERSION: anterior.estado.version },
    nuevo: { MODULOS_CONTRATADOS: observado.estado.originales, ACTIVA: true, VERSION: observado.estado.version },
    motivo, resultado: "CONCILIADO",
    detalle: diagnostico.estadoDetectado === "APLICADO" ? "CONCILIADO_APLICADO" : "CONCILIADO_NO_APLICADO",
    origen: "PANEL",
  });
  return { operacionId: result.operacionId, registroId: result.registroId };
}
