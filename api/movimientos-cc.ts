import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({
  path: ".env.local",
});

type TipoMovimiento = "REMITO EMITIDO" | "PAGO RECIBIDO";
type MedioPago = "EFECTIVO" | "TRANSFERENCIA" | "ECHEQ" | "";

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type AirtableResponse = {
  records?: AirtableRecord[];
  error?: unknown;
};

type AirtableListResponse = {
  records?: AirtableRecord[];
  offset?: string;
  error?: unknown;
};

type MovimientoPayload = {
  clienteId: string;
  fecha: string;
  tipoMovimiento: TipoMovimiento;
  comprobante?: string;
  medioPago?: MedioPago;
  datosPago?: string;
  importe: number;
  observacion?: string;
  responsable?: string;
};

type ActualizarMovimientoPayload = {
  id: string;
  fecha: string;
  comprobante?: string;
  medioPago?: MedioPago;
  datosPago?: string;
  importe: number;
  observacion?: string;
  responsable?: string;
};

type ItemRemitoPayload = {
  descripcion: string;
  cantidad: number | string;
  unidad: string;
  costoUnitario: number | string;
  observaciones?: string;
};

type CrearRemitoPayload = {
  clienteId: string;
  fecha: string;
  observaciones?: string;
  responsable?: string;
  items: ItemRemitoPayload[];
};


type CompletarImporteItemPayload = {
  id: string;
  costoUnitario: number | string;
};

type CompletarImporteRemitoPayload = {
  accion: "completar-remito-pendiente";
  movimientoId: string;
  items: CompletarImporteItemPayload[];
};

type ItemRemitoPendiente = {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  costoUnitario: number;
  totalItem: number;
  orden: number;
  observaciones: string;
};

type DetalleRemitoPendiente = {
  remitoId: string;
  movimientoId: string;
  numero: number;
  comprobante: string;
  importe: number;
  items: ItemRemitoPendiente[];
};

type RemitoCreado = {
  id: string;
  numero: number;
  comprobante: string;
  fecha: string;
  clienteId: string;
  importe: number;
  observaciones: string;
  responsable: string;
  movimientoCcId: string;
  items: Array<{
    id: string;
    descripcion: string;
    cantidad: number;
    unidad: string;
    costoUnitario: number;
    totalItem: number;
    orden: number;
    observaciones: string;
  }>;
};

function getEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta configurar la variable de entorno: ${name}`);
  }

  return value;
}

function getAirtableConfig() {
  return {
    token: getEnv("AIRTABLE_TOKEN"),
    baseId: getEnv("AIRTABLE_CC_BASE_ID"),
    movimientosTable:
      process.env.AIRTABLE_MOVIMIENTOS_CC_TABLE_NAME || "MOVIMIENTOS_CC",
    remitosTable:
      process.env.AIRTABLE_REMITOS_CLIENTES_TABLE_NAME || "REMITOS_CLIENTES",
    itemsTable:
      process.env.AIRTABLE_ITEMS_REMITO_TABLE_NAME || "ITEMS_REMITO",
  };
}

function normalizarTexto(valor: unknown): string {
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number") return String(valor);

  if (Array.isArray(valor)) {
    return valor.map((item) => normalizarTexto(item)).filter(Boolean).join(", ");
  }

  return "";
}

function normalizarNumero(valor: unknown): number {
  if (typeof valor === "number") return valor;

  if (typeof valor === "string") {
    const numero = Number(valor);
    return Number.isNaN(numero) ? 0 : numero;
  }

  return 0;
}

function obtenerClienteIds(valor: unknown): string[] {
  if (Array.isArray(valor)) {
    return valor.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function convertirFechaParaAirtable(fecha: string) {
  const valor = fecha.trim();

  if (!valor) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return valor;
  }

  const match = valor.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);

  if (!match) return valor;

  const dia = String(Number(match[1])).padStart(2, "0");
  const mes = String(Number(match[2])).padStart(2, "0");
  const anioTexto = match[3];
  const anio = anioTexto.length === 2 ? `20${anioTexto}` : anioTexto;

  return `${anio}-${mes}-${dia}`;
}

function convertirFechaParaMostrar(valor: unknown) {
  const fecha = normalizarTexto(valor);

  if (!fecha) return "";

  const match = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) return fecha;

  return `${match[3]}/${match[2]}/${match[1]}`;
}

function mapearMovimiento(record: AirtableRecord) {
  return {
    id: record.id,
    clienteIds: obtenerClienteIds(record.fields.CLIENTES),
    fecha: convertirFechaParaMostrar(record.fields.FECHA),
    tipoMovimiento: normalizarTexto(record.fields.TIPO_MOVIMIENTO) as TipoMovimiento,
    comprobante: normalizarTexto(record.fields.COMPROBANTE),
    medioPago: normalizarTexto(record.fields.MEDIO_DE_PAGO) as MedioPago,
    datosPago: normalizarTexto(record.fields.DATOS_PAGO),
    importe: normalizarNumero(record.fields.IMPORTE),
    importeFirmado: normalizarNumero(record.fields.IMPORTE_FIRMADO),
    observacion: normalizarTexto(record.fields["OBSERVACIÓN"]),
    responsable: normalizarTexto(record.fields.RESPONSABLE),
  };
}

async function listarMovimientos(clienteId: string) {
  const { token, baseId, movimientosTable } = getAirtableConfig();

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      movimientosTable
    )}`
  );

  url.searchParams.set("pageSize", "100");
  url.searchParams.set("sort[0][field]", "FECHA");
  url.searchParams.set("sort[0][direction]", "desc");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as AirtableResponse;

  if (!response.ok) {
    console.error("Error listando movimientos:", data);
    throw new Error("No se pudieron obtener los movimientos");
  }

  return (data.records || [])
    .map(mapearMovimiento)
    .filter((movimiento) => movimiento.clienteIds.includes(clienteId));
}


