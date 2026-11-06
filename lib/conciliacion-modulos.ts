/**
 * OPTIMA 12B.4.1 — detección conservadora de incidentes de auditoría.
 * Sólo consultas GET; no expone API, no cambia empresas ni cierra incidencias.
 * Cualquier error de lectura o integridad se trata como BLOQUEANTE por el llamador.
 */

const ID = /^rec[A-Za-z0-9]{14}$/;
const BASE = /^app[A-Za-z0-9]{14}$/;
const TABLA = /^tbl[A-Za-z0-9]{14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ESTADOS = new Set(["INTENTO", "CONFIRMADO", "FALLIDO", "INDETERMINADO", "CONCILIADO", "RECHAZADO"]);
const FINALES = new Set(["CONFIRMADO", "FALLIDO"]);
const MAX_PAGINAS = 50;
const MAX_EVENTOS = 5000;
const CAMPOS = ["ID_EVENTO", "OPERACION_ID", "EMPRESA_ID", "ACTOR_USUARIO_ID", "MODULO", "ACCION",
  "RECURSO_TIPO", "RECURSO_ID", "RESULTADO", "ESTADO_ANTERIOR", "ESTADO_NUEVO", "DETALLE", "ESQUEMA_VERSION"] as const;

export type RegistroAuditoriaAirtable = Readonly<{ id: string; fields: Record<string, unknown> }>;
type RegistroAirtable = RegistroAuditoriaAirtable;
type Causa = "SIN_RESULTADO" | "INDETERMINADO" | "SECUENCIA_INVALIDA" | "HISTORIAL_INVALIDO";
export type IncidenciaAuditoria = Readonly<{ operacionId: string | null; causa: Causa }>;
export type EstadoIncidencias = Readonly<{
  bloqueada: boolean;
  operacionesAnalizadas: number;
  incidencias: readonly IncidenciaAuditoria[];
}>;

export class ErrorConsultaAuditoria extends Error {
  constructor(public readonly codigo: "CONFIG_INVALIDA" | "LECTURA_FALLIDA" | "PAGINACION_INVALIDA") {
    super(`Auditoría no comprobable: ${codigo}`);
    this.name = "ErrorConsultaAuditoria";
  }
}

type Evento = Readonly<{
  eventoId: string;
  operacionId: string;
  empresaId: string;
  actorId: string;
  modulo: string;
  accion: string;
  recursoId: string;
  resultado: string;
  anterior: string;
  nuevo: string;
  detalle: string;
}>;

function snapshotTecnicoValido(texto: string, obligatorio: boolean): boolean {
  if (!texto) return !obligatorio;
  try {
    const valor: unknown = JSON.parse(texto);
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
    const campos = valor as Record<string, unknown>;
    if (Object.keys(campos).some(k => !["MODULOS_CONTRATADOS", "ACTIVA", "VERSION"].includes(k))) return false;
    return Array.isArray(campos.MODULOS_CONTRATADOS) && campos.MODULOS_CONTRATADOS.length >= 1 &&
      campos.MODULOS_CONTRATADOS.length <= 30 &&
      campos.MODULOS_CONTRATADOS.every((x: unknown) => typeof x === "string" && x.length >= 2 && x.length <= 80) &&
      campos.ACTIVA === true && typeof campos.VERSION === "string" && /^[a-f0-9]{64}$/.test(campos.VERSION);
  } catch { return false; }
}

function extraerEvento(registro: RegistroAirtable, empresaId: string): Evento | "OTRA_ACCION" | null {
  if (!registro || typeof registro !== "object" || !ID.test(registro.id) ||
      !registro.fields || typeof registro.fields !== "object" || Array.isArray(registro.fields)) return null;
  const f = registro.fields;
  if (f.EMPRESA_ID !== empresaId || typeof f.ACCION !== "string") return null;
  if (!f.ACCION.startsWith("MODULO_")) return "OTRA_ACCION";
  if (!UUID.test(String(f.ID_EVENTO ?? "")) || !UUID.test(String(f.OPERACION_ID ?? "")) ||
      !ID.test(String(f.RECURSO_ID ?? "")) || f.RECURSO_ID !== empresaId ||
      (typeof f.ACTOR_USUARIO_ID !== "string" || !ID.test(f.ACTOR_USUARIO_ID)) ||
      f.RECURSO_TIPO !== "EMPRESA" || f.ESQUEMA_VERSION !== "1" ||
      (typeof f.MODULO !== "string" || !/^[A-Z][A-Z0-9_]{1,79}$/.test(f.MODULO)) ||
      (typeof f.ACCION !== "string" || !/^MODULO_(HABILITAR|SUSPENDER|REACTIVAR)$/.test(f.ACCION)) ||
      !ESTADOS.has(String(f.RESULTADO)) ||
      typeof f.ESTADO_ANTERIOR !== "string") return null;
  // Airtable omite campos de texto vacío al listar; INDETERMINADO puede no tener snapshot final.
  const nuevo = f.ESTADO_NUEVO === undefined && f.RESULTADO === "INDETERMINADO" ? "" : f.ESTADO_NUEVO;
  if (typeof nuevo !== "string") return null;
  if (!snapshotTecnicoValido(f.ESTADO_ANTERIOR, true) ||
      !snapshotTecnicoValido(nuevo, ["INTENTO", "CONFIRMADO", "FALLIDO"].includes(String(f.RESULTADO))))
    return null;
  return {
    eventoId: f.ID_EVENTO as string, operacionId: f.OPERACION_ID as string,
    empresaId, actorId: f.ACTOR_USUARIO_ID as string, modulo: f.MODULO as string,
    accion: f.ACCION as string, recursoId: f.RECURSO_ID as string,
    resultado: f.RESULTADO as string, anterior: f.ESTADO_ANTERIOR, nuevo,
    detalle: typeof f.DETALLE === "string" ? f.DETALLE : "",
  };
}

/**
 * Puro y estricto: sólo acepta como cerrado INTENTO+un CONFIRMADO/FALLIDO consistente.
 * CONCILIADO se conserva como incidente hasta definir el protocolo de verificación del 12B.4.3.
 * 0 filas se interpreta como 0 incidencias únicamente sobre un historial COMPLETO y verificado.
 */
export function analizarHistorialAuditoria(empresaId: string, registros: readonly RegistroAirtable[]): EstadoIncidencias {
  const invalido = (): EstadoIncidencias => ({ bloqueada: true, operacionesAnalizadas: 0,
    incidencias: [{ operacionId: null, causa: "HISTORIAL_INVALIDO" }] });
  if (!ID.test(empresaId) || !Array.isArray(registros) || registros.length > MAX_EVENTOS) return invalido();
  const grupos = new Map<string, Evento[]>();
  const ids = new Set<string>();
  const registrosIds = new Set<string>();
  for (const registro of registros) {
    const e = extraerEvento(registro, empresaId);
    if (!e) return invalido();
    if (e === "OTRA_ACCION") continue;
    if (ids.has(e.eventoId) || registrosIds.has(registro.id)) return invalido();
    ids.add(e.eventoId); registrosIds.add(registro.id);
    const grupo = grupos.get(e.operacionId) ?? [];
    grupo.push(e);
    grupos.set(e.operacionId, grupo);
  }
  const incidencias: IncidenciaAuditoria[] = [];
  for (const [operacionId, eventos] of grupos) {
    const inicios = eventos.filter(e => e.resultado === "INTENTO");
    const finales = eventos.filter(e => FINALES.has(e.resultado));
    const cierres = eventos.filter(e => e.resultado === "CONCILIADO");
    const indeterminados = eventos.filter(e => e.resultado === "INDETERMINADO");
    const base = inicios[0] ?? eventos[0];
    // Un conciliador distinto puede actuar, pero NO puede cambiar la identidad
    // ni la descripción de la operación original.
    const consistente = eventos.every(e => e.empresaId === base.empresaId &&
      e.modulo === base.modulo && e.accion === base.accion &&
      e.recursoId === base.recursoId && e.anterior === base.anterior &&
      (e.resultado === "CONCILIADO" || e.actorId === base.actorId));
    if (!consistente || inicios.length !== 1 || finales.length > 1 || cierres.length > 1 ||
        eventos.some(e => e.resultado === "RECHAZADO") || indeterminados.length > 1) {
      incidencias.push({ operacionId, causa: "SECUENCIA_INVALIDA" });
    } else if (cierres.length === 1) {
      const cierre = cierres[0], inicio = inicios[0];
      const aplicado = cierre.detalle === "CONCILIADO_APLICADO" && cierre.nuevo === inicio.nuevo;
      const noAplicado = cierre.detalle === "CONCILIADO_NO_APLICADO" && cierre.nuevo === inicio.anterior;
      // Solo INTENTO + [INDETERMINADO] + CONCILIADO, sin finales adicionales.
      if (finales.length || eventos.length !== 2 + indeterminados.length ||
          indeterminados.some(e => e.nuevo && e.nuevo !== inicio.anterior && e.nuevo !== inicio.nuevo) ||
          !snapshotTecnicoValido(cierre.nuevo, true) || !(aplicado || noAplicado)) {
        incidencias.push({ operacionId, causa: "SECUENCIA_INVALIDA" });
      }
    } else if (indeterminados.length) {
      incidencias.push({ operacionId, causa: "INDETERMINADO" });
    } else if (finales.length === 0) {
      incidencias.push({ operacionId, causa: "SIN_RESULTADO" });
    } else if (eventos.length !== 2 ||
               (finales[0].resultado === "CONFIRMADO" && finales[0].nuevo !== inicios[0].nuevo) ||
               (finales[0].resultado === "FALLIDO" && finales[0].nuevo !== inicios[0].anterior)) {
      incidencias.push({ operacionId, causa: "SECUENCIA_INVALIDA" });
    }
  }
  incidencias.sort((a, b) => (a.operacionId ?? "").localeCompare(b.operacionId ?? ""));
  return { bloqueada: incidencias.length > 0, operacionesAnalizadas: grupos.size, incidencias };
}

/**
 * Sólo lectura del historial completo por empresa; falla cerrado ante páginas incompletas.
 * NO es una barrera activa de la API de cambios hasta el paso 12B.4.2.
 */
export async function consultarHistorialAuditoriaEmpresa(empresaId: string): Promise<readonly RegistroAuditoriaAirtable[]> {
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
  const tabla = process.env.AIRTABLE_AUDITORIA_TABLE_ID?.trim() ?? "";
  const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
  if (!ID.test(empresaId) || !BASE.test(base) || !TABLA.test(tabla) || !token)
    throw new ErrorConsultaAuditoria("CONFIG_INVALIDA");
  const registros: RegistroAirtable[] = [];
  const offsets = new Set<string>();
  let offset: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const url = new URL(`https://api.airtable.com/v0/${base}/${tabla}`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("filterByFormula", `{EMPRESA_ID}="${empresaId}"`);
    for (const campo of CAMPOS) url.searchParams.append("fields[]", campo);
    if (offset) url.searchParams.set("offset", offset);
    let datos: unknown;
    try {
      const respuesta = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000) });
      if (!respuesta.ok) throw new Error("Auditoría inaccesible");
      datos = await respuesta.json();
    } catch { throw new ErrorConsultaAuditoria("LECTURA_FALLIDA"); }
    if (!datos || typeof datos !== "object" || !('records' in datos) || !Array.isArray(datos.records) ||
        datos.records.length > 100) throw new ErrorConsultaAuditoria("PAGINACION_INVALIDA");
    registros.push(...datos.records as RegistroAirtable[]);
    if (registros.length > MAX_EVENTOS) throw new ErrorConsultaAuditoria("PAGINACION_INVALIDA");
    const siguiente = 'offset' in datos ? datos.offset : undefined;
    if (siguiente === undefined) return registros;
    if (typeof siguiente !== "string" || !siguiente || siguiente.length > 512 || offsets.has(siguiente))
      throw new ErrorConsultaAuditoria("PAGINACION_INVALIDA");
    offsets.add(siguiente);
    offset = siguiente;
  }
  throw new ErrorConsultaAuditoria("PAGINACION_INVALIDA");
}

/** Consulta completa compartida: cualquier historial incompleto se considera error. */
export async function consultarIncidenciasAuditoria(empresaId: string): Promise<EstadoIncidencias> {
  return analizarHistorialAuditoria(empresaId, await consultarHistorialAuditoriaEmpresa(empresaId));
}
