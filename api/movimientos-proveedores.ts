import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({ path: ".env.local" });

type TipoMovimiento = "COMPRA RECIBIDA" | "PAGO REALIZADO";
type MedioPago = "EFECTIVO" | "TRANSFERENCIA" | "ECHEQ" | "";

type AirtableRecord = { id: string; fields: Record<string, unknown> };
type AirtableListResponse = { records?: AirtableRecord[]; offset?: string; error?: unknown };

type ItemCompraPayload = {
  id?: string;
  descripcion: string;
  cantidad: number | string;
  unidad: string;
  precioUnitario: number | string;
  observaciones?: string;
};

type CrearCompraPayload = {
  accion: "crear-compra";
  proveedorId: string;
  fecha: string;
  comprobante?: string;
  observaciones?: string;
  responsable?: string;
  items: ItemCompraPayload[];
};

type ActualizarCompraPayload = {
  accion: "actualizar-compra";
  movimientoId: string;
  fecha: string;
  comprobante?: string;
  observaciones?: string;
  responsable?: string;
  items: ItemCompraPayload[];
};

type MovimientoPayload = {
  proveedorId: string;
  fecha: string;
  tipoMovimiento: TipoMovimiento;
  comprobante?: string;
  medioPago?: MedioPago;
  datosPago?: string;
  importe: number;
  observacion?: string;
  responsable?: string;
};

type ActualizarMovimientoPayload = Omit<MovimientoPayload, "proveedorId" | "tipoMovimiento"> & { id: string };

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta configurar la variable de entorno: ${name}`);
  return value;
}

function getAirtableConfig() {
  return {
    token: getEnv("AIRTABLE_TOKEN"),
    baseId: getEnv("AIRTABLE_CC_BASE_ID"),
    movimientosTable: process.env.AIRTABLE_MOVIMIENTOS_PROVEEDORES_TABLE_NAME || "MOVIMIENTOS_PROVEEDORES",
    comprasTable: process.env.AIRTABLE_COMPRAS_PROVEEDORES_TABLE_NAME || "COMPRAS_PROVEEDORES",
    itemsTable: process.env.AIRTABLE_ITEMS_COMPRA_PROVEEDOR_TABLE_NAME || "ITEMS_COMPRA_PROVEEDOR",
  };
}

function texto(valor: unknown): string {
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number") return String(valor);
  if (Array.isArray(valor)) return valor.map(texto).filter(Boolean).join(", ");
  return "";
}

function numero(valor: unknown): number {
  if (typeof valor === "number") return valor;
  if (typeof valor === "string") {
    const result = Number(valor);
    return Number.isNaN(result) ? 0 : result;
  }
  return 0;
}

function ids(valor: unknown): string[] {
  return Array.isArray(valor)
    ? valor.filter((item): item is string => typeof item === "string")
    : [];
}

function fechaAirtable(fecha: string) {
  const valor = fecha.trim();
  if (!valor) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const match = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return valor;
  const dia = String(Number(match[1])).padStart(2, "0");
  const mes = String(Number(match[2])).padStart(2, "0");
  const anio = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${anio}-${mes}-${dia}`;
}

function fechaMostrar(valor: unknown) {
  const fecha = texto(valor);
  const match = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : fecha;
}

async function airtableFetch(url: string, options: RequestInit = {}) {
  const { token } = getAirtableConfig();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = (await response.json()) as AirtableRecord | AirtableListResponse;
  if (!response.ok) {
    console.error("Error de Airtable:", data);
    throw new Error(`Airtable rechazó la operación: ${JSON.stringify("error" in data ? data.error : data)}`);
  }
  return data;
}

async function listarTodos(tableName: string) {
  const { baseId } = getAirtableConfig();
  const records: AirtableRecord[] = [];
  let offset = "";
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const data = (await airtableFetch(url.toString())) as AirtableListResponse;
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);
  return records;
}

async function crearRegistro(tableName: string, fields: Record<string, unknown>) {
  const { baseId } = getAirtableConfig();
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  const data = (await airtableFetch(url, {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  })) as AirtableListResponse;
  const record = data.records?.[0];
  if (!record) throw new Error("Airtable no devolvió el registro creado.");
  return record;
}

async function actualizarRegistro(tableName: string, recordId: string, fields: Record<string, unknown>) {
  const { baseId } = getAirtableConfig();
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${encodeURIComponent(recordId)}`;
  return (await airtableFetch(url, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true }),
  })) as AirtableRecord;
}

async function eliminarRegistro(tableName: string, recordId: string) {
  const { baseId } = getAirtableConfig();
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${encodeURIComponent(recordId)}`;
  await airtableFetch(url, { method: "DELETE" });
}

