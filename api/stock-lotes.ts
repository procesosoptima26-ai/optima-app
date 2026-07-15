import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({ path: ".env.local" });

type AirtableRecord = { id: string; fields: Record<string, unknown> };
type AirtableResponse = { records?: AirtableRecord[]; offset?: string; error?: unknown };

type LoteStock = {
  id: string;
  productoId: string;
  codigo: string;
  nombreProducto: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
  ubicacionId: string;
  ubicacionNombre: string;
  sucursal: string;
  tipoUbicacion: string;
  vencimiento: string | null;
  cantidad: number;
};

function getEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configurar la variable de entorno: ${name}`);
  return value;
}

function obtenerPrimerIdVinculado(valor: unknown): string | null {
  if (!Array.isArray(valor) || valor.length === 0) return null;
  const primero = valor[0];
  if (typeof primero === "string") return primero.trim() || null;
  if (primero && typeof primero === "object") {
    const objeto = primero as Record<string, unknown>;
    if (typeof objeto.id === "string") return objeto.id.trim() || null;
  }
  return null;
}

function normalizarTexto(valor: unknown): string {
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number") return String(valor);
  if (Array.isArray(valor)) return valor.map(normalizarTexto).filter(Boolean).join(", ");
  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    if (typeof objeto.name === "string") return objeto.name.trim();
    if (typeof objeto.text === "string") return objeto.text.trim();
    if (typeof objeto.value === "string") return objeto.value.trim();
  }
  return "";
}

function normalizarCantidad(valor: unknown): number {
  const numero = typeof valor === "number" ? valor : Number(normalizarTexto(valor));
  if (Number.isNaN(numero)) return 0;
  return Math.round(numero * 1000) / 1000;
}

function normalizarFecha(valor: unknown): string | null {
  if (!valor) return null;
  const texto = normalizarTexto(valor);
  if (!texto) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return null;
  const anio = fecha.getUTCFullYear();
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getUTCDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

async function leerTodosLosRegistros(tableName: string, fields: string[]) {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const registros: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set("pageSize", "100");
    fields.forEach((field) => url.searchParams.append("fields[]", field));
    if (offset) url.searchParams.set("offset", offset);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await response.json()) as AirtableResponse;
    if (!response.ok) {
      console.error(`Error consultando ${tableName}:`, data);
      throw new Error(`No se pudo consultar ${tableName}`);
    }
    registros.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return registros;
}

function ordenarLotes(lotes: LoteStock[]) {
  return [...lotes].sort((a, b) => {
    const producto = a.nombreProducto.localeCompare(b.nombreProducto, "es", { sensitivity: "base" });
    if (producto !== 0) return producto;
    const ubicacion = a.ubicacionNombre.localeCompare(b.ubicacionNombre, "es", { sensitivity: "base" });
    if (ubicacion !== 0) return ubicacion;
    if (a.vencimiento === null && b.vencimiento === null) return 0;
    if (a.vencimiento === null) return 1;
    if (b.vencimiento === null) return -1;
    return a.vencimiento.localeCompare(b.vencimiento);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    const vista = String(req.query.vista || "").trim().toLowerCase();
    const productoId = String(req.query.productoId || "").trim();
    const ubicacionId = String(req.query.ubicacionId || "").trim();
    const sucursalConsultada = String(req.query.sucursal || "").trim().toUpperCase();
    const vencimiento = normalizarFecha(req.query.vencimiento);

    if (vista !== "general" && !productoId) {
      return res.status(400).json({ ok: false, error: "Falta productoId" });
    }

    const stockTable = getEnv("AIRTABLE_STOCK_LOTES_TABLE_NAME");
    const ubicacionesTable = getEnv("AIRTABLE_UBICACIONES_TABLE_NAME");
    const productosTable = getEnv("AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME");
    const codeField = getEnv("AIRTABLE_MOVIMIENTOS_CODE_FIELD");
    const nameField = getEnv("AIRTABLE_MOVIMIENTOS_NAME_FIELD");

    const [registrosStock, registrosUbicaciones, registrosProductos] = await Promise.all([
      leerTodosLosRegistros(stockTable, ["PRODUCTOS", "UBICACIÓN", "VENCIMIENTO", "CANTIDAD_ACTUAL"]),
      leerTodosLosRegistros(ubicacionesTable, ["NOMBRE", "SUCURSAL", "TIPO_UBICACIÓN"]),
      leerTodosLosRegistros(productosTable, [codeField, nameField, "NOMBRE MASTER", "NOMBRE_MÁSTER", "PRODUCTO", "MARCA", "PRESENTACIÓN", "ESPECIFICACIÓN"]),
    ]);

    const ubicacionesPorId = new Map<string, { nombre: string; sucursal: string; tipoUbicacion: string }>();
    registrosUbicaciones.forEach((record) => {
      const sucursal = normalizarTexto(record.fields.SUCURSAL);
      const tipoUbicacion = normalizarTexto(record.fields["TIPO_UBICACIÓN"]);
      const nombre = normalizarTexto(record.fields.NOMBRE) || [sucursal, tipoUbicacion].filter(Boolean).join(" | ");
      ubicacionesPorId.set(record.id, { nombre: nombre || "Ubicación", sucursal, tipoUbicacion });
    });

    const productosPorId = new Map<string, { codigo: string; nombre: string; producto: string; marca: string; presentacion: string; especificacion: string }>();
    registrosProductos.forEach((record) => {
      const producto = normalizarTexto(record.fields.PRODUCTO);
      productosPorId.set(record.id, {
        codigo: normalizarTexto(record.fields[codeField]),
        nombre: normalizarTexto(record.fields[nameField]) || normalizarTexto(record.fields["NOMBRE MASTER"]) || normalizarTexto(record.fields["NOMBRE_MÁSTER"]) || producto || "Producto",
        producto,
        marca: normalizarTexto(record.fields.MARCA),
        presentacion: normalizarTexto(record.fields["PRESENTACIÓN"]),
        especificacion: normalizarTexto(record.fields["ESPECIFICACIÓN"]),
      });
    });

    const lotes = ordenarLotes(
      registrosStock.map((record): LoteStock | null => {
        const productoVinculadoId = obtenerPrimerIdVinculado(record.fields.PRODUCTOS);
        const ubicacionVinculadaId = obtenerPrimerIdVinculado(record.fields["UBICACIÓN"]);
        if (!productoVinculadoId || !ubicacionVinculadaId) return null;
        if (vista !== "general" && productoVinculadoId !== productoId) return null;
        if (ubicacionId && ubicacionVinculadaId !== ubicacionId) return null;

        const ubicacion = ubicacionesPorId.get(ubicacionVinculadaId);
        if (sucursalConsultada && ubicacion?.sucursal.toUpperCase() !== sucursalConsultada) return null;
        const producto = productosPorId.get(productoVinculadoId);

        return {
          id: record.id,
          productoId: productoVinculadoId,
          codigo: producto?.codigo || "",
          nombreProducto: producto?.nombre || "Producto",
          producto: producto?.producto || "",
          marca: producto?.marca || "",
          presentacion: producto?.presentacion || "",
          especificacion: producto?.especificacion || "",
          ubicacionId: ubicacionVinculadaId,
          ubicacionNombre: ubicacion?.nombre || "Ubicación",
          sucursal: ubicacion?.sucursal || "",
          tipoUbicacion: ubicacion?.tipoUbicacion || "",
          vencimiento: normalizarFecha(record.fields.VENCIMIENTO),
          cantidad: normalizarCantidad(record.fields.CANTIDAD_ACTUAL),
        };
      }).filter((lote): lote is LoteStock => lote !== null)
    );

    if (vista === "general") {
      const lotesConStock = lotes.filter((lote) => lote.cantidad > 0);
      const cantidadTotal = lotesConStock.reduce((total, lote) => total + lote.cantidad, 0);
      return res.status(200).json({
        ok: true,
        vista: "general",
        sucursal: sucursalConsultada || null,
        cantidadTotal: Math.round(cantidadTotal * 1000) / 1000,
        cantidadLotes: lotesConStock.length,
        lotes: lotesConStock,
      });
    }

    const lotesConStock = lotes.filter((lote) => lote.cantidad > 0);
    const loteSeleccionado = vencimiento ? lotes.find((lote) => lote.vencimiento === vencimiento) || null : null;
    const loteAnterior = vencimiento && ubicacionId
      ? lotesConStock.find((lote) => lote.vencimiento !== null && lote.vencimiento < vencimiento) || null
      : null;
    const vencimientoMasProximo = lotesConStock.find((lote) => lote.vencimiento !== null) || null;
    const cantidadTotal = lotes.reduce((total, lote) => total + lote.cantidad, 0);

    return res.status(200).json({
      ok: true,
      productoId,
      ubicacionId: ubicacionId || null,
      vencimientoConsultado: vencimiento,
      cantidadTotal: Math.round(cantidadTotal * 1000) / 1000,
      cantidadVencimientoSeleccionado: loteSeleccionado?.cantidad || 0,
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
      error: error instanceof Error ? error.message : "Error interno del servidor",
    });
  }
}
