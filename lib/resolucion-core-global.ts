/**
 * OPTIMA — diagnóstico y cierre limitado de incidencias del Core.
 * No vuelve a ejecutar el cambio de negocio; sólo agrega CONCILIADO a auditoría.
 * NUNCA concilia invitaciones, altas o credenciales: requieren evidencia externa.
 */
import { createHash } from "node:crypto";
import { analizarAuditoriaGlobal, estadosIguales, leerSnapshotAuditoriaCore,
  ACCIONES_CONCILIABLES_CORE, type AccionConciliableCore,
  type SnapshotAuditoriaCore } from "./conciliacion-core-global.js";
import type { RegistroAuditoriaAirtable } from "./conciliacion-modulos.js";
import { registrarEventoAuditoria, type ActorAuditoria, type EntradaAuditoria } from "./auditoria-eventos.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type EstadoDetectadoCore = "APLICADO" | "NO_APLICADO";
export type DiagnosticoCore = Readonly<{
  empresaId: string; operacionId: string; accion: AccionConciliableCore;
  recursoId: string; recursoTipo: "USUARIO" | "SUCURSAL";
  estadoDetectado: EstadoDetectadoCore; huellaActual: string;
  anterior: SnapshotAuditoriaCore; propuesto: SnapshotAuditoriaCore;
  observado: SnapshotAuditoriaCore;
}>;
export class ErrorResolucionCoreGlobal extends Error {
  constructor(public readonly codigo: "HISTORIAL_INVALIDO" | "NO_CONCILIABLE" |
    "VERIFICACION_EXTERNA" | "ESTADO_NO_COINCIDE" | "SNAPSHOT_INCONSISTENTE") {
    super(`Resolución Core requiere revisión: ${codigo}`);
    this.name = "ErrorResolucionCoreGlobal";
  }
}
function abortar(codigo: ErrorResolucionCoreGlobal["codigo"]): never {
  throw new ErrorResolucionCoreGlobal(codigo);
}
function huella(s: SnapshotAuditoriaCore): string {
  const normalizado = Object.fromEntries(Object.keys(s).sort().map(k => [k, s[k]]));
  return createHash("sha256").update(JSON.stringify(normalizado)).digest("hex");
}
function camposExactos(s: SnapshotAuditoriaCore, claves: readonly string[]): boolean {
  return Object.keys(s).sort().join("|") === [...claves].sort().join("|");
}
function versionDeAccesos(s: SnapshotAuditoriaCore): boolean {
  return camposExactos(s, ["ACTIVA", "SUCURSALES", "SUCURSAL_PRINCIPAL", "MODULOS_HABILITADOS", "PERMISOS", "VERSION"]) &&
    typeof s.ACTIVA === "boolean" && typeof s.VERSION === "string" && /^[a-f0-9]{64}$/.test(s.VERSION) &&
    Array.isArray(s.SUCURSALES) && s.SUCURSALES.length > 0 &&
    typeof s.SUCURSAL_PRINCIPAL === "string" && s.SUCURSALES.includes(s.SUCURSAL_PRINCIPAL) &&
    Array.isArray(s.MODULOS_HABILITADOS) && s.MODULOS_HABILITADOS.includes("CORE") &&
    Array.isArray(s.PERMISOS);
}
function validoCambio(accion: AccionConciliableCore, anterior: SnapshotAuditoriaCore, nuevo: SnapshotAuditoriaCore): boolean {
  if (accion === "USUARIO_EDITAR_ACCESOS") return versionDeAccesos(anterior) && versionDeAccesos(nuevo) &&
    anterior.ACTIVA === nuevo.ACTIVA && anterior.VERSION !== nuevo.VERSION;
  if (!camposExactos(anterior, ["ACTIVA", "NOMBRE_SUCURSAL", "SUCURSAL_ID"]) ||
      !camposExactos(nuevo, ["ACTIVA", "NOMBRE_SUCURSAL", "SUCURSAL_ID"]) ||
      anterior.SUCURSAL_ID !== nuevo.SUCURSAL_ID) return false;
  if (accion === "SUCURSAL_RENOMBRAR") return anterior.ACTIVA === nuevo.ACTIVA &&
    anterior.NOMBRE_SUCURSAL !== nuevo.NOMBRE_SUCURSAL;
  return anterior.ACTIVA === true && nuevo.ACTIVA === false &&
    anterior.NOMBRE_SUCURSAL === nuevo.NOMBRE_SUCURSAL;
}

