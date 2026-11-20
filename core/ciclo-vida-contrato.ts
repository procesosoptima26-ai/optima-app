/**
 * OPTIMA Core — ciclo de vida de una empresa cliente (Tarea 5).
 *
 * Módulo PURO: no lee ni escribe en ninguna base, no usa variables de entorno
 * y no depende del reloj (la fecha se recibe como dato). Decide en qué estado
 * de acceso está una empresa a partir de TRES hechos registrados por OPTIMA:
 *   - hasta cuándo está pagado el período contratado,
 *   - desde cuándo está suspendida (la suspende OPTIMA a mano),
 *   - desde cuándo está cancelada.
 *
 * Estados:
 *   ACTIVO        todo lo contratado.
 *   GRACIA        período vencido, pero dentro de los días de gracia: todo, con aviso.
 *   SOLO_LECTURA  ver y exportar; ninguna acción que modifique datos.
 *   CERRADA       sin acceso. Los datos se conservan (nunca se borran solos).
 *
 * Si hay varios motivos a la vez gana el MÁS RESTRICTIVO. Si un dato es inválido
 * NO se adivina: el resultado es un error y quien llama debe DENEGAR.
 * Un día se cuenta como 24 horas exactas (sin ajustes de horario).
 */
import type { Permiso } from "./seguridad.js";

export type EstadoAcceso = "ACTIVO" | "GRACIA" | "SOLO_LECTURA" | "CERRADA";
export type MotivoEstado =
  | "VIGENTE"
  | "VENCIDO_EN_GRACIA"
  | "VENCIDO_SIN_RENOVAR"
  | "CERRADO_POR_VENCIMIENTO"
  | "SUSPENDIDO"
  | "CANCELADO"
  | "CERRADO_POR_CANCELACION";

export type HechosCicloVida = Readonly<{
  /** Fin del período contratado (instante ISO UTC). null = sin fecha de vencimiento. */
  periodoHasta: string | null;
  /** Desde cuándo está suspendida por OPTIMA. null = no suspendida. */
  suspendidoDesde: string | null;
  /** Desde cuándo está cancelada. null = no cancelada. */
  canceladoDesde: string | null;
}>;

export type ParametrosCicloVida = Readonly<{
  /** Días con acceso completo después de vencer sin renovar. */
  diasGracia: number;
  /** Días de solo lectura después de la gracia, si no renovó ni pagó. */
  diasSoloLecturaVencimiento: number;
  /** Días de solo lectura después de una cancelación. */
  diasSoloLecturaCancelacion: number;
}>;

export const PARAMETROS_CICLO_VIDA_POR_DEFECTO: ParametrosCicloVida = Object.freeze({
  diasGracia: 10,
  diasSoloLecturaVencimiento: 30,
  diasSoloLecturaCancelacion: 90,
});

export type EvaluacionCicloVida =
  | Readonly<{
      ok: true;
      estado: EstadoAcceso;
      motivo: MotivoEstado;
      /** Instante ISO en que el estado cambiará por el solo paso del tiempo; null si no cambia solo. */
      cambiaEn: string | null;
    }>
  | Readonly<{ ok: false; motivo: "DATOS_INVALIDOS" }>;

const MS_DIA = 24 * 60 * 60 * 1000;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const SEVERIDAD: Readonly<Record<EstadoAcceso, number>> = {
  ACTIVO: 0, GRACIA: 1, SOLO_LECTURA: 2, CERRADA: 3,
};

function instante(valor: unknown): number | null {
  if (typeof valor !== "string" || !ISO.test(valor)) return null;
  const n = Date.parse(valor);
  return Number.isFinite(n) ? n : null;
}
function diasValidos(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 3650;
}
const iso = (ms: number): string => new Date(ms).toISOString();

type Candidato = Readonly<{ estado: EstadoAcceso; motivo: MotivoEstado; cambiaEn: number | null }>;

