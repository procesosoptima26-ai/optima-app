import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({
  path: ".env.local",
});

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type AirtableResponse = {
  records?: AirtableRecord[];
  offset?: string;
  error?: unknown;
};

type LoteStock = {
  id: string;
  productoId: string;
  ubicacionId: string;
  ubicacionNombre: string;
  vencimiento: string | null;
  cantidad: number;
};

type LoteStockGeneral = LoteStock & {
  codigo: string;
  nombreProducto: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
  sucursal: string;
  tipoUbicacion: string;
};

type ProductoStock = {
  id: string;
  codigo: string;
  nombreProducto: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
};

type UbicacionStock = {
  id: string;
  nombre: string;
  sucursal: string;
  tipoUbicacion: string;
};

/**
 * Obtiene una variable de entorno obligatoria.
 */
function getEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Falta configurar la variable de entorno: ${name}`
    );
  }

  return value;
}

/**
 * Obtiene una variable opcional.
 *
 * Esto nos permite usar nombres predeterminados de tablas
 * cuando la variable todavía no existe en Vercel.
 */
function getOptionalEnv(
  names: string[],
  fallback: string
): string {
  for (const name of names) {
    const value = process.env[name];

    if (value?.trim()) {
      return value.trim();
    }
  }

  return fallback;
}

/**
 * Extrae el primer ID de un campo vinculado de Airtable.
 */
function obtenerPrimerIdVinculado(
  valor: unknown
): string | null {
  if (!Array.isArray(valor) || valor.length === 0) {
    return null;
  }

  const primerElemento = valor[0];

  if (typeof primerElemento === "string") {
    return primerElemento.trim() || null;
  }

  if (
    primerElemento &&
    typeof primerElemento === "object"
  ) {
    const objeto =
      primerElemento as Record<string, unknown>;

    if (typeof objeto.id === "string") {
      return objeto.id.trim() || null;
    }
  }

  return null;
}

/**
 * Convierte diferentes tipos de valores de Airtable
 * en un texto limpio.
 */
function normalizarTexto(valor: unknown): string {
  if (typeof valor === "string") {
    return valor.trim();
  }

  if (typeof valor === "number") {
    return String(valor);
  }

  if (Array.isArray(valor)) {
    return valor
      .map((item) => normalizarTexto(item))
      .filter(Boolean)
      .join(", ");
  }

  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;

    if (typeof objeto.name === "string") {
      return objeto.name.trim();
    }

    if (typeof objeto.text === "string") {
      return objeto.text.trim();
    }

    if (typeof objeto.value === "string") {
      return objeto.value.trim();
    }
  }

  return "";
}

/**
 * Lee el primer campo que tenga contenido.
 *
 * Es útil porque en PRODUCTOS puede existir:
 * - NOMBRE MASTER
 * - NOMBRE_MÁSTER
 * - NOMBRE
 * - PRODUCTO
 */
function obtenerPrimerTexto(
  fields: Record<string, unknown>,
  posiblesCampos: string[]
): string {
  for (const campo of posiblesCampos) {
    const texto = normalizarTexto(fields[campo]);

    if (texto) {
      return texto;
    }
  }

  return "";
}

function normalizarCantidad(valor: unknown): number {
  if (typeof valor === "number") {
    return Math.round(valor * 1000) / 1000;
  }

  const numero = Number(normalizarTexto(valor));

  if (Number.isNaN(numero)) {
    return 0;
  }

  return Math.round(numero * 1000) / 1000;
}

function normalizarFecha(
  valor: unknown
): string | null {
  if (!valor) {
    return null;
  }

  const texto = normalizarTexto(valor);

  if (!texto) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto;
  }

  const fecha = new Date(texto);

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  const anio = fecha.getUTCFullYear();
  const mes = String(
    fecha.getUTCMonth() + 1
  ).padStart(2, "0");
  const dia = String(
    fecha.getUTCDate()
  ).padStart(2, "0");

  return `${anio}-${mes}-${dia}`;
}

/**
 * Lee todos los registros de una tabla de Airtable.
 *
 * No agregamos fields[] porque así evitamos que Airtable
 * rechace la consulta si algún campo opcional no existe.
 */
async function leerTodosLosRegistros(
  tableName: string
): Promise<AirtableRecord[]> {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv(
    "AIRTABLE_MOVIMIENTOS_BASE_ID"
  );

  const registros: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tableName
      )}`
    );

    url.searchParams.set("pageSize", "100");

    if (offset) {
      url.searchParams.set("offset", offset);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data =
      (await response.json()) as AirtableResponse;

    if (!response.ok) {
      console.error(
        `Error consultando ${tableName}:`,
        data
      );

      throw new Error(
        `No se pudo consultar la tabla ${tableName}`
      );
    }

    registros.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return registros;
}