export function diagnosticarIncidenciaCore(
  empresaId: string, operacionId: string, registros: readonly RegistroAuditoriaAirtable[],
  actual: SnapshotAuditoriaCore,
): DiagnosticoCore {
  if (!ID.test(empresaId) || !UUID.test(operacionId)) return abortar("HISTORIAL_INVALIDO");
  const informe = analizarAuditoriaGlobal(empresaId, registros);
  if (informe.incidencias.some(i => i.operacionId === null)) return abortar("HISTORIAL_INVALIDO");
  const pendiente = informe.incidencias.find(i => i.operacionId === operacionId);
  if (!pendiente || !["SIN_RESULTADO", "INDETERMINADO"].includes(pendiente.causa))
    return abortar("NO_CONCILIABLE");
  const eventos = registros.filter(r => r.fields.OPERACION_ID === operacionId);
  const comienzos = eventos.filter(r => r.fields.RESULTADO === "INTENTO");
  const inciertos = eventos.filter(r => r.fields.RESULTADO === "INDETERMINADO");
  if (comienzos.length !== 1 || inciertos.length > 1 || eventos.length !== 1 + inciertos.length)
    return abortar("NO_CONCILIABLE");
  const f = comienzos[0].fields;
  if (typeof f.ACCION !== "string") return abortar("HISTORIAL_INVALIDO");
  if (!ACCIONES_CONCILIABLES_CORE.includes(f.ACCION as AccionConciliableCore))
    return abortar("VERIFICACION_EXTERNA");
  const accion = f.ACCION as AccionConciliableCore;
  const recursoTipo = accion === "USUARIO_EDITAR_ACCESOS" ? "USUARIO" : "SUCURSAL";
  if (f.RECURSO_TIPO !== recursoTipo || !ID.test(String(f.RECURSO_ID ?? "")) ||
      typeof f.ESTADO_ANTERIOR !== "string" || typeof f.ESTADO_NUEVO !== "string")
    return abortar("SNAPSHOT_INCONSISTENTE");
  const anterior = leerSnapshotAuditoriaCore(f.ESTADO_ANTERIOR);
  const propuesto = leerSnapshotAuditoriaCore(f.ESTADO_NUEVO);
  if (!anterior || !propuesto || !validoCambio(accion, anterior, propuesto))
    return abortar("SNAPSHOT_INCONSISTENTE");
  if (accion !== "USUARIO_EDITAR_ACCESOS" && (anterior.SUCURSAL_ID !== f.RECURSO_ID ||
      propuesto.SUCURSAL_ID !== f.RECURSO_ID)) return abortar("SNAPSHOT_INCONSISTENTE");
  for (const incierto of inciertos) {
    if (incierto.fields.ESTADO_NUEVO !== undefined && incierto.fields.ESTADO_NUEVO !== "") {
      const v = leerSnapshotAuditoriaCore(incierto.fields.ESTADO_NUEVO);
      if (!v || (!estadosIguales(v, anterior) && !estadosIguales(v, propuesto)))
        return abortar("SNAPSHOT_INCONSISTENTE");
    }
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual) ||
      !validoCambio(accion, anterior, propuesto)) return abortar("SNAPSHOT_INCONSISTENTE");
  // Nunca se acepta un estado intermedio ni cambios posteriores a la operación incierta.
  const estadoDetectado = estadosIguales(actual, propuesto) ? "APLICADO" :
    estadosIguales(actual, anterior) ? "NO_APLICADO" : null;
  if (!estadoDetectado) return abortar("ESTADO_NO_COINCIDE");
  return { empresaId, operacionId, accion, recursoId: String(f.RECURSO_ID), recursoTipo,
    estadoDetectado, huellaActual: huella(actual), anterior, propuesto, observado: actual };
}

export async function registrarResolucionCore(
  diagnostico: DiagnosticoCore, actor: ActorAuditoria, empresaNombre: string, motivo: string,
  registrar: typeof registrarEventoAuditoria = registrarEventoAuditoria,
): Promise<{ operacionId: string; registroId: string }> {
  if (!diagnostico || !ID.test(diagnostico.empresaId) || !UUID.test(diagnostico.operacionId) ||
      !ACCIONES_CONCILIABLES_CORE.includes(diagnostico.accion) ||
      actor.tipo !== "PLATAFORMA" || !ID.test(actor.usuarioId) ||
      typeof motivo !== "string" || motivo.trim().length < 10 || motivo.trim().length > 500 ||
      !/^[a-f0-9]{64}$/.test(diagnostico.huellaActual) ||
      huella(diagnostico.observado) !== diagnostico.huellaActual ||
      !validoCambio(diagnostico.accion, diagnostico.anterior, diagnostico.propuesto) ||
      !(diagnostico.estadoDetectado === "APLICADO" ?
        estadosIguales(diagnostico.observado, diagnostico.propuesto) :
        estadosIguales(diagnostico.observado, diagnostico.anterior)))
    return abortar("SNAPSHOT_INCONSISTENTE");
  const entrada: EntradaAuditoria = {
    operacionId: diagnostico.operacionId, actor, empresaId: diagnostico.empresaId,
    empresaNombre, modulo: "CORE", accion: diagnostico.accion,
    recursoTipo: diagnostico.recursoTipo, recursoId: diagnostico.recursoId,
    anterior: diagnostico.anterior, nuevo: diagnostico.observado,
    motivo: motivo.trim(), resultado: "CONCILIADO",
    detalle: diagnostico.estadoDetectado === "APLICADO" ? "CONCILIADO_APLICADO" : "CONCILIADO_NO_APLICADO",
    origen: "PANEL",
  };
  const r = await registrar(entrada);
  return { operacionId: r.operacionId, registroId: r.registroId };
}
