/**
 * Alerta de vencimientos — lógica pura (sin pantalla, sin red).
 * Para qué sirve: a partir de la lista de lotes de stock (la misma que usa la
 * pantalla Stock) decide cuáles están vencidos o por vencer, los agrupa por
 * urgencia y los ordena. Al ser pura, se puede probar sin abrir la aplicación.
 */

export type LoteVencimiento = {
  id: string;
  productoId: string;
  codigo: string;
  nombreProducto: string;
  ubicacionId: string;
  ubicacionNombre: string;
  vencimiento: string | null;
  cantidad: number;
};

export type NivelVencimiento =
  | "VENCIDO"
  | "VENCE_7"
  | "VENCE_15"
  | "VENCE_30"
  | "VENCE_60"
  | "VENCE_90";

export type ItemVencimiento = LoteVencimiento & {
  vencimiento: string;
  dias: number;
  nivel: NivelVencimiento;
};

export type GrupoVencimiento = {
  nivel: NivelVencimiento;
  titulo: string;
  items: ItemVencimiento[];
  unidades: number;
};

export const DIAS_AVISO_OPCIONES = [15, 30, 60, 90] as const;

const ORDEN_NIVELES: NivelVencimiento[] = [
  "VENCIDO",
  "VENCE_7",
  "VENCE_15",
  "VENCE_30",
  "VENCE_60",
  "VENCE_90",
];

const TITULOS: Record<NivelVencimiento, string> = {
  VENCIDO: "Vencidos (todavía figuran en stock)",
  VENCE_7: "Vencen en los próximos 7 días",
  VENCE_15: "Vencen entre 8 y 15 días",
  VENCE_30: "Vencen entre 16 y 30 días",
  VENCE_60: "Vencen entre 31 y 60 días",
  VENCE_90: "Vencen entre 61 y 90 días",
};

const LIMITE_DIAS: Record<NivelVencimiento, number> = {
  VENCIDO: -1,
  VENCE_7: 7,
  VENCE_15: 15,
  VENCE_30: 30,
  VENCE_60: 60,
  VENCE_90: 90,
};

/** Fecha de hoy (AAAA-MM-DD) en horario de Argentina, para no depender de la hora del dispositivo. */
export function hoyArgentina(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
  return partes;
}

function aDiaUtc(fecha: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const control = new Date(ms);
  // Rechaza fechas imposibles como 2026-02-31.
  if (
    control.getUTCFullYear() !== Number(m[1]) ||
    control.getUTCMonth() !== Number(m[2]) - 1 ||
    control.getUTCDate() !== Number(m[3])
  ) {
    return null;
  }
  return Math.round(ms / 86_400_000);
}

/** Días que faltan para el vencimiento (negativo = ya venció, 0 = vence hoy). Null si alguna fecha es inválida. */
export function diasHasta(hoy: string, vencimiento: string): number | null {
  const a = aDiaUtc(hoy);
  const b = aDiaUtc(vencimiento);
  if (a === null || b === null) return null;
  return b - a;
}

export function nivelPorDias(dias: number): NivelVencimiento | null {
  for (const nivel of ORDEN_NIVELES) {
    if (dias <= LIMITE_DIAS[nivel]) return nivel;
  }
  return null;
}

export type OpcionesVencimientos = {
  lotes: LoteVencimiento[];
  hoy: string;
  /** Hasta cuántos días hacia adelante mostrar (los vencidos se muestran siempre). */
  diasAviso: number;
  ubicacionId?: string;
  texto?: string;
};

export type ResultadoVencimientos = {
  grupos: GrupoVencimiento[];
  totalLotes: number;
  totalUnidades: number;
};

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function calcularVencimientos(opciones: OpcionesVencimientos): ResultadoVencimientos {
  const { lotes, hoy, diasAviso, ubicacionId, texto } = opciones;
  const buscado = sinAcentos((texto ?? "").trim());
  const porNivel = new Map<NivelVencimiento, ItemVencimiento[]>();

  for (const lote of lotes) {
    // Sin fecha o sin unidades no hay nada que vigilar.
    if (!lote.vencimiento || !(lote.cantidad > 0)) continue;
    if (ubicacionId && lote.ubicacionId !== ubicacionId) continue;
    const dias = diasHasta(hoy, lote.vencimiento);
    if (dias === null) continue;
    if (dias > diasAviso) continue;
    const nivel = nivelPorDias(dias);
    if (!nivel) continue;
    if (buscado) {
      const pajar = sinAcentos(`${lote.codigo} ${lote.nombreProducto}`);
      if (!pajar.includes(buscado)) continue;
    }
    const lista = porNivel.get(nivel) ?? [];
    lista.push({ ...lote, vencimiento: lote.vencimiento, dias, nivel });
    porNivel.set(nivel, lista);
  }

  const grupos: GrupoVencimiento[] = [];
  let totalLotes = 0;
  let totalUnidades = 0;
  for (const nivel of ORDEN_NIVELES) {
    const items = porNivel.get(nivel);
    if (!items?.length) continue;
    items.sort(
      (a, b) =>
        a.dias - b.dias ||
        a.nombreProducto.localeCompare(b.nombreProducto, "es") ||
        a.ubicacionNombre.localeCompare(b.ubicacionNombre, "es"),
    );
    const unidades = Math.round(items.reduce((t, i) => t + i.cantidad, 0) * 1000) / 1000;
    grupos.push({ nivel, titulo: TITULOS[nivel], items, unidades });
    totalLotes += items.length;
    totalUnidades += unidades;
  }
  return {
    grupos,
    totalLotes,
    totalUnidades: Math.round(totalUnidades * 1000) / 1000,
  };
}

function celdaCsv(valor: string): string {
  return `"${valor.replace(/"/g, '""')}"`;
}

/** Texto CSV para abrir en Excel (separador ";" y coma decimal, como en Argentina). */
export function vencimientosACsv(grupos: GrupoVencimiento[]): string {
  const filas = ["Estado;Código;Producto;Ubicación;Vencimiento;Días;Cantidad"];
  for (const grupo of grupos) {
    for (const i of grupo.items) {
      filas.push(
        [
          celdaCsv(grupo.titulo),
          celdaCsv(i.codigo),
          celdaCsv(i.nombreProducto),
          celdaCsv(i.ubicacionNombre),
          i.vencimiento,
          String(i.dias),
          String(i.cantidad).replace(".", ","),
        ].join(";"),
      );
    }
  }
  return "﻿" + filas.join("\r\n");
}