/** Evalúa el estado de acceso de una empresa en el instante `ahoraIso`. */
export function evaluarCicloVida(
  hechos: HechosCicloVida,
  ahoraIso: string,
  parametros: ParametrosCicloVida = PARAMETROS_CICLO_VIDA_POR_DEFECTO,
): EvaluacionCicloVida {
  const ahora = instante(ahoraIso);
  if (ahora === null || !hechos || typeof hechos !== "object" || !parametros ||
      !diasValidos(parametros.diasGracia) ||
      !diasValidos(parametros.diasSoloLecturaVencimiento) ||
      !diasValidos(parametros.diasSoloLecturaCancelacion)) {
    return { ok: false, motivo: "DATOS_INVALIDOS" };
  }
  const campos = [hechos.periodoHasta, hechos.suspendidoDesde, hechos.canceladoDesde];
  if (campos.some((c) => c !== null && instante(c) === null)) {
    return { ok: false, motivo: "DATOS_INVALIDOS" };
  }
  const hasta = hechos.periodoHasta === null ? null : instante(hechos.periodoHasta);
  const suspendido = hechos.suspendidoDesde === null ? null : instante(hechos.suspendidoDesde);
  const cancelado = hechos.canceladoDesde === null ? null : instante(hechos.canceladoDesde);

  // Orden = prioridad para informar el motivo cuando dos tienen la misma severidad:
  // primero las decisiones manuales de OPTIMA, después el paso del tiempo.
  const candidatos: Candidato[] = [];

  if (cancelado !== null && ahora >= cancelado) {
    const finLecturaCancelacion = cancelado + parametros.diasSoloLecturaCancelacion * MS_DIA;
    candidatos.push(ahora <= finLecturaCancelacion
      ? { estado: "SOLO_LECTURA", motivo: "CANCELADO", cambiaEn: finLecturaCancelacion + 1 }
      : { estado: "CERRADA", motivo: "CERRADO_POR_CANCELACION", cambiaEn: null });
  }
  // Una suspensión con fecha futura todavía no rige.
  if (suspendido !== null && ahora >= suspendido) {
    candidatos.push({ estado: "SOLO_LECTURA", motivo: "SUSPENDIDO", cambiaEn: null });
  }
  if (hasta === null) {
    candidatos.push({ estado: "ACTIVO", motivo: "VIGENTE", cambiaEn: null });
  } else {
    const finGracia = hasta + parametros.diasGracia * MS_DIA;
    const finLectura = finGracia + parametros.diasSoloLecturaVencimiento * MS_DIA;
    if (ahora <= hasta) {
      candidatos.push({ estado: "ACTIVO", motivo: "VIGENTE", cambiaEn: hasta + 1 });
    } else if (ahora <= finGracia) {
      candidatos.push({ estado: "GRACIA", motivo: "VENCIDO_EN_GRACIA", cambiaEn: finGracia + 1 });
    } else if (ahora <= finLectura) {
      candidatos.push({ estado: "SOLO_LECTURA", motivo: "VENCIDO_SIN_RENOVAR", cambiaEn: finLectura + 1 });
    } else {
      candidatos.push({ estado: "CERRADA", motivo: "CERRADO_POR_VENCIMIENTO", cambiaEn: null });
    }
  }

  // Gana el MÁS restrictivo (a igualdad, el primero de la lista).
  let ganador = candidatos[0];
  for (const c of candidatos) if (SEVERIDAD[c.estado] > SEVERIDAD[ganador.estado]) ganador = c;
  // El estado cambiará solo cuando se cumpla el primer plazo entre los motivos
  // de igual severidad (todos avanzan hacia estados más restrictivos, nunca al revés).
  const proximos = candidatos
    .filter((c) => c.estado === ganador.estado && c.cambiaEn !== null)
    .map((c) => c.cambiaEn as number);
  const cambiaEn = proximos.length === 0 ? null : iso(Math.min(...proximos));
  return { ok: true, estado: ganador.estado, motivo: ganador.motivo, cambiaEn };
}

/**
 * Clasificación de TODAS las acciones del Core. Si se agrega un permiso nuevo,
 * TypeScript obliga a clasificarlo aquí (nunca queda sin decidir).
 */
export const NATURALEZA_DEL_PERMISO: Readonly<Record<Permiso, "LECTURA" | "ESCRITURA">> = {
  "inventario.ver": "LECTURA",
  "inventario.crear": "ESCRITURA",
  "inventario.editarGuardado": "ESCRITURA",
  "movimientos.ver": "LECTURA",
  "movimientos.crear": "ESCRITURA",
  "movimientos.ajustar": "ESCRITURA",
  "movimientos.revisarAjustes": "ESCRITURA",
  "movimientos.editarGuardado": "ESCRITURA",
  "administracion.ver": "LECTURA",
  "administracion.gestionarTerceros": "ESCRITURA",
  "administracion.gestionarDocumentos": "ESCRITURA",
  "administracion.gestionarPagos": "ESCRITURA",
  "administracion.gestionarCheques": "ESCRITURA",
  "administracion.gestionarBancos": "ESCRITURA",
  "administracion.configurar": "ESCRITURA",
  "facturacion.ver": "LECTURA",
  "facturacion.crear": "ESCRITURA",
  "reportes.ver": "LECTURA",
  "reportes.exportar": "LECTURA",
  "ajustes.ver": "LECTURA",
  "ajustes.configurar": "ESCRITURA",
  "usuarios.ver": "LECTURA",
  "usuarios.gestionar": "ESCRITURA",
  "sucursales.gestionar": "ESCRITURA",
};

/** ¿Puede ejecutarse este permiso en el estado dado? Cualquier valor desconocido se DENIEGA. */
export function estadoPermiteAccion(estado: EstadoAcceso, permiso: Permiso): boolean {
  const naturaleza = NATURALEZA_DEL_PERMISO[permiso];
  if (naturaleza !== "LECTURA" && naturaleza !== "ESCRITURA") return false;
  switch (estado) {
    case "ACTIVO":
    case "GRACIA":
      return true;
    case "SOLO_LECTURA":
      return naturaleza === "LECTURA";
    default:
      return false;
  }
}
