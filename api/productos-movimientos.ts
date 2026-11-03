import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirAutorizacion } from "../lib/autorizacion.js";
import { configTablaOperativa, productoDeEmpresa } from "../lib/alcance-operativo.js";

dotenv.config({
  path: ".env.local",
});

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type AirtableResponse = {
  records?: AirtableRecord[];
  error?: {
    type?: string;
    message?: string;
  };
};

type CrearProductoPayload = {
  codigo?: string;
  producto?: string;
  marca?: string;
  presentacion?: string;
  especificacion?: string;
};

function getEnv(name: string) {
  const value = process.env[name]?.trim();

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

function transformarProducto(
  record: AirtableRecord,
  codigoIngresado: string,
  codigoNormalizado: string,
  nameField: string
) {
  return {
    id: record.id,
    codigo: codigoIngresado,
    codigoNormalizado,
    nombre:
      normalizarTexto(record.fields[nameField]) ||
      normalizarTexto(record.fields["NOMBRE MASTER"]) ||
      normalizarTexto(record.fields["NOMBRE_MÁSTER"]) ||
      normalizarTexto(record.fields.PRODUCTO),
    producto: normalizarTexto(record.fields.PRODUCTO),
    marca: normalizarTexto(record.fields.MARCA),
    presentacion: normalizarTexto(record.fields["PRESENTACIÓN"]),
    especificacion: normalizarTexto(record.fields["ESPECIFICACIÓN"]),
  };
}

async function buscarProductoPorCodigo(
  codigoIngresado: string,
  empresaId: string,
): Promise<{
  record: AirtableRecord | null;
  productoAjeno: boolean;
  codigoNormalizado: string;
  nameField: string;
}> {
  const codigoNormalizado = normalizarCodigo(codigoIngresado);

  if (!codigoNormalizado) {
    throw new Error("El código debe ser numérico");
  }

  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv("AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME");
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
  url.searchParams.set("pageSize", "100");
  let record: AirtableRecord | null = null;
  let productoAjeno = false;
  let offset: string | undefined;
  do {
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("No se pudo consultar el catálogo de productos");
    const data = (await response.json()) as AirtableResponse & { offset?: string };
    for (const candidato of data.records || []) {
      if (productoDeEmpresa(candidato.fields, empresaId)) { record = candidato; break; }
      productoAjeno = true;
    }
    offset = data.offset;
  } while (!record && offset);

  return { record, productoAjeno, codigoNormalizado, nameField };
}

async function crearProducto(payload: CrearProductoPayload, empresaId: string) {
  const codigoIngresado = normalizarTexto(payload.codigo);
  const producto = normalizarTexto(payload.producto);
  const marca = normalizarTexto(payload.marca);
  const presentacion = normalizarTexto(payload.presentacion);
  const especificacion = normalizarTexto(payload.especificacion);

  if (!codigoIngresado) {
    throw new Error("Falta el código");
  }

  if (!producto) {
    throw new Error("Ingresá el nombre del producto");
  }

  const busqueda = await buscarProductoPorCodigo(codigoIngresado, empresaId);

  if (busqueda.record) {
    return {
      creado: false,
      producto: transformarProducto(
        busqueda.record,
        codigoIngresado,
        busqueda.codigoNormalizado,
        busqueda.nameField
      ),
    };
  }

  if (busqueda.productoAjeno) {
    // No duplicar ficha compartida ni vincular otro cliente sin un flujo explícito.
    return { creado: false, necesitaVinculacion: true, producto: null };
  }

  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv("AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME");
  const codeField = getEnv("AIRTABLE_MOVIMIENTOS_CODE_FIELD");

  const fields: Record<string, unknown> = {
    [codeField]: Number(busqueda.codigoNormalizado),
    PRODUCTO: producto,
    EMPRESA: [empresaId],
  };

  if (marca) {
    fields.MARCA = marca;
  }

  if (presentacion) {
    fields["PRESENTACIÓN"] = presentacion;
  }

  if (especificacion) {
    fields["ESPECIFICACIÓN"] = especificacion;
  }

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
      fields,
      typecast: true,
    }),
  });

  const data = (await response.json()) as AirtableRecord & AirtableResponse;

  if (!response.ok || !data.id) {
    console.error("Error creando PRODUCTO desde MOVIMIENTOS:", data);
    throw new Error(
      data.error?.message || "No se pudo crear el producto"
    );
  }

  return {
    creado: true,
    producto: transformarProducto(
      data,
      codigoIngresado,
      busqueda.codigoNormalizado,
      busqueda.nameField
    ),
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    // Autorizar ANTES de consultar o crear productos de movimientos.
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Método no permitido",
      });
    }

    const autorizado = await exigirAutorizacion(req, res, {
      modulos: ["MOVIMIENTOS"],
      permiso: req.method === "GET" ? "movimientos.ver" : "movimientos.crear",
    });
    if (!autorizado) return;

    if (req.method === "GET") {
      const codigoIngresado = String(req.query.codigo || "").trim();

      if (!codigoIngresado) {
        return res.status(400).json({
          ok: false,
          error: "Falta el código",
        });
      }

      const busqueda = await buscarProductoPorCodigo(codigoIngresado, autorizado.empresaId);

      if (!busqueda.record) {
        return res.status(200).json({
          ok: true,
          encontrado: false,
          producto: null,
        });
      }

      return res.status(200).json({
        ok: true,
        encontrado: true,
        producto: transformarProducto(
          busqueda.record,
          codigoIngresado,
          busqueda.codigoNormalizado,
          busqueda.nameField
        ),
      });
    }

    if (req.method === "POST") {
      const resultado = await crearProducto(
        (req.body || {}) as CrearProductoPayload, autorizado.empresaId,
      );
      if ("necesitaVinculacion" in resultado && resultado.necesitaVinculacion) {
        return res.status(409).json({ ok: false,
          error: "El código ya existe en el catálogo compartido. Requiere vinculación autorizada." });
      }

      return res.status(resultado.creado ? 201 : 200).json({
        ok: true,
        creado: resultado.creado,
        encontrado: true,
        producto: resultado.producto,
      });
    }

    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
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
