import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({
  path: ".env.local",
});

type AirtableRecord = {
  id: string;
  fields?: Record<string, unknown>;
};

type AirtableRecordsResponse = {
  records?: AirtableRecord[];
  offset?: string;
  error?: unknown;
};

type ClientePayload = {
  cliente: string;
  telefono?: string;
  cuit?: string;
  direccion?: string;
  observaciones?: string;
};

const CLIENTES_TABLE = "CLIENTES";

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

function armarCliente(record: AirtableRecord) {
  const fields = record.fields || {};
  const saldo = normalizarNumero(fields.SALDO_ACTUAL);

  return {
    id: record.id,
    cliente: normalizarTexto(fields.CLIENTE),
    telefono: normalizarTexto(fields["TELÉFONO"]),
    cuit: normalizarTexto(fields.CUIT),
    direccion: normalizarTexto(fields.DIRECCION),
    observaciones: normalizarTexto(fields.OBSERVACIONES),
    saldoActual: saldo,
    estado: normalizarTexto(fields.ESTADO) || obtenerEstadoDesdeSaldo(saldo),
  };
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
    clientesTable: process.env.AIRTABLE_CLIENTES_TABLE_NAME || CLIENTES_TABLE,
  };
}

async function listarClientes() {
  const { token, baseId, clientesTable } = getAirtableConfig();
  const clientes = [] as ReturnType<typeof armarCliente>[];
  let offset: string | undefined;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(clientesTable)}`
    );

    url.searchParams.set("pageSize", "100");
    url.searchParams.set("sort[0][field]", "CLIENTE");
    url.searchParams.set("sort[0][direction]", "asc");

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
      console.error("Error listando clientes:", data);
      throw new Error("No se pudieron leer los clientes en Airtable");
    }

    clientes.push(...(data.records || []).map(armarCliente));
    offset = data.offset;
  } while (offset);

  return clientes;
}

function validarCliente(payload: ClientePayload) {
  if (!payload.cliente?.trim()) return "Falta el nombre del cliente";
  return "";
}

async function crearCliente(payload: ClientePayload) {
  const { token, baseId, clientesTable } = getAirtableConfig();

  const fields: Record<string, unknown> = {
    CLIENTE: payload.cliente.trim(),
  };

  const telefono = limpiarTexto(payload.telefono);
  const cuit = limpiarTexto(payload.cuit);
  const direccion = limpiarTexto(payload.direccion);
  const observaciones = limpiarTexto(payload.observaciones);

  if (telefono) fields["TELÉFONO"] = telefono;
  if (cuit) fields.CUIT = cuit;
  if (direccion) fields.DIRECCION = direccion;
  if (observaciones) fields.OBSERVACIONES = observaciones;

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
      records: [{ fields }],
      typecast: true,
    }),
  });

  const data = (await response.json()) as AirtableRecordsResponse;

  if (!response.ok) {
    console.error("Error creando cliente:", data);
    throw new Error("No se pudo crear el cliente en Airtable");
  }

  const record = data.records?.[0];

  if (!record) {
    throw new Error("Airtable no devolvió el cliente creado");
  }

  return armarCliente(record);
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
      const payload = req.body as ClientePayload;
      const errorValidacion = validarCliente(payload);

      if (errorValidacion) {
        return res.status(400).json({
          error: errorValidacion,
        });
      }

      const cliente = await crearCliente(payload);

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
      error: "Error interno en clientes",
    });
  }
}
