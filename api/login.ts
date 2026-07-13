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

function normalizarModulos(valor: unknown): string[] {
  if (Array.isArray(valor)) {
    return valor
      .map((item) =>
        normalizarTexto(item)
          .toUpperCase()
          .replaceAll(" ", "_")
      )
      .filter(Boolean);
  }

  return normalizarTexto(valor)
    .split(",")
    .map((item) =>
      item
        .trim()
        .toUpperCase()
        .replaceAll(" ", "_")
    )
    .filter(Boolean);
}

function normalizarActivo(valor: unknown) {
  return (
    valor === true ||
    valor === 1 ||
    valor === "1" ||
    valor === "true"
  );
}

function escaparFormulaAirtable(valor: string) {
  return valor
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Método no permitido",
      });
    }

    const usuario = String(
      req.body?.usuario || ""
    ).trim();

    const password = String(
      req.body?.password || ""
    ).trim();

    if (!usuario || !password) {
      return res.status(400).json({
        ok: false,
        error: "Faltan usuario y contraseña",
      });
    }

    const token = getEnv("AIRTABLE_TOKEN");
    const baseId = getEnv("AIRTABLE_USERS_BASE_ID");
    const tableId = getEnv("AIRTABLE_USERS_TABLE_ID");

    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tableId
      )}`
    );

    url.searchParams.set(
      "filterByFormula",
      `LOWER({USUARIO}) = "${escaparFormulaAirtable(
        usuario.toLowerCase()
      )}"`
    );

    url.searchParams.set("maxRecords", "1");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data =
      (await response.json()) as AirtableResponse;

    if (!response.ok) {
      console.error(
        "Error consultando usuarios:",
        data
      );

      return res.status(response.status).json({
        ok: false,
        error: "No se pudo consultar el usuario",
        detalle: data,
      });
    }

    const record = data.records?.[0];

    if (!record) {
      return res.status(401).json({
        ok: false,
        error: "Usuario o contraseña incorrectos",
      });
    }

    const passwordAirtable = normalizarTexto(
      record.fields.PASSWORD
    );

    const usuarioActivo = normalizarActivo(
      record.fields.ACTIVO
    );

    if (!usuarioActivo) {
      return res.status(403).json({
        ok: false,
        error: "El usuario no está activo",
      });
    }

    if (passwordAirtable !== password) {
      return res.status(401).json({
        ok: false,
        error: "Usuario o contraseña incorrectos",
      });
    }

    const sucursal = normalizarTexto(
      record.fields.SUCURSAL
    ).toUpperCase();

    if (!sucursal) {
      return res.status(403).json({
        ok: false,
        error:
          "El usuario no tiene una sucursal asignada.",
      });
    }

    return res.status(200).json({
      ok: true,
      usuario: {
        usuario: normalizarTexto(
          record.fields.USUARIO
        ),
        nombre: normalizarTexto(
          record.fields.NOMBRE
        ),
        empresa: normalizarTexto(
          record.fields.EMPRESA
        ),
        rol: normalizarTexto(record.fields.ROL),
        sucursal,
        modulos: normalizarModulos(
          record.fields.MODULOS
        ),
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: "Error interno iniciando sesión",
    });
  }
}