async function listarImportesPendientes() {
  const { token, baseId, movimientosTable } = getAirtableConfig();

  const movimientosPendientes: ReturnType<typeof mapearMovimiento>[] = [];
  let offset = "";

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        movimientosTable
      )}`
    );

    url.searchParams.set("pageSize", "100");
    url.searchParams.set("sort[0][field]", "FECHA");
    url.searchParams.set("sort[0][direction]", "desc");
    url.searchParams.set(
      "filterByFormula",
      'AND({TIPO_MOVIMIENTO}="REMITO EMITIDO",{IMPORTE}=0)'
    );

    if (offset) {
      url.searchParams.set("offset", offset);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = (await response.json()) as AirtableResponse & {
      offset?: string;
    };

    if (!response.ok) {
      console.error("Error listando importes pendientes:", data);
      throw new Error("No se pudieron obtener los importes pendientes");
    }

    movimientosPendientes.push(...(data.records || []).map(mapearMovimiento));
    offset = data.offset || "";
  } while (offset);

  return movimientosPendientes;
}

async function crearMovimiento(payload: MovimientoPayload) {
  const { token, baseId, movimientosTable } = getAirtableConfig();

  if (!payload.clienteId?.trim()) {
    throw new Error("Falta el cliente");
  }

  if (!payload.fecha?.trim()) {
    throw new Error("Falta la fecha");
  }

  if (!payload.tipoMovimiento?.trim()) {
    throw new Error("Falta el tipo de movimiento");
  }

  const importeNumero = Number(payload.importe);

  if (Number.isNaN(importeNumero) || importeNumero < 0) {
    throw new Error("El importe debe ser cero o mayor");
  }

  if (
    payload.tipoMovimiento === "PAGO RECIBIDO" &&
    importeNumero <= 0
  ) {
    throw new Error("El pago debe tener un importe mayor a cero");
  }

  if (
    payload.tipoMovimiento === "PAGO RECIBIDO" &&
    !payload.medioPago?.trim()
  ) {
    throw new Error("Falta el medio de pago");
  }

  const fields: Record<string, unknown> = {
    CLIENTES: [payload.clienteId],
    FECHA: convertirFechaParaAirtable(payload.fecha),
    TIPO_MOVIMIENTO: payload.tipoMovimiento,
    IMPORTE: importeNumero,
  };

  if (payload.comprobante?.trim()) {
    fields.COMPROBANTE = payload.comprobante.trim();
  }

  if (payload.tipoMovimiento === "PAGO RECIBIDO" && payload.medioPago) {
    fields.MEDIO_DE_PAGO = payload.medioPago;
  } else {
    fields.MEDIO_DE_PAGO = null;
  }

  if (payload.datosPago?.trim()) {
    fields.DATOS_PAGO = payload.datosPago.trim();
  } else {
    fields.DATOS_PAGO = null;
  }

  if (payload.observacion?.trim()) {
    fields["OBSERVACIÓN"] = payload.observacion.trim();
  } else {
    fields["OBSERVACIÓN"] = null;
  }

  if (payload.responsable?.trim()) {
    fields.RESPONSABLE = payload.responsable.trim();
  } else {
    fields.RESPONSABLE = null;
  }

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    movimientosTable
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
          fields,
        },
      ],
      typecast: true,
    }),
  });

  const data = (await response.json()) as AirtableResponse;

  if (!response.ok) {
    console.error("Error creando movimiento:", data);
    throw new Error("No se pudo crear el movimiento en Airtable");
  }

  const record = data.records?.[0];

  if (!record) {
    throw new Error("Airtable no devolvió el movimiento creado");
  }

  return mapearMovimiento(record);
}

async function actualizarMovimiento(payload: ActualizarMovimientoPayload) {
  const { token, baseId, movimientosTable } = getAirtableConfig();

  if (!payload.id?.trim()) {
    throw new Error("Falta el id del movimiento");
  }

  if (!payload.fecha?.trim()) {
    throw new Error("Falta la fecha");
  }

  const importeNumero = Number(payload.importe);

  if (Number.isNaN(importeNumero) || importeNumero < 0) {
    throw new Error("El importe debe ser cero o mayor");
  }

  const recordUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    movimientosTable
  )}/${payload.id}`;

  const actualResponse = await fetch(recordUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const actualData = (await actualResponse.json()) as AirtableRecord & { error?: unknown };

  if (!actualResponse.ok) {
    console.error("Error consultando movimiento:", actualData);
    throw new Error("No se pudo consultar el movimiento");
  }

  const tipoMovimientoActual = normalizarTexto(actualData.fields.TIPO_MOVIMIENTO) as TipoMovimiento;

  if (tipoMovimientoActual === "PAGO RECIBIDO" && importeNumero <= 0) {
    throw new Error("El pago debe tener un importe mayor a cero");
  }

  if (tipoMovimientoActual === "PAGO RECIBIDO" && !payload.medioPago?.trim()) {
    throw new Error("Falta el medio de pago");
  }

  const fields: Record<string, unknown> = {
    FECHA: convertirFechaParaAirtable(payload.fecha),
    COMPROBANTE: payload.comprobante?.trim() || null,
    IMPORTE: importeNumero,
    "OBSERVACIÓN": payload.observacion?.trim() || null,
    RESPONSABLE: payload.responsable?.trim() || null,
  };

  if (tipoMovimientoActual === "PAGO RECIBIDO") {
    fields.MEDIO_DE_PAGO = payload.medioPago?.trim() || null;
    fields.DATOS_PAGO = payload.datosPago?.trim() || null;
  } else {
    fields.MEDIO_DE_PAGO = null;
    fields.DATOS_PAGO = null;
  }

  const response = await fetch(recordUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields,
      typecast: true,
    }),
  });

  const data = (await response.json()) as AirtableRecord & { error?: unknown };

  if (!response.ok) {
    console.error("Error actualizando movimiento:", data);
    throw new Error("No se pudo actualizar el movimiento en Airtable");
  }

  return mapearMovimiento(data);
}

