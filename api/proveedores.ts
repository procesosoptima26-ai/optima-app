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

type ProveedorPayload = {
  proveedor: string;
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
    baseId: getEnv("AIRTABLE_CC_BASE_ID"),
    proveedoresTable:
      process.env.AIRTABLE_PROVEEDORES_TABLE_NAME || "PROVEEDORES",
  };
}

function mapearProveedor(record: AirtableRecord) {
  const saldo = normalizarNumero(record.fields.SALDO_ACTUAL);
  const estado = normalizarTexto(record.fields.ESTADO) || obtenerEstadoDesdeSaldo(saldo);

  return {
    id: record.id,
    proveedor: normalizarTexto(record.fields.PROVEEDOR),
    telefono: normalizarTexto(record.fields["TELÉFONO"]),
    cuit: normalizarTexto(record.fields.CUIT),
    direccion: normalizarTexto(record.fields["DIRECCIÓN"]),
    observaciones: normalizarTexto(record.fields.OBSERVACIONES),
    saldoActual: saldo,
    estado,
  };
}

async function listarProveedores() {
  const { token, baseId, proveedoresTable } = getAirtableConfig();

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(proveedoresTable)}`
  );

  url.searchParams.set("pageSize", "100");
  url.searchParams.set("sort[0][field]", "PROVEEDOR");
  url.searchParams.set("sort[0][direction]", "asc");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as AirtableResponse;

  if (!response.ok) {
    console.error("Error listando proveedores:", data);
    throw new Error("No se pudieron obtener los proveedores");
  }

  return (data.records || []).map(mapearProveedor);
}

async function crearProveedor(payload: ProveedorPayload) {
  const { token, baseId, proveedoresTable } = getAirtableConfig();

  const nombreProveedor = payload.proveedor?.trim();

  if (!nombreProveedor) {
    throw new Error("El nombre del proveedor es obligatorio");
  }

  const fields: Record<string, unknown> = {
    PROVEEDOR: nombreProveedor,
  };

  if (payload.telefono?.trim()) fields["TELÉFONO"] = payload.telefono.trim();
  if (payload.cuit?.trim()) fields.CUIT = payload.cuit.trim();
  if (payload.direccion?.trim()) fields["DIRECCIÓN"] = payload.direccion.trim();
  if (payload.observaciones?.trim()) {
    fields.OBSERVACIONES = payload.observaciones.trim();
  }

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
    proveedoresTable
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
    console.error("Error creando proveedor:", data);
    throw new Error("No se pudo crear el proveedor en Airtable");
  }

  const record = data.records?.[0];

  if (!record) {
    throw new Error("Airtable no devolvió el proveedor creado");
  }

  return mapearProveedor(record);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const proveedores = await listarProveedores();

      return res.status(200).json({
        ok: true,
        proveedores,
      });
    }

    if (req.method === "POST") {
      const proveedor = await crearProveedor(req.body as ProveedorPayload);

      return res.status(200).json({
        ok: true,
        proveedor,
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