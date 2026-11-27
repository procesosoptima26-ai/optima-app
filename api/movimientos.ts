import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirAutorizacion } from "../lib/autorizacion.js";
import { configTablaOperativa, sucursalRealDeUbicacion, idsVinculados, sucursalSolicitada,
  productoExistenteDeEmpresa, movimientoPermitido } from "../lib/alcance-operativo.js";
import type { ContextoCore } from "../core/seguridad.js";
import {
  planificarVentas, etiquetaArchivoVentas, MAX_PRODUCTOS_POR_ARCHIVO,
} from "../lib/ventas-archivo-plan.js";
import {
  buscarProductosPorCodigos, leerStockPorProductoEnUbicacion,
  leerProductosYaCargados, leerResultadoVentas,
} from "../lib/ventas-archivo-airtable.js";
import { tomarBloqueoVentas, liberarBloqueoVentas } from "../lib/bloqueo-ventas.js";
import {
  destinosTransferencia, validarTransferencia, esMotivoTransferencia,
  type SucursalTransferencia,
} from "../lib/transferencias.js";

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

const REGISTRO_ID = /^rec[A-Za-z0-9]{14}$/;

type Ubicacion = {
  id: string;
  nombre: string;
  sucursal: string;
  tipoUbicacion: string;
  sucursalCoreId: string | null;
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
  const texto = normalizarTexto(valor);
  return /^rec[A-Za-z0-9]{14}$/.test(texto) ? texto : texto.toUpperCase();
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
      tipoUbicacion,
      sucursalCoreId: sucursalRealDeUbicacion(record.fields),
    };
  });
}

/**
 * Sucursales de UNA empresa (todas, no solo las del usuario). Se usa para
 * saber a qué sucursales se puede transferir mercadería. Se filtra por el ID
 * real de la empresa, nunca por nombre visible.
 */
async function leerSucursalesDeEmpresa(empresaId: string): Promise<SucursalTransferencia[]> {
  const token = getEnv("AIRTABLE_TOKEN");
  const baseId = getEnv("AIRTABLE_USERS_BASE_ID");
  const tabla = getEnv("AIRTABLE_SUCURSALES_TABLE_ID");
  const resultado: SucursalTransferencia[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tabla)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = (await response.json()) as AirtableResponse;
    if (!response.ok) {
      console.error("Error consultando sucursales:", data);
      throw new Error("No se pudieron consultar las sucursales de la empresa");
    }
    for (const registro of data.records || []) {
      const empresas = idsVinculados(registro.fields.EMPRESA);
      const nombre = normalizarTexto(registro.fields.NOMBRE);
      if (empresas?.length === 1 && empresas[0] === empresaId && nombre) {
        resultado.push({ id: registro.id, nombre, activa: registro.fields.ACTIVA === true });
      }
    }
    offset = data.offset;
  } while (offset);
  return resultado;
}

async function validarProductoExiste(productoId: string, empresaId: string) {
  return productoExistenteDeEmpresa(productoId, empresaId);
}

function validarMovimiento(
  movimiento: MovimientoPayload,
  sucursalCoreId: string,
  ubicaciones: Ubicacion[],
  sucursalesActivasEmpresaIds: ReadonlySet<string> = new Set()
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

  if (ubicacionOrigen && (
    ubicacionOrigen.sucursalCoreId !== sucursalCoreId
  )) {
    return "La ubicación de origen no pertenece a la sucursal del usuario.";
  }

  if (esMotivoTransferencia(motivo)) {
    // Única excepción a "todo dentro de mi sucursal": el destino puede estar
    // en OTRA sucursal activa de la misma empresa (nunca de otra empresa).
    return validarTransferencia({
      tipoMovimiento: tipo,
      origen: ubicacionOrigen ?? null,
      destino: ubicacionDestino ?? null,
      sucursalUsuarioId: sucursalCoreId,
      sucursalesActivasEmpresaIds,
    });
  }

  if (ubicacionDestino && (
    ubicacionDestino.sucursalCoreId !== sucursalCoreId
  )) {
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
    fields.OBSERVACIONES = observacion;
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
      throw new Error(
        "Airtable rechazó uno o más movimientos"
      );
    }

    registrosCreados.push(...(data.records || []));
  }

  return registrosCreados;
}

