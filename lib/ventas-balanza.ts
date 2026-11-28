/**
 * OPTIMA - Códigos de balanza (lógica pura).
 *
 * Para qué sirve: los productos que se pesan en la balanza (quesos, fiambres, carnes,
 * panificados) no se venden con el código del producto sino con una etiqueta de 16
 * dígitos que empieza con "24". Los dígitos 3 a 7 de esa etiqueta son el CÓDIGO
 * interno del producto en OPTIMA; el resto (precio y peso) no identifica al producto.
 * Ejemplo real: 2401002000222750 → dígitos 3 a 7 = "01002" → producto 1002.
 *
 * Qué soluciona: sin esta conversión, las ventas por balanza (cerca del 3% de las
 * unidades en Goya) no se reconocían y no descontaban stock.
 *
 * Regla verificada con las ventas reales de Goya y Bella Vista: en los últimos 4 meses
 * el producto que resulta coincide con el nombre de la venta en el 98% de los casos.
 *
 * IMPORTANTE: la misma regla existe en el lector del navegador
 * (src/modules/movimientos/lector-ventas-archivo.ts). Si se cambia una, se cambia la otra;
 * las pruebas de ambos lados usan los mismos ejemplos.
 */

/** Convierte una etiqueta de balanza en el código interno; cualquier otro código queda igual. */
export function codigoDeBalanza(codigo: string): string {
  if (!/^24\d{14}$/.test(codigo)) return codigo;
  const interno = codigo.slice(2, 7).replace(/^0+(?=\d)/, "");
  // "00000" no es un producto: se deja el código original para que se marque como no reconocido.
  return interno === "0" ? codigo : interno;
}
