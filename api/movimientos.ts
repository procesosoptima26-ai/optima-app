import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({
  path: ".env.local",
});

type AirtableRecord = {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
};

type AirtableResponse = {
  records?: AirtableRecord[];
  offset?: string;
  error?: unknown;
};

type Ubicacion = {
  id: string;
  nombre: string;
  sucursal: string;
};

type MovimientoPayload = {
  productoId: string;
  tipoMovimiento: string;
  motivo: string;
  ubicacionOrigenId?: string;
  ubicacionDestinoId?: string;
  vencimiento?: string | null;
  cantidad: number | string;
  responsable?: string;
  observacion?: string;
  requiereRevision?: boolean;
};

type GuardarMovimientosPayload = {
  sucursal: string;
  movimientos: MovimientoPayload[];
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

function normalizarSucursal(valor: unknown) {
  return normalizarTexto(valor).toUpperCase();
}

function normalizarOpcion(valor: unknown) {
  return normalizarTexto(valor).toUpperCase();
}

function normalizarCantidad(valor: unknown) {
  const numero = Number(valor);

  if (!Number.isFinite(numero)) {
    return 0;
  }

  return Math.round(numero * 1000) / 1000;
}

function normalizarFecha(valor: unknown): string | null {
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

function obtenerPrimerIdVinculado(valor: unknown): string | null {
  if (!Array.isArray(valor) || valor.length === 0) {
    return null;
  }

  const primerElemento = valor[0];

  if (typeof primerElemento === "string") {
    return primerElemento.trim() || null;
  }

  if (primerElemento && typeof primerElemento === "object") {
    const objeto = primerElemento as Record<string, unknown>;

    if (typeof objeto.id === "string") {
      return objeto.id.trim() || null;
    }
  }

  return null;
}

function partirEnGrupos<T>(items: T[], cantidad: number) {
  const grupos: T[][] = [];

  for (let indice = 0; indice < items.length; indice += cantidad) {
    grupos.push(items.slice(indice, indice + cantidad));
  }

  return grupos;
}

async function leerUbicaciones(): Promise<Ubicacion[]> {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
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
      console.error("Error consultando ubicaciones:", data);
      throw new Error("No se pudieron validar las ubicaciones");
    }

    registros.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return registros.map((record) => {
    const sucursal = normalizarSucursal(record.fields.SUCURSAL);

    const tipoUbicacion = normalizarOpcion(
      record.fields["TIPO_UBICACIÓN"]
    );

    const nombre =
      normalizarTexto(record.fields.NOMBRE).toUpperCase() ||
      [sucursal, tipoUbicacion].filter(Boolean).join(" | ");

    return {
      id: record.id,
      nombre,
      sucursal,
    };
  });
}

async function validarProductoExiste(productoId: string) {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv(
    "AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME"
  );

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}/${encodeURIComponent(productoId)}`
  );

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.ok;
}

function validarMovimiento(
  movimiento: MovimientoPayload,
  sucursal: string,
  ubicaciones: Ubicacion[]
) {
  const productoId = normalizarTexto(movimiento.productoId);
  const tipo = normalizarOpcion(movimiento.tipoMovimiento);
  const motivo = normalizarOpcion(movimiento.motivo);
  const cantidad = normalizarCantidad(movimiento.cantidad);

  const origenId = normalizarTexto(
    movimiento.ubicacionOrigenId
  );

  const destinoId = normalizarTexto(
    movimiento.ubicacionDestinoId
  );

  if (!productoId) {
    return "Falta el producto.";
  }

  if (!tipo) {
    return "Falta el tipo de movimiento.";
  }

  if (!motivo) {
    return "Falta el motivo.";
  }

  if (cantidad <= 0) {
    return "La cantidad debe ser mayor que cero.";
  }

  const ubicacionOrigen = origenId
    ? ubicaciones.find((ubicacion) => ubicacion.id === origenId)
    : null;

  const ubicacionDestino = destinoId
    ? ubicaciones.find((ubicacion) => ubicacion.id === destinoId)
    : null;

  if (origenId && !ubicacionOrigen) {
    return "La ubicación de origen no existe.";
  }

  if (destinoId && !ubicacionDestino) {
    return "La ubicación de destino no existe.";
  }

  if (
    ubicacionOrigen &&
    ubicacionOrigen.sucursal !== sucursal
  ) {
    return "La ubicación de origen no pertenece a la sucursal del usuario.";
  }

  if (
    ubicacionDestino &&
    ubicacionDestino.sucursal !== sucursal
  ) {
    return "La ubicación de destino no pertenece a la sucursal del usuario.";
  }

  if (origenId && destinoId && origenId === destinoId) {
    return "La ubicación de origen y destino no pueden ser iguales.";
  }

  if (motivo === "REPOSICIÓN") {
    if (!origenId || !destinoId) {
      return "La reposición necesita ubicación de origen y destino.";
    }
  } else if (motivo === "VUELVE A DEPÓSITO") {
    if (!origenId || !destinoId) {
      return "Vuelve a depósito necesita origen y destino.";
    }
  } else if (
    tipo === "INGRESO" ||
    tipo === "AJUSTE +" ||
    tipo === "AJUSTE POSITIVO"
  ) {
    if (!destinoId) {
      return "Este movimiento necesita una ubicación de destino.";
    }
  } else if (
    tipo === "EGRESO" ||
    tipo === "AJUSTE -" ||
    tipo === "AJUSTE NEGATIVO"
  ) {
    if (!origenId) {
      return "Este movimiento necesita una ubicación de origen.";
    }
  }

  return "";
}

function armarCamposMovimiento(
  movimiento: MovimientoPayload
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    PRODUCTO: [
      normalizarTexto(movimiento.productoId),
    ],
    TIPO_MOVIMIENTO: normalizarOpcion(
      movimiento.tipoMovimiento
    ),
    MOTIVO: normalizarOpcion(movimiento.motivo),
    CANTIDAD: normalizarCantidad(movimiento.cantidad),
    PROCESADO: false,
    ERROR_MOTOR: "",
    "REQUIERE_REVISION": Boolean(movimiento.requiereRevision),
  };

  const ubicacionOrigenId = normalizarTexto(
    movimiento.ubicacionOrigenId
  );

  const ubicacionDestinoId = normalizarTexto(
    movimiento.ubicacionDestinoId
  );

  const vencimiento = normalizarFecha(
    movimiento.vencimiento
  );

  const responsable = normalizarTexto(
    movimiento.responsable
  );

  const observacion = normalizarTexto(
    movimiento.observacion
  );

  if (ubicacionOrigenId) {
    fields["UBICACIÓN ORIGEN"] = [
      ubicacionOrigenId,
    ];
  }

  if (ubicacionDestinoId) {
    fields["UBICACIÓN DESTINO"] = [
      ubicacionDestinoId,
    ];
  }

  if (vencimiento) {
    fields.VENCIMIENTO = vencimiento;
  }

  if (responsable) {
    fields.RESPONSABLE = responsable;
  }

  if (observacion) {
    fields["OBSERVACIÓN"] = observacion;
  }

  return fields;
}

async function crearMovimientos(
  movimientos: MovimientoPayload[]
) {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv(
    "AIRTABLE_MOVIMIENTOS_TABLE_NAME"
  );

  const registrosCreados: AirtableRecord[] = [];

  const records = movimientos.map((movimiento) => ({
    fields: armarCamposMovimiento(movimiento),
  }));

  const grupos = partirEnGrupos(records, 10);

  for (const grupo of grupos) {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tableName
      )}`
    );

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        records: grupo,
        typecast: true,
      }),
    });

    const data = (await response.json()) as AirtableResponse;

    if (!response.ok) {
      console.error("Error creando movimientos:", data);

      const detalle =
        data &&
        typeof data === "object" &&
        "error" in data
          ? JSON.stringify(data.error)
          : JSON.stringify(data);

      throw new Error(
        `Airtable rechazó uno o más movimientos. Detalle: ${detalle}`
      );
    }

    registrosCreados.push(...(data.records || []));
  }

  return registrosCreados;
}

