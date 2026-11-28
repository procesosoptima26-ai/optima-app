/**
 * Opciones de Producto / Marca / Presentación / Especificación al crear un producto.
 *
 * Para qué sirve: que "1KG", "1Kg" y "1kg" (o "Clasico" y "Clásico") se traten como UNA sola
 * opción, así el catálogo no se llena de repetidos. Son funciones puras (sin Airtable): el
 * servidor las usa para armar las listas y para corregir lo que llega, y están probadas aparte.
 */

export type CampoOpcion = "producto" | "marca" | "presentacion" | "especificacion";

/** Espacios de más fuera: recorta y deja un solo espacio entre palabras. */
export function limpiarOpcion(texto: unknown): string {
  return typeof texto === "string" ? texto.replace(/\s+/g, " ").trim() : "";
}

/** Clave para comparar: sin mayúsculas, sin tildes y sin espacios, puntos ni guiones. */
export function claveOpcion(texto: unknown): string {
  return limpiarOpcion(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s.\-_]/g, "");
}

function conTilde(texto: string): boolean {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "") !== texto;
}

/**
 * Junta todos los valores del catálogo en una lista sin repetidos (según claveOpcion).
 * De cada grupo se queda con el más usado; si empatan, el que tiene tildes; si sigue el empate,
 * el primero por orden alfabético. Devuelve la lista ordenada alfabéticamente.
 */
export function agruparOpciones(valores: readonly string[]): string[] {
  const grupos = new Map<string, Map<string, number>>();
  for (const bruto of valores) {
    const valor = limpiarOpcion(bruto);
    const clave = claveOpcion(valor);
    if (!clave) continue;
    const grupo = grupos.get(clave) ?? new Map<string, number>();
    grupo.set(valor, (grupo.get(valor) ?? 0) + 1);
    grupos.set(clave, grupo);
  }
  const salida: string[] = [];
  for (const grupo of grupos.values()) {
    const elegido = [...grupo.entries()].sort((a, b) =>
      b[1] - a[1] || Number(conTilde(b[0])) - Number(conTilde(a[0])) || a[0].localeCompare(b[0], "es"),
    )[0][0];
    salida.push(elegido);
  }
  return salida.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

/** Si ya existe una opción equivalente, devuelve ESA (con su forma oficial); si no, null. */
export function opcionExistente(valor: string, opciones: readonly string[]): string | null {
  const clave = claveOpcion(valor);
  if (!clave) return null;
  return opciones.find((o) => claveOpcion(o) === clave) ?? null;
}

/**
 * Forma prolija para una opción NUEVA: sin espacios de más. Producto, Marca y Especificación llevan
 * cada palabra con la primera letra en mayúscula; Presentación va en minúscula ("1kg", "x2").
 */
export function formatearOpcionNueva(campo: CampoOpcion, texto: unknown): string {
  const limpio = limpiarOpcion(texto);
  if (!limpio) return "";
  const minuscula = limpio.toLowerCase();
  if (campo === "presentacion") return minuscula;
  return minuscula.replace(/(^|\s)(\p{L})/gu, (_, espacio: string, letra: string) => espacio + letra.toUpperCase());
}

/**
 * Deja el valor como corresponde: si ya existe una opción equivalente usa esa; si no, lo
 * formatea como opción nueva. `esNueva` avisa que se está agregando una opción que no existía.
 */
export function resolverOpcion(
  campo: CampoOpcion, valor: unknown, opciones: readonly string[],
): { valor: string; esNueva: boolean } {
  const limpio = limpiarOpcion(valor);
  if (!limpio) return { valor: "", esNueva: false };
  const existente = opcionExistente(limpio, opciones);
  if (existente) return { valor: existente, esNueva: false };
  return { valor: formatearOpcionNueva(campo, limpio), esNueva: true };
}

/** Nombre que arma Airtable (NOMBRE MASTER): Producto + Marca + Especificación + Presentación. */
export function nombreMaster(partes: {
  producto: string; marca?: string; especificacion?: readonly string[]; presentacion?: string;
}): string {
  return [partes.producto, partes.marca, ...(partes.especificacion ?? []), partes.presentacion]
    .map((p) => limpiarOpcion(p))
    .filter(Boolean)
    .join(" ");
}

/** Cant. pack válida: entero positivo de hasta 4 cifras ("" = no se carga). Devuelve null si es inválida. */
export function normalizarCantPack(valor: unknown): string | null {
  const texto = typeof valor === "number" ? String(valor) : limpiarOpcion(valor);
  if (!texto) return "";
  if (!/^\d{1,4}$/.test(texto)) return null;
  const n = Number(texto);
  return n > 0 ? String(n) : null;
}