async function leerMovimientosPorIds(ids: readonly string[]): Promise<AirtableRecord[] | null> {
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv("AIRTABLE_MOVIMIENTOS_TABLE_NAME");
  const resultados: AirtableRecord[] = [];

  for (const id of ids) {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${id}`
    );
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    // No devolver una lista parcial cuando un ID no existe.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("No se pudo verificar la consulta de movimientos");
    const dato: unknown = await response.json();
    if (!dato || typeof dato !== "object" || Array.isArray(dato) ||
        !("id" in dato) || dato.id !== id || !("fields" in dato) ||
        !dato.fields || typeof dato.fields !== "object" || Array.isArray(dato.fields)) {
      return null;
    }
    resultados.push(dato as AirtableRecord);
  }
  return resultados;
}

function mapaUbicacionesCore(ubicaciones: Ubicacion[]) {
  return new Map(ubicaciones.map((u) => [u.id, {
    id: u.id,
    fields: { SUCURSAL_CORE: u.sucursalCoreId ? [u.sucursalCoreId] : [] },
  }]));
}

async function leerMovimientosRecientes(
  sucursalCoreId: string,
  limite: number,
  contexto: ContextoCore,
) {
  const { token, baseId } = configTablaOperativa("AIRTABLE_MOVIMIENTOS_BASE_ID");
  const tableName = getEnv("AIRTABLE_MOVIMIENTOS_TABLE_NAME");
  const ubicaciones = await leerUbicaciones();
  const mapaUbicaciones = mapaUbicacionesCore(ubicaciones);

  const encontrados: AirtableRecord[] = [];
  const offsetsVistos = new Set<string>();
  let offset: string | undefined;
  // Una página puede contener movimientos de otras sucursales o empresas.
  // Se pagina hasta reunir el límite AUTORIZADO o agotar el historial.
  for (let pagina = 0; pagina < 50; pagina++) {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("sort[0][field]", "FECHA_HORA");
    url.searchParams.set("sort[0][direction]", "desc");
    if (offset) url.searchParams.set("offset", offset);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("No se pudieron consultar los movimientos recientes");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        !("records" in data) || !Array.isArray(data.records)) {
      throw new Error("Respuesta incompleta al consultar los movimientos");
    }
    for (const registro of data.records) {
      if (!registro || typeof registro !== "object" || Array.isArray(registro) ||
          !REGISTRO_ID.test(String(registro.id ?? "")) || !registro.fields ||
          typeof registro.fields !== "object" || Array.isArray(registro.fields)) {
        throw new Error("Historial de movimientos inconsistente");
      }
      if (movimientoPermitido(registro.fields, mapaUbicaciones, contexto, sucursalCoreId)) {
        encontrados.push(registro as AirtableRecord);
        if (encontrados.length >= limite) return encontrados.slice(0, limite);
      }
    }
    const siguiente = "offset" in data ? data.offset : undefined;
    if (siguiente === undefined) return encontrados;
    if (typeof siguiente !== "string" || !siguiente.trim() || offsetsVistos.has(siguiente)) {
      throw new Error("Paginación inconsistente en movimientos");
    }
    offsetsVistos.add(siguiente);
    offset = siguiente;
  }
  throw new Error("La consulta de movimientos excedió el límite seguro de páginas");
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
      record.fields.OBSERVACIONES ?? record.fields["OBSERVACIÓN"]
    ),
    procesado: Boolean(record.fields.PROCESADO),
    errorMotor: normalizarTexto(
      record.fields.ERROR_MOTOR
    ),
  };
}

/**
 * Los GET por IDs no incluyen una sucursal en la URL.
 * Verificamos las ubicaciones de CADA registro antes de devolver información.
 */
async function movimientosPertenecenASucursales(
  registros: AirtableRecord[], contexto: ContextoCore,
): Promise<boolean> {
  if (registros.length === 0) return true;
  const ubicaciones = await leerUbicaciones();
  const mapa = mapaUbicacionesCore(ubicaciones);
  return registros.every((registro) => movimientoPermitido(registro.fields, mapa, contexto));
}

/**
 * Ventas por archivo (Etapa 1).
 * - ventas_vista_previa: calcula el plan SIN guardar nada.
 * - ventas_confirmar: vuelve a calcular el plan y guarda solo las ventas listas.
 * - ventas_resultado: informa cómo le fue al motor con lo ya cargado.
 * El stock lo sigue modificando únicamente el motor de Airtable: acá solo se
 * crean movimientos EGRESO + VENTA, igual que a mano.
 */
type LineaVentaPayload = { codigo: string; producto?: string; cantidad: number };

function textoCorto(valor: unknown, maximo: number): string {
  return typeof valor === "string" ? valor.trim().slice(0, maximo) : "";
}

async function manejarVentasArchivo(
  req: VercelRequest,
  res: VercelResponse,
  accion: string,
) {
  if (!["ventas_vista_previa", "ventas_confirmar", "ventas_resultado"].includes(accion)) {
    return res.status(400).json({ ok: false, error: "Acción no válida." });
  }
  const cuerpo = (req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body : {}) as Record<string, unknown>;

  const sucursal = normalizarSucursal(cuerpo.sucursal);
  const ubicacionId = normalizarTexto(cuerpo.ubicacionId);
  if (!sucursal) {
    return res.status(400).json({ ok: false, error: "Falta la sucursal." });
  }
  if (!REGISTRO_ID.test(ubicacionId)) {
    return res.status(400).json({ ok: false, error: "Falta la ubicación de venta." });
  }
  let etiqueta: string;
  try {
    etiqueta = etiquetaArchivoVentas(textoCorto(cuerpo.nombreArchivo, 200));
  } catch {
    return res.status(400).json({ ok: false, error: "Falta el nombre del archivo." });
  }

  const autorizado = await exigirAutorizacion(req, res, {
    modulos: ["MOVIMIENTOS"],
    permiso: "movimientos.crear",
    capacidadComercial: "movimientos.registro.crear",
    sucursal,
  });
  if (!autorizado) return;

  const sucursalCore = sucursalSolicitada(autorizado.contexto, sucursal);
  if (!sucursalCore) {
    return res.status(403).json({ ok: false, error: "Sucursal no autorizada" });
  }
  const ubicaciones = await leerUbicaciones();
  const ubicacion = ubicaciones.find((u) => u.id === ubicacionId);
  if (!ubicacion || ubicacion.sucursalCoreId !== sucursalCore.id) {
    return res.status(400).json({
      ok: false,
      error: "La ubicación de venta no pertenece a la sucursal del usuario.",
    });
  }

  if (accion === "ventas_resultado") {
    const resultado = await leerResultadoVentas(etiqueta);
    return res.status(200).json({ ok: true, etiqueta, resultado });
  }

  const crudas = Array.isArray(cuerpo.lineas) ? cuerpo.lineas : null;
  if (!crudas || crudas.length === 0) {
    return res.status(400).json({ ok: false, error: "El archivo no tiene ventas." });
  }
  if (crudas.length > 5000) {
    return res.status(400).json({ ok: false, error: "El archivo tiene demasiadas filas." });
  }
  const lineas: LineaVentaPayload[] = [];
  for (const cruda of crudas as Array<Record<string, unknown>>) {
    const codigo = normalizarTexto(cruda?.codigo);
    const cantidad = Number(cruda?.cantidad);
    if (!/^\d{1,20}$/.test(codigo) || !Number.isFinite(cantidad) ||
        cantidad <= 0 || cantidad > 100000) {
      return res.status(400).json({ ok: false, error: "Hay líneas con código o cantidad inválidos." });
    }
    lineas.push({ codigo, producto: textoCorto(cruda?.producto, 200), cantidad });
  }
  if (new Set(lineas.map((l) => l.codigo)).size > MAX_PRODUCTOS_POR_ARCHIVO) {
    return res.status(400).json({ ok: false, error: "El archivo tiene demasiados productos." });
  }

  // Candado: solo una confirmación a la vez por archivo y ubicación. Si Redis
  // no responde, NO se carga (preferimos frenar antes que descontar dos veces).
  // La vista previa no escribe nada, así que no lo necesita.
  let dueno: string | null = null;
  if (accion === "ventas_confirmar") {
    try {
      dueno = await tomarBloqueoVentas(ubicacionId, etiqueta);
    } catch (error) {
      console.error("No se pudo tomar el candado de ventas:", error);
      return res.status(503).json({
        ok: false,
        error: "No se pudo asegurar la carga en este momento. No se cargó nada; probá de nuevo en un minuto.",
      });
    }
    if (!dueno) {
      return res.status(409).json({
        ok: false,
        error: "Este archivo ya se está cargando (otra pestaña o persona). Esperá unos segundos y mirá el resultado.",
      });
    }
  }

  try {
  const [catalogo, stock, yaCargados] = await Promise.all([
    buscarProductosPorCodigos([...new Set(lineas.map((l) => l.codigo))], autorizado.empresaId),
    leerStockPorProductoEnUbicacion(ubicacionId),
    leerProductosYaCargados(etiqueta),
  ]);

  const plan = planificarVentas({
    lineas: lineas.map((l) => ({ codigo: l.codigo, producto: l.producto ?? "", cantidad: l.cantidad })),
    productosPorCodigo: catalogo.productos,
    codigosDeOtraEmpresa: catalogo.codigosDeOtraEmpresa,
    stockPorProductoId: stock,
    yaCargadosPorProductoId: yaCargados,
  });

  if (accion === "ventas_vista_previa") {
    return res.status(200).json({ ok: true, etiqueta, plan });
  }

  // ventas_confirmar: solo se guardan las ventas que el plan marca como listas.
  if (plan.listas.length === 0) {
    return res.status(400).json({
      ok: false, error: "No hay ventas para cargar.", plan,
    });
  }
  const responsable = textoCorto(cuerpo.responsable, 100);
  const movimientos: MovimientoPayload[] = plan.listas.map((venta) => ({
    productoId: venta.productoId,
    tipoMovimiento: "EGRESO",
    motivo: "VENTA",
    ubicacionOrigenId: ubicacionId,
    cantidad: venta.cantidad,
    responsable,
    observacion: etiqueta,
  }));
  for (const movimiento of movimientos) {
    const errorValidacion = validarMovimiento(movimiento, sucursalCore.id, ubicaciones);
    if (errorValidacion) {
      return res.status(400).json({ ok: false, error: errorValidacion });
    }
  }
  const creados = await crearMovimientos(movimientos);
  return res.status(200).json({
    ok: true,
    etiqueta,
    cantidad: creados.length,
    omitidas: plan.problemas.length,
  });
  } finally {
    if (dueno) {
      try {
        await liberarBloqueoVentas(ubicacionId, etiqueta, dueno);
      } catch (error) {
        // El candado vence solo a los 90 s; no se debe tapar la respuesta real.
        console.error("No se pudo liberar el candado de ventas:", error);
      }
    }
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    if (req.method === "POST") {
      const accionVentas = normalizarTexto(req.query.accion);
      if (accionVentas) return await manejarVentasArchivo(req, res, accionVentas);

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

      const acciones = movimientos.map((movimiento) => {
        const tipo = normalizarOpcion(movimiento.tipoMovimiento);
        return tipo === "AJUSTE +" || tipo === "AJUSTE -" ||
          tipo === "AJUSTE POSITIVO" || tipo === "AJUSTE NEGATIVO"
          ? "movimientos.ajustar" as const : "movimientos.crear" as const;
      });
      const autorizado = await exigirAutorizacion(req, res, {
        modulos: ["MOVIMIENTOS"],
        permiso: [...new Set(acciones)],
        sucursal,
        capacidadesPorPermiso: {
          "movimientos.crear": "movimientos.registro.crear",
          "movimientos.ajustar": "movimientos.registro.ajustar",
        },
      });
      if (!autorizado) return;

      const sucursalCore = sucursalSolicitada(autorizado.contexto, sucursal);
      if (!sucursalCore) return res.status(403).json({ ok: false, error: "Sucursal no autorizada" });
      const ubicaciones = await leerUbicaciones();
      const hayTransferencias = movimientos.some((m) => esMotivoTransferencia(normalizarOpcion(m.motivo)));
      const sucursalesActivasEmpresaIds = hayTransferencias
        ? new Set((await leerSucursalesDeEmpresa(autorizado.empresaId))
            .filter((s) => s.activa).map((s) => s.id))
        : new Set<string>();

      for (
        let indice = 0;
        indice < movimientos.length;
        indice += 1
      ) {
        const movimiento = movimientos[indice];

        const errorValidacion = validarMovimiento(
          movimiento,
          sucursalCore.id,
          ubicaciones,
          sucursalesActivasEmpresaIds
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
        const existe = await validarProductoExiste(productoId, autorizado.empresaId);

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

    if (req.method === "GET") {
      if (normalizarTexto(req.query.accion) === "destinos_transferencia") {
        const sucursalPedida = normalizarSucursal(req.query.sucursal);
        if (!sucursalPedida) {
          return res.status(400).json({ ok: false, error: "Falta la sucursal de origen." });
        }
        const autorizadoDestinos = await exigirAutorizacion(req, res, {
          modulos: ["MOVIMIENTOS"],
          permiso: "movimientos.crear",
          capacidadComercial: "movimientos.registro.crear",
          sucursal: sucursalPedida,
        });
        if (!autorizadoDestinos) return;
        const origen = sucursalSolicitada(autorizadoDestinos.contexto, sucursalPedida);
        if (!origen) return res.status(403).json({ ok: false, error: "Sucursal no autorizada" });
        const [sucursalesEmpresa, todasUbicaciones] = await Promise.all([
          leerSucursalesDeEmpresa(autorizadoDestinos.empresaId), leerUbicaciones(),
        ]);
        return res.status(200).json({
          ok: true,
          destinos: destinosTransferencia(sucursalesEmpresa, todasUbicaciones, origen.id),
        });
      }

      const idsTexto = normalizarTexto(req.query.ids);

      if (idsTexto) {
        const autorizado = await exigirAutorizacion(req, res, {
          modulos: ["MOVIMIENTOS"],
          permiso: "movimientos.ver",
          capacidadComercial: "movimientos.registro.consultar",
        });
        if (!autorizado) return;

        const ids = idsTexto.split(",").map((id) => id.trim());
        if (ids.length === 0 || ids.length > 100 ||
            ids.some((id) => !REGISTRO_ID.test(id)) ||
            new Set(ids).size !== ids.length) {
          return res.status(400).json({ ok: false, error: "Lista de IDs de movimientos inválida" });
        }
        const registros = await leerMovimientosPorIds(ids);
        if (!registros || registros.length !== ids.length) {
          return res.status(403).json({
            ok: false, error: "No tenés acceso a uno o más movimientos solicitados",
          });
        }
        const permitidos = await movimientosPertenecenASucursales(
          registros,
          autorizado.contexto
        );

        if (!permitidos) {
          return res.status(403).json({
            ok: false,
            error: "No tenés acceso a uno o más movimientos solicitados",
          });
        }

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

      const autorizado = await exigirAutorizacion(req, res, {
        modulos: ["MOVIMIENTOS"],
        permiso: "movimientos.ver",
        capacidadComercial: "movimientos.registro.consultar",
        sucursal,
      });
      if (!autorizado) return;

      const limiteSolicitado = Number(req.query.limite);
      const limite =
        Number.isFinite(limiteSolicitado) &&
        limiteSolicitado > 0
          ? Math.min(Math.floor(limiteSolicitado), 50)
          : 20;

      const sucursalCore = sucursalSolicitada(autorizado.contexto, sucursal);
      if (!sucursalCore) return res.status(403).json({ ok: false, error: "Sucursal no autorizada" });
      const recientes = await leerMovimientosRecientes(sucursalCore.id, limite, autorizado.contexto);

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