async function leerMovimientosPorIds(ids: string[]) {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv(
    "AIRTABLE_MOVIMIENTOS_TABLE_NAME"
  );

  const resultados: AirtableRecord[] = [];

  for (const id of ids) {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tableName
      )}/${encodeURIComponent(id)}`
    );

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      continue;
    }

    const record = (await response.json()) as AirtableRecord;
    resultados.push(record);
  }

  return resultados;
}

async function leerMovimientosRecientes(
  sucursal: string,
  limite: number
) {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv(
    "AIRTABLE_MOVIMIENTOS_TABLE_NAME"
  );

  const ubicaciones = await leerUbicaciones();

  const ubicacionesPermitidas = new Set(
    ubicaciones
      .filter((ubicacion) => ubicacion.sucursal === sucursal)
      .map((ubicacion) => ubicacion.id)
  );

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}`
  );

  url.searchParams.set("pageSize", "100");
  url.searchParams.append(
    "sort[0][field]",
    "FECHA_HORA"
  );
  url.searchParams.append(
    "sort[0][direction]",
    "desc"
  );

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as AirtableResponse;

  if (!response.ok) {
    console.error("Error leyendo movimientos recientes:", data);
    throw new Error(
      "No se pudieron consultar los movimientos recientes"
    );
  }

  return (data.records || [])
    .filter((record) => {
      const origenId = obtenerPrimerIdVinculado(
        record.fields["UBICACIÓN ORIGEN"]
      );

      const destinoId = obtenerPrimerIdVinculado(
        record.fields["UBICACIÓN DESTINO"]
      );

      return (
        (origenId && ubicacionesPermitidas.has(origenId)) ||
        (destinoId && ubicacionesPermitidas.has(destinoId))
      );
    })
    .slice(0, limite);
}

