/**
 * OPTIMA Core — avisos de vencimiento a empresas clientes (Tarea 5, avisos).
 *
 * Módulo PURO: no lee bases, no envía correos, no usa variables de entorno ni reloj
 * (la fecha se recibe como dato). Decide QUÉ aviso corresponde a una empresa hoy y
 * redacta el texto. Quién lo envía y cómo evitar duplicados lo resuelve otro módulo.
 *
 * Avisos (uno por tipo y por período contratado):
 *   VENCE_15 / VENCE_7 / VENCE_1  faltan 15, 7 o 1 día (o menos) para el fin del período.
 *   EN_GRACIA                     el período venció y rige la gracia (acceso completo, con aviso).
 *   SOLO_LECTURA                  la gracia terminó: la empresa solo puede ver y exportar.
 *
 * No se avisa automáticamente cuando OPTIMA suspendió o canceló a mano, ni cuando la
 * empresa ya está cerrada: esos casos los gestiona una persona de OPTIMA.
 * Si se omitió algún día (p. ej. la tarea diaria no corrió), se envía solo el aviso
 * que corresponde HOY, nunca los atrasados.
 */
import {
  evaluarCicloVida, PARAMETROS_CICLO_VIDA_POR_DEFECTO,
  type HechosCicloVida, type ParametrosCicloVida,
} from "./ciclo-vida-contrato.js";

export const TIPOS_AVISO = ["VENCE_15", "VENCE_7", "VENCE_1", "EN_GRACIA", "SOLO_LECTURA"] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

export type AvisoVencimiento = Readonly<{
  tipo: TipoAviso;
  /** Fin del período contratado (ISO UTC); identifica el período para no repetir avisos. */
  periodoHasta: string;
  /** Días que faltan para la fecha límite que menciona el aviso (redondeado hacia arriba, mínimo 0). */
  diasRestantes: number;
  /** Fecha límite que menciona el aviso (ISO UTC). */
  fechaLimite: string;
}>;

export type ResultadoAviso =
  | Readonly<{ ok: true; aviso: AvisoVencimiento | null }>
  | Readonly<{ ok: false; motivo: "DATOS_INVALIDOS" }>;

const MS_DIA = 24 * 60 * 60 * 1000;
const dias = (ms: number): number => Math.max(0, Math.ceil(ms / MS_DIA));

export function calcularAviso(
  hechos: HechosCicloVida,
  ahoraIso: string,
  parametros: ParametrosCicloVida = PARAMETROS_CICLO_VIDA_POR_DEFECTO,
): ResultadoAviso {
  const ev = evaluarCicloVida(hechos, ahoraIso, parametros);
  if (!ev.ok) return { ok: false, motivo: "DATOS_INVALIDOS" };
  if (hechos.periodoHasta === null) return { ok: true, aviso: null };
  const ahora = Date.parse(ahoraIso);
  const hasta = Date.parse(hechos.periodoHasta);
  const finGracia = hasta + parametros.diasGracia * MS_DIA;
  const finLectura = finGracia + parametros.diasSoloLecturaVencimiento * MS_DIA;

  if (ev.motivo === "VIGENTE") {
    const faltan = dias(hasta - ahora);
    const tipo: TipoAviso | null = faltan <= 1 ? "VENCE_1" : faltan <= 7 ? "VENCE_7" :
      faltan <= 15 ? "VENCE_15" : null;
    return { ok: true, aviso: tipo === null ? null :
      Object.freeze({ tipo, periodoHasta: hechos.periodoHasta, diasRestantes: faltan,
        fechaLimite: hechos.periodoHasta }) };
  }
  if (ev.motivo === "VENCIDO_EN_GRACIA") {
    return { ok: true, aviso: Object.freeze({ tipo: "EN_GRACIA", periodoHasta: hechos.periodoHasta,
      diasRestantes: dias(finGracia - ahora), fechaLimite: new Date(finGracia).toISOString() }) };
  }
  if (ev.motivo === "VENCIDO_SIN_RENOVAR") {
    return { ok: true, aviso: Object.freeze({ tipo: "SOLO_LECTURA", periodoHasta: hechos.periodoHasta,
      diasRestantes: dias(finLectura - ahora), fechaLimite: new Date(finLectura).toISOString() }) };
  }
  return { ok: true, aviso: null };
}

const ID_EMPRESA = /^emp_[a-z0-9]{12}$/;
/** Clave anti-duplicados: un aviso de cada tipo por empresa y por período, por ambiente. */
export function claveAviso(ambiente: string, empresaId: string, aviso: AvisoVencimiento): string {
  if (!/^[a-z]{3,12}$/.test(ambiente) || !ID_EMPRESA.test(empresaId) || !TIPOS_AVISO.includes(aviso.tipo)) {
    throw new Error("Clave de aviso inválida");
  }
  return `optima:aviso:${ambiente}:${empresaId}:${aviso.periodoHasta}:${aviso.tipo}`;
}

function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

/** Texto del correo. No incluye datos sensibles ni enlaces; solo nombre de empresa y fechas. */
export function redactarAviso(aviso: AvisoVencimiento, nombreEmpresa: string): { asunto: string; texto: string } {
  const nombre = nombreEmpresa.replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "tu empresa";
  const limite = fechaLarga(aviso.fechaLimite);
  const cierre = "\n\nPara renovar o consultar tu plan, comunicate con OPTIMA.\n\nEquipo OPTIMA";
  switch (aviso.tipo) {
    case "VENCE_15":
    case "VENCE_7":
    case "VENCE_1": {
      const cuando = aviso.tipo === "VENCE_1" ? "en las próximas 24 horas" : `en ${aviso.diasRestantes} días`;
      return { asunto: `OPTIMA: el período de ${nombre} vence ${cuando}`,
        texto: `Hola. El período contratado de ${nombre} en OPTIMA vence el ${limite}.\n` +
          "Si no se renueva, tendrás unos días de gracia con acceso completo y luego solo podrás consultar y exportar tu información." + cierre };
    }
    case "EN_GRACIA":
      return { asunto: `OPTIMA: el período de ${nombre} venció (días de gracia)`,
        texto: `Hola. El período contratado de ${nombre} en OPTIMA venció. Seguís teniendo acceso completo hasta el ${limite}.\n` +
          "Después de esa fecha solo podrás consultar y exportar tu información; no podrás cargar ni modificar datos." + cierre };
    case "SOLO_LECTURA":
      return { asunto: `OPTIMA: ${nombre} está en modo solo lectura`,
        texto: `Hola. Terminó la gracia del período de ${nombre} en OPTIMA. Por ahora solo podés consultar y exportar tu información; no podés cargar ni modificar datos.\n` +
          `Si no se renueva, el acceso se cerrará el ${limite}. Tus datos se conservan.` + cierre };
  }
}