function formatearNumeroRemito(numero: number) {
  return String(numero).padStart(8, "0");
}

async function airtableFetch(
  url: string,
  options: RequestInit = {}
) {
  const { token } = getAirtableConfig();

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers || {}),
    },
  });

  const data = (await response.json()) as
    | AirtableRecord
    | AirtableListResponse;

  if (!response.ok) {
    console.error("Error de Airtable:", data);

    const detalle =
      data &&
      typeof data === "object" &&
      "error" in data
        ? JSON.stringify(data.error)
        : JSON.stringify(data);

    throw new Error(`Airtable rechazó la operación. ${detalle}`);
  }

  return data;
}

async function obtenerSiguienteNumero() {
  const { baseId, remitosTable } = getAirtableConfig();

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      remitosTable
    )}`
  );

  url.searchParams.set("pageSize", "1");
  url.searchParams.set("maxRecords", "1");
  url.searchParams.set("sort[0][field]", "NÚMERO");
  url.searchParams.set("sort[0][direction]", "desc");

  const data = (await airtableFetch(
    url.toString()
  )) as AirtableListResponse;

  const ultimoNumero = normalizarNumero(
    data.records?.[0]?.fields["NÚMERO"]
  );

  return Math.max(1, Math.floor(ultimoNumero) + 1);
}

async function crearRegistro(
  tableName: string,
  fields: Record<string, unknown>
) {
  const { baseId } = getAirtableConfig();

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    tableName
  )}`;

  const data = (await airtableFetch(url, {
    method: "POST",
    body: JSON.stringify({
      records: [{ fields }],
      typecast: true,
    }),
  })) as AirtableListResponse;

  const record = data.records?.[0];

  if (!record) {
    throw new Error("Airtable no devolvió el registro creado.");
  }

  return record;
}

