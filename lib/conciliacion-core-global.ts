/**
 * OPTIMA — inspección global append-only, nunca modifica entidades de negocio.
 * Un cierre de incidente del Core sólo se admite para ACCESOS, RENOMBRE o BAJA
 * de sucursal y cuando se originó por el protocolo seguro de conciliación.
 * Invitaciones, altas de sucursal y credenciales requieren revisión especializada.
 */
import { analizarHistorialAuditoria, consultarHistorialAuditoriaEmpresa,
  type RegistroAuditoriaAirtable, type IncidenciaAuditoria } from "./conciliacion-modulos.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const ACCIONES = new Set([
  "USUARIO_EDITAR_ACCESOS", "SUCURSAL_CREAR", "SUCURSAL_RENOMBRAR", "SUCURSAL_DESACTIVAR",
  "USUARIO_INVITAR", "USUARIO_ACTIVAR", "USUARIO_RESTABLECER_CLAVE",
]);
export const ACCIONES_CONCILIABLES_CORE = ["USUARIO_EDITAR_ACCESOS", "SUCURSAL_RENOMBRAR", "SUCURSAL_DESACTIVAR"] as const;
export type AccionConciliableCore = typeof ACCIONES_CONCILIABLES_CORE[number];
export type SnapshotAuditoriaCore = Readonly<Record<string, unknown>>;
export type InformeGlobal = Readonly<{
  bloqueada: boolean;
  operacionesModulos: number;
  operacionesCore: number;
  incidencias: readonly IncidenciaAuditoria[];
}>;

type Evento = {
  eventoId: string; operacionId: string; actorId: string; actorTipo: string;
  accion: string; recursoId: string; recursoTipo: string;
  anterior: SnapshotAuditoriaCore; propuesto: SnapshotAuditoriaCore | null;
  resultado: string; detalle: string;
};

/** Parser cerrado: sólo estados que AUDITORIA_EVENTOS permite escribir. */
export function leerSnapshotAuditoriaCore(valor: unknown): SnapshotAuditoriaCore | null {
  if (typeof valor !== "string" || !valor || valor.length > 4000) return null;
  try {
    const v: unknown = JSON.parse(valor);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const campos = v as Record<string, unknown>;
    const claves = Object.keys(campos);
    if (!claves.length) return null;
    const permitidas = new Set(["ACTIVA", "VERSION", "SUCURSALES", "SUCURSAL_PRINCIPAL",
      "MODULOS_HABILITADOS", "PERMISOS", "NOMBRE_SUCURSAL", "SUCURSAL_ID", "USUARIO_AFECTADO_ID",
      "INVITACION_ACEPTADA_POR_PROVEEDOR", "CREDENCIAL_ACTUALIZADA", "SESIONES_REVOCADAS"]);
    if (claves.some(k => !permitidas.has(k))) return null;
    for (const [k, valorCampo] of Object.entries(campos)) {
      if (["ACTIVA", "INVITACION_ACEPTADA_POR_PROVEEDOR", "CREDENCIAL_ACTUALIZADA", "SESIONES_REVOCADAS"].includes(k)) {
        if (typeof valorCampo !== "boolean") return null;
      } else if (k === "VERSION") {
        if (typeof valorCampo !== "string" || !HEX.test(valorCampo)) return null;
      } else if (["SUCURSAL_ID", "SUCURSAL_PRINCIPAL", "USUARIO_AFECTADO_ID"].includes(k)) {
        if (typeof valorCampo !== "string" || !ID.test(valorCampo)) return null;
      } else if (k === "NOMBRE_SUCURSAL") {
        if (typeof valorCampo !== "string" || !valorCampo.trim() || valorCampo.length > 80) return null;
      } else if (k === "SUCURSALES" || k === "MODULOS_HABILITADOS" || k === "PERMISOS") {
        const max = k === "SUCURSALES" ? 100 : k === "PERMISOS" ? 60 : 30;
        if (!Array.isArray(valorCampo) || valorCampo.length > max ||
            !valorCampo.every(x => typeof x === "string" && x.length <= 80 && x.length > 0 &&
              (k !== "SUCURSALES" || ID.test(x))) ||
            new Set(valorCampo).size !== valorCampo.length) return null;
      }
    }
    return campos;
  } catch { return null; }
}

export function estadosIguales(a: SnapshotAuditoriaCore, b: SnapshotAuditoriaCore): boolean {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] &&
    JSON.stringify(a[k]) === JSON.stringify(b[k]));
}
function contieneEstado(a: SnapshotAuditoriaCore, b: SnapshotAuditoriaCore): boolean {
  return Object.keys(b).every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}
function inválido(): InformeGlobal {
  return { bloqueada: true, operacionesModulos: 0, operacionesCore: 0,
    incidencias: [{ operacionId: null, causa: "HISTORIAL_INVALIDO" }] };
}

