/**
 * OPTIMA - Compras sugeridas: reglas de grupo, cobertura y temporada (lógica pura).
 *
 * Para qué sirve: define a qué GRUPO pertenece cada producto (helados, bebidas,
 * lácteos...), cuántos días de mercadería conviene tener de cada grupo y cuánto
 * cambia la venta según el mes (por ejemplo, helados y gaseosas suben en verano).
 *
 * Qué soluciona: hoy el campo CATEGORÍA de Airtable está vacío, así que el grupo se
 * deduce del nombre del producto. Cuando Antonella cargue CATEGORÍA, esa categoría
 * tiene prioridad (si coincide con un grupo de esta lista). Todos los números de este
 * archivo son PUNTOS DE PARTIDA razonables, no verdades: se ajustan acá, en un solo lugar.
 */

export type GrupoCompra =
  | "HELADOS"
  | "BEBIDAS"
  | "CERVEZAS_Y_VINOS"
  | "NAVIDENOS"
  | "LACTEOS_Y_FIAMBRES"
  | "CARNES"
  | "CONGELADOS"
  | "GOLOSINAS"
  | "SNACKS"
  | "ALMACEN"
  | "LIMPIEZA_Y_PERFUMERIA"
  | "GENERAL";

export const NOMBRE_GRUPO: Readonly<Record<GrupoCompra, string>> = {
  HELADOS: "Helados y postres helados",
  BEBIDAS: "Bebidas sin alcohol",
  CERVEZAS_Y_VINOS: "Cervezas, vinos y espirituosas",
  NAVIDENOS: "Navideños (pan dulce, sidra, frutos secos)",
  LACTEOS_Y_FIAMBRES: "Lácteos y fiambres",
  CARNES: "Carnes y elaborados",
  CONGELADOS: "Congelados",
  GOLOSINAS: "Golosinas y chocolates",
  SNACKS: "Snacks",
  ALMACEN: "Almacén",
  LIMPIEZA_Y_PERFUMERIA: "Limpieza y perfumería",
  GENERAL: "General",
};

/** Días de mercadería que conviene tener, por grupo. Lo perecedero se compra más seguido. */
export const COBERTURA_POR_GRUPO: Readonly<Record<GrupoCompra, number>> = {
  HELADOS: 10,
  BEBIDAS: 14,
  CERVEZAS_Y_VINOS: 14,
  NAVIDENOS: 15,
  LACTEOS_Y_FIAMBRES: 10,
  CARNES: 10,
  CONGELADOS: 15,
  GOLOSINAS: 21,
  SNACKS: 14,
  ALMACEN: 21,
  LIMPIEZA_Y_PERFUMERIA: 21,
  GENERAL: 15,
};

/**
 * Índice estacional por mes (enero = posición 0). Solo importa la proporción entre
 * meses: 1 es un mes "normal", 1,5 es un 50% más de venta. Hemisferio sur.
 */