async function actualizarRegistro(
  tableName: string,
  recordId: string,
  fields: Record<string, unknown>
) {
  const { baseId } = getAirtableConfig();

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    tableName
  )}/${encodeURIComponent(recordId)}`;

  return (await airtableFetch(url, {
    method: "PATCH",
    body: JSON.stringify({
      fields,
      typecast: true,
    }),
  })) as AirtableRecord;
}

async function eliminarRegistro(
  tableName: string,
  recordId: string
) {
  const { baseId } = getAirtableConfig();

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    tableName
  )}/${encodeURIComponent(recordId)}`;

  try {
    await airtableFetch(url, {
      method: "DELETE",
    });
  } catch (error) {
    console.error(
      `No se pudo revertir ${tableName}/${recordId}:`,
      error
    );
  }
}

function validarPayload(payload: CrearRemitoPayload) {
  const clienteId = normalizarTexto(payload?.clienteId);
  const fecha = normalizarTexto(payload?.fecha);
  const items = Array.isArray(payload?.items) ? payload.items : [];

  if (!clienteId || !clienteId.startsWith("rec")) {
    throw new Error("Falta seleccionar un cliente válido.");
  }

  if (!fecha) {
    throw new Error("Falta la fecha del remito.");
  }

  convertirFechaParaAirtable(fecha);

  if (items.length === 0) {
    throw new Error("El remito debe tener al menos un ítem.");
  }

  const itemsNormalizados = items.map((item, index) => {
    const descripcion = normalizarTexto(item.descripcion);
    const cantidad = normalizarNumero(item.cantidad);
    const unidad = normalizarTexto(item.unidad).toUpperCase();
    const costoUnitario = normalizarNumero(item.costoUnitario);
    const observaciones = normalizarTexto(item.observaciones);

    if (!descripcion) {
      throw new Error(
        `Ítem ${index + 1}: falta la descripción.`
      );
    }

    if (
      !Number.isFinite(Number(item.cantidad)) ||
      cantidad <= 0
    ) {
      throw new Error(
        `Ítem ${index + 1}: la cantidad debe ser mayor a cero.`
      );
    }

    if (!unidad) {
      throw new Error(`Ítem ${index + 1}: falta la unidad.`);
    }

    if (
      !Number.isFinite(Number(item.costoUnitario)) ||
      costoUnitario < 0
    ) {
      throw new Error(
        `Ítem ${index + 1}: el costo unitario debe ser cero o mayor.`
      );
    }

    const totalItem = Math.round(cantidad * costoUnitario * 100) / 100;

    return {
      descripcion,
      cantidad,
      unidad,
      costoUnitario,
      totalItem,
      observaciones,
      orden: index + 1,
    };
  });

  const importe =
    Math.round(
      itemsNormalizados.reduce(
        (total, item) => total + item.totalItem,
        0
      ) * 100
    ) / 100;

  return {
    clienteId,
    fecha: convertirFechaParaAirtable(fecha),
    importe,
    observaciones: normalizarTexto(payload.observaciones),
    responsable: normalizarTexto(payload.responsable),
    items: itemsNormalizados,
  };
}

