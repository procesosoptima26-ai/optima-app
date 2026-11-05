import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirAutorizacion } from "../lib/autorizacion.js";
import { configTablaOperativa, productoDeEmpresa, sucursalSolicitada, sucursalRealDeUbicacion } from "../lib/alcance-operativo.js";

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

function armarCamposProductoNuevo(payload: GuardarStockPayload, empresaId: string) {
  const codeField = getEnv("AIRTABLE_CODE_FIELD");
  const especificacionLimpia = limpiarTexto(payload.especificacion);

  const fields: Record<string, unknown> = {
    [codeField]: convertirCodigoParaProductos(payload.codigo),
    PRODUCTO: limpiarTexto(payload.producto),
    MARCA: limpiarTexto(payload.marca),
    "PRESENTACIÓN": limpiarTexto(payload.presentacion),
    EMPRESA: [empresaId],
  };

  if (especificacionLimpia) {
    fields["ESPECIFICACIÓN"] = [especificacionLimpia];
  }

  return fields;
}

async function crearProductoSiEsNuevo(payload: GuardarStockPayload, empresaId: string) {
  if (!payload.productoNuevo) return;

  const { token, baseId } = configTablaOperativa("AIRTABLE_BASE_ID");
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
          fields: armarCamposProductoNuevo(payload, empresaId),
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

/** Catálogo compartido: cada código consultado tiene que estar asignado
 * explícitamente a la empresa de la sesión (nunca se autoriza por nombre).
 */
async function verificarCodigoProducto(codigo: string, empresaId: string): Promise<"propio" | "ajeno" | "ausente"> {
  const { token, baseId } = configTablaOperativa("AIRTABLE_BASE_ID");
  const tabla = getEnv("AIRTABLE_TABLE_NAME");
  const campo = getEnv("AIRTABLE_CODE_FIELD");
  const numero = Number(codigo.trim());
  if (!Number.isFinite(numero) || !/^\d+$/.test(codigo.trim())) return "ausente";
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tabla)}`);
  url.searchParams.set("filterByFormula", `{${campo}} = ${numero}`);
  url.searchParams.set("pageSize", "100");
  let offset: string | undefined;
  let ajeno = false;
  do {
    if (offset) url.searchParams.set("offset", offset);
    const respuesta = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!respuesta.ok) throw new Error("No se pudo comprobar el producto");
    const data = (await respuesta.json()) as { records?: AirtableRecord[]; offset?: string };
    for (const record of data.records || []) {
      if (productoDeEmpresa(record.fields ?? {}, empresaId)) return "propio";
      ajeno = true;
    }
    offset = data.offset;
  } while (offset);
  return ajeno ? "ajeno" : "ausente";
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
    ...configTablaOperativa("AIRTABLE_BASE_ID"),
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

/**
 * Comprueba los lotes existentes ANTES de editar o borrar alguno.
 * La sucursal del payload no es suficiente para autorizar un recordId.
 */
async function registrosStockPertenecenASucursal(
  payload: GuardarStockPayload
): Promise<boolean> {
  if (
    payload.registrosEliminados !== undefined &&
    !Array.isArray(payload.registrosEliminados)
  ) {
    return false;
  }

  const ids = [
    ...payload.lotes.map((lote) => lote.recordId).filter((id): id is string => Boolean(id)),
    ...(payload.registrosEliminados || []),
  ];

  if (ids.length > 200) return false;

  const idsUnicos = [...new Set(ids)];
  if (idsUnicos.length === 0) return true;

  const { token, baseId, stockTable } = getAirtableConfig();
  const sucursalAutorizada = payload.sucursal.trim().toUpperCase();

  for (const recordId of idsUnicos) {
    if (!/^rec[A-Za-z0-9]{14}$/.test(recordId)) return false;

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      stockTable
    )}/${encodeURIComponent(recordId)}`;

    const respuesta = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (respuesta.status === 404) return false;
    if (!respuesta.ok) {
      throw new Error(`No se pudo verificar un lote (${respuesta.status})`);
    }

    const registro = (await respuesta.json()) as AirtableRecord;
    const sucursalRegistrada =
      typeof registro.fields?.SUCURSAL === "string"
        ? registro.fields.SUCURSAL.trim().toUpperCase()
        : "";

    const codigoRegistrado = String(registro.fields?.[getEnv("AIRTABLE_CODE_FIELD")] ??
      registro.fields?.CÓDIGO ?? "").trim();
    const ubicacionRegistrada = String(registro.fields?.UBICACIÓN ?? "").trim().toUpperCase();
    if (sucursalRegistrada !== sucursalAutorizada ||
        codigoRegistrado !== payload.codigo.trim() ||
        ubicacionRegistrada !== payload.ubicacion.trim().toUpperCase()) return false;
  }

  return true;
}

