/**
 * OPTIMA — Inspección global de auditoría, sólo lectura.
 * Reutiliza el historial completo existente; NO reescribe ni concilia eventos.
 * FALLA CERRADO cuando faltan finales, hay duplicados o efectos inciertos.
 */
import { analizarHistorialAuditoria, consultarHistorialAuditoriaEmpresa,
  type RegistroAuditoriaAirtable, type IncidenciaAuditoria } from "./conciliacion-modulos.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCIONES = new Set([
  "USUARIO_EDITAR_ACCESOS", "SUCURSAL_CREAR", "SUCURSAL_RENOMBRAR", "SUCURSAL_DESACTIVAR",
  "USUARIO_INVITAR", "USUARIO_ACTIVAR", "USUARIO_RESTABLECER_CLAVE",
]);
export type InformeGlobal = Readonly<{
  bloqueada: boolean;
  operacionesModulos: number;
  operacionesCore: number;
  incidencias: readonly IncidenciaAuditoria[];
}>;

type Evento = {
  eventoId: string; operacionId: string; actorId: string; accion: string;
  recursoId: string; recursoTipo: string; anterior: Record<string, unknown>;
  propuesto: Record<string, unknown> | null; resultado: string;
};
function snapshot(texto: unknown): Record<string, unknown> | null {
  if (typeof texto !== "string" || !texto || texto.length > 4000) return null;
  try {
    const v: unknown = JSON.parse(texto);
    if (!v || typeof v !== "object" || Array.isArray(v) || !Object.keys(v).length) return null;
    const permitido = new Set(["ACTIVA", "VERSION", "SUCURSALES", "SUCURSAL_PRINCIPAL", "MODULOS_HABILITADOS",
      "PERMISOS", "NOMBRE_SUCURSAL", "SUCURSAL_ID", "USUARIO_AFECTADO_ID",
      "INVITACION_ACEPTADA_POR_PROVEEDOR", "CREDENCIAL_ACTUALIZADA", "SESIONES_REVOCADAS"]);
    if (Object.keys(v).some(k => !permitido.has(k))) return null;
    return v as Record<string, unknown>;
  } catch { return null; }
}
function igualEstado(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return Object.keys(b).every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}
function inválido(): InformeGlobal {
  return { bloqueada: true, operacionesModulos: 0, operacionesCore: 0,
    incidencias: [{ operacionId: null, causa: "HISTORIAL_INVALIDO" }] };
}

