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

function getEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta configurar la variable de entorno: ${name}`);
  }

  return value;
}

function normalizarTexto(valor: unknown): string {
  if (typeof valor === "string") {
    return valor.trim();
  }

  if (typeof valor === "number") {
    return String(valor);
  }

  if (Array.isArray(valor)) {
    return valor
      .map((item) => normalizarTexto(item))
      .filter(Boolean)
      .join(", ");
  }

  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;

    if (typeof objeto.name === "string") {
      return objeto.name.trim();
    }

    if (typeof objeto.text === "string") {
      return objeto.text.trim();
    }

    if (typeof objeto.value === "string") {
      return objeto.value.trim();
    }
  }

  return "";
}

function normalizarCodigo(codigo: string) {
  const codigoLimpio = codigo.trim().replace(/\s+/g, "");

  if (!/^\d+$/.test(codigoLimpio)) {
    return "";
  }

  return codigoLimpio.replace(/^0+(?=\d)/, "");
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        error: "Método no permitido",
      });
    }

    const codigoIngresado = String(req.query.codigo || "").trim();

    if (!codigoIngresado) {
      return res.status(400).json({
        ok: false,
        error: "Falta el código",
      });
    }

    const codigoNormalizado = normalizarCodigo(codigoIngresado);

    if (!codigoNormalizado) {
      return res.status(400).json({
        ok: false,
        error: "El código debe ser numérico",
      });
    }

    const token = getEnv("AIRTABLE_TOKEN");
    const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
    const tableName = getEnv(
      "AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME"
    );
    const codeField = getEnv("AIRTABLE_MOVIMIENTOS_CODE_FIELD");
    const nameField = getEnv("AIRTABLE_MOVIMIENTOS_NAME_FIELD");

    const codigoNumero = Number(codigoNormalizado);

    const formula = `{${codeField}} = ${codigoNumero}`;

    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tableName
      )}`
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
      console.error("Error consultando PRODUCTOS de MOVIMIENTOS:", data);

      return res.status(response.status).json({
        ok: false,
        error: "Error consultando productos en Airtable",
      });
    }

    const record = data.records?.[0];

    if (!record) {
      return res.status(200).json({
        ok: true,
        encontrado: false,
        producto: null,
      });
    }

    return res.status(200).json({
      ok: true,
      encontrado: true,
      producto: {
        id: record.id,
        codigo: codigoIngresado,
        codigoNormalizado,
        nombre: normalizarTexto(record.fields[nameField]),
        producto: normalizarTexto(record.fields.PRODUCTO),
        marca: normalizarTexto(record.fields.MARCA),
        presentacion: normalizarTexto(
          record.fields["PRESENTACIÓN"]
        ),
        especificacion: normalizarTexto(
          record.fields["ESPECIFICACIÓN"]
        ),
      },
    });
  } catch (error) {
    console.error("Error interno en productos-movimientos:", error);

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Error interno del servidor",
    });
  }
}
