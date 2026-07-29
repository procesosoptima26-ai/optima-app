import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({ path: ".env.local" });

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type AirtableResponse = {
  records?: AirtableRecord[];
  offset?: string;
  error?: unknown;
};

type RolTercero = "CLIENTE" | "PROVEEDOR" | "EMPLEADO" | "OTRO";

function getEnv(name: string): string {
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

  return "";
}

function normalizarLista(valor: unknown): string[] {
  if (!Array.isArray(valor)) {
    return [];
  }

  return valor
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizarBooleano(valor: unknown): boolean {
  return valor === true;
}

function getAirtableConfig() {
  return {
    token: getEnv("AIRTABLE_TOKEN"),
    baseId: getEnv("AIRTABLE_ADMIN_BASE_ID"),
    tercerosTable:
      process.env.AIRTABLE_ADMIN_TERCEROS_TABLE_NAME || "TERCEROS",
  };
}

function mapearTercero(record: AirtableRecord) {
  return {
    id: record.id,
    tercero: normalizarTexto(record.fields.TERCERO),
    codigoTercero: normalizarTexto(record.fields.CÓDIGO_TERCERO),
    roles: normalizarLista(record.fields.ROLES),
    tipoPersona: normalizarTexto(record.fields.TIPO_PERSONA),
    nombre: normalizarTexto(record.fields.NOMBRE),
    apellido: normalizarTexto(record.fields.APELLIDO),
    razonSocial: normalizarTexto(record.fields["RAZÓN_SOCIAL"]),
    nombreComercial: normalizarTexto(record.fields.NOMBRE_COMERCIAL),
    tipoDocumento: normalizarTexto(record.fields.TIPO_DOCUMENTO),
    numeroDocumento: normalizarTexto(record.fields["NÚMERO_DOCUMENTO"]),
    cuitCuil: normalizarTexto(record.fields.CUIT_CUIL),
    condicionIva: normalizarTexto(record.fields["CONDICIÓN_IVA"]),
    telefono: normalizarTexto(record.fields["TELÉFONO"]),
    email: normalizarTexto(record.fields.EMAIL),
    direccion: normalizarTexto(record.fields["DIRECCIÓN"]),
    localidad: normalizarTexto(record.fields.LOCALIDAD),
    provincia: normalizarTexto(record.fields.PROVINCIA),
    observaciones: normalizarTexto(record.fields.OBSERVACIONES),
    activo: normalizarBooleano(record.fields.ACTIVO),
  };
}

function obtenerRol(req: VercelRequest): RolTercero | undefined {
  const valor = typeof req.query.rol === "string"
    ? req.query.rol.trim().toUpperCase()
    : "";

  const rolesPermitidos: RolTercero[] = [
    "CLIENTE",
    "PROVEEDOR",
    "EMPLEADO",
    "OTRO",
  ];

  if (!valor) {
    return undefined;
  }

  if (!rolesPermitidos.includes(valor as RolTercero)) {
    throw new Error("El rol solicitado no es válido");
  }

  return valor as RolTercero;
}

async function listarTerceros(rol?: RolTercero) {
  const { token, baseId, tercerosTable } = getAirtableConfig();

  const terceros: ReturnType<typeof mapearTercero>[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tercerosTable
      )}`
    );

    url.searchParams.set("pageSize", "100");
    url.searchParams.set("sort[0][field]", "TERCERO");
    url.searchParams.set("sort[0][direction]", "asc");

    if (rol) {
      url.searchParams.set(
        "filterByFormula",
        `FIND("${rol}", ARRAYJOIN({ROLES}, ",")) > 0`
      );
    }

    if (offset) {
      url.searchParams.set("offset", offset);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = (await response.json()) as AirtableResponse;

    if (!response.ok) {
      console.error("Error listando terceros:", data);
      throw new Error("No se pudieron obtener los terceros");
    }

    terceros.push(...(data.records || []).map(mapearTercero));
    offset = data.offset;
  } while (offset);

  return terceros;
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

    const rol = obtenerRol(req);
    const terceros = await listarTerceros(rol);

    return res.status(200).json({
      ok: true,
      rol: rol || null,
      terceros,
    });
  } catch (error) {
    console.error("Error en administración/terceros:", error);

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Error interno del servidor",
    });
  }
}
