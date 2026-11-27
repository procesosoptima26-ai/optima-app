/**
 * OPTIMA - Plan de carga de ventas desde archivo (lógica pura).
 *
 * Para qué sirve: dado lo que dice el archivo, lo que existe en el catálogo,
 * el stock de la ubicación de venta y lo que ya se cargó antes, decide qué
 * ventas se pueden cargar y cuáles no, y por qué.
 *
 * Qué soluciona: concentra TODAS las reglas en un solo lugar sin tocar
 * Airtable, para poder probarlas a fondo. El mismo plan se calcula en la
 * vista previa y otra vez al confirmar (el servidor no confía en la pantalla).
 */

/** Mismo valor que usa el motor de stock de Airtable. */
export const TOLERANCIA_VENTA = 0.1;
export const MAX_PRODUCTOS_POR_ARCHIVO = 1000;

export type LineaEntrada = {
  codigo: string;
  producto: string;
  cantidad: number;
};

export type ProductoCatalogo = {
  id: string;
  nombre: string;
};

export type EntradaPlan = {
  lineas: readonly LineaEntrada[];
  /** Productos de la empresa encontrados por código. */
  productosPorCodigo: ReadonlyMap<string, ProductoCatalogo>;
  /** Códigos que existen pero pertenecen a otra empresa (catálogo compartido). */
  codigosDeOtraEmpresa: ReadonlySet<string>;
  /** Stock total disponible en la ubicación de venta, por id de producto. */
  stockPorProductoId: ReadonlyMap<string, number>;
  /** Ids de producto que ya se cargaron desde este mismo archivo. */
  yaCargadosPorProductoId: ReadonlySet<string>;
};

export type VentaLista = {
  codigo: string;
  productoId: string;
  nombre: string;
  cantidad: number;
  stock: number;
};

export type VentaConProblema = {
  codigo: string;
  nombre: string;
  cantidad: number;
  motivo: "NO_RECONOCIDO" | "OTRA_EMPRESA" | "SIN_STOCK" | "STOCK_INSUFICIENTE" | "YA_CARGADO";
  detalle: string;
  stock?: number;
  faltante?: number;
  /** Solo en SIN_STOCK y STOCK_INSUFICIENTE: producto reconocido, para cargarlo con error. */
  productoId?: string;
};

export type PlanVentas = {
  listas: VentaLista[];
  problemas: VentaConProblema[];
  totales: {
    productos: number;
    listas: number;
    noReconocidas: number;
    sinStockOInsuficiente: number;
    yaCargadas: number;
    unidadesListas: number;
  };
};

function redondear(numero: number): number {
  return Math.round(numero * 1000) / 1000;
}

export function planificarVentas(entrada: EntradaPlan): PlanVentas {
  // Un código = una venta. Si llegan repetidos se suman (defensa del servidor).
  const sumadas = new Map<string, LineaEntrada>();
  for (const linea of entrada.lineas) {
    if (!(linea.cantidad > 0) || !Number.isFinite(linea.cantidad)) {
      throw new Error(`Cantidad inválida para el código ${linea.codigo}`);
    }
    const previa = sumadas.get(linea.codigo);
    if (previa) {
      previa.cantidad = redondear(previa.cantidad + linea.cantidad);
      if (!previa.producto && linea.producto) previa.producto = linea.producto;
    } else {
      sumadas.set(linea.codigo, { ...linea });
    }
  }
  if (sumadas.size > MAX_PRODUCTOS_POR_ARCHIVO) {
    throw new Error(`El archivo supera el máximo de ${MAX_PRODUCTOS_POR_ARCHIVO} productos.`);
  }

  const listas: VentaLista[] = [];
  const problemas: VentaConProblema[] = [];

  for (const linea of sumadas.values()) {
    const cantidad = redondear(linea.cantidad);
    const catalogo = entrada.productosPorCodigo.get(linea.codigo);

    if (!catalogo) {
      if (entrada.codigosDeOtraEmpresa.has(linea.codigo)) {
        problemas.push({
          codigo: linea.codigo, nombre: linea.producto, cantidad,
          motivo: "OTRA_EMPRESA",
          detalle: "El código existe en un catálogo compartido y necesita vinculación autorizada.",
        });
      } else {
        problemas.push({
          codigo: linea.codigo, nombre: linea.producto, cantidad,
          motivo: "NO_RECONOCIDO",
          detalle: "El código no existe en el catálogo.",
        });
      }
      continue;
    }

    if (entrada.yaCargadosPorProductoId.has(catalogo.id)) {
      problemas.push({
        codigo: linea.codigo, nombre: catalogo.nombre, cantidad,
        motivo: "YA_CARGADO",
        detalle: "Este producto ya se cargó desde este mismo archivo.",
      });
      continue;
    }

    const stock = redondear(entrada.stockPorProductoId.get(catalogo.id) ?? 0);
    if (stock <= 0) {
      problemas.push({
        codigo: linea.codigo, nombre: catalogo.nombre, cantidad,
        motivo: "SIN_STOCK", stock: 0, faltante: cantidad, productoId: catalogo.id,
        detalle: "No hay stock en la ubicación de venta.",
      });
      continue;
    }

    const faltante = redondear(cantidad - stock);
    if (faltante > TOLERANCIA_VENTA) {
      problemas.push({
        codigo: linea.codigo, nombre: catalogo.nombre, cantidad,
        motivo: "STOCK_INSUFICIENTE", stock, faltante, productoId: catalogo.id,
        detalle: `Stock disponible ${stock}; faltan ${faltante}.`,
      });
      continue;
    }

    listas.push({
      codigo: linea.codigo, productoId: catalogo.id, nombre: catalogo.nombre,
      cantidad, stock,
    });
  }

  return {
    listas,
    problemas,
    totales: {
      productos: sumadas.size,
      listas: listas.length,
      noReconocidas: problemas.filter(
        (p) => p.motivo === "NO_RECONOCIDO" || p.motivo === "OTRA_EMPRESA").length,
      sinStockOInsuficiente: problemas.filter(
        (p) => p.motivo === "SIN_STOCK" || p.motivo === "STOCK_INSUFICIENTE").length,
      yaCargadas: problemas.filter((p) => p.motivo === "YA_CARGADO").length,
      unidadesListas: redondear(listas.reduce((a, v) => a + v.cantidad, 0)),
    },
  };
}

/**
 * Ventas reconocidas pero sin stock suficiente. Se cargan igual como movimientos
 * (cantidad completa): el motor de Airtable las rechaza sin tocar el stock y
 * las deja con ERROR_MOTOR para que se revisen y reprocesen a mano.
 */
export function ventasParaRevision(plan: PlanVentas): VentaLista[] {
  const salida: VentaLista[] = [];
  for (const p of plan.problemas) {
    if ((p.motivo === "SIN_STOCK" || p.motivo === "STOCK_INSUFICIENTE") && p.productoId) {
      salida.push({
        codigo: p.codigo, productoId: p.productoId, nombre: p.nombre,
        cantidad: p.cantidad, stock: p.stock ?? 0,
      });
    }
  }
  return salida;
}

/** Marca que se escribe en OBSERVACIONES para reconocer de qué archivo viene cada venta. */
export function etiquetaArchivoVentas(nombreArchivo: string): string {
  const limpio = nombreArchivo
    .replace(/[\u0000-\u001f"\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!limpio) throw new Error("Falta el nombre del archivo.");
  return `Ventas archivo: ${limpio}`;
}
