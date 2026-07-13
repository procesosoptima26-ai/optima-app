type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (codigo: number) => VercelResponse;
  json: (contenido: unknown) => void;
  setHeader: (nombre: string, valor: string) => void;
};

type ErrorMovimientoPayload = {
  usuario?: string;
  sucursal?: string;
  productoId?: string;
  codigo?: string;
  ubicacionId?: string;
  vencimiento?: string | null;
  cantidadSolicitada?: number;
  cantidadDisponible?: number;
  tipoError?: string;
  detalle?: string;
};

type AirtableResponse = {
  id?: string;
  error?: {
    type?: string;
    message?: string;
  };
};

function obtenerVariable(nombre: string) {
  const valor = process.env[nombre]?.trim();

  if (!valor) {
    throw new Error(`Falta configurar ${nombre}`);
  }

  return valor;
}

function limpiarTexto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function normalizarNumero(valor: unknown) {
  const numero = Number(valor);

  return Number.isFinite(numero) ? numero : 0;
}

function validarPayload(payload: ErrorMovimientoPayload) {
  if (!limpiarTexto(payload.usuario)) {
    return "Falta el usuario";
  }

  if (!limpiarTexto(payload.sucursal)) {
    return "Falta la sucursal";
  }

  if (!limpiarTexto(payload.productoId)) {
    return "Falta el producto";
  }

  if (!limpiarTexto(payload.ubicacionId)) {
    return "Falta la ubicación";
  }

  if (!limpiarTexto(payload.tipoError)) {
    return "Falta el tipo de error";
  }

  return "";
}

async function registrarError(payload: ErrorMovimientoPayload) {
  const token = obtenerVariable("AIRTABLE_TOKEN");
  const baseId = obtenerVariable("AIRTABLE_MOVIMIENTOS_BASE_ID");

  const tabla =
    process.env.AIRTABLE_ERRORES_MOVIMIENTOS_TABLE_NAME?.trim() ||
    "ERRORES_MOVIMIENTOS";

  const fields: Record<string, unknown> = {
    USUARIO: limpiarTexto(payload.usuario),
    SUCURSAL: limpiarTexto(payload.sucursal),
    PRODUCTO: [limpiarTexto(payload.productoId)],
    CÓDIGO: limpiarTexto(payload.codigo),
    UBICACIÓN: [limpiarTexto(payload.ubicacionId)],
    CANTIDAD_SOLICITADA: normalizarNumero(
      payload.cantidadSolicitada
    ),
    CANTIDAD_DISPONIBLE: normalizarNumero(
      payload.cantidadDisponible
    ),
    TIPO_ERROR: limpiarTexto(payload.tipoError),
    DETALLE: limpiarTexto(payload.detalle),
    REVISADO: false,
  };

  if (payload.vencimiento) {
    fields.VENCIMIENTO = payload.vencimiento;
  }

  const url =
    `https://api.airtable.com/v0/${baseId}/` +
    encodeURIComponent(tabla);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields,
      typecast: true,
    }),
  });

  const data = (await response.json()) as AirtableResponse;

  if (!response.ok) {
    console.error("Error registrando alerta en Airtable:", data);

    throw new Error(
      data.error?.message ||
        "No se pudo registrar el error de movimiento"
    );
  }

  return data.id || "";
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
    return;
  }

  try {
    const payload = (req.body || {}) as ErrorMovimientoPayload;

    const errorValidacion = validarPayload(payload);

    if (errorValidacion) {
      res.status(400).json({
        ok: false,
        error: errorValidacion,
      });
      return;
    }

    const id = await registrarError(payload);

    res.status(200).json({
      ok: true,
      id,
    });
  } catch (error) {
    console.error("Error en errores-movimientos:", error);

    res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No se pudo registrar el error",
    });
  }
}
