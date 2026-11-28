/**
 * OPTIMA - Stock vendible según vencimientos (lógica pura).
 *
 * Para qué sirve: de todo el stock de un producto, calcula cuánto se puede vender de verdad
 * antes de que venza. Los lotes se venden en orden de vencimiento (primero el que vence antes).
 * Lo que ya está vencido, o lo que no alcanza a venderse al ritmo actual antes de su fecha,
 * NO cuenta como stock disponible para comprar.
 *
 * Qué soluciona: hoy el stock vencido que sigue cargado se cuenta como mercadería disponible,
 * y Compras pide menos de lo que corresponde. Además avisa qué se va a vencer para poder
 * moverlo, rematarlo o darlo de baja a tiempo.
 *
 * Reglas:
 * - Lote sin fecha de vencimiento: no vence (cuenta entero).
 * - Lote vencido (fecha anterior a hoy): no cuenta; se informa como "vencido".
 * - Lote que vence en más de 90 días: cuenta entero (todavía no es accionable).
 * - Lote que vence dentro de 90 días: cuenta solo lo que se alcanza a vender antes de su fecha,
 *   descontando lo que se venderá de los lotes que vencen antes. El resto es "por vencer".
 */

export type LoteStock = {
  cantidad: number;
  /** Fecha de vencimiento AAAA-MM-DD; null si no tiene. */
  vencimiento: string | null;
};

export type AnalisisVencimiento = {
  /** Stock que se puede vender antes de que venza (lo que cuenta para comprar). */
  stockVendible: number;
  /** Unidades ya vencidas que todavía figuran en stock. */
  vencidas: number;
  /** Unidades que no se alcanzan a vender antes de vencer (al ritmo actual). */
  porVencer: number;
  /** Fecha del vencimiento más próximo entre lo vencido o en riesgo; null si no hay. */
  primerVencimiento: string | null;
};

/** Más allá de estos días el vencimiento todavía no es accionable. */
export const HORIZONTE_VENCIMIENTO_DIAS = 90;

const MS_DIA = 86_400_000;

function aDia(fecha: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) throw new Error(`Fecha inválida: ${fecha}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_DIA;
}

function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * @param lotes lotes del producto en la sucursal (solo con cantidad > 0)
 * @param hoy fecha de hoy AAAA-MM-DD
 * @param ventaDiaria ritmo de venta esperado (unidades por día)
 */
export function analizarVencimientos(
  lotes: readonly LoteStock[],
  hoy: string,
  ventaDiaria: number,
): AnalisisVencimiento {
  const dHoy = aDia(hoy);
  const ritmo = Number.isFinite(ventaDiaria) && ventaDiaria > 0 ? ventaDiaria : 0;

  const validos = lotes.filter((l) => Number.isFinite(l.cantidad) && l.cantidad > 0);
  const conFecha = validos
    .filter((l) => l.vencimiento)
    .map((l) => ({ cantidad: l.cantidad, vencimiento: l.vencimiento as string, dia: aDia(l.vencimiento as string) }))
    .sort((a, b) => a.dia - b.dia);
  const sinFecha = validos.filter((l) => !l.vencimiento).reduce((s, l) => s + l.cantidad, 0);

  let vendible = sinFecha;
  let vencidas = 0;
  let porVencer = 0;
  let primero: string | null = null;
  // Lo que se va a vender de los lotes que vencen antes (los lotes se venden en ese orden).
  let vendidoDeLotesAnteriores = 0;

  for (const lote of conFecha) {
    const dias = lote.dia - dHoy;
    if (dias < 0) {
      vencidas += lote.cantidad;
      if (primero === null || lote.vencimiento < primero) primero = lote.vencimiento;
      continue;
    }
    if (dias > HORIZONTE_VENCIMIENTO_DIAS) {
      vendible += lote.cantidad;
      continue;
    }
    // Hasta su fecha se venden ritmo × días unidades en total; lo anterior ya se llevó una parte.
    const disponibleParaEste = Math.max(0, ritmo * dias - vendidoDeLotesAnteriores);
    const vendibleDeEste = Math.min(lote.cantidad, disponibleParaEste);
    vendible += vendibleDeEste;
    vendidoDeLotesAnteriores += vendibleDeEste;
    const riesgo = lote.cantidad - vendibleDeEste;
    if (riesgo > 0.0005) {
      porVencer += riesgo;
      if (primero === null || lote.vencimiento < primero) primero = lote.vencimiento;
    }
  }

  return {
    stockVendible: redondear(vendible),
    vencidas: redondear(vencidas),
    porVencer: redondear(porVencer),
    primerVencimiento: primero,
  };
}