async function crearRemito(
  payload: CrearRemitoPayload
): Promise<RemitoCreado> {
  const {
    remitosTable,
    itemsTable,
    movimientosTable,
  } = getAirtableConfig();

  const datos = validarPayload(payload);
  const numero = await obtenerSiguienteNumero();
  const comprobante = `REMITO ${formatearNumeroRemito(numero)}`;

  let remitoId = "";
  let movimientoId = "";
  const itemIds: string[] = [];

  try {
    const remito = await crearRegistro(remitosTable, {
      "NÚMERO": numero,
      "FECHA": datos.fecha,
      "CLIENTE": [datos.clienteId],
      "IMPORTE": datos.importe,
      "OBSERVACIONES": datos.observaciones || null,
      "RESPONSABLE": datos.responsable || null,
    });

    remitoId = remito.id;

    const itemsCreados = [];

    for (const item of datos.items) {
      const record = await crearRegistro(itemsTable, {
        "REMITO": [remitoId],
        "DESCRIPCIÓN": item.descripcion,
        "CANTIDAD": item.cantidad,
        "UNIDAD": item.unidad,
        "COSTO_UNITARIO": item.costoUnitario,
        "ORDEN": item.orden,
        "OBSERVACIONES": item.observaciones || null,
      });

      itemIds.push(record.id);

      itemsCreados.push({
        id: record.id,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        unidad: item.unidad,
        costoUnitario: item.costoUnitario,
        totalItem: item.totalItem,
        orden: item.orden,
        observaciones: item.observaciones,
      });
    }

    const movimiento = await crearRegistro(movimientosTable, {
      "CLIENTES": [datos.clienteId],
      "FECHA": datos.fecha,
      "TIPO_MOVIMIENTO": "REMITO EMITIDO",
      "COMPROBANTE": comprobante,
      "IMPORTE": datos.importe,
      "MEDIO_DE_PAGO": null,
      "DATOS_PAGO": null,
      "OBSERVACIÓN": datos.observaciones || null,
      "RESPONSABLE": datos.responsable || null,
    });

    movimientoId = movimiento.id;

    await actualizarRegistro(remitosTable, remitoId, {
      "MOVIMIENTO_CC": [movimientoId],
    });

    return {
      id: remitoId,
      numero,
      comprobante,
      fecha: datos.fecha,
      clienteId: datos.clienteId,
      importe: datos.importe,
      observaciones: datos.observaciones,
      responsable: datos.responsable,
      movimientoCcId: movimientoId,
      items: itemsCreados,
    };
  } catch (error) {
    if (movimientoId) {
      await eliminarRegistro(movimientosTable, movimientoId);
    }

    for (const itemId of [...itemIds].reverse()) {
      await eliminarRegistro(itemsTable, itemId);
    }

    if (remitoId) {
      await eliminarRegistro(remitosTable, remitoId);
    }

    throw error;
  }
}



function obtenerIdsVinculados(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];

  return valor.filter(
    (item): item is string => typeof item === "string"
  );
}

async function listarTodosLosRegistros(tableName: string) {
  const { baseId } = getAirtableConfig();
  const registros: AirtableRecord[] = [];
  let offset = "";

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

    const data = (await airtableFetch(
      url.toString()
    )) as AirtableListResponse;

    registros.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return registros;
}

async function obtenerDetalleRemitoPendiente(
  movimientoId: string
): Promise<DetalleRemitoPendiente> {
  const { remitosTable, itemsTable } = getAirtableConfig();

  if (!movimientoId?.trim()) {
    throw new Error("Falta el movimiento del remito.");
  }

  const remitos = await listarTodosLosRegistros(remitosTable);

  const remito = remitos.find((record) =>
    obtenerIdsVinculados(record.fields["MOVIMIENTO_CC"]).includes(
      movimientoId
    )
  );

  if (!remito) {
    throw new Error(
      "No se encontró el remito relacionado con este movimiento."
    );
  }

  const registrosItems = await listarTodosLosRegistros(itemsTable);

  const items = registrosItems
    .filter((record) =>
      obtenerIdsVinculados(record.fields["REMITO"]).includes(
        remito.id
      )
    )
    .map((record) => {
      const cantidad = normalizarNumero(record.fields["CANTIDAD"]);
      const costoUnitario = normalizarNumero(
        record.fields["COSTO_UNITARIO"]
      );
      const totalFormula = normalizarNumero(
        record.fields["TOTAL_ITEM"]
      );

      return {
        id: record.id,
        descripcion: normalizarTexto(
          record.fields["DESCRIPCIÓN"]
        ),
        cantidad,
        unidad: normalizarTexto(record.fields["UNIDAD"]),
        costoUnitario,
        totalItem:
          totalFormula ||
          Math.round(cantidad * costoUnitario * 100) / 100,
        orden: normalizarNumero(record.fields["ORDEN"]),
        observaciones: normalizarTexto(
          record.fields["OBSERVACIONES"]
        ),
      };
    })
    .sort((a, b) => a.orden - b.orden);

  if (items.length === 0) {
    throw new Error("El remito no tiene ítems relacionados.");
  }

  const numero = normalizarNumero(remito.fields["NÚMERO"]);

  return {
    remitoId: remito.id,
    movimientoId,
    numero,
    comprobante: `REMITO ${formatearNumeroRemito(numero)}`,
    importe: normalizarNumero(remito.fields["IMPORTE"]),
    items,
  };
}

