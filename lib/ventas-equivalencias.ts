/**
 * OPTIMA - Equivalencias de venta (lógica pura).
 *
 * Para qué sirve: algunos productos se venden como "x2" de otro (por ejemplo, el maple de
 * huevos x2 son dos maples). Esta tabla dice que el código 1024 vale 2 unidades del 1023.
 * Al cargar las ventas, una venta del 1024 se convierte en el doble de unidades del 1023.
 *
 * Qué soluciona: el stock se lleva solo del producto base. Vender un maple x2 descuenta dos
 * maples, y el ritmo de venta para Compras también cuenta los dos.
 *
 * Para agregar una equivalencia, sumar una línea acá Y en el lector del navegador
 * (src/modules/movimientos/lector-ventas-archivo.ts); la prueba compara ambas tablas.
 * Cada código se convierte una sola vez (no se encadenan equivalencias).
 */

export type Equivalencia = { codigoBase: string; factor: number };

/** Código vendido → producto base y cuántas unidades base vale. */
export const EQUIVALENCIAS_VENTA: Readonly<Record<string, Equivalencia>> = {
  // Huevo blanco maple x2 = 2 × Huevo blanco maple
  "1024": { codigoBase: "1023", factor: 2 },
};

export function aplicarEquivalenciaVenta(
  codigo: string,
  cantidad: number,
): { codigo: string; cantidad: number } {
  const eq = EQUIVALENCIAS_VENTA[codigo];
  if (!eq) return { codigo, cantidad };
  return { codigo: eq.codigoBase, cantidad: Math.round(cantidad * eq.factor * 1000) / 1000 };
}