function mapearMovimiento(record: AirtableRecord) {
  return {
    id: record.id,
    proveedorIds: ids(record.fields.PROVEEDORES),
    fecha: fechaMostrar(record.fields.FECHA),
    tipoMovimiento: texto(record.fields.TIPO_MOVIMIENTO) as TipoMovimiento,
    comprobante: texto(record.fields.COMPROBANTE),
    medioPago: texto(record.fields.MEDIO_DE_PAGO) as MedioPago,
    datosPago: texto(record.fields.DATOS_PAGO),
    importe: numero(record.fields.IMPORTE),
    importeFirmado: numero(record.fields.IMPORTE_FIRMADO),
    observacion: texto(record.fields["OBSERVACIÓN"]),
    responsable: texto(record.fields.RESPONSABLE),
  };
}

async function listarMovimientos(proveedorId: string) {
  const { movimientosTable } = getAirtableConfig();
  const movimientos = (await listarTodos(movimientosTable))
    .map(mapearMovimiento)
    .filter((movimiento) => movimiento.proveedorIds.includes(proveedorId));

  return movimientos.sort((a, b) => {
    const toTime = (fecha: string) => {
      const [dia, mes, anio] = fecha.split("/");
      return new Date(Number(anio), Number(mes) - 1, Number(dia)).getTime();
    };
    return toTime(b.fecha) - toTime(a.fecha);
  });
}

function validarItems(items: ItemCompraPayload[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("La compra debe tener al menos un ítem.");
  }

  const normalizados = items.map((item, index) => {
    const descripcion = texto(item.descripcion);
    const cantidad = numero(item.cantidad);
    const unidad = texto(item.unidad).toUpperCase();
    const precioUnitario = numero(item.precioUnitario);
    const observaciones = texto(item.observaciones);

    if (!descripcion) throw new Error(`Ítem ${index + 1}: falta la descripción.`);
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error(`Ítem ${index + 1}: la cantidad debe ser mayor a cero.`);
    if (!unidad) throw new Error(`Ítem ${index + 1}: falta la unidad.`);
    if (!Number.isFinite(precioUnitario) || precioUnitario < 0) throw new Error(`Ítem ${index + 1}: el precio unitario debe ser cero o mayor.`);

    return {
      id: texto(item.id),
      descripcion,
      cantidad,
      unidad,
      precioUnitario,
      totalItem: Math.round(cantidad * precioUnitario * 100) / 100,
      observaciones,
      orden: index + 1,
    };
  });

  const importe = Math.round(normalizados.reduce((total, item) => total + item.totalItem, 0) * 100) / 100;
  return { items: normalizados, importe };
}

async function crearCompra(payload: CrearCompraPayload) {
  const { comprasTable, itemsTable, movimientosTable } = getAirtableConfig();
  const proveedorId = texto(payload.proveedorId);
  const fecha = fechaAirtable(texto(payload.fecha));
  if (!proveedorId.startsWith("rec")) throw new Error("Falta seleccionar un proveedor válido.");
  if (!fecha) throw new Error("Falta la fecha de la compra.");

  const datosItems = validarItems(payload.items);
  const comprobante = texto(payload.comprobante) || "Compra recibida";
  const observaciones = texto(payload.observaciones);
  const responsable = texto(payload.responsable);

  let compraId = "";
  let movimientoId = "";
  const itemIds: string[] = [];

  try {
    const compra = await crearRegistro(comprasTable, {
      FECHA: fecha,
      PROVEEDOR: [proveedorId],
      COMPROBANTE: comprobante,
      IMPORTE: datosItems.importe,
      OBSERVACIONES: observaciones || null,
      RESPONSABLE: responsable || null,
    });
    compraId = compra.id;

    for (const item of datosItems.items) {
      const creado = await crearRegistro(itemsTable, {
        COMPRA: [compraId],
        "DESCRIPCIÓN": item.descripcion,
        CANTIDAD: item.cantidad,
        UNIDAD: item.unidad,
        PRECIO_UNITARIO: item.precioUnitario,
        ORDEN: item.orden,
        OBSERVACIONES: item.observaciones || null,
      });
      itemIds.push(creado.id);
    }

    const movimiento = await crearRegistro(movimientosTable, {
      PROVEEDORES: [proveedorId],
      FECHA: fecha,
      TIPO_MOVIMIENTO: "COMPRA RECIBIDA",
      COMPROBANTE: comprobante,
      IMPORTE: datosItems.importe,
      MEDIO_DE_PAGO: null,
      DATOS_PAGO: null,
      "OBSERVACIÓN": observaciones || null,
      RESPONSABLE: responsable || null,
    });
    movimientoId = movimiento.id;

    await actualizarRegistro(comprasTable, compraId, {
      MOVIMIENTO_PROVEEDOR: [movimientoId],
    });

    return { compraId, movimientoId, comprobante, importe: datosItems.importe };
  } catch (error) {
    if (movimientoId) await eliminarRegistro(movimientosTable, movimientoId);
    for (const itemId of [...itemIds].reverse()) await eliminarRegistro(itemsTable, itemId);
    if (compraId) await eliminarRegistro(comprasTable, compraId);
    throw error;
  }
}

