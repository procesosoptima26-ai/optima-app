/**
 * Alta de producto: lo que comparten las pantallas que crean productos (Recepción, Ventas y Stock).
 * Para qué sirve: un solo lugar donde se arman las listas de opciones, se corrige lo que llega
 * ("1KG" → "1kg" si esa opción ya existe), se elige o se crea el proveedor y se valida la cant. pack.
 */
import { crearProveedorMinimo, leerProveedoresDeEmpresa, leerValoresCatalogo } from "./compras-airtable.js";
import {
  agruparOpciones, claveOpcion, limpiarOpcion, normalizarCantPack, opcionExistente, resolverOpcion,
} from "./producto-opciones.js";

/** Error por datos mal enviados (las pantallas lo muestran tal cual). */
export class ErrorSolicitud extends Error {}

export type Opciones = {
  producto: string[]; marca: string[]; presentacion: string[]; especificacion: string[];
  proveedores: { id: string; nombre: string }[];
};

export type DatosAltaProducto = {
  producto?: unknown;
  marca?: unknown;
  presentacion?: unknown;
  /** Una o varias especificaciones (en Airtable es de selección múltiple). */
  especificacion?: unknown;
  /** Proveedor elegido de la lista (id de Airtable). */
  proveedorId?: unknown;
  /** Proveedor que no estaba en la lista: se crea solo con el nombre. */
  proveedorNuevo?: unknown;
  /** Unidades por pack, opcional. */
  cantPack?: unknown;
};

export type ProveedorAlta = { id: string; nombre: string; creado: boolean };

// Las listas se arman leyendo todo el catálogo (varias páginas de Airtable); se guardan unos
// minutos en memoria para que abrir el formulario sea rápido.
const VIDA_OPCIONES_MS = 10 * 60 * 1000;
const cacheOpciones = new Map<string, { hasta: number; opciones: Opciones }>();

const ordenarProveedores = (lista: { id: string; nombre: string }[]) =>
  [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

export async function obtenerOpciones(empresaId: string, forzar = false): Promise<Opciones> {
  const guardado = cacheOpciones.get(empresaId);
  if (!forzar && guardado && guardado.hasta > Date.now()) return guardado.opciones;
  const [valores, proveedores] = await Promise.all([leerValoresCatalogo(empresaId), leerProveedoresDeEmpresa(empresaId)]);
  const opciones: Opciones = {
    producto: agruparOpciones(valores.producto),
    marca: agruparOpciones(valores.marca),
    presentacion: agruparOpciones(valores.presentacion),
    especificacion: agruparOpciones(valores.especificacion),
    proveedores: ordenarProveedores([...proveedores.entries()].map(([id, nombre]) => ({ id, nombre }))),
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
    o.proveedores = ordenarProveedores([...o.proveedores, proveedor]);
  }
}

/**
 * Valida y arma los campos del producto nuevo (sin código ni EMPRESA, que pone cada pantalla).
 * Si hay un proveedor nuevo, lo crea AHORA (solo con el nombre). Después de guardar el producto
 * hay que llamar a `recordar()` para que las listas lo incluyan enseguida.
 */
export async function prepararAltaProducto(datos: DatosAltaProducto, empresaId: string): Promise<{
  campos: Record<string, unknown>;
  proveedor: ProveedorAlta | null;
  recordar: () => void;
}> {
  const productoIngresado = limpiarOpcion(datos.producto);
  if (!productoIngresado) throw new ErrorSolicitud("Ingresá el nombre del producto");

  const cantPack = normalizarCantPack(datos.cantPack);
  if (cantPack === null) throw new ErrorSolicitud("La cantidad por pack debe ser un número entero mayor a 0");

  const proveedorIdEnviado = limpiarOpcion(datos.proveedorId);
  const proveedorNuevoNombre = limpiarOpcion(datos.proveedorNuevo);
  if (proveedorIdEnviado && !/^rec[A-Za-z0-9]{14}$/.test(proveedorIdEnviado)) {
    throw new ErrorSolicitud("El proveedor elegido no es válido");
  }

  // Cada valor se compara con las opciones que ya existen: si hay una equivalente
  // ("1KG" = "1kg") se usa ESA, así no nacen repetidos aunque la pantalla mande otra cosa.
  const opciones = await obtenerOpciones(empresaId);
  const producto = resolverOpcion("producto", productoIngresado, opciones.producto).valor;
  const marca = resolverOpcion("marca", datos.marca, opciones.marca).valor;
  const presentacion = resolverOpcion("presentacion", datos.presentacion, opciones.presentacion).valor;
  const listaEspecificaciones: unknown[] = Array.isArray(datos.especificacion)
    ? datos.especificacion : [datos.especificacion ?? ""];
  const especificaciones: string[] = [];
  for (const e of listaEspecificaciones) {
    const r = resolverOpcion("especificacion", e, opciones.especificacion).valor;
    if (r && !especificaciones.some((x) => claveOpcion(x) === claveOpcion(r))) especificaciones.push(r);
  }

  // Proveedor: uno de la lista, o uno nuevo solo con el nombre (administración completa el resto).
  let proveedor: ProveedorAlta | null = null;
  if (proveedorIdEnviado) {
    const existente = opciones.proveedores.find((p) => p.id === proveedorIdEnviado);
    if (!existente) throw new ErrorSolicitud("El proveedor elegido no existe");
    proveedor = { ...existente, creado: false };
  } else if (proveedorNuevoNombre) {
    const parecido = opciones.proveedores.find((p) => claveOpcion(p.nombre) === claveOpcion(proveedorNuevoNombre));
    proveedor = parecido
      ? { ...parecido, creado: false }
      : { id: await crearProveedorMinimo(proveedorNuevoNombre, empresaId), nombre: proveedorNuevoNombre, creado: true };
  }

  const campos: Record<string, unknown> = { PRODUCTO: producto };
  if (marca) campos.MARCA = marca;
  if (presentacion) campos["PRESENTACIÓN"] = presentacion;
  if (especificaciones.length) campos["ESPECIFICACIÓN"] = especificaciones;
  if (proveedor) campos.PROVEEDOR = [proveedor.id];
  if (cantPack) campos["CANT. PACK"] = cantPack;

  return {
    campos,
    proveedor,
    recordar: () => recordarOpciones(empresaId, { producto, marca, presentacion }, especificaciones,
      proveedor ? { id: proveedor.id, nombre: proveedor.nombre } : null),
  };
}