/**
 * Consulta STOCK_LOTES.
 *
 * Esta función conserva la estructura de la consulta que
 * ya utiliza Reposición.
 */
async function leerTodosLosRegistrosStock() {
  const tableName = getEnv(
    "AIRTABLE_STOCK_LOTES_TABLE_NAME"
  );

  return leerTodosLosRegistros(tableName);
}

/**
 * Consulta todas las ubicaciones una sola vez.
 *
 * Antes se hacía una petición por cada ubicación.
 * Ahora usamos un mapa, que es más rápido y confiable.
 */
async function leerMapaUbicaciones(): Promise<
  Map<string, UbicacionStock>
> {
  const tableName = getEnv(
    "AIRTABLE_UBICACIONES_TABLE_NAME"
  );

  const registros =
    await leerTodosLosRegistros(tableName);

  const mapa = new Map<string, UbicacionStock>();

  registros.forEach((record) => {
    const sucursal = obtenerPrimerTexto(
      record.fields,
      ["SUCURSAL"]
    );

    const tipoUbicacion = obtenerPrimerTexto(
      record.fields,
      [
        "TIPO_UBICACIÓN",
        "TIPO UBICACIÓN",
        "TIPO_UBICACION",
      ]
    );

    const nombre =
      obtenerPrimerTexto(record.fields, ["NOMBRE"]) ||
      [sucursal, tipoUbicacion]
        .filter(Boolean)
        .join(" | ");

    mapa.set(record.id, {
      id: record.id,
      nombre: nombre || "Ubicación",
      sucursal,
      tipoUbicacion,
    });
  });

  return mapa;
}

/**
 * Consulta la tabla PRODUCTOS y arma un mapa por ID.
 */
async function leerMapaProductos(): Promise<
  Map<string, ProductoStock>
> {
  const tableName = getOptionalEnv(
    [
      "AIRTABLE_PRODUCTOS_TABLE_NAME",
      "AIRTABLE_PRODUCTS_TABLE_NAME",
    ],
    "PRODUCTOS"
  );

  const registros =
    await leerTodosLosRegistros(tableName);

  const mapa = new Map<string, ProductoStock>();

  registros.forEach((record) => {
    const codigo = obtenerPrimerTexto(
      record.fields,
      [
        "CÓDIGO",
        "CODIGO",
        "COD. BARRA",
        "COD_BARRA",
      ]
    );

    const producto = obtenerPrimerTexto(
      record.fields,
      ["PRODUCTO"]
    );

    const marca = obtenerPrimerTexto(
      record.fields,
      ["MARCA"]
    );

    const presentacion = obtenerPrimerTexto(
      record.fields,
      [
        "PRESENTACIÓN",
        "PRESENTACION",
      ]
    );

    const especificacion = obtenerPrimerTexto(
      record.fields,
      [
        "ESPECIFICACIÓN",
        "ESPECIFICACION",
      ]
    );

    const nombreProducto =
      obtenerPrimerTexto(
        record.fields,
        [
          "NOMBRE MASTER",
          "NOMBRE_MÁSTER",
          "NOMBRE MASTER LOOKUP",
          "NOMBRE",
        ]
      ) ||
      [
        producto,
        marca,
        presentacion,
        especificacion,
      ]
        .filter(Boolean)
        .join(" ");

    mapa.set(record.id, {
      id: record.id,
      codigo,
      nombreProducto:
        nombreProducto ||
        producto ||
        `Producto ${codigo || record.id}`,
      producto,
      marca,
      presentacion,
      especificacion,
    });
  });

  return mapa;
}

