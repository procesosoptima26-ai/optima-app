import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({
  path: ".env.local",
});

type AirtableRecord = {
  id: string;
  fields: {
    [key: string]: unknown;
  };
};

type AirtableResponse = {
  records: AirtableRecord[];
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
    return valor
      .map((item) => normalizarTexto(item))
      .filter(Boolean)
      .join(", ");
  }

  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;

    if (typeof objeto.name === "string") return objeto.name.trim();
    if (typeof objeto.text === "string") return objeto.text.trim();
    if (typeof objeto.value === "string") return objeto.value.trim();

    return "";
  }

  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        error: "Método no permitido",
      });
    }

    const codigo = String(req.query.codigo || "").trim();

    if (!codigo) {
      return res.status(400).json({
        error: "Falta el código",
      });
    }

    const codigoNumero = Number(codigo);

    if (Number.isNaN(codigoNumero)) {
      return res.status(400).json({
        error: "El código debe ser numérico",
      });
    }

    const token = getEnv("AIRTABLE_TOKEN");
    const baseId = getEnv("AIRTABLE_BASE_ID");
    const tableName = getEnv("AIRTABLE_TABLE_NAME");
    const codeField = getEnv("AIRTABLE_CODE_FIELD");
    const nameField = getEnv("AIRTABLE_NAME_FIELD");

    const formula = `{${codeField}} = ${codigoNumero}`;

    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
    );

    url.searchParams.set("filterByFormula", formula);
    url.searchParams.set("maxRecords", "1");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = (await response.json()) as AirtableResponse;

    if (!response.ok) {
      console.error("Error Airtable:", data);

      return res.status(response.status).json({
        error: "Error consultando Airtable",
        detalle: data,
      });
    }

    const record = data.records[0];

    if (!record) {
      return res.status(200).json({
        encontrado: false,
        producto: null,
      });
    }

    return res.status(200).json({
      encontrado: true,
      producto: {
        id: record.id,
        codigo,
        nombre: normalizarTexto(record.fields[nameField]),
        producto: normalizarTexto(record.fields["PRODUCTO"]),
        marca: normalizarTexto(record.fields["MARCA"]),
        presentacion: normalizarTexto(record.fields["PRESENTACIÓN"]),
        especificacion: normalizarTexto(record.fields["ESPECIFICACIÓN"]),
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Error interno del servidor",
    });
  }
}