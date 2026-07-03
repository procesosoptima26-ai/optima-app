import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({
  path: ".env.local",
});

type LotePayload = {
  vencimiento: string;
  cantidad: string;
};

type GuardarStockPayload = {
  codigo: string;
  nombre: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
  sucursal: string;
  ubicacion: string;
  sinVencimiento: boolean;
  productoNuevo: boolean;
  observaciones: string;
  lotes: LotePayload[];
};

type AirtableErrorResponse = {
  error?: unknown;
};

function getEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta configurar la variable de entorno: ${name}`);
  }

  return value;
}

function convertirCodigoParaProductos(codigo: string) {
  const codigoLimpio = codigo.trim();
  const codigoNumero = Number(codigoLimpio);

  if (!Number.isNaN(codigoNumero)) {
    return codigoNumero;
  }

  return codigoLimpio;
}

function limpiarTexto(valor: string) {
  return valor.trim();
}

function armarCamposProductoNuevo(payload: GuardarStockPayload) {
  const codeField = getEnv("AIRTABLE_CODE_FIELD");
  const especificacionLimpia = limpiarTexto(payload.especificacion);

  const fields: Record<string, unknown> = {
    [codeField]: convertirCodigoParaProductos(payload.codigo),
    PRODUCTO: limpiarTexto(payload.producto),
    MARCA: limpiarTexto(payload.marca),
    "PRESENTACIÓN": limpiarTexto(payload.presentacion),
  };

  if (especificacionLimpia) {
    fields["ESPECIFICACIÓN"] = [especificacionLimpia];
  }

  return fields;
}

async function crearProductoSiEsNuevo(payload: GuardarStockPayload) {
  if (!payload.productoNuevo) return;

  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_BASE_ID");
  const productosTable = getEnv("AIRTABLE_TABLE_NAME");

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    productosTable
  )}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      records: [
        {
          fields: armarCamposProductoNuevo(payload),
        },
      ],
      typecast: true,
    }),
  });

  if (!response.ok) {
    const data = (await response.json()) as AirtableErrorResponse;
    console.error("Error creando producto:", data);
    throw new Error("No se pudo crear el producto nuevo en Airtable");
  }
}

function armarRecordsStock(payload: GuardarStockPayload) {
  const codigoTexto = payload.codigo.trim();

  return payload.lotes.map((lote) => {
    const cantidadNumero = Number(lote.cantidad);

    const fields: Record<string, unknown> = {
      CÓDIGO: codigoTexto,
      NOMBRE: limpiarTexto(payload.nombre),
      SUCURSAL: limpiarTexto(payload.sucursal),
      UBICACIÓN: limpiarTexto(payload.ubicacion),
      SIN_VENCIMIENTO: payload.sinVencimiento,
      CANTIDAD: cantidadNumero,
      OBSERVACIONES: limpiarTexto(payload.observaciones),
    };

    if (!payload.sinVencimiento && lote.vencimiento) {
      fields.FECHA_VENCIMIENTO = lote.vencimiento;
    }

    return {
      fields,
    };
  });
}

function partirEnGrupos<T>(items: T[], cantidadPorGrupo: number) {
  const grupos: T[][] = [];

  for (let i = 0; i < items.length; i += cantidadPorGrupo) {
    grupos.push(items.slice(i, i + cantidadPorGrupo));
  }

  return grupos;
}

async function guardarStock(payload: GuardarStockPayload) {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_BASE_ID");
  const stockTable = getEnv("AIRTABLE_STOCK_TABLE_NAME");

  const records = armarRecordsStock(payload);
  const grupos = partirEnGrupos(records, 10);
  const creados = [];

  for (const grupo of grupos) {
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      stockTable
    )}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        records: grupo,
        typecast: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Error guardando stock:", data);
      throw new Error("No se pudo guardar el stock en Airtable");
    }

    creados.push(...data.records);
  }

  return creados;
}

function validarPayload(payload: GuardarStockPayload) {
  if (!payload.codigo?.trim()) return "Falta el código";
  if (!payload.nombre?.trim()) return "Falta el nombre";
  if (!payload.sucursal?.trim()) return "Falta la sucursal";
  if (!payload.ubicacion?.trim()) return "Falta la ubicación";

  if (!Array.isArray(payload.lotes) || payload.lotes.length === 0) {
    return "Faltan lotes para guardar";
  }

  for (const lote of payload.lotes) {
    if (!payload.sinVencimiento && !lote.vencimiento) {
      return "Falta fecha de vencimiento";
    }

    if (!lote.cantidad || Number(lote.cantidad) <= 0) {
      return "La cantidad debe ser mayor a cero";
    }
  }

  if (payload.productoNuevo) {
    if (!payload.producto?.trim()) return "Falta el producto";
    if (!payload.marca?.trim()) return "Falta la marca";
    if (!payload.presentacion?.trim()) return "Falta la presentación";
  }

  return "";
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Método no permitido",
      });
    }

    const payload = req.body as GuardarStockPayload;
    const errorValidacion = validarPayload(payload);

    if (errorValidacion) {
      return res.status(400).json({
        error: errorValidacion,
      });
    }

    await crearProductoSiEsNuevo(payload);

    const recordsCreados = await guardarStock(payload);

    return res.status(200).json({
      ok: true,
      cantidadRegistros: recordsCreados.length,
      registros: recordsCreados.map((record) => record.id),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Error interno guardando inventario",
    });
  }
}