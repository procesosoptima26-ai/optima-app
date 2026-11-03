import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirAutorizacion } from "../lib/autorizacion.js";
import { configTablaOperativa, productoDeEmpresa } from "../lib/alcance-operativo.js";

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

    // El catálogo de productos de inventario requiere sesión y módulo.
    const autorizado = await exigirAutorizacion(req, res, {
      modulos: ["INVENTARIO"],
      permiso: "inventario.ver",
    });
    if (!autorizado) return;

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

    const { token, baseId } = configTablaOperativa("AIRTABLE_BASE_ID");
    const tableName = getEnv("AIRTABLE_TABLE_NAME");
    const codeField = getEnv("AIRTABLE_CODE_FIELD");
    const nameField = getEnv("AIRTABLE_NAME_FIELD");

    const formula = `{${codeField}} = ${codigoNumero}`;

    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`
    );

    url.searchParams.set("filterByFormula", formula);
    url.searchParams.set("pageSize", "100");
    let record: AirtableRecord | undefined;
    let offset: string | undefined;
    do {
      if (offset) url.searchParams.set("offset", offset);
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("No se pudo verificar el catálogo de productos");
      const data = (await response.json()) as AirtableResponse & { offset?: string };
      record = data.records.find((producto) =>
        productoDeEmpresa(producto.fields, autorizado.empresaId));
      offset = data.offset;
    } while (!record && offset);

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