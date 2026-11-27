/**
 * OPTIMA - Lector de archivos de ventas (Excel .xlsx y CSV).
 *
 * Para qué sirve: leer el archivo que baja el sistema de ventas (por ejemplo
 * Fenovo) con las columnas Código, Producto y Cantidad, y convertirlo en una
 * lista ordenada y validada. NO guarda nada ni habla con Airtable: solo lee
 * y suma. El servidor vuelve a validar todo antes de cargar cualquier venta.
 *
 * Qué soluciona: no hace falta instalar librerías de Excel; el .xlsx se lee
 * con funciones del propio navegador (descomprime el ZIP y lee el XML).
 */

export type LineaVenta = {
  fila: number;
  codigo: string;
  producto: string;
  cantidad: number;
};

export type ErrorLinea = {
  fila: number;
  motivo: string;
};

export type LecturaVentas = {
  lineas: LineaVenta[];
  errores: ErrorLinea[];
};

export type VentaAgrupada = {
  codigo: string;
  producto: string;
  cantidad: number;
  lineas: number;
};

export const MAX_BYTES_ARCHIVO = 2 * 1024 * 1024;
export const MAX_FILAS_ARCHIVO = 5000;

/* ------------------------------------------------------------------ */
/* Utilidades de texto y números                                       */
/* ------------------------------------------------------------------ */

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizarEncabezado(texto: string): string {
  return sinTildes(texto).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Deja solo dígitos y quita ceros a la izquierda (igual que el servidor). */
export function normalizarCodigoVenta(valor: string): string {
  const limpio = valor.trim().replace(/\s+/g, "");
  if (!/^\d+$/.test(limpio)) return "";
  return limpio.replace(/^0+(?=\d)/, "");
}

export function convertirCantidad(valor: string): number | null {
  let texto = valor.trim().replace(/\s+/g, "");
  if (!texto) return null;
  const tieneComa = texto.includes(",");
  const tienePunto = texto.includes(".");
  if (tieneComa && tienePunto) {
    // 1.234,56 -> 1234.56 (el último separador es el decimal)
    if (texto.lastIndexOf(",") > texto.lastIndexOf(".")) {
      texto = texto.replace(/\./g, "").replace(",", ".");
    } else {
      texto = texto.replace(/,/g, "");
    }
  } else if (tieneComa) {
    texto = texto.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(texto)) return null;
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 1000) / 1000;
}

function decodificarXml(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");
}

/* ------------------------------------------------------------------ */
/* ZIP mínimo (lo que necesita un .xlsx)                               */
/* ------------------------------------------------------------------ */

type EntradaZip = {
  nombre: string;
  metodo: number;
  tamanoComprimido: number;
  desplazamiento: number;
};