function ordenarLotes(
  lotes: LoteStock[]
): LoteStock[] {
  return [...lotes].sort((a, b) => {
    if (
      a.vencimiento === null &&
      b.vencimiento === null
    ) {
      return a.ubicacionNombre.localeCompare(
        b.ubicacionNombre,
        "es"
      );
    }

    if (a.vencimiento === null) {
      return 1;
    }

    if (b.vencimiento === null) {
      return -1;
    }

    return a.vencimiento.localeCompare(
      b.vencimiento
    );
  });
}

function ordenarStockGeneral(
  lotes: LoteStockGeneral[]
): LoteStockGeneral[] {
  return [...lotes].sort((a, b) => {
    const porNombre =
      a.nombreProducto.localeCompare(
        b.nombreProducto,
        "es",
        {
          sensitivity: "base",
        }
      );

    if (porNombre !== 0) {
      return porNombre;
    }

    const porUbicacion =
      a.tipoUbicacion.localeCompare(
        b.tipoUbicacion,
        "es",
        {
          sensitivity: "base",
        }
      );

    if (porUbicacion !== 0) {
      return porUbicacion;
    }

    if (
      a.vencimiento === null &&
      b.vencimiento === null
    ) {
      return 0;
    }

    if (a.vencimiento === null) {
      return 1;
    }

    if (b.vencimiento === null) {
      return -1;
    }

    return a.vencimiento.localeCompare(
      b.vencimiento
    );
  });
}

/**
 * Respuesta utilizada por Reposición y Ajustes.
 *
 * Necesita productoId.
 */
async function responderConsultaProducto(
  req: VercelRequest,
  res: VercelResponse
) {
  const productoId = String(
    req.query.productoId || ""
  ).trim();

  const ubicacionId = String(
    req.query.ubicacionId || ""
  ).trim();

  const vencimiento = normalizarFecha(
    req.query.vencimiento
  );

  if (!productoId) {
    return res.status(400).json({
      ok: false,
      error: "Falta productoId",
    });
  }

  const [
    registros,
    mapaUbicaciones,
  ] = await Promise.all([
    leerTodosLosRegistrosStock(),
    leerMapaUbicaciones(),
  ]);

  const lotesSinNombre = registros
    .map((record): LoteStock | null => {
      const productoVinculadoId =
        obtenerPrimerIdVinculado(
          record.fields.PRODUCTOS
        );

      const ubicacionVinculadaId =
        obtenerPrimerIdVinculado(
          record.fields["UBICACIÓN"]
        );

      if (
        !productoVinculadoId ||
        !ubicacionVinculadaId
      ) {
        return null;
      }

      if (
        productoVinculadoId !== productoId
      ) {
        return null;
      }

      if (
        ubicacionId &&
        ubicacionVinculadaId !== ubicacionId
      ) {
        return null;
      }

      const ubicacion =
        mapaUbicaciones.get(
          ubicacionVinculadaId
        );

      return {
        id: record.id,
        productoId:
          productoVinculadoId,
        ubicacionId:
          ubicacionVinculadaId,
        ubicacionNombre:
          ubicacion?.nombre ||
          "Ubicación",
        vencimiento: normalizarFecha(
          record.fields.VENCIMIENTO
        ),
        cantidad: normalizarCantidad(
          record.fields.CANTIDAD_ACTUAL
        ),
      };
    })
    .filter(
      (lote): lote is LoteStock =>
        lote !== null
    );

  const lotes = ordenarLotes(
    lotesSinNombre
  );

  const lotesConStock = lotes.filter(
    (lote) => lote.cantidad > 0
  );

  /**
   * Cuando vencimiento es null, también debemos poder
   * encontrar un lote SIN VENCIMIENTO.
   *
   * Por eso no usamos:
   * vencimiento ? ... : null
   */
  const loteSeleccionado =
    ubicacionId
      ? lotes.find(
          (lote) =>
            lote.vencimiento === vencimiento
        ) || null
      : null;

  const loteAnterior =
    vencimiento && ubicacionId
      ? lotesConStock.find(
          (lote) =>
            lote.vencimiento !== null &&
            lote.vencimiento < vencimiento
        ) || null
      : null;

  const vencimientoMasProximo =
    lotesConStock.find(
      (lote) =>
        lote.vencimiento !== null
    ) || null;

  const cantidadTotal = lotes.reduce(
    (total, lote) =>
      total + lote.cantidad,
    0
  );

  return res.status(200).json({
    ok: true,
    productoId,
    ubicacionId:
      ubicacionId || null,
    vencimientoConsultado:
      vencimiento,
    cantidadTotal:
      Math.round(
        cantidadTotal * 1000
      ) / 1000,
    cantidadVencimientoSeleccionado:
      loteSeleccionado?.cantidad || 0,
    loteSeleccionado,
    loteAnterior,
    vencimientoMasProximo,
    alertaFefo: Boolean(loteAnterior),
    lotes,
  });
}

