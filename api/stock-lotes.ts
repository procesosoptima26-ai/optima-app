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
  offset?: string;
  error?: unknown;
};

type LoteStock = {
  id: string;
  productoId: string;
  ubicacionId: string;
  ubicacionNombre: string;
  vencimiento: string | null;
  cantidad: number;
};

function getEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta configurar la variable de entorno: ${name}`);
  }

  return value;
}

function obtenerPrimerIdVinculado(valor: unknown): string | null {
  if (!Array.isArray(valor) || valor.length === 0) {
    return null;
  }

  const primerElemento = valor[0];

  if (typeof primerElemento === "string") {
    return primerElemento.trim() || null;
  }

  if (
    primerElemento &&
    typeof primerElemento === "object"
  ) {
    const objeto = primerElemento as Record<string, unknown>;

    if (typeof objeto.id === "string") {
      return objeto.id.trim() || null;
    }
  }

  return null;
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

function normalizarCantidad(valor: unknown): number {
  if (typeof valor === "number") {
    return Math.round(valor * 1000) / 1000;
  }

  const numero = Number(normalizarTexto(valor));

  if (Number.isNaN(numero)) {
    return 0;
  }

  return Math.round(numero * 1000) / 1000;
}

function normalizarFecha(valor: unknown): string | null {
  if (!valor) {
    return null;
  }

  const texto = normalizarTexto(valor);

  if (!texto) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto;
  }

  const fecha = new Date(texto);

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  const anio = fecha.getUTCFullYear();
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getUTCDate()).padStart(2, "0");

  return `${anio}-${mes}-${dia}`;
}

async function leerTodosLosRegistrosStock() {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv("AIRTABLE_STOCK_LOTES_TABLE_NAME");

  const registros: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tableName
      )}`
    );

    url.searchParams.set("pageSize", "100");

    url.searchParams.append("fields[]", "PRODUCTOS");
    url.searchParams.append("fields[]", "UBICACIÓN");
    url.searchParams.append("fields[]", "VENCIMIENTO");
    url.searchParams.append("fields[]", "CANTIDAD_ACTUAL");

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
      console.error("Error consultando STOCK_LOTES:", data);

      throw new Error("No se pudo consultar el stock por lotes");
    }

    registros.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return registros;
}

async function leerNombreUbicacion(ubicacionId: string) {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv("AIRTABLE_UBICACIONES_TABLE_NAME");

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}/${encodeURIComponent(ubicacionId)}`
  );

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return "";
  }

  const record = (await response.json()) as AirtableRecord;

  return (
    normalizarTexto(record.fields.NOMBRE) ||
    [
      normalizarTexto(record.fields.SUCURSAL),
      normalizarTexto(record.fields["TIPO_UBICACIÓN"]),
    ]
      .filter(Boolean)
      .join(" | ")
  );
}

function ordenarLotes(lotes: LoteStock[]) {
  return [...lotes].sort((a, b) => {
    if (a.vencimiento === null && b.vencimiento === null) {
      return 0;
    }

    if (a.vencimiento === null) {
      return 1;
    }

    if (b.vencimiento === null) {
      return -1;
    }

    return a.vencimiento.localeCompare(b.vencimiento);
  });
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

    const productoId = String(req.query.productoId || "").trim();
    const ubicacionId = String(req.query.ubicacionId || "").trim();
    const vencimiento = normalizarFecha(req.query.vencimiento);

    if (!productoId) {
      return res.status(400).json({
        ok: false,
        error: "Falta productoId",
      });
    }

    const registros = await leerTodosLosRegistrosStock();

    const nombresUbicaciones = new Map<string, string>();

    const lotesSinNombre = registros
      .map((record) => {
        const productoVinculadoId = obtenerPrimerIdVinculado(
          record.fields.PRODUCTOS
        );

        const ubicacionVinculadaId = obtenerPrimerIdVinculado(
          record.fields["UBICACIÓN"]
        );

        if (!productoVinculadoId || !ubicacionVinculadaId) {
          return null;
        }

        if (productoVinculadoId !== productoId) {
          return null;
        }

        if (
          ubicacionId &&
          ubicacionVinculadaId !== ubicacionId
        ) {
          return null;
        }

        return {
          id: record.id,
          productoId: productoVinculadoId,
          ubicacionId: ubicacionVinculadaId,
          ubicacionNombre: "",
          vencimiento: normalizarFecha(
            record.fields.VENCIMIENTO
          ),
          cantidad: normalizarCantidad(
            record.fields.CANTIDAD_ACTUAL
          ),
        };
      })
      .filter(
        (lote): lote is LoteStock => lote !== null
      );

    const ubicacionesNecesarias = [
      ...new Set(
        lotesSinNombre.map((lote) => lote.ubicacionId)
      ),
    ];

    await Promise.all(
      ubicacionesNecesarias.map(async (id) => {
        const nombre = await leerNombreUbicacion(id);
        nombresUbicaciones.set(id, nombre || "Ubicación");
      })
    );

    const lotes = ordenarLotes(
      lotesSinNombre.map((lote) => ({
        ...lote,
        ubicacionNombre:
          nombresUbicaciones.get(lote.ubicacionId) ||
          "Ubicación",
      }))
    );

    const lotesConStock = lotes.filter(
      (lote) => lote.cantidad > 0
    );

    const loteSeleccionado = vencimiento
      ? lotes.find(
          (lote) => lote.vencimiento === vencimiento
        ) || null
      : null;

    const loteAnterior =
      vencimiento && ubicacionId
        ? lotesConStock.find(
            (lote) =>
              lote.vencimiento !== null &&
              lote.vencimiento < vencimiento
          ) || null
        : null;

    const vencimientoMasProximo =
      lotesConStock.find(
        (lote) => lote.vencimiento !== null
      ) || null;

    const cantidadTotal = lotes.reduce(
      (total, lote) => total + lote.cantidad,
      0
    );

    return res.status(200).json({
      ok: true,
      productoId,
      ubicacionId: ubicacionId || null,
      vencimientoConsultado: vencimiento,
      cantidadTotal:
        Math.round(cantidadTotal * 1000) / 1000,
      cantidadVencimientoSeleccionado:
        loteSeleccionado?.cantidad || 0,
      loteSeleccionado,
      loteAnterior,
      vencimientoMasProximo,
      alertaFefo: Boolean(loteAnterior),
      lotes,
    });
  } catch (error) {
    console.error("Error interno en stock-lotes:", error);

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Error interno del servidor",
    });
  }
}