function leerEntradasZip(datos: Uint8Array): Map<string, EntradaZip> {
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  let fin = -1;
  const minimo = Math.max(0, datos.length - 65557);
  for (let i = datos.length - 22; i >= minimo; i--) {
    if (vista.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("El archivo no es un Excel (.xlsx) válido.");

  const cantidad = vista.getUint16(fin + 10, true);
  let posicion = vista.getUint32(fin + 16, true);
  const entradas = new Map<string, EntradaZip>();
  const decodificador = new TextDecoder("utf-8");

  for (let n = 0; n < cantidad; n++) {
    if (posicion + 46 > datos.length ||
        vista.getUint32(posicion, true) !== 0x02014b50) {
      throw new Error("El archivo Excel está dañado.");
    }
    const metodo = vista.getUint16(posicion + 10, true);
    const tamanoComprimido = vista.getUint32(posicion + 20, true);
    const largoNombre = vista.getUint16(posicion + 28, true);
    const largoExtra = vista.getUint16(posicion + 30, true);
    const largoComentario = vista.getUint16(posicion + 32, true);
    const desplazamiento = vista.getUint32(posicion + 42, true);
    const nombre = decodificador.decode(
      datos.subarray(posicion + 46, posicion + 46 + largoNombre),
    );
    entradas.set(nombre, { nombre, metodo, tamanoComprimido, desplazamiento });
    posicion += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

async function extraerEntrada(
  datos: Uint8Array,
  entrada: EntradaZip,
): Promise<Uint8Array> {
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const base = entrada.desplazamiento;
  if (base + 30 > datos.length || vista.getUint32(base, true) !== 0x04034b50) {
    throw new Error("El archivo Excel está dañado.");
  }
  const largoNombre = vista.getUint16(base + 26, true);
  const largoExtra = vista.getUint16(base + 28, true);
  const inicio = base + 30 + largoNombre + largoExtra;
  const comprimido = datos.subarray(inicio, inicio + entrada.tamanoComprimido);

  if (entrada.metodo === 0) return comprimido;
  if (entrada.metodo !== 8) {
    throw new Error("El archivo Excel usa una compresión no soportada.");
  }
  const flujo = new Blob([comprimido as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(flujo).arrayBuffer();
  return new Uint8Array(buffer);
}

async function textoDeEntrada(
  datos: Uint8Array,
  entradas: Map<string, EntradaZip>,
  nombre: string,
): Promise<string | null> {
  const entrada = entradas.get(nombre);
  if (!entrada) return null;
  const bytes = await extraerEntrada(datos, entrada);
  return new TextDecoder("utf-8").decode(bytes);
}

/* ------------------------------------------------------------------ */
/* Lectura de la hoja de cálculo                                       */
/* ------------------------------------------------------------------ */

function leerTextosCompartidos(xml: string | null): string[] {
  if (!xml) return [];
  const textos: string[] = [];
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    let texto = "";
    for (const t of item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
      texto += decodificarXml(t[1]);
    }
    textos.push(texto);
  }
  return textos;
}

function columnaDeReferencia(referencia: string): number {
  const letras = referencia.replace(/[^A-Za-z]/g, "").toUpperCase();
  let numero = 0;
  for (const letra of letras) numero = numero * 26 + (letra.charCodeAt(0) - 64);
  return numero - 1;
}

async function rutaPrimeraHoja(
  datos: Uint8Array,
  entradas: Map<string, EntradaZip>,
): Promise<string> {
  const libro = await textoDeEntrada(datos, entradas, "xl/workbook.xml");
  const relaciones = await textoDeEntrada(
    datos, entradas, "xl/_rels/workbook.xml.rels",
  );
  if (libro && relaciones) {
    const hoja = libro.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
    if (hoja) {
      for (const rel of relaciones.matchAll(/<Relationship\b[^>]*>/g)) {
        const id = rel[0].match(/\bId="([^"]+)"/);
        const destino = rel[0].match(/\bTarget="([^"]+)"/);
        if (id && destino && id[1] === hoja[1]) {
          const t = destino[1].replace(/^\//, "");
          return t.startsWith("xl/") ? t : "xl/" + t;
        }
      }
    }
  }
  return "xl/worksheets/sheet1.xml";
}

async function leerFilasXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const datos = new Uint8Array(buffer);
  const entradas = leerEntradasZip(datos);
  const textos = leerTextosCompartidos(
    await textoDeEntrada(datos, entradas, "xl/sharedStrings.xml"),
  );
  const ruta = await rutaPrimeraHoja(datos, entradas);
  const xml = await textoDeEntrada(datos, entradas, ruta);
  if (!xml) throw new Error("No se encontró la hoja de datos en el Excel.");

  const filas: string[][] = [];
  for (const fila of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas: string[] = [];
    for (const celda of fila[1].matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const atributos = celda[1];
      const contenido = celda[2] ?? "";
      const ref = atributos.match(/\br="([A-Za-z]+\d+)"/);
      const tipo = atributos.match(/\bt="([^"]+)"/);
      const indice = ref ? columnaDeReferencia(ref[1]) : celdas.length;
      let valor = "";
      if (tipo && tipo[1] === "inlineStr") {
        for (const t of contenido.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
          valor += decodificarXml(t[1]);
        }
      } else {
        const v = contenido.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        if (v) {
          const crudo = decodificarXml(v[1]);
          valor = tipo && tipo[1] === "s" ? (textos[Number(crudo)] ?? "") : crudo;
        }
      }
      while (celdas.length < indice) celdas.push("");
      celdas[indice] = valor;
    }
    filas.push(celdas);
    if (filas.length > MAX_FILAS_ARCHIVO + 1) {
      throw new Error(`El archivo tiene más de ${MAX_FILAS_ARCHIVO} filas.`);
    }
  }
  return filas;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function leerFilasCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, "");
  const primeraLinea = limpio.split(/\r?\n/, 1)[0] ?? "";
  const candidatos = [";", ",", "\t"];
  let separador = ",";
  let mejor = -1;
  for (const c of candidatos) {
    const cuenta = primeraLinea.split(c).length - 1;
    if (cuenta > mejor) {
      mejor = cuenta;
      separador = c;
    }
  }

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
      if (filas.length > MAX_FILAS_ARCHIVO + 1) {
        throw new Error(`El archivo tiene más de ${MAX_FILAS_ARCHIVO} filas.`);
      }
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

/* ------------------------------------------------------------------ */
/* Interpretación de columnas                                          */
/* ------------------------------------------------------------------ */

const NOMBRES_CODIGO = ["codigo", "cod", "codigocb", "codigodebarras", "codbarras", "ean", "sku"];
const NOMBRES_PRODUCTO = ["producto", "descripcion", "nombre", "articulo", "detalle"];
const NOMBRES_CANTIDAD = ["cantidad", "cant", "unidades", "qty"];

function buscarColumna(encabezados: string[], nombres: string[]): number {
  return encabezados.findIndex((e) => nombres.includes(normalizarEncabezado(e)));
}

export function interpretarFilas(filas: string[][]): LecturaVentas {
  const lineas: LineaVenta[] = [];
  const errores: ErrorLinea[] = [];

  const indiceEncabezado = filas.findIndex((f) => f.some((c) => c.trim() !== ""));
  if (indiceEncabezado < 0) {
    throw new Error("El archivo está vacío.");
  }
  const encabezados = filas[indiceEncabezado];
  const colCodigo = buscarColumna(encabezados, NOMBRES_CODIGO);
  const colProducto = buscarColumna(encabezados, NOMBRES_PRODUCTO);
  const colCantidad = buscarColumna(encabezados, NOMBRES_CANTIDAD);
  if (colCodigo < 0 || colCantidad < 0) {
    throw new Error(
      "No encontré las columnas 'Código' y 'Cantidad' en la primera fila del archivo.",
    );
  }

  for (let i = indiceEncabezado + 1; i < filas.length; i++) {
    const fila = filas[i];
    if (fila.every((c) => (c ?? "").trim() === "")) continue;
    const numeroFila = i + 1;
    const codigoCrudo = (fila[colCodigo] ?? "").trim();
    const cantidadCruda = (fila[colCantidad] ?? "").trim();
    const producto = colProducto >= 0 ? (fila[colProducto] ?? "").trim() : "";

    const codigo = normalizarCodigoVenta(codigoCrudo);
    if (!codigo) {
      errores.push({
        fila: numeroFila,
        motivo: codigoCrudo ? `Código inválido: "${codigoCrudo}"` : "Falta el código",
      });
      continue;
    }
    const cantidad = convertirCantidad(cantidadCruda);
    if (cantidad === null) {
      errores.push({
        fila: numeroFila,
        motivo: `Cantidad inválida: "${cantidadCruda}"`,
      });
      continue;
    }
    if (cantidad <= 0) {
      errores.push({
        fila: numeroFila,
        motivo: `La cantidad debe ser mayor que cero (${cantidad})`,
      });
      continue;
    }
    lineas.push({ fila: numeroFila, codigo, producto, cantidad });
  }
  return { lineas, errores };
}

/** Lee un archivo de ventas (.xlsx o .csv) y devuelve líneas válidas y errores. */
export async function leerArchivoVentas(
  contenido: ArrayBuffer,
  nombreArchivo: string,
): Promise<LecturaVentas> {
  if (contenido.byteLength === 0) throw new Error("El archivo está vacío.");
  if (contenido.byteLength > MAX_BYTES_ARCHIVO) {
    throw new Error("El archivo es demasiado grande (máximo 2 MB).");
  }
  const nombre = nombreArchivo.toLowerCase();
  let filas: string[][];
  if (nombre.endsWith(".xlsx")) {
    filas = await leerFilasXlsx(contenido);
  } else if (nombre.endsWith(".csv") || nombre.endsWith(".txt")) {
    filas = leerFilasCsv(new TextDecoder("utf-8").decode(contenido));
  } else {
    throw new Error("Formato no soportado. Usá un archivo .xlsx o .csv.");
  }
  return interpretarFilas(filas);
}

/** Suma las líneas por código de producto (un producto = una sola venta). */
export function agruparVentas(lineas: readonly LineaVenta[]): VentaAgrupada[] {
  const mapa = new Map<string, VentaAgrupada>();
  for (const linea of lineas) {
    const existente = mapa.get(linea.codigo);
    if (existente) {
      existente.cantidad = Math.round((existente.cantidad + linea.cantidad) * 1000) / 1000;
      existente.lineas += 1;
      if (!existente.producto && linea.producto) existente.producto = linea.producto;
    } else {
      mapa.set(linea.codigo, {
        codigo: linea.codigo,
        producto: linea.producto,
        cantidad: linea.cantidad,
        lineas: 1,
      });
    }
  }
  return [...mapa.values()];
}
