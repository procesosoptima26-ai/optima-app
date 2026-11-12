/** Lectura independiente del estado canónico. No acepta snapshots del navegador. */
import { leerUsuario } from "./usuarios-maestros.js";
import { versionAcceso } from "../core/edicion-usuarios.js";
import { normalizarNombreModulo } from "../core/alta-usuarios.js";
import { leerPermisosAsignados } from "../core/permisos-airtable.js";
import type { AccionConciliableCore, SnapshotAuditoriaCore } from "./conciliacion-core-global.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const BASE = /^app[A-Za-z0-9]{14}$/;
const TABLA = /^tbl[A-Za-z0-9]{14}$/;
export type LectorEstadoConciliacionCore = (empresaId: string, recursoId: string,
  accion: AccionConciliableCore) => Promise<SnapshotAuditoriaCore>;

function ids(value: unknown, minimo: number, maximo: number): string[] {
  if (!Array.isArray(value) || value.length < minimo || value.length > maximo ||
      !value.every(x => typeof x === "string" && ID.test(x)) ||
      new Set(value).size !== value.length) throw new Error("ESTADO_INVALIDO");
  return value as string[];
}

/** Para empleados, misma derivación de la edición de accesos: versión sobre campos originales. */
async function consultarAccesos(empresaId: string, recursoId: string): Promise<SnapshotAuditoriaCore> {
  const r = await leerUsuario(recursoId);
  if (!r || r.id !== recursoId || !r.fields ||
      ids(r.fields.EMPRESA, 1, 1)[0] !== empresaId || r.fields.ROL !== "USUARIO" ||
      typeof r.fields.ACTIVO !== "boolean") throw new Error("EMPLEADO_NO_VERIFICABLE");
  const f = r.fields;
  const sucursales = ids(f.SUCURSALES_AUTORIZADAS, 1, 100);
  const principal = ids(f.SUCURSAL_PREDETERMINADA, 1, 1)[0];
  if (!sucursales.includes(principal) || !Array.isArray(f.MODULOS) ||
      f.MODULOS.length < 1 || f.MODULOS.length > 30) throw new Error("EMPLEADO_NO_VERIFICABLE");
  const modulos = f.MODULOS.map((m: unknown) => typeof m === "string" ? normalizarNombreModulo(m) : null);
  if (modulos.some(x => !x) || new Set(modulos).size !== modulos.length || !modulos.includes("CORE"))
    throw new Error("MODULOS_NO_VERIFICABLES");
  const permisos = leerPermisosAsignados(f);
  if (!permisos || new Set(permisos).size !== permisos.length || permisos.length > 60)
    throw new Error("PERMISOS_NO_VERIFICABLES");
  return {
    ACTIVA: f.ACTIVO,
    SUCURSALES: [...sucursales].sort(),
    SUCURSAL_PRINCIPAL: principal,
    MODULOS_HABILITADOS: [...modulos].sort(),
    PERMISOS: [...permisos].sort(),
    VERSION: versionAcceso(r),
  };
}

async function leerRegistro(base: string, tabla: string, id: string, token: string) {
  const r = await fetch(`https://api.airtable.com/v0/${base}/${tabla}/${id}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("LECTURA_NO_DISPONIBLE");
  const registro: unknown = await r.json();
  if (!registro || typeof registro !== "object" || Array.isArray(registro)) throw new Error("LECTURA_INVALIDA");
  const valor = registro as { id?: unknown; fields?: unknown };
  if (valor.id !== id || !valor.fields || typeof valor.fields !== "object" || Array.isArray(valor.fields))
    throw new Error("LECTURA_INVALIDA");
  return valor.fields as Record<string, unknown>;
}
async function consultarSucursal(empresaId: string, recursoId: string): Promise<SnapshotAuditoriaCore> {
  const base = process.env.AIRTABLE_USERS_BASE_ID?.trim() ?? "";
  const tablaSucursales = process.env.AIRTABLE_SUCURSALES_TABLE_ID?.trim() ?? "";
  const tablaEmpresas = process.env.AIRTABLE_COMPANIES_TABLE_ID?.trim() ?? "";
  const token = process.env.AIRTABLE_TOKEN?.trim() ?? "";
  if (!BASE.test(base) || !TABLA.test(tablaSucursales) || !TABLA.test(tablaEmpresas) || !token)
    throw new Error("CONFIG_INVALIDA");
  const [sucursal, empresa] = await Promise.all([
    leerRegistro(base, tablaSucursales, recursoId, token),
    leerRegistro(base, tablaEmpresas, empresaId, token),
  ]);
  if (ids(sucursal.EMPRESA, 1, 1)[0] !== empresaId ||
      !ids(empresa.SUCURSALES, 1, 100).includes(recursoId) ||
      typeof sucursal.NOMBRE !== "string" || !sucursal.NOMBRE.trim() ||
      sucursal.NOMBRE.length > 80 || typeof sucursal.ACTIVA !== "boolean")
    throw new Error("SUCURSAL_NO_VERIFICABLE");
  return { ACTIVA: sucursal.ACTIVA, NOMBRE_SUCURSAL: sucursal.NOMBRE.trim(), SUCURSAL_ID: recursoId };
}

export const leerEstadoCoreParaConciliacion: LectorEstadoConciliacionCore = async (empresaId, recursoId, accion) => {
  if (!ID.test(empresaId) || !ID.test(recursoId)) throw new Error("IDENTIFICADORES_INVALIDOS");
  return accion === "USUARIO_EDITAR_ACCESOS" ? consultarAccesos(empresaId, recursoId) :
    consultarSucursal(empresaId, recursoId);
};
