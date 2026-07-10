import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({
  path: ".env.local",
});

type TipoMovimiento = "REMITO EMITIDO" | "PAGO RECIBIDO";
type MedioPago = "EFECTIVO" | "TRANSFERENCIA" | "ECHEQ" | "";

type AirtableRecord = {
  id: string;
  fields?: Record<string, unknown>;
};

type AirtableRecordsResponse = {
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

const MOVIMIENTOS_TABLE = "MOVIMIENTOS_CC";

function getEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta configurar la variable de entorno: ${name}`);
  }

  return value;
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

  if (Array.isArray(valor)) {
    const primerNumero = valor.find((item) => typeof item === "number");
    return typeof primerNumero === "number" ? primerNumero : 0;
  }

  if (typeof valor === "string") {
    const numero = Number(valor.replace(/[^0-9.-]/g, ""));
    return Number.isNaN(numero) ? 0 : numero;
  }

  return 0;
}

function limpiarTexto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function obtenerClienteIds(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];

  return valor.filter((item): item is string => typeof item === "string");
}

function armarMovimiento(record: AirtableRecord) {
  const fields = record.fields || {};
  const tipoMovimiento = normalizarTexto(fields.TIPO_MOVIMIENTO) as TipoMovimiento;
  const importe = normalizarNumero(fields.IMPORTE);
  const importeFirmado = normalizarNumero(fields.IMPORTE_FIRMADO);
  const importeCalculado = importeFirmado || (tipoMovimiento === "PAGO RECIBIDO" ? -importe : importe);

  return {
    id: record.id,
    clienteIds: obtenerClienteIds(fields.CLIENTE),
    fecha: normalizarTexto(fields.FECHA),
    tipoMovimiento,
    medioPago: normalizarTexto(fields.MEDIO_DE_PAGO) as MedioPago,
    comprobante: normalizarTexto(fields.COMPROBANTE),
    datosPago: normalizarTexto(fields.DATOS_PAGO),
    importe,
    importeFirmado: importeCalculado,
    observacion: normalizarTexto(fields.OBSERVACION),
    responsable: normalizarTexto(fields.RESPONSABLE),
  };
}

function getAirtableConfig() {
  return {
    token: getEnv("AIRTABLE_TOKEN"),
    baseId: getEnv("AIRTABLE_BASE_ID"),
    movimientosTable:
      process.env.AIRTABLE_MOVIMIENTOS_CC_TABLE_NAME || MOVIMIENTOS_TABLE,
  };
}

async function listarMovimientos(clienteId: string) {
  const { token, baseId, movimientosTable } = getAirtableConfig();
  const movimientos = [] as ReturnType<typeof armarMovimiento>[];
  let offset: string | undefined;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(movimientosTable)}`
    );

    url.searchParams.set("pageSize", "100");
    url.searchParams.set("sort[0][field]", "FECHA");
    url.searchParams.set("sort[0][direction]", "desc");

    if (offset) {
      url.searchParams.set("offset", offset);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = (await response.json()) as AirtableRecordsResponse;

    if (!response.ok) {
      console.error("Error listando movimientos:", data);
      throw new Error("No se pudieron leer los movimientos en Airtable");
    }

    movimientos.push(...(data.records || []).map(armarMovimiento));
    offset = data.offset;
  } while (offset);

  return movimientos.filter((movimiento) => movimiento.clienteIds.includes(clienteId));
}

function validarMovimiento(payload: MovimientoPayload) {
  if (!payload.clienteId?.trim()) return "Falta el cliente";
  if (!payload.fecha?.trim()) return "Falta la fecha";
  if (!payload.tipoMovimiento?.trim()) return "Falta el tipo de movimiento";

  if (
    payload.tipoMovimiento !== "REMITO EMITIDO" &&
    payload.tipoMovimiento !== "PAGO RECIBIDO"
  ) {
    return "Tipo de movimiento inválido";
  }

  if (!payload.importe || Number(payload.importe) <= 0) {
    return "El importe debe ser mayor a cero";
  }

  if (payload.tipoMovimiento === "PAGO RECIBIDO" && !payload.medioPago) {
    return "Falta el medio de pago";
  }

  return "";
}

async function crearMovimiento(payload: MovimientoPayload) {
  const { token, baseId, movimientosTable } = getAirtableConfig();

  const fields: Record<string, unknown> = {
    CLIENTE: [payload.clienteId],
    FECHA: payload.fecha,
    TIPO_MOVIMIENTO: payload.tipoMovimiento,
    IMPORTE: Number(payload.importe),
  };

  const comprobante = limpiarTexto(payload.comprobante);
  const medioPago = limpiarTexto(payload.medioPago);
  const datosPago = limpiarTexto(payload.datosPago);
  const observacion = limpiarTexto(payload.observacion);
  const responsable = limpiarTexto(payload.responsable);

  if (comprobante) fields.COMPROBANTE = comprobante;

  if (payload.tipoMovimiento === "PAGO RECIBIDO" && medioPago) {
    fields.MEDIO_DE_PAGO = medioPago;
  }

  if (payload.tipoMovimiento === "PAGO RECIBIDO" && datosPago) {
    fields.DATOS_PAGO = datosPago;
  }

  if (observacion) fields.OBSERVACION = observacion;
  if (responsable) fields.RESPONSABLE = responsable;

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
      records: [{ fields }],
      typecast: true,
    }),
  });

  const data = (await response.json()) as AirtableRecordsResponse;

  if (!response.ok) {
    console.error("Error creando movimiento:", data);
    throw new Error("No se pudo crear el movimiento en Airtable");
  }

  const record = data.records?.[0];

  if (!record) {
    throw new Error("Airtable no devolvió el movimiento creado");
  }

  return armarMovimiento(record);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const clienteId = String(req.query.clienteId || "").trim();

      if (!clienteId) {
        return res.status(400).json({
          error: "Falta el cliente",
        });
      }

      const movimientos = await listarMovimientos(clienteId);

      return res.status(200).json({
        ok: true,
        movimientos,
      });
    }

    if (req.method === "POST") {
      const payload = req.body as MovimientoPayload;
      const errorValidacion = validarMovimiento(payload);

      if (errorValidacion) {
        return res.status(400).json({
          error: errorValidacion,
        });
      }

      const movimiento = await crearMovimiento(payload);

      return res.status(200).json({
        ok: true,
        movimiento,
      });
    }

    return res.status(405).json({
      error: "Método no permitido",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Error interno en movimientos de cuenta corriente",
    });
  }
}
