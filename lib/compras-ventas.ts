/**
 * OPTIMA - Compras sugeridas: juntar las ventas de los últimos días (lógica sin red propia).
 *
 * Para qué sirve: arma la ventana de ventas día por día, usando un caché por día
 * para no volver a pedirle a Airtable lo que ya sabemos, y corta a tiempo si
 * se agota el presupuesto (la función de Vercel dura 60 s).
 *
 * Qué soluciona: leer 60 días de ventas de una sola vez es demasiado lento y
 * choca con el límite de pedidos de Airtable. Así la primera vez se completa
 * en unas pocas tandas (la pantalla muestra "preparando...") y después es inmediato.
 */
import type { VentasDelDia } from "./compras-datos.js";

export type DependenciasVentas = {
  /** Lee de Airtable un día completo. */
  leerDia: (dia: string) => Promise<VentasDelDia>;
  /** Devuelve los días que ya están guardados. */
  leerCache: (dias: readonly string[]) => Promise<Map<string, VentasDelDia>>;
  guardarCache: (dia: string, datos: VentasDelDia) => Promise<void>;
  ahoraMs: () => number;
};

export type OpcionesVentas = {
  /** Instante (ms) a partir del cual no se empiezan días nuevos. */
  limiteMs: number;
  concurrencia?: number;
  /** Tras esta cantidad de errores seguidos se deja de insistir. */
  maxErrores?: number;
};

export type VentanaDeVentas = {
  porDia: Map<string, VentasDelDia>;
  pendientes: string[];
  errores: number;
};

/**
 * `hoy` nunca se guarda en el caché porque todavía está incompleto.
 * Los días anteriores sí: un movimiento queda fechado cuando se crea, así que
 * un día cerrado no cambia.
 */
export async function juntarVentasDeVentana(
  dias: readonly string[],
  hoy: string,
  dep: DependenciasVentas,
  opciones: OpcionesVentas,
): Promise<VentanaDeVentas> {
  const porDia = new Map<string, VentasDelDia>();
  const cacheables = dias.filter((d) => d < hoy);
  const enCache = cacheables.length > 0 ? await dep.leerCache(cacheables) : new Map<string, VentasDelDia>();
  for (const [d, v] of enCache) porDia.set(d, v);

  // Primero el día de hoy y los más recientes (los que más pesan en la decisión).
  const faltantes = [...dias].filter((d) => !porDia.has(d)).sort().reverse();
  let errores = 0;
  const maxErrores = opciones.maxErrores ?? 3;
  const concurrencia = Math.max(1, opciones.concurrencia ?? 2);

  async function trabajador(): Promise<void> {
    while (faltantes.length > 0 && errores < maxErrores && dep.ahoraMs() < opciones.limiteMs) {
      const dia = faltantes.shift();
      if (!dia) return;
      try {
        const datos = await dep.leerDia(dia);
        porDia.set(dia, datos);
        if (dia < hoy) await dep.guardarCache(dia, datos);
      } catch {
        errores += 1;
        faltantes.push(dia);
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrencia }, () => trabajador()));

  return { porDia, pendientes: dias.filter((d) => !porDia.has(d)), errores };
}