/** Es seguro pasar sólo registros que provengan de una consulta completa y filtrada del servidor. */
export function analizarAuditoriaGlobal(empresaId: string, registros: readonly RegistroAuditoriaAirtable[]): InformeGlobal {
  if (!ID.test(empresaId) || !Array.isArray(registros) || registros.length > 5000) return inválido();
  const modulos = analizarHistorialAuditoria(empresaId, registros);
  const grupos = new Map<string, Evento[]>();
  const idsEventos = new Set<string>();
  const idsRegistros = new Set<string>();
  for (const r of registros) {
    if (!r || !ID.test(r.id) || !r.fields || typeof r.fields !== "object") return inválido();
    const f = r.fields;
    if (f.EMPRESA_ID !== empresaId) return inválido();
    if (typeof f.ACCION !== "string" || !ACCIONES.has(f.ACCION)) continue;
    const esperadoTipo = f.ACCION === "USUARIO_INVITAR" || f.ACCION === "SUCURSAL_CREAR" ? "EMPRESA" :
      f.ACCION.startsWith("SUCURSAL_") ? "SUCURSAL" : "USUARIO";
    if (f.RECURSO_TIPO !== esperadoTipo ||
        (esperadoTipo === "EMPRESA" && f.RECURSO_ID !== empresaId) ||
        (f.ACTOR_USUARIO_ID === "SISTEMA" && !["USUARIO_ACTIVAR", "USUARIO_RESTABLECER_CLAVE"].includes(f.ACCION)))
      return inválido();
    if (!UUID.test(String(f.ID_EVENTO ?? "")) || !UUID.test(String(f.OPERACION_ID ?? "")) ||
        !ID.test(String(f.RECURSO_ID ?? "")) ||
        !(f.ACTOR_USUARIO_ID === "SISTEMA" || ID.test(String(f.ACTOR_USUARIO_ID ?? ""))) ||
        f.MODULO !== "CORE" || f.ESQUEMA_VERSION !== "1" ||
        !["EMPRESA", "USUARIO", "SUCURSAL"].includes(String(f.RECURSO_TIPO)) ||
        !["INTENTO", "CONFIRMADO", "FALLIDO", "INDETERMINADO"].includes(String(f.RESULTADO)) ||
        idsEventos.has(String(f.ID_EVENTO)) || idsRegistros.has(r.id)) return inválido();
    const anterior = snapshot(f.ESTADO_ANTERIOR);
    const nuevo = snapshot(f.ESTADO_NUEVO);
    if (!anterior || (f.RESULTADO !== "INDETERMINADO" && !nuevo)) return inválido();
    idsEventos.add(String(f.ID_EVENTO)); idsRegistros.add(r.id);
    const evento: Evento = {
      eventoId: String(f.ID_EVENTO), operacionId: String(f.OPERACION_ID),
      actorId: String(f.ACTOR_USUARIO_ID), accion: f.ACCION,
      recursoId: String(f.RECURSO_ID), recursoTipo: String(f.RECURSO_TIPO),
      anterior, propuesto: nuevo, resultado: String(f.RESULTADO),
    };
    const grupo = grupos.get(evento.operacionId) ?? [];
    grupo.push(evento);
    grupos.set(evento.operacionId, grupo);
  }
  const incidencias: IncidenciaAuditoria[] = [...modulos.incidencias];
  for (const [op, eventos] of grupos) {
    const inicios = eventos.filter(e => e.resultado === "INTENTO");
    const finales = eventos.filter(e => e.resultado === "CONFIRMADO" || e.resultado === "FALLIDO");
    const inciertos = eventos.filter(e => e.resultado === "INDETERMINADO");
    if (inicios.length !== 1 || finales.length > 1 || inciertos.length > 1 ||
        eventos.length !== inicios.length + finales.length + inciertos.length) {
      incidencias.push({ operacionId: op, causa: "SECUENCIA_INVALIDA" });
      continue;
    }
    const inicio = inicios[0];
    const coherente = eventos.every(e => e.accion === inicio.accion && e.actorId === inicio.actorId &&
      e.recursoId === inicio.recursoId && e.recursoTipo === inicio.recursoTipo &&
      JSON.stringify(e.anterior) === JSON.stringify(inicio.anterior));
    if (!coherente || !inicio.propuesto || (finales.length && inciertos.length)) {
      incidencias.push({ operacionId: op, causa: "SECUENCIA_INVALIDA" });
    } else if (inciertos.length) {
      incidencias.push({ operacionId: op, causa: "INDETERMINADO" });
    } else if (!finales.length) {
      incidencias.push({ operacionId: op, causa: "SIN_RESULTADO" });
    } else if (!finales[0].propuesto ||
      !(finales[0].resultado === "CONFIRMADO" ?
        igualEstado(finales[0].propuesto, inicio.propuesto) :
        igualEstado(finales[0].propuesto, inicio.anterior))) {
      incidencias.push({ operacionId: op, causa: "SECUENCIA_INVALIDA" });
    }
  }
  incidencias.sort((a,b) => String(a.operacionId ?? "").localeCompare(String(b.operacionId ?? "")));
  return { bloqueada: incidencias.length > 0 || modulos.bloqueada,
    operacionesModulos: modulos.operacionesAnalizadas, operacionesCore: grupos.size, incidencias };
}

/** No publica endpoint ni se ejecuta automáticamente: lectura GET existente. */
export async function consultarAuditoriaGlobal(empresaId: string): Promise<InformeGlobal> {
  return analizarAuditoriaGlobal(empresaId, await consultarHistorialAuditoriaEmpresa(empresaId));
}
