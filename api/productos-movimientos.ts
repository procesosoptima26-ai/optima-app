import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirAutorizacion } from "../lib/autorizacion.js";
import { configTablaOperativa, productoDeEmpresa } from "../lib/alcance-operativo.js";
import { crearProveedorMinimo, leerProveedoresDeEmpresa, leerValoresCatalogo } from "../lib/compras-airtable.js";
import {
  agruparOpciones, claveOpcion, limpiarOpcion, normalizarCantPack,
  opcionExistente, resolverOpcion,
} from "../lib/producto-opciones.js";

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
  /** Una o varias especificaciones (en Airtable es de selección múltiple). */
  especificacion?: string | string[];
  /** Proveedor elegido de la lista (id de Airtable). */
  proveedorId?: string;
  /** Proveedor que no estaba en la lista: se crea solo con el nombre. */
  proveedorNuevo?: string;
  /** Unidades por pack, opcional. */
  cantPack?: string | number;
};

/** Error por datos mal enviados: responde 400 en vez de 500. */
class ErrorSolicitud extends Error {}

type Opciones = {
  producto: string[]; marca: string[]; presentacion: string[]; especificacion: string[];
  proveedores: { id: string; nombre: string }[];
};

// Las listas se arman leyendo todo el catálogo (varias páginas de Airtable); se guardan unos
// minutos en memoria para que abrir el formulario sea rápido.
const VIDA_OPCIONES_MS = 10 * 60 * 1000;
const cacheOpciones = new Map<string, { hasta: number; opciones: Opciones }>();

async function obtenerOpciones(empresaId: string, forzar = false): Promise<Opciones> {
  const guardado = cacheOpciones.get(empresaId);
  if (!forzar && guardado && guardado.hasta > Date.now()) return guardado.opciones;
  const [valores, proveedores] = await Promise.all([leerValoresCatalogo(empresaId), leerProveedoresDeEmpresa(empresaId)]);
  const opciones: Opciones = {
    producto: agruparOpciones(valores.producto),
    marca: agruparOpciones(valores.marca),
    presentacion: agruparOpciones(valores.presentacion),
    especificacion: agruparOpciones(valores.especificacion),
    proveedores: [...proveedores.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })),
  };
  cacheOpciones.set(empresaId, { hasta: Date.now() + VIDA_OPCIONES_MS, opciones });
  return opciones;
}

/** Suma a la lista guardada lo que se acaba de crear, para que aparezca sin esperar. */
function recordarOpciones(empresaId: string, usadas: Partial<Record<"producto" | "marca" | "presentacion", string>>,
  especificaciones: string[], proveedor: { id: string; nombre: string } | null) {
  const g = cacheOpciones.get(empresaId);
  if (!g) return;
  const o = g.opciones;
  for (const campo of ["producto", "marca", "presentacion"] as const) {
    const v = usadas[campo];
    if (v && !opcionExistente(v, o[campo])) o[campo] = agruparOpciones([...o[campo], v]);
  }
  for (const e of especificaciones) if (!opcionExistente(e, o.especificacion)) o.especificacion = agruparOpciones([...o.especificacion, e]);
  if (proveedor && !o.proveedores.some((p) => p.id === proveedor.id)) {
    o.proveedores = [...o.proveedores, proveedor].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
  }
}

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
  const productoIngresado = limpiarOpcion(payload.producto);

  if (!codigoIngresado) {
    throw new ErrorSolicitud("Falta el código");
  }

  if (!productoIngresado) {
    throw new ErrorSolicitud("Ingresá el nombre del producto");
  }

  const cantPack = normalizarCantPack(payload.cantPack);
  if (cantPack === null) {
    throw new ErrorSolicitud("La cantidad por pack debe ser un número entero mayor a 0");
  }
  const proveedorIdEnviado = limpiarOpcion(payload.proveedorId);
  const proveedorNuevoNombre = limpiarOpcion(payload.proveedorNuevo);
  if (proveedorIdEnviado && !/^rec[A-Za-z0-9]{14}$/.test(proveedorIdEnviado)) {
    throw new ErrorSolicitud("El proveedor elegido no es válido");
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

  // Cada valor se compara con las opciones que ya existen: si hay una equivalente
  // ("1KG" = "1kg") se usa ESA, así no nacen repetidos aunque la pantalla mande otra cosa.
  const opciones = await obtenerOpciones(empresaId);
  const producto = resolverOpcion("producto", productoIngresado, opciones.producto).valor;
  const marca = resolverOpcion("marca", payload.marca, opciones.marca).valor;
  const presentacion = resolverOpcion("presentacion", payload.presentacion, opciones.presentacion).valor;
  const listaEspecificaciones = Array.isArray(payload.especificacion)
    ? payload.especificacion : [payload.especificacion ?? ""];
  const especificaciones: string[] = [];
  for (const e of listaEspecificaciones) {
    const r = resolverOpcion("especificacion", e, opciones.especificacion).valor;
    if (r && !especificaciones.some((x) => claveOpcion(x) === claveOpcion(r))) especificaciones.push(r);
  }

  // Proveedor: uno de la lista, o uno nuevo solo con el nombre (administración completa el resto).
  let proveedor: { id: string; nombre: string; creado: boolean } | null = null;
  if (proveedorIdEnviado) {
    const existente = opciones.proveedores.find((p) => p.id === proveedorIdEnviado);
    if (!existente) throw new ErrorSolicitud("El proveedor elegido no existe");
    proveedor = { ...existente, creado: false };
  } else if (proveedorNuevoNombre) {
    const parecido = opciones.proveedores.find((p) => claveOpcion(p.nombre) === claveOpcion(proveedorNuevoNombre));
    if (parecido) {
      proveedor = { ...parecido, creado: false };
    } else {
      const nombre = proveedorNuevoNombre;
      proveedor = { id: await crearProveedorMinimo(nombre, empresaId), nombre, creado: true };
    }
  }

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

  if (especificaciones.length) {
    fields["ESPECIFICACIÓN"] = especificaciones;
  }

  if (proveedor) {
    fields.PROVEEDOR = [proveedor.id];
  }

  if (cantPack) {
    fields["CANT. PACK"] = cantPack;
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

  recordarOpciones(empresaId, { producto, marca, presentacion }, especificaciones,
    proveedor ? { id: proveedor.id, nombre: proveedor.nombre } : null);

  return {
    creado: true,
    proveedor,
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
      capacidadesPorPermiso: {
        "movimientos.ver": "movimientos.registro.consultar",
        "movimientos.crear": "movimientos.registro.crear",
      },
    });
    if (!autorizado) return;

    if (req.method === "GET" && req.query.opciones !== undefined) {
      const opciones = await obtenerOpciones(autorizado.empresaId, req.query.opciones === "recargar");
      return res.status(200).json({ ok: true, opciones });
    }

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
        proveedor: "proveedor" in resultado ? resultado.proveedor : null,
        encontrado: true,
        producto: resultado.producto,
      });
    }

    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
  } catch (error) {
    if (error instanceof ErrorSolicitud) {
      return res.status(400).json({ ok: false, error: error.message });
    }
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