/** Sólo acepta registros que provienen de consulta GET completa y filtrada en servidor. */
export function analizarAuditoriaGlobal(empresaId: string, registros: readonly RegistroAuditoriaAirtable[]): InformeGlobal {
  if (!ID.test(empresaId) || !Array.isArray(registros) || registros.length > 5000) return inválido();
  const modulos = analizarHistorialAuditoria(empresaId, registros);
  const grupos = new Map<string, Evento[]>();
  const idsEventos = new Set<string>();
  const idsRegistros = new Set<string>();
  const modulosOps = new Set(registros.filter(r => r?.fields?.EMPRESA_ID === empresaId &&
    typeof r.fields.ACCION === "string" && r.fields.ACCION.startsWith("MODULO_")).map(r => r.fields.OPERACION_ID));
  for (const r of registros) {
    if (!r || !ID.test(r.id) || !r.fields || typeof r.fields !== "object" || Array.isArray(r.fields)) return inválido();
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
        modulosOps.has(f.OPERACION_ID) || !ID.test(String(f.RECURSO_ID ?? "")) ||
        !(f.ACTOR_USUARIO_ID === "SISTEMA" || ID.test(String(f.ACTOR_USUARIO_ID ?? ""))) ||
        f.MODULO !== "CORE" || f.ESQUEMA_VERSION !== "1" ||
        !["EMPRESA", "USUARIO", "SUCURSAL"].includes(String(f.RECURSO_TIPO)) ||
        !["INTENTO", "CONFIRMADO", "FALLIDO", "INDETERMINADO", "CONCILIADO"].includes(String(f.RESULTADO)) ||
        idsEventos.has(String(f.ID_EVENTO)) || idsRegistros.has(r.id)) return inválido();
    const anterior = leerSnapshotAuditoriaCore(f.ESTADO_ANTERIOR);
    // Airtable omite campos vacíos de texto. INDETERMINADO puede carecer de snapshot.
    const propuesto = f.ESTADO_NUEVO === undefined || f.ESTADO_NUEVO === "" ? null :
      leerSnapshotAuditoriaCore(f.ESTADO_NUEVO);
    if (!anterior || (f.RESULTADO !== "INDETERMINADO" && !propuesto) ||
        (f.ESTADO_NUEVO !== undefined && f.ESTADO_NUEVO !== "" && !propuesto)) return inválido();
    idsEventos.add(String(f.ID_EVENTO)); idsRegistros.add(r.id);
    const evento: Evento = {
      eventoId: String(f.ID_EVENTO), operacionId: String(f.OPERACION_ID),
      actorId: String(f.ACTOR_USUARIO_ID), actorTipo: String(f.ACTOR_TIPO ?? ""),
      accion: f.ACCION, recursoId: String(f.RECURSO_ID), recursoTipo: String(f.RECURSO_TIPO),
      anterior, propuesto, resultado: String(f.RESULTADO), detalle: String(f.DETALLE ?? ""),
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
    const cierres = eventos.filter(e => e.resultado === "CONCILIADO");
    if (inicios.length !== 1 || finales.length > 1 || inciertos.length > 1 || cierres.length > 1 ||
        eventos.length !== inicios.length + finales.length + inciertos.length + cierres.length) {
      incidencias.push({ operacionId: op, causa: "SECUENCIA_INVALIDA" });
      continue;
    }
    const inicio = inicios[0];
    const coherente = eventos.every(e => e.accion === inicio.accion && e.recursoId === inicio.recursoId &&
      e.recursoTipo === inicio.recursoTipo && estadosIguales(e.anterior, inicio.anterior) &&
      (e.resultado === "CONCILIADO" || e.actorId === inicio.actorId));
    if (!coherente || !inicio.propuesto || (finales.length && (inciertos.length || cierres.length))) {
      incidencias.push({ operacionId: op, causa: "SECUENCIA_INVALIDA" });
    } else if (cierres.length) {
      const cierre = cierres[0];
      const permitido = ACCIONES_CONCILIABLES_CORE.includes(inicio.accion as AccionConciliableCore);
      const aplicado = cierre.detalle === "CONCILIADO_APLICADO" && cierre.propuesto !== null &&
        estadosIguales(cierre.propuesto, inicio.propuesto);
      const noAplicado = cierre.detalle === "CONCILIADO_NO_APLICADO" && cierre.propuesto !== null &&
        estadosIguales(cierre.propuesto, inicio.anterior);
      const inciertosValidos = inciertos.every(e => !e.propuesto ||
        estadosIguales(e.propuesto, inicio.anterior) || contieneEstado(e.propuesto, inicio.propuesto!));
      if (!permitido || finales.length || !inciertosValidos ||
          cierre.actorTipo !== "PLATAFORMA" || cierre.actorId === "SISTEMA" ||
          !ID.test(cierre.actorId) || !(aplicado || noAplicado))
        incidencias.push({ operacionId: op, causa: "SECUENCIA_INVALIDA" });
    } else if (inciertos.length) {
      incidencias.push({ operacionId: op, causa: "INDETERMINADO" });
    } else if (!finales.length) {
      incidencias.push({ operacionId: op, causa: "SIN_RESULTADO" });
    } else if (!finales[0].propuesto ||
      !(finales[0].resultado === "CONFIRMADO" ?
        contieneEstado(finales[0].propuesto, inicio.propuesto) :
        contieneEstado(finales[0].propuesto, inicio.anterior))) {
      incidencias.push({ operacionId: op, causa: "SECUENCIA_INVALIDA" });
    }
  }
  incidencias.sort((a,b) => String(a.operacionId ?? "").localeCompare(String(b.operacionId ?? "")));
  return { bloqueada: incidencias.length > 0 || modulos.bloqueada,
    operacionesModulos: modulos.operacionesAnalizadas, operacionesCore: grupos.size, incidencias };
}

/** No publica endpoint ni se ejecuta automáticamente: GET existente. */
export async function consultarAuditoriaGlobal(empresaId: string): Promise<InformeGlobal> {
  return analizarAuditoriaGlobal(empresaId, await consultarHistorialAuditoriaEmpresa(empresaId));
}
