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
  error?: unknown;
};

type ClientePayload = {
  cliente: string;
  telefono?: string;
  cuit?: string;
  direccion?: string;
  observaciones?: string;
};

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

  if (typeof valor === "string") {
    const numero = Number(valor);
    return Number.isNaN(numero) ? 0 : numero;
  }

  return 0;
}

function obtenerEstadoDesdeSaldo(saldo: number) {
  if (saldo > 0) return "DEBE";
  if (saldo < 0) return "A FAVOR";
  return "AL DIA";
}

function getAirtableConfig() {
  return {
    token: getEnv("AIRTABLE_TOKEN"),
    baseId: getEnv("AIRTABLE_BASE_ID"),
    clientesTable: process.env.AIRTABLE_CLIENTES_TABLE_NAME || "CLIENTES",
  };
}

function mapearCliente(record: AirtableRecord) {
  const saldo = normalizarNumero(record.fields.SALDO_ACTUAL);
  const estado = normalizarTexto(record.fields.ESTADO) || obtenerEstadoDesdeSaldo(saldo);

  return {
    id: record.id,
    cliente: normalizarTexto(record.fields.CLIENTE),
    telefono: normalizarTexto(record.fields["TELÉFONO"]),
    cuit: normalizarTexto(record.fields.CUIT),
    direccion: normalizarTexto(record.fields["DIRECCIÓN"]),
    observaciones: normalizarTexto(record.fields.OBSERVACIONES),
    saldoActual: saldo,
    estado,
  };
}

async function listarClientes() {
  const { token, baseId, clientesTable } = getAirtableConfig();

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(clientesTable)}`
  );

  url.searchParams.set("pageSize", "100");
  url.searchParams.set("sort[0][field]", "CLIENTE");
  url.searchParams.set("sort[0][direction]", "asc");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as AirtableResponse;

  if (!response.ok) {
    console.error("Error listando clientes:", data);
    throw new Error("No se pudieron obtener los clientes");
  }

  return (data.records || []).map(mapearCliente);
}

async function crearCliente(payload: ClientePayload) {
  const { token, baseId, clientesTable } = getAirtableConfig();

  const nombreCliente = payload.cliente?.trim();

  if (!nombreCliente) {
    throw new Error("El nombre del cliente es obligatorio");
  }

  const fields: Record<string, unknown> = {
    CLIENTE: nombreCliente,
  };

  if (payload.telefono?.trim()) fields["TELÉFONO"] = payload.telefono.trim();
  if (payload.cuit?.trim()) fields.CUIT = payload.cuit.trim();
  if (payload.direccion?.trim()) fields["DIRECCIÓN"] = payload.direccion.trim();
  if (payload.observaciones?.trim()) {
    fields.OBSERVACIONES = payload.observaciones.trim();
  }

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    clientesTable
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
    console.error("Error creando cliente:", data);
    throw new Error("No se pudo crear el cliente en Airtable");
  }

  const record = data.records?.[0];

  if (!record) {
    throw new Error("Airtable no devolvió el cliente creado");
  }

  return mapearCliente(record);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const clientes = await listarClientes();

      return res.status(200).json({
        ok: true,
        clientes,
      });
    }

    if (req.method === "POST") {
      const cliente = await crearCliente(req.body as ClientePayload);

      return res.status(200).json({
        ok: true,
        cliente,
      });
    }

    return res.status(405).json({
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
