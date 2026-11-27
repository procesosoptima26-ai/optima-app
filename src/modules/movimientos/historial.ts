/**
 * Historial de movimientos: filtros y exportación (lógica pura, sin red).
 * Para qué sirve: encontrar rápido "qué pasó con este producto" o "qué se
 * cargó esta semana" y bajarlo a Excel, sin entrar a Airtable.
 */

export type MovimientoHistorial = {
  id: string;
  fechaHora: string;
  nombreProducto: string;
  tipoMovimiento: string;
  motivo: string;
  ubicacionOrigenNombre?: string;
  ubicacionDestinoNombre?: string;
  vencimiento: string | null;
  cantidad: number;
  responsable: string;
  observacion: string;
  procesado: boolean;
  errorMotor: string;
};

export type EstadoMovimiento = "OK" | "ERROR" | "PENDIENTE";

export type FiltrosHistorial = {
  /** Fecha AAAA-MM-DD (hora argentina), inclusive. */
  desde?: string;
  hasta?: string;
  tipo?: string;
  motivo?: string;
  estado?: EstadoMovimiento | "";
  texto?: string;
};

export function estadoDeMovimiento(m: Pick<MovimientoHistorial, "procesado" | "errorMotor">): EstadoMovimiento {
  if (m.procesado) return "OK";
  return m.errorMotor ? "ERROR" : "PENDIENTE";
}

/** Fecha AAAA-MM-DD en hora de Argentina de un instante ISO ("" si no se entiende). */
export function fechaArgentina(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
  return partes;
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filtrarHistorial(
  movimientos: readonly MovimientoHistorial[],
  filtros: FiltrosHistorial,
): MovimientoHistorial[] {
  const buscado = sinTildes((filtros.texto ?? "").trim());
  return movimientos.filter((m) => {
    const dia = fechaArgentina(m.fechaHora);
    if (filtros.desde && (!dia || dia < filtros.desde)) return false;
    if (filtros.hasta && (!dia || dia > filtros.hasta)) return false;
    if (filtros.tipo && m.tipoMovimiento !== filtros.tipo) return false;
    if (filtros.motivo && m.motivo !== filtros.motivo) return false;
    if (filtros.estado && estadoDeMovimiento(m) !== filtros.estado) return false;
    if (buscado) {
      const pajar = sinTildes(
        [m.nombreProducto, m.observacion, m.responsable, m.ubicacionOrigenNombre, m.ubicacionDestinoNombre]
          .filter(Boolean)
          .join(" "),
      );
      if (!pajar.includes(buscado)) return false;
    }
    return true;
  });
}

export function valoresDistintos(
  movimientos: readonly MovimientoHistorial[],
  campo: "tipoMovimiento" | "motivo",
): string[] {
  return [...new Set(movimientos.map((m) => m[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}

function celdaCsv(valor: string): string {
  // Evita que Excel interprete como fórmula un texto que empieza con = + - @
  const seguro = /^[=+\-@]/.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/** CSV para Excel en Argentina: separador ";" y coma decimal. */
export function historialACsv(movimientos: readonly MovimientoHistorial[]): string {
  const filas = [
    "Fecha;Producto;Tipo;Motivo;Origen;Destino;Vencimiento;Cantidad;Responsable;Observación;Estado;Error",
  ];
  for (const m of movimientos) {
    filas.push(
      [
        fechaArgentina(m.fechaHora),
        celdaCsv(m.nombreProducto),
        celdaCsv(m.tipoMovimiento),
        celdaCsv(m.motivo),
        celdaCsv(m.ubicacionOrigenNombre ?? ""),
        celdaCsv(m.ubicacionDestinoNombre ?? ""),
        m.vencimiento ?? "",
        String(m.cantidad).replace(".", ","),
        celdaCsv(m.responsable),
        celdaCsv(m.observacion),
        estadoDeMovimiento(m),
        celdaCsv(m.errorMotor),
      ].join(";"),
    );
  }
  return "﻿" + filas.join("\r\n");
}