/**
 * Respuesta utilizada por la pantalla Stock.
 *
 * No requiere productoId.
 * Filtra por sucursal.
 */
async function responderStockGeneral(
  req: VercelRequest,
  res: VercelResponse
) {
  const sucursalConsultada = String(
    req.query.sucursal || ""
  )
    .trim()
    .toUpperCase();

  const [
    registrosStock,
    mapaUbicaciones,
    mapaProductos,
  ] = await Promise.all([
    leerTodosLosRegistrosStock(),
    leerMapaUbicaciones(),
    leerMapaProductos(),
  ]);

  const lotes: LoteStockGeneral[] =
    registrosStock
      .map(
        (
          record
        ): LoteStockGeneral | null => {
          const productoId =
            obtenerPrimerIdVinculado(
              record.fields.PRODUCTOS
            );

          const ubicacionId =
            obtenerPrimerIdVinculado(
              record.fields["UBICACIÓN"]
            );

          if (
            !productoId ||
            !ubicacionId
          ) {
            return null;
          }

          const producto =
            mapaProductos.get(productoId);

          const ubicacion =
            mapaUbicaciones.get(
              ubicacionId
            );

          if (!ubicacion) {
            return null;
          }

          const sucursalUbicacion =
            ubicacion.sucursal
              .trim()
              .toUpperCase();

          if (
            sucursalConsultada &&
            sucursalUbicacion !==
              sucursalConsultada
          ) {
            return null;
          }

          return {
            id: record.id,
            productoId,
            ubicacionId,
            ubicacionNombre:
              ubicacion.nombre,
            vencimiento:
              normalizarFecha(
                record.fields.VENCIMIENTO
              ),
            cantidad:
              normalizarCantidad(
                record.fields.CANTIDAD_ACTUAL
              ),
            codigo:
              producto?.codigo || "",
            nombreProducto:
              producto?.nombreProducto ||
              "Producto sin nombre",
            producto:
              producto?.producto || "",
            marca:
              producto?.marca || "",
            presentacion:
              producto?.presentacion || "",
            especificacion:
              producto?.especificacion || "",
            sucursal:
              ubicacion.sucursal,
            tipoUbicacion:
              ubicacion.tipoUbicacion,
          };
        }
      )
      .filter(
        (
          lote
        ): lote is LoteStockGeneral =>
          lote !== null
      );

  const lotesOrdenados =
    ordenarStockGeneral(lotes);

  const cantidadTotal =
    lotesOrdenados.reduce(
      (total, lote) =>
        total + lote.cantidad,
      0
    );

  return res.status(200).json({
    ok: true,
    sucursal:
      sucursalConsultada || null,
    cantidadTotal:
      Math.round(
        cantidadTotal * 1000
      ) / 1000,
    cantidadLotes:
      lotesOrdenados.length,
    lotes: lotesOrdenados,
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        error: "Método no permitido",
      });
    }

    const vista = String(
      req.query.vista || ""
    )
      .trim()
      .toLowerCase();

    /**
     * La pantalla Stock consulta:
     *
     * /api/stock-lotes?vista=general&sucursal=BELLA VISTA
     */
    if (vista === "general") {
      return await responderStockGeneral(
        req,
        res
      );
    }

    /**
     * Reposición y Ajustes continúan utilizando:
     *
     * /api/stock-lotes?productoId=...&ubicacionId=...
     */
    return await responderConsultaProducto(
      req,
      res
    );
  } catch (error) {
    console.error(
      "Error interno en stock-lotes:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Error interno del servidor",
    });
  }
}