async function obtenerDetalleCompra(movimientoId: string) {
  const { comprasTable, itemsTable } = getAirtableConfig();
  if (!movimientoId) throw new Error("Falta el movimiento de la compra.");

  const compra = (await listarTodos(comprasTable)).find((record) =>
    ids(record.fields.MOVIMIENTO_PROVEEDOR).includes(movimientoId)
  );
  if (!compra) throw new Error("No se encontró la compra vinculada a este movimiento.");

  const items = (await listarTodos(itemsTable))
    .filter((record) => ids(record.fields.COMPRA).includes(compra.id))
    .map((record) => {
      const cantidad = numero(record.fields.CANTIDAD);
      const precioUnitario = numero(record.fields.PRECIO_UNITARIO);
      return {
        id: record.id,
        descripcion: texto(record.fields["DESCRIPCIÓN"]),
        cantidad,
        unidad: texto(record.fields.UNIDAD),
        precioUnitario,
        totalItem: numero(record.fields.TOTAL_ITEM) || Math.round(cantidad * precioUnitario * 100) / 100,
        orden: numero(record.fields.ORDEN),
        observaciones: texto(record.fields.OBSERVACIONES),
      };
    })
    .sort((a, b) => a.orden - b.orden);

  return {
    compraId: compra.id,
    movimientoId,
    fecha: fechaMostrar(compra.fields.FECHA),
    proveedorIds: ids(compra.fields.PROVEEDOR),
    comprobante: texto(compra.fields.COMPROBANTE),
    importe: numero(compra.fields.IMPORTE),
    observaciones: texto(compra.fields.OBSERVACIONES),
    responsable: texto(compra.fields.RESPONSABLE),
    items,
  };
}

async function actualizarCompra(payload: ActualizarCompraPayload) {
  const { comprasTable, itemsTable, movimientosTable } = getAirtableConfig();
  const detalle = await obtenerDetalleCompra(texto(payload.movimientoId));
  const datosItems = validarItems(payload.items);
  const fecha = fechaAirtable(texto(payload.fecha));
  const comprobante = texto(payload.comprobante) || "Compra recibida";
  const observaciones = texto(payload.observaciones);
  const responsable = texto(payload.responsable);
  if (!fecha) throw new Error("Falta la fecha de la compra.");

  const idsRecibidos = new Set(datosItems.items.map((item) => item.id).filter(Boolean));
  const idsExistentes = new Set(detalle.items.map((item) => item.id));

  for (const item of datosItems.items) {
    const fields = {
      COMPRA: [detalle.compraId],
      "DESCRIPCIÓN": item.descripcion,
      CANTIDAD: item.cantidad,
      UNIDAD: item.unidad,
      PRECIO_UNITARIO: item.precioUnitario,
      ORDEN: item.orden,
      OBSERVACIONES: item.observaciones || null,
    };
    if (item.id && idsExistentes.has(item.id)) await actualizarRegistro(itemsTable, item.id, fields);
    else await crearRegistro(itemsTable, fields);
  }

  for (const item of detalle.items) {
    if (!idsRecibidos.has(item.id)) await eliminarRegistro(itemsTable, item.id);
  }

  await actualizarRegistro(comprasTable, detalle.compraId, {
    FECHA: fecha,
    COMPROBANTE: comprobante,
    IMPORTE: datosItems.importe,
    OBSERVACIONES: observaciones || null,
    RESPONSABLE: responsable || null,
  });

  await actualizarRegistro(movimientosTable, detalle.movimientoId, {
    FECHA: fecha,
    COMPROBANTE: comprobante,
    IMPORTE: datosItems.importe,
    "OBSERVACIÓN": observaciones || null,
    RESPONSABLE: responsable || null,
  });

  return obtenerDetalleCompra(detalle.movimientoId);
}