export const INDICE_ESTACIONAL: Readonly<Record<GrupoCompra, readonly number[]>> = {
  //            ene  feb  mar  abr  may  jun  jul  ago  sep  oct  nov  dic
  HELADOS:              [1.5, 1.4, 1.2, 0.9, 0.7, 0.5, 0.5, 0.6, 0.8, 1.0, 1.3, 1.5],
  BEBIDAS:              [1.4, 1.3, 1.1, 0.9, 0.8, 0.7, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4],
  CERVEZAS_Y_VINOS:     [1.2, 1.1, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.2, 1.5],
  NAVIDENOS:            [0.4, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.5, 1.0, 2.0, 4.0],
  LACTEOS_Y_FIAMBRES:   [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1],
  CARNES:               [1.1, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.2, 1.4],
  CONGELADOS:           [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1],
  GOLOSINAS:            [0.8, 0.8, 1.2, 1.3, 1.2, 1.2, 1.1, 1.1, 1.0, 1.0, 1.0, 1.1],
  SNACKS:               [1.1, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.1, 1.3],
  ALMACEN:              [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1],
  LIMPIEZA_Y_PERFUMERIA:[1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  GENERAL:              [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
};

/** Tope del ajuste por temporada: nunca se multiplica ni se reduce más que esto de golpe. */
export const FACTOR_MINIMO = 0.5;
export const FACTOR_MAXIMO = 2.5;

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Palabras que identifican cada grupo. El ORDEN importa: gana el primero que coincide
 * (por ejemplo "torta helada" es helado antes que "torta" cualquier otra cosa).
 */
const REGLAS_POR_PALABRA: ReadonlyArray<readonly [GrupoCompra, RegExp]> = [
  ["HELADOS", /\b(helado|helados|torta helada|palito helado|cassata|postre helado|crocante helado)\b/],
  ["NAVIDENOS", /\b(pan dulce|panettone|budin|turron|garrapinada|mantecol|frutas secas|nueces|almendras|castanas|pasas|ciruelas|confitad|sidra|champagne|champan|espumante|vitel tone|guirnalda)\b/],
  ["CERVEZAS_Y_VINOS", /\b(cerveza|birra|vino|fernet|gin|whisky|whiskey|vodka|aperol|campari|licor|ron|tequila|aperitivo|malbec|cabernet|brahma|quilmes|heineken|stella|amstel|sativa)\b/],
  ["BEBIDAS", /\b(gaseosa|agua|aquarius|jugo|cepita|coca|sprite|fanta|pepsi|7 up|seven up|soda|saborizada|levite|powerade|gatorade|speed|energizante|monster|tonica|ades|bebida|amargo|terma)\b/],
  // Almacén "fuerte": palabras que mandan aunque el nombre diga chocolate, carne, pizza...
  ["ALMACEN", /\b(galletita|galletitas|fideo|fideos|arroz|harina|aceite|yerba|azucar|mermelada|premezcla|gelatina|caldo|sopa|cereal|cereales|mate cocido|conserva|tomate|tomates|semola|tostadas|alicante|en lata)\b/],
  ["SNACKS", /\b(papas fritas|papas lays|lays|pringles|doritos|cheetos|chizitos|chizito|twistos|tostaditas|takis|grisines|snack|pehuamar|ondulad|rufles|conitos 3d|saladix|nachos|pochoclo|palomitas)\b/],
  ["GOLOSINAS", /\b(chocolate|bombon|bocaditos|bocadito|tofi|merengues|merengue|cubanitos|caramelo|caramelos|alfajor|alfajores|chicle|golosina|gomitas|chupetin|mogul|milka|cadbury|bon o bon|rocklets|oblea|obleas|huevo de pascua|barra de cereal|barrita|marroc|chocolatin|cofler|felfort|confite)\b/],
  ["CONGELADOS", /\b(congelad|papas mccain|mccain|tiempo verde|pizza|prepizza|empanada|empanadas|tarta|vianda|lasagna|ravioles|tallarines frioteka|tapas|rapiditas|formitas)\b/],
  ["CARNES", /\b(hamburguesa|milanesa|pollo|pechuga|carne|chorizo|morcilla|costeleta|bondiola|cerdo|muslo|salchicha|salchichas|nugget|nuggets|rebozad|medallon|merluza|pescado|filet|sabalo|surubi|pacu|tararira|langostino|asado|vacio|matambre|picada|solomillo|carre)\b/],
  ["LACTEOS_Y_FIAMBRES", /\b(queso|leche|yogur|yogurt|yoghurt|manteca|crema|ricota|jamon|salame|fiambre|mortadela|muzzarella|mozzarella|cremoso|sardo|provolone|postre|flan|dulce de leche|margarina|huevo|lomito|paleta)\b/],
  ["LIMPIEZA_Y_PERFUMERIA", /\b(detergente|lavandina|jabon|shampoo|acondicionador|desodorante|papel higienico|rollo de cocina|limpiador|suavizante|panal|panales|toallita|toallas|esponja|bolsa|trapo|insecticida|ambientador|crema dental|dentifrico|dentiifrico|kolynos|cepillo|protector|algodon|desinfectante|lustra|cif|ayudin|skip|ariel|drive|repelente|analgesico|sertal)\b/],
  ["ALMACEN", /\b(arvejas|lentejas|lenteja|garbanzo|polenta|cacao|edulcorante|vinagre|mayonesa|ketchup|mostaza|pan rallado|levadura|avena|dulce|batata|membrillo|miel|pate|aceituna|aceitunas|pickles|picante|sal|te|cafe|salsa|pure|atun)\b/],
];

/** Nombres de CATEGORÍA de Airtable que se reconocen como grupo (por si Antonella la carga). */
const CATEGORIA_A_GRUPO: ReadonlyArray<readonly [GrupoCompra, RegExp]> = [
  ["HELADOS", /helad/],
  ["BEBIDAS", /bebida|gaseosa|agua|jugo/],
  ["CERVEZAS_Y_VINOS", /cerveza|vino|alcohol|espirituosa/],
  ["NAVIDENOS", /navide/],
  ["LACTEOS_Y_FIAMBRES", /lacteo|fiambre|queso/],
  ["CARNES", /carne|pollo|pescado|elaborado/],
  ["CONGELADOS", /congelad/],
  ["GOLOSINAS", /golosina|chocolate|kiosco/],
  ["SNACKS", /snack/],
  ["ALMACEN", /almacen|seco/],
  ["LIMPIEZA_Y_PERFUMERIA", /limpieza|perfumeria|higiene/],
];

/** Grupo de un producto: primero la CATEGORÍA de Airtable (si se reconoce), después el nombre. */
export function clasificarGrupo(nombre: string, categoria?: string | null): GrupoCompra {
  const cat = sinTildes(categoria ?? "").trim();
  if (cat) {
    for (const [grupo, patron] of CATEGORIA_A_GRUPO) if (patron.test(cat)) return grupo;
  }
  const n = sinTildes(nombre);
  for (const [grupo, patron] of REGLAS_POR_PALABRA) if (patron.test(n)) return grupo;
  return "GENERAL";
}

const MS_DIA = 86_400_000;

function aUtc(fecha: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) throw new Error(`Fecha inválida: ${fecha}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Promedio del índice estacional de un grupo entre dos días (incluidos), día por día. */
export function indicePromedio(grupo: GrupoCompra, desde: string, hasta: string): number {
  const tabla = INDICE_ESTACIONAL[grupo];
  const ini = aUtc(desde);
  const fin = aUtc(hasta);
  let suma = 0;
  let dias = 0;
  for (let t = ini; t <= fin; t += MS_DIA) {
    suma += tabla[new Date(t).getUTCMonth()];
    dias += 1;
  }
  return dias > 0 ? suma / dias : 1;
}

function sumarDias(fecha: string, n: number): string {
  return new Date(aUtc(fecha) + n * MS_DIA).toISOString().slice(0, 10);
}

/**
 * Factor de temporada: cuánto más (o menos) se va a vender en los próximos `cobertura`
 * días comparado con los últimos `ventana` días, de donde sale el ritmo de venta.
 * Es el cociente entre el índice estacional futuro y el pasado, con tope.
 */
export function factorDeTemporada(
  grupo: GrupoCompra,
  hoy: string,
  coberturaDias: number,
  ventanaDias: number,
): number {
  const pasado = indicePromedio(grupo, sumarDias(hoy, -(ventanaDias - 1)), hoy);
  const futuro = indicePromedio(grupo, sumarDias(hoy, 1), sumarDias(hoy, Math.max(1, Math.round(coberturaDias))));
  const bruto = pasado > 0 ? futuro / pasado : 1;
  const acotado = Math.min(FACTOR_MAXIMO, Math.max(FACTOR_MINIMO, bruto));
  return Math.round(acotado * 100) / 100;
}