async function leerAjustesPendientes(
  sucursal: string,
  limite: number
) {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv(
    "AIRTABLE_MOVIMIENTOS_TABLE_NAME"
  );

  const ubicaciones = await leerUbicaciones();

  const ubicacionesPermitidas = new Set(
    ubicaciones
      .filter((ubicacion) => ubicacion.sucursal === sucursal)
      .map((ubicacion) => ubicacion.id)
  );

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}`
  );

  url.searchParams.set("pageSize", "100");
  url.searchParams.set(
    "filterByFormula",
    'AND({REQUIERE_REVISION}=1,{REVISADO}=0)'
  );
  url.searchParams.append(
    "sort[0][field]",
    "FECHA_HORA"
  );
  url.searchParams.append(
    "sort[0][direction]",
    "desc"
  );

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json()) as AirtableResponse;

  if (!response.ok) {
    console.error("Error leyendo ajustes pendientes:", data);
    throw new Error(
      "No se pudieron consultar los ajustes pendientes"
    );
  }

  return (data.records || [])
    .filter((record) => {
      const origenId = obtenerPrimerIdVinculado(
        record.fields["UBICACIÓN ORIGEN"]
      );

      const destinoId = obtenerPrimerIdVinculado(
        record.fields["UBICACIÓN DESTINO"]
      );

      return (
        (origenId && ubicacionesPermitidas.has(origenId)) ||
        (destinoId && ubicacionesPermitidas.has(destinoId))
      );
    })
    .slice(0, limite);
}

async function marcarMovimientoComoRevisado(id: string) {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv(
    "AIRTABLE_MOVIMIENTOS_TABLE_NAME"
  );

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tableName
    )}/${encodeURIComponent(id)}`
  );

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        REVISADO: true,
      },
      typecast: true,
    }),
  });

  const data = (await response.json()) as AirtableRecord & {
    error?: unknown;
  };

  if (!response.ok) {
    console.error("Error marcando movimiento como revisado:", data);
    throw new Error(
      "No se pudo marcar el ajuste como revisado"
    );
  }

  return data;
}

