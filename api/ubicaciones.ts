import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirAutorizacion } from "../lib/autorizacion.js";
import { configTablaOperativa, sucursalRealDeUbicacion, sucursalSolicitada } from "../lib/alcance-operativo.js";

dotenv.config({
  path: ".env.local",
});

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type AirtableResponse = {
  records?: AirtableRecord[];
  offset?: string;
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

function normalizarBooleano(valor: unknown): boolean {
  if (typeof valor === "boolean") {
    return valor;
  }

  if (typeof valor === "number") {
    return valor !== 0;
  }

  const texto = normalizarTexto(valor).toUpperCase();

  return texto === "TRUE" || texto === "SÍ" || texto === "SI";
}

function normalizarSucursal(valor: unknown) {
  return normalizarTexto(valor).toUpperCase();
}

async function leerTodasLasUbicaciones() {
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv("AIRTABLE_UBICACIONES_TABLE_NAME");

  const registros: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tableName
      )}`
    );

    url.searchParams.set("pageSize", "100");

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
      console.error("Error consultando UBICACIÓN:", data);

      throw new Error("No se pudieron consultar las ubicaciones");
    }

    registros.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return registros;
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

    const sucursalSolicitadaNombre = normalizarSucursal(req.query.sucursal);

    if (!sucursalSolicitadaNombre) {
      return res.status(400).json({
        ok: false,
        error: "Falta indicar la sucursal",
      });
    }

    // Antes de leer Airtable, validamos sesión, módulo y sucursal.
    const autorizado = await exigirAutorizacion(req, res, {
      modulos: ["MOVIMIENTOS"],
      permiso: "movimientos.ver",
      sucursal: sucursalSolicitadaNombre,
    });
    if (!autorizado) return;

    const sucursalCore = sucursalSolicitada(autorizado.contexto, sucursalSolicitadaNombre);
    if (!sucursalCore) return res.status(403).json({ ok: false, error: "Sucursal no autorizada" });
    const registros = await leerTodasLasUbicaciones();

    const ubicaciones = registros
      .map((record) => {
        const sucursal = normalizarSucursal(record.fields.SUCURSAL);
        const idSucursalCore = sucursalRealDeUbicacion(record.fields);
        if (idSucursalCore !== sucursalCore.id ||
            sucursal !== normalizarSucursal(sucursalCore.nombre)) return null;

        const tipoUbicacion = normalizarTexto(
          record.fields["TIPO_UBICACIÓN"]
        ).toUpperCase();

        const nombre =
          normalizarTexto(record.fields.NOMBRE).toUpperCase() ||
          [sucursal, tipoUbicacion].filter(Boolean).join(" | ");

        const activa =
          record.fields.ACTIVA === undefined
            ? true
            : normalizarBooleano(record.fields.ACTIVA);

        return {
          id: record.id,
          nombre,
          sucursal,
          tipoUbicacion,
          activa,
        };
      })
      .filter((ubicacion): ubicacion is NonNullable<typeof ubicacion> =>
        ubicacion !== null && ubicacion.activa &&
        ubicacion.sucursal === sucursalSolicitadaNombre &&
        Boolean(ubicacion.tipoUbicacion)
      )
      .sort((primera, segunda) =>
        primera.tipoUbicacion.localeCompare(
          segunda.tipoUbicacion,
          "es"
        )
      );

    return res.status(200).json({
      ok: true,
      sucursal: sucursalSolicitadaNombre,
      ubicaciones,
    });
  } catch (error) {
    console.error("Error interno en ubicaciones:", error);

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Error interno del servidor",
    });
  }
}