async function completarImporteRemitoPendiente(
  payload: CompletarImporteRemitoPayload
) {
  const {
    remitosTable,
    itemsTable,
    movimientosTable,
  } = getAirtableConfig();

  const detalle = await obtenerDetalleRemitoPendiente(
    normalizarTexto(payload.movimientoId)
  );

  const costosRecibidos = Array.isArray(payload.items)
    ? payload.items
    : [];

  if (costosRecibidos.length !== detalle.items.length) {
    throw new Error(
      "Deben completarse los costos de todos los ítems."
    );
  }

  const costosPorId = new Map(
    costosRecibidos.map((item) => [
      normalizarTexto(item.id),
      normalizarNumero(item.costoUnitario),
    ])
  );

  const itemsActualizados = detalle.items.map((item, index) => {
    if (!costosPorId.has(item.id)) {
      throw new Error(
        `Falta el costo unitario del ítem ${index + 1}.`
      );
    }

    const costoUnitario = costosPorId.get(item.id) || 0;

    if (
      !Number.isFinite(costoUnitario) ||
      costoUnitario <= 0
    ) {
      throw new Error(
        `El costo unitario del ítem ${index + 1} debe ser mayor a cero.`
      );
    }

    return {
      ...item,
      costoUnitario,
      totalItem:
        Math.round(item.cantidad * costoUnitario * 100) / 100,
    };
  });

  const importe =
    Math.round(
      itemsActualizados.reduce(
        (total, item) => total + item.totalItem,
        0
      ) * 100
    ) / 100;

  if (importe <= 0) {
    throw new Error(
      "El importe total del remito debe ser mayor a cero."
    );
  }

  for (const item of itemsActualizados) {
    await actualizarRegistro(itemsTable, item.id, {
      "COSTO_UNITARIO": item.costoUnitario,
    });
  }

  await actualizarRegistro(remitosTable, detalle.remitoId, {
    "IMPORTE": importe,
  });

  await actualizarRegistro(
    movimientosTable,
    detalle.movimientoId,
    {
      "IMPORTE": importe,
    }
  );

  return {
    ...detalle,
    importe,
    items: itemsActualizados,
  };
}


export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const accion = String(req.query.accion || "")
        .trim()
        .toLowerCase();

      if (accion === "detalle-remito-pendiente") {
        const movimientoId = String(
          req.query.movimientoId || ""
        ).trim();

        const detalle = await obtenerDetalleRemitoPendiente(
          movimientoId
        );

        return res.status(200).json({
          ok: true,
          detalle,
        });
      }

      if (accion === "siguiente-remito") {
        const siguienteNumero = await obtenerSiguienteNumero();

        return res.status(200).json({
          ok: true,
          siguienteNumero,
          comprobante: `REMITO ${formatearNumeroRemito(siguienteNumero)}`,
        });
      }

      const pendientes = String(req.query.pendientes || "")
        .trim()
        .toLowerCase();

      if (pendientes === "true") {
        const movimientos = await listarImportesPendientes();

        return res.status(200).json({
          ok: true,
          movimientos,
        });
      }

      const clienteId = String(req.query.clienteId || "").trim();

      if (!clienteId) {
        return res.status(400).json({
          ok: false,
          error: "Falta clienteId",
        });
      }

      const movimientos = await listarMovimientos(clienteId);

      return res.status(200).json({
        ok: true,
        movimientos,
      });
    }

    if (req.method === "POST") {
      const accion = String(req.body?.accion || "")
        .trim()
        .toLowerCase();

      if (accion === "crear-remito") {
        const remito = await crearRemito(req.body as CrearRemitoPayload);

        return res.status(200).json({
          ok: true,
          remito,
        });
      }

      const movimiento = await crearMovimiento(req.body as MovimientoPayload);

      return res.status(200).json({
        ok: true,
        movimiento,
      });
    }

    if (req.method === "PATCH") {
      const accion = String(req.body?.accion || "")
        .trim()
        .toLowerCase();

      if (accion === "completar-remito-pendiente") {
        const detalle = await completarImporteRemitoPendiente(
          req.body as CompletarImporteRemitoPayload
        );

        return res.status(200).json({
          ok: true,
          detalle,
        });
      }

      const movimiento = await actualizarMovimiento(
        req.body as ActualizarMovimientoPayload
      );

      return res.status(200).json({
        ok: true,
        movimiento,
      });
    }

    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
  } catch (error) {
    console.error("Error en movimientos-cc:", error);

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Error interno del servidor",
    });
  }
}