function transformarMovimiento(record: AirtableRecord) {
  return {
    id: record.id,
    fechaHora:
      normalizarTexto(record.fields.FECHA_HORA) ||
      record.createdTime ||
      "",
    productoId: obtenerPrimerIdVinculado(
      record.fields.PRODUCTO
    ),
    nombreProducto: normalizarTexto(
      record.fields["NOMBRE_MÁSTER"] ??
        record.fields["NOMBRE MASTER"]
    ),
    tipoMovimiento: normalizarOpcion(
      record.fields.TIPO_MOVIMIENTO
    ),
    motivo: normalizarOpcion(record.fields.MOTIVO),
    ubicacionOrigenId: obtenerPrimerIdVinculado(
      record.fields["UBICACIÓN ORIGEN"]
    ),
    ubicacionDestinoId: obtenerPrimerIdVinculado(
      record.fields["UBICACIÓN DESTINO"]
    ),
    vencimiento: normalizarFecha(
      record.fields.VENCIMIENTO
    ),
    cantidad: normalizarCantidad(
      record.fields.CANTIDAD
    ),
    responsable: normalizarTexto(
      record.fields.RESPONSABLE
    ),
    observacion: normalizarTexto(
      record.fields["OBSERVACIÓN"]
    ),
    procesado: Boolean(record.fields.PROCESADO),
    errorMotor: normalizarTexto(
      record.fields.ERROR_MOTOR
    ),
    requiereRevision: Boolean(
      record.fields["REQUIERE_REVISION"]
    ),
    revisado: Boolean(record.fields.REVISADO),
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    if (req.method === "POST") {
      const payload = req.body as GuardarMovimientosPayload;

      const sucursal = normalizarSucursal(
        payload?.sucursal
      );

      const movimientos = Array.isArray(payload?.movimientos)
        ? payload.movimientos
        : [];

      if (!sucursal) {
        return res.status(400).json({
          ok: false,
          error: "Falta la sucursal del usuario.",
        });
      }

      if (movimientos.length === 0) {
        return res.status(400).json({
          ok: false,
          error: "No hay movimientos para guardar.",
        });
      }

      if (movimientos.length > 100) {
        return res.status(400).json({
          ok: false,
          error:
            "No se pueden guardar más de 100 movimientos juntos.",
        });
      }

      const ubicaciones = await leerUbicaciones();

      for (
        let indice = 0;
        indice < movimientos.length;
        indice += 1
      ) {
        const movimiento = movimientos[indice];

        const errorValidacion = validarMovimiento(
          movimiento,
          sucursal,
          ubicaciones
        );

        if (errorValidacion) {
          return res.status(400).json({
            ok: false,
            error: `Movimiento ${indice + 1}: ${errorValidacion}`,
          });
        }
      }

      const productosUnicos = [
        ...new Set(
          movimientos.map((movimiento) =>
            normalizarTexto(movimiento.productoId)
          )
        ),
      ];

      for (const productoId of productosUnicos) {
        const existe = await validarProductoExiste(productoId);

        if (!existe) {
          return res.status(400).json({
            ok: false,
            error:
              "Uno de los productos seleccionados no existe en la base de prueba.",
          });
        }
      }

      const creados = await crearMovimientos(movimientos);

      return res.status(200).json({
        ok: true,
        cantidad: creados.length,
        ids: creados.map((record) => record.id),
      });
    }

    if (req.method === "PATCH") {
      const id = normalizarTexto(req.body?.id);

      if (!id || !id.startsWith("rec")) {
        return res.status(400).json({
          ok: false,
          error: "Falta un ID de movimiento válido.",
        });
      }

      const actualizado = await marcarMovimientoComoRevisado(id);

      return res.status(200).json({
        ok: true,
        movimiento: transformarMovimiento(actualizado),
      });
    }

    if (req.method === "GET") {
      const ajustesPendientes =
        normalizarTexto(req.query.ajustesPendientes).toLowerCase() ===
        "true";

      if (ajustesPendientes) {
        const sucursal = normalizarSucursal(
          req.query.sucursal
        );

        if (!sucursal) {
          return res.status(400).json({
            ok: false,
            error:
              "Falta indicar la sucursal para consultar ajustes pendientes.",
          });
        }

        const limiteSolicitado = Number(req.query.limite);
        const limite =
          Number.isFinite(limiteSolicitado) &&
          limiteSolicitado > 0
            ? Math.min(Math.floor(limiteSolicitado), 50)
            : 50;

        const pendientes = await leerAjustesPendientes(
          sucursal,
          limite
        );

        return res.status(200).json({
          ok: true,
          sucursal,
          cantidad: pendientes.length,
          movimientos: pendientes.map(transformarMovimiento),
        });
      }

      const idsTexto = normalizarTexto(req.query.ids);

      if (idsTexto) {
        const ids = idsTexto
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.startsWith("rec"))
          .slice(0, 100);

        const registros = await leerMovimientosPorIds(ids);

        return res.status(200).json({
          ok: true,
          movimientos: registros.map(transformarMovimiento),
        });
      }

      const sucursal = normalizarSucursal(
        req.query.sucursal
      );

      if (!sucursal) {
        return res.status(400).json({
          ok: false,
          error:
            "Falta indicar sucursal o IDs de movimientos.",
        });
      }

      const limiteSolicitado = Number(req.query.limite);
      const limite =
        Number.isFinite(limiteSolicitado) &&
        limiteSolicitado > 0
          ? Math.min(Math.floor(limiteSolicitado), 50)
          : 20;

      const recientes = await leerMovimientosRecientes(
        sucursal,
        limite
      );

      return res.status(200).json({
        ok: true,
        sucursal,
        movimientos: recientes.map(transformarMovimiento),
      });
    }

    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
  } catch (error) {
    console.error("Error interno en movimientos:", error);

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Error interno del servidor",
    });
  }
}
