import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({
  path: ".env.local",
});

type LotePayload = {
  id?: number;
  recordId?: string;
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
  registrosEliminados?: string[];
};

type AirtableRecord = {
  id: string;
  fields?: Record<string, unknown>;
};

type AirtableRecordsResponse = {
  records?: AirtableRecord[];
  error?: unknown;
};

type AirtableDeleteResponse = {
  records?: {
    id: string;
    deleted: boolean;
  }[];
  error?: unknown;
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

function armarCamposStock(payload: GuardarStockPayload, lote: LotePayload) {
  const codigoTexto = payload.codigo.trim();
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

  if (payload.sinVencimiento) {
    fields.FECHA_VENCIMIENTO = null;
  }

  return fields;
}

function armarRecordsStock(payload: GuardarStockPayload) {
  return payload.lotes.map((lote) => ({
    fields: armarCamposStock(payload, lote),
  }));
}

function partirEnGrupos<T>(items: T[], cantidadPorGrupo: number) {
  const grupos: T[][] = [];

  for (let i = 0; i < items.length; i += cantidadPorGrupo) {
    grupos.push(items.slice(i, i + cantidadPorGrupo));
  }

  return grupos;
}

function getAirtableConfig() {
  return {
    token: getEnv("AIRTABLE_TOKEN"),
    baseId: getEnv("AIRTABLE_BASE_ID"),
    stockTable: getEnv("AIRTABLE_STOCK_TABLE_NAME"),
  };
}

async function guardarStock(payload: GuardarStockPayload) {
  const { token, baseId, stockTable } = getAirtableConfig();

  const records = armarRecordsStock(payload);
  const grupos = partirEnGrupos(records, 10);
  const creados: AirtableRecord[] = [];

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

    const data = (await response.json()) as AirtableRecordsResponse;

    if (!response.ok) {
      console.error("Error guardando stock:", data);
      throw new Error("No se pudo guardar el stock en Airtable");
    }

    creados.push(...(data.records || []));
  }

  return creados;
}

async function crearUnLoteStock(payload: GuardarStockPayload, lote: LotePayload) {
  const payloadUnitario: GuardarStockPayload = {
    ...payload,
    lotes: [lote],
  };

  const recordsCreados = await guardarStock(payloadUnitario);
  const recordCreado = recordsCreados[0];

  if (!recordCreado) {
    throw new Error("No se pudo crear el lote nuevo en Airtable");
  }

  return recordCreado;
}

async function actualizarUnLoteStock(
  payload: GuardarStockPayload,
  lote: LotePayload
) {
  if (!lote.recordId) {
    throw new Error("Falta el ID del registro para actualizar");
  }

  const { token, baseId, stockTable } = getAirtableConfig();

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    stockTable
  )}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      records: [
        {
          id: lote.recordId,
          fields: armarCamposStock(payload, lote),
        },
      ],
      typecast: true,
    }),
  });

  const data = (await response.json()) as AirtableRecordsResponse;

  if (!response.ok) {
    console.error("Error actualizando stock:", data);
    throw new Error("No se pudo actualizar el stock en Airtable");
  }

  const recordActualizado = data.records?.[0];

  if (!recordActualizado) {
    throw new Error("Airtable no devolvió el registro actualizado");
  }

  return recordActualizado;
}

async function eliminarLotesStock(recordIds: string[]) {
  if (recordIds.length === 0) return [];

  const { token, baseId, stockTable } = getAirtableConfig();
  const grupos = partirEnGrupos(recordIds, 10);
  const eliminados: string[] = [];

  for (const grupo of grupos) {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(stockTable)}`
    );

    grupo.forEach((recordId) => {
      url.searchParams.append("records[]", recordId);
    });

    const response = await fetch(url.toString(), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = (await response.json()) as AirtableDeleteResponse;

    if (!response.ok) {
      console.error("Error eliminando lotes:", data);
      throw new Error("No se pudo eliminar el lote en Airtable");
    }

    eliminados.push(
      ...(data.records || [])
        .filter((record) => record.deleted)
        .map((record) => record.id)
    );
  }

  return eliminados;
}

async function actualizarCargaStock(payload: GuardarStockPayload) {
  const registrosEliminados = payload.registrosEliminados || [];
  const eliminados = await eliminarLotesStock(registrosEliminados);

  const lotesProcesados: {
    id?: number;
    recordId: string;
  }[] = [];

  for (const lote of payload.lotes) {
    if (lote.recordId) {
      const recordActualizado = await actualizarUnLoteStock(payload, lote);

      lotesProcesados.push({
        id: lote.id,
        recordId: recordActualizado.id,
      });

      continue;
    }

    const recordCreado = await crearUnLoteStock(payload, lote);

    lotesProcesados.push({
      id: lote.id,
      recordId: recordCreado.id,
    });
  }

  return {
    lotesProcesados,
    eliminados,
  };
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
    if (req.method !== "POST" && req.method !== "PATCH") {
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

    if (req.method === "POST") {
      await crearProductoSiEsNuevo(payload);

      const recordsCreados = await guardarStock(payload);

      return res.status(200).json({
        ok: true,
        cantidadRegistros: recordsCreados.length,
        registros: recordsCreados.map((record) => record.id),
        lotes: recordsCreados.map((record, index) => ({
          id: payload.lotes[index]?.id,
          recordId: record.id,
        })),
      });
    }

    const resultadoActualizacion = await actualizarCargaStock(payload);

    return res.status(200).json({
      ok: true,
      cantidadRegistros: resultadoActualizacion.lotesProcesados.length,
      registros: resultadoActualizacion.lotesProcesados.map(
        (lote) => lote.recordId
      ),
      lotes: resultadoActualizacion.lotesProcesados,
      registrosEliminados: resultadoActualizacion.eliminados,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Error interno guardando inventario",
    });
  }
}