/** Valor heredado de SUCURSAL, resuelto exclusivamente desde UBICACIÓN por ID.
 * No confiar en un nombre suministrado por el navegador tras un renombrado.
 */
async function nombreSucursalInventarioLegacy(sucursalId: string): Promise<string | null> {
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tabla = getEnv("AIRTABLE_UBICACIONES_TABLE_NAME");
  const opciones = new Set<string>();
  let offset: string | undefined;
  let paginas = 0;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tabla)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const respuesta = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!respuesta.ok) throw new Error("No se pudo resolver la sucursal heredada");
    const datos = await respuesta.json() as { records?: AirtableRecord[]; offset?: string };
    if (!Array.isArray(datos.records)) throw new Error("Respuesta de ubicaciones inválida");
    for (const r of datos.records) {
      const campos = r.fields || {};
      if (sucursalRealDeUbicacion(campos) === sucursalId) {
        const etiqueta = campos.SUCURSAL;
        if (typeof etiqueta !== "string" || !etiqueta.trim()) return null;
        opciones.add(etiqueta.trim());
      }
    }
    offset = datos.offset;
    paginas++;
    if (paginas > 100) throw new Error("Demasiadas páginas de ubicaciones");
  } while (offset);
  return opciones.size === 1 ? [...opciones][0] : null;
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

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Solicitud de stock inválida" });
    }

    const payload = req.body as GuardarStockPayload;
    const errorValidacion = validarPayload(payload);

    if (errorValidacion) {
      return res.status(400).json({
        error: errorValidacion,
      });
    }

    // Comprobar usuario, módulo y sucursal ANTES de escribir en Airtable.
    const usuarioAutorizado = await exigirAutorizacion(req, res, {
      modulos: ["INVENTARIO"],
      permiso: req.method === "POST" ? "inventario.crear" : "inventario.editarGuardado",
      sucursal: payload.sucursal,
    });
    if (!usuarioAutorizado) return;

    const sucursalCore = sucursalSolicitada(usuarioAutorizado.contexto, payload.sucursal);
    if (!sucursalCore) return res.status(403).json({ error: "Sucursal no autorizada" });
    const etiquetaLegacy = await nombreSucursalInventarioLegacy(sucursalCore.id);
    if (!etiquetaLegacy) return res.status(409).json({
      error: "No hay una correspondencia única con el inventario heredado de esta sucursal",
    });
    const payloadInterno = { ...payload, sucursal: etiquetaLegacy };

    const propiedadProducto = await verificarCodigoProducto(payload.codigo, usuarioAutorizado.empresaId);
    // Códigos ajenos, no asignados o duplicados nunca autorizan la escritura.
    if ((!payload.productoNuevo && propiedadProducto !== "propio") ||
        (payload.productoNuevo && propiedadProducto !== "ausente")) {
      return res.status(403).json({ error: "El código no corresponde a un producto habilitado para esta empresa" });
    }
    if (req.method === "PATCH" && payload.productoNuevo) {
      return res.status(400).json({ error: "No se puede editar stock de un producto no creado" });
    }
    if (req.method === "PATCH") {
      const permitido = await registrosStockPertenecenASucursal(payloadInterno);
      if (!permitido) {
        return res.status(403).json({
          error: "Hay lotes que no pertenecen a tu sucursal o no existen",
        });
      }
    }

    if (req.method === "POST") {
      await crearProductoSiEsNuevo(payloadInterno, usuarioAutorizado.empresaId);

      const recordsCreados = await guardarStock(payloadInterno);

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

    const resultadoActualizacion = await actualizarCargaStock(payloadInterno);

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

