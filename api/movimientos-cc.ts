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
    baseId: getEnv("AIRTABLE_BASE_ID"),
    movimientosTable:
      process.env.AIRTABLE_MOVIMIENTOS_CC_TABLE_NAME || "MOVIMIENTOS_CC",
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

function obtenerPrimerClienteId(valor: unknown): string {
  if (Array.isArray(valor) && typeof valor[0] === "string") {
    return valor[0];
  }

  return "";
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
    clienteId: obtenerPrimerClienteId(record.fields.CLIENTES),
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
    .filter((movimiento) => movimiento.clienteId === clienteId);
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

  if (!importeNumero || importeNumero <= 0) {
    throw new Error("El importe debe ser mayor a cero");
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
  }

  if (payload.datosPago?.trim()) {
    fields.DATOS_PAGO = payload.datosPago.trim();
  }

  if (payload.observacion?.trim()) {
    fields["OBSERVACIÓN"] = payload.observacion.trim();
  }

  if (payload.responsable?.trim()) {
    fields.RESPONSABLE = payload.responsable.trim();
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
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
      const movimiento = await crearMovimiento(req.body as MovimientoPayload);

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
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Error interno del servidor",
    });
  }
}
