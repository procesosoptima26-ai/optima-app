import type { VercelRequest, VercelResponse } from "@vercel/node";
import { autenticarAdministrador } from "../../lib/usuarios-maestros.js";
import { prepararAltaSucursal, prepararCambioNombreSucursal,
  prepararDesactivacionSucursal } from "../../core/gestion-sucursales.js";
import { evaluarCambioSucursal } from "../../core/control-cambios-sucursales.js";
import { bloquearAltaSucursal, liberarAltaSucursal } from "../../lib/bloqueo-sucursales.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const TABLA = /^(?:tbl[A-Za-z0-9]{14}|[\p{L}\p{N}_ -]{1,80})$/u;
type Registro = { id: string; fields: Record<string, unknown> };
type SucursalGestionInterna = {
  id: string; nombre: string; activa: boolean; autorizada: boolean;
  usuariosAsignados: number; ubicaciones: string[];
};

function idsRelacion(valor: unknown): string[] | null {
  if (valor === undefined) return [];
  if (!Array.isArray(valor) || !valor.every(id => typeof id === "string" && ID.test(id))) return null;
  const ids = valor as string[];
  return new Set(ids).size === ids.length ? ids : null;
}

async function leerRegistro(base: string, tabla: string, id: string, token: string): Promise<Registro> {
  if (!ID.test(id) || !TABLA.test(tabla)) throw new Error("Identificador inválido");
  const respuesta = await fetch(`https://api.airtable.com/v0/${base}/${encodeURIComponent(tabla)}/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!respuesta.ok) throw new Error(`Airtable no disponible (${respuesta.status})`);
  const registro = await respuesta.json() as Registro;
  if (registro.id !== id || !registro.fields || typeof registro.fields !== "object")
    throw new Error("Registro inconsistente");
  return registro;
}

async function escribirRegistro(
  base: string, tabla: string, token: string, metodo: "POST" | "PATCH",
  campos: Record<string, unknown>, id?: string,
): Promise<Registro> {
  if (id && !ID.test(id)) throw new Error("Identificador inválido");
  const respuesta = await fetch(`https://api.airtable.com/v0/${base}/${tabla}${id ? `/${id}` : ""}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: campos, typecast: false }),
  });
  if (!respuesta.ok) throw new Error(`Airtable rechazó la operación (${respuesta.status})`);
  const registro = await respuesta.json() as Registro;
  if (!ID.test(registro.id) || (id && registro.id !== id) || !registro.fields)
    throw new Error("Airtable no confirmó el resultado");
  return registro;
}