async function crearMovimiento(payload: MovimientoPayload) {
  const { movimientosTable } = getAirtableConfig();
  const proveedorId = texto(payload.proveedorId);
  const fecha = fechaAirtable(texto(payload.fecha));
  const importe = numero(payload.importe);
  if (!proveedorId) throw new Error("Falta el proveedor.");
  if (!fecha) throw new Error("Falta la fecha.");
  if (importe <= 0) throw new Error("El importe debe ser mayor a cero.");
  if (payload.tipoMovimiento === "PAGO REALIZADO" && !texto(payload.medioPago)) throw new Error("Falta el medio de pago.");

  const record = await crearRegistro(movimientosTable, {
    PROVEEDORES: [proveedorId],
    FECHA: fecha,
    TIPO_MOVIMIENTO: payload.tipoMovimiento,
    COMPROBANTE: texto(payload.comprobante) || null,
    MEDIO_DE_PAGO: payload.tipoMovimiento === "PAGO REALIZADO" ? payload.medioPago || null : null,
    DATOS_PAGO: payload.tipoMovimiento === "PAGO REALIZADO" ? texto(payload.datosPago) || null : null,
    IMPORTE: importe,
    "OBSERVACIÓN": texto(payload.observacion) || null,
    RESPONSABLE: texto(payload.responsable) || null,
  });
  return mapearMovimiento(record);
}

async function actualizarMovimiento(payload: ActualizarMovimientoPayload) {
  const { movimientosTable, baseId } = getAirtableConfig();
  if (!payload.id) throw new Error("Falta el id del movimiento.");

  const actual = (await airtableFetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(movimientosTable)}/${encodeURIComponent(payload.id)}`)) as AirtableRecord;
  const tipo = texto(actual.fields.TIPO_MOVIMIENTO) as TipoMovimiento;
  const importe = numero(payload.importe);
  if (importe <= 0) throw new Error("El importe debe ser mayor a cero.");
  if (tipo === "PAGO REALIZADO" && !texto(payload.medioPago)) throw new Error("Falta el medio de pago.");

  const record = await actualizarRegistro(movimientosTable, payload.id, {
    FECHA: fechaAirtable(payload.fecha),
    COMPROBANTE: texto(payload.comprobante) || null,
    MEDIO_DE_PAGO: tipo === "PAGO REALIZADO" ? payload.medioPago || null : null,
    DATOS_PAGO: tipo === "PAGO REALIZADO" ? texto(payload.datosPago) || null : null,
    IMPORTE: importe,
    "OBSERVACIÓN": texto(payload.observacion) || null,
    RESPONSABLE: texto(payload.responsable) || null,
  });
  return mapearMovimiento(record);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const accion = texto(req.query.accion).toLowerCase();
      if (accion === "detalle-compra") {
        const detalle = await obtenerDetalleCompra(texto(req.query.movimientoId));
        return res.status(200).json({ ok: true, detalle });
      }

      const proveedorId = texto(req.query.proveedorId);
      if (!proveedorId) return res.status(400).json({ ok: false, error: "Falta proveedorId" });
      const movimientos = await listarMovimientos(proveedorId);
      return res.status(200).json({ ok: true, movimientos });
    }

    if (req.method === "POST") {
      const accion = texto(req.body?.accion).toLowerCase();
      if (accion === "crear-compra") {
        const compra = await crearCompra(req.body as CrearCompraPayload);
        return res.status(200).json({ ok: true, compra });
      }
      const movimiento = await crearMovimiento(req.body as MovimientoPayload);
      return res.status(200).json({ ok: true, movimiento });
    }

    if (req.method === "PATCH") {
      const accion = texto(req.body?.accion).toLowerCase();
      if (accion === "actualizar-compra") {
        const detalle = await actualizarCompra(req.body as ActualizarCompraPayload);
        return res.status(200).json({ ok: true, detalle });
      }
      const movimiento = await actualizarMovimiento(req.body as ActualizarMovimientoPayload);
      return res.status(200).json({ ok: true, movimiento });
    }

    return res.status(405).json({ ok: false, error: "Método no permitido" });
  } catch (error) {
    console.error("Error en movimientos-proveedores:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Error interno del servidor",
    });
  }
}