/** Comprueba vínculos por ID directamente en el servidor. No depende de nombres visibles. */
async function referenciasCompatibles(
  sucursalId: string, ubicaciones: string[], base: string, token: string,
): Promise<boolean> {
  if (ubicaciones.length === 0) return true;
  const tabla = process.env.AIRTABLE_UBICACIONES_TABLE_NAME?.trim();
  if (!tabla || !TABLA.test(tabla)) return false;
  const registros = await Promise.all(ubicaciones.map(id => leerRegistro(base, tabla, id, token)));
  return registros.every(reg => {
    const relacion = idsRelacion(reg.fields.SUCURSAL_CORE);
    // Para las rutas heredadas se conserva el selector antiguo; es una etiqueta fija.
    return relacion?.length === 1 && relacion[0] === sucursalId &&
      typeof reg.fields.SUCURSAL === "string" && reg.fields.SUCURSAL.trim().length > 0;
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method || ""))
    return res.status(405).json({ ok: false, error: "Método no permitido" });

  const lectura = req.method === "GET";
  const permiso = lectura
    ? ["usuarios.gestionar", "sucursales.gestionar"] as const
    : "sucursales.gestionar" as const;
  const admin = await autenticarAdministrador(req, res, permiso);
  if (!admin) return;

  const empresaId = admin.contexto.empresa.id;
  let propietario: string | null = null;
  try {
    const base = process.env.AIRTABLE_USERS_BASE_ID?.trim();
    const tablaEmpresas = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim();
    const tablaSucursales = process.env.AIRTABLE_SUCURSALES_TABLE_ID?.trim();
    const token = process.env.AIRTABLE_TOKEN?.trim();
    if (!base || !tablaEmpresas || !tablaSucursales || !token ||
        !TABLA.test(tablaEmpresas) || !TABLA.test(tablaSucursales))
      throw new Error("Configuración incompleta");

    if (!lectura) {
      const esperado = req.method === "POST" ? "crear" :
        req.method === "PATCH" ? "renombrar" : "desactivar";
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
          req.body.accion !== esperado)
        return res.status(400).json({ ok: false, error: "Operación no admitida" });
      // El mismo bloqueo por empresa protege crear, renombrar y desactivar.
      propietario = await bloquearAltaSucursal(empresaId);
      if (!propietario) return res.status(409).json({
        ok: false, error: "Otra modificación de sucursales está en proceso",
      });
    }

    const empresa = await leerRegistro(base, tablaEmpresas, empresaId, token);
    const ids = idsRelacion(empresa.fields.SUCURSALES);
    if (!ids || ids.length > 100) throw new Error("Vínculos de sucursales inválidos");
    const sucursales = await Promise.all(ids.map(async id => {
      const registro = await leerRegistro(base, tablaSucursales, id, token);
      const f = registro.fields;
      const empresaSucursal = idsRelacion(f.EMPRESA);
      const pred = idsRelacion(f.USUARIOS_PREDETERMINADOS);
      const aut = idsRelacion(f.USUARIOS_AUTORIZADOS);
      const ubicaciones = idsRelacion(f["UBICACIÓN"]);
      if (empresaSucursal?.length !== 1 || empresaSucursal[0] !== empresaId ||
          !pred || !aut || !ubicaciones || typeof f.NOMBRE !== "string" || !f.NOMBRE.trim())
        throw new Error("Sucursal inconsistente");
      return {
        id, nombre: f.NOMBRE.trim(), activa: f.ACTIVA === true,
        autorizada: admin.contexto.sucursalesAutorizadas.some(s => s.id === id && s.activa),
        usuariosAsignados: new Set([...pred, ...aut]).size, ubicaciones,
      } satisfies SucursalGestionInterna;
    }));
    sucursales.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    if (lectura) return res.status(200).json({
      ok: true, sucursales: sucursales.map(s => ({
        id: s.id, nombre: s.nombre, activa: s.activa, autorizada: s.autorizada,
        usuariosAsignados: s.usuariosAsignados, ubicaciones: s.ubicaciones.length,
      })),
    });

    if (req.method === "POST") {
      const alta = prepararAltaSucursal(req.body.nombre, empresaId, sucursales);
      if (!alta.ok) return res.status(400).json({ ok: false, error: alta.error });
      const creada = await escribirRegistro(base, tablaSucursales, token, "POST", alta.campos);
      if (creada.fields.ACTIVA !== true ||
          idsRelacion(creada.fields.EMPRESA)?.[0] !== empresaId)
        throw new Error("No se pudo confirmar el alta");
      return res.status(201).json({
        ok: true, sucursal: { id: creada.id, nombre: creada.fields.NOMBRE, activa: true },
      });
    }

    const id = req.body.id;
    if (typeof id !== "string" || !ID.test(id))
      return res.status(400).json({ ok: false, error: "Identificador inválido" });
    const actual = sucursales.find(s => s.id === id);
    if (!actual) return res.status(404).json({ ok: false, error: "Sucursal no encontrada en esta empresa" });

    const compatibles = await referenciasCompatibles(id, actual.ubicaciones, base, token);
    const evaluacion = evaluarCambioSucursal(req.method === "PATCH" ? "renombrar" : "desactivar", {
      perteneceEmpresa: true, activa: actual.activa,
      usuariosAsignados: actual.usuariosAsignados,
      sucursalesActivas: sucursales.filter(s => s.activa).length,
      referenciasOperativasCompatibles: compatibles,
    });
    if (!evaluacion.permitido)
      return res.status(409).json({ ok: false, error: evaluacion.motivo });

    if (req.method === "PATCH") {
      const cambio = prepararCambioNombreSucursal(id, req.body.nombre, sucursales);
      if (!cambio.ok) return res.status(400).json({ ok: false, error: cambio.error });
      const actualizado = await escribirRegistro(base, tablaSucursales, token, "PATCH", cambio.campos, id);
      if (actualizado.fields.NOMBRE !== cambio.campos.NOMBRE)
        throw new Error("No se pudo confirmar el nuevo nombre");
      return res.status(200).json({
        ok: true, sucursal: { id, nombre: actualizado.fields.NOMBRE, activa: actual.activa },
      });
    }

    // La ausencia de usuarios NO alcanza: una ubicación puede conservar stock e historial.
    // Se bloquea hasta disponer de un flujo de cierre/migración auditado.
    if (actual.ubicaciones.length > 0)
      return res.status(409).json({
        ok: false, error: "La sucursal tiene ubicaciones e historial operativo; no se puede desactivar directamente",
      });
    const baja = prepararDesactivacionSucursal(id, sucursales, actual.usuariosAsignados);
    if (!baja.ok) return res.status(409).json({ ok: false, error: baja.error });
    const actualizado = await escribirRegistro(base, tablaSucursales, token, "PATCH", baja.campos, id);
    if (actualizado.fields.ACTIVA !== false) throw new Error("No se pudo confirmar la desactivación");
    return res.status(200).json({ ok: true, sucursal: { id, nombre: actual.nombre, activa: false } });
  } catch (error) {
    console.error("Paso 11B:", error);
    return res.status(503).json({ ok: false, error: "No se pudo gestionar las sucursales" });
  } finally {
    if (propietario) {
      try { await liberarAltaSucursal(empresaId, propietario); }
      catch (error) { console.error("No se pudo liberar el bloqueo:", error); }
    }
  }
}
