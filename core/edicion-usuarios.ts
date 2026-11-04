/** Paso 10B — contratos de edición de accesos, sin mutaciones de identidad. */
import { createHash } from "node:crypto";
import { normalizarNombreModulo, type OpcionesAlta } from "./alta-usuarios.js";
import { CAMPOS_PERMISOS, leerPermisosAsignados } from "./permisos-airtable.js";
import { MODULO_DEL_PERMISO, type Modulo, type Permiso } from "./seguridad.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const CAMPOS_EDITABLES = [
  "SUCURSALES_AUTORIZADAS", "SUCURSAL_PREDETERMINADA", "MODULOS",
  ...Object.keys(CAMPOS_PERMISOS),
] as const;
type Registro = { id: string; fields: Record<string, unknown> };

export type DetalleEmpleado = Readonly<{
  id: string; usuario: string; nombre: string; activo: boolean;
  sucursalIds: string[]; sucursalPredeterminadaId: string;
  modulos: Modulo[]; permisos: Permiso[]; version: string;
}>;

export function versionAcceso(registro: Registro): string {
  const f = registro.fields;
  const datos: Record<string, unknown> = {
    id: registro.id, EMPRESA: f.EMPRESA ?? null,
    ROL: f.ROL ?? null, ACTIVO: f.ACTIVO ?? null,
  };
  for (const campo of CAMPOS_EDITABLES) datos[campo] = f[campo] ?? [];
  return createHash("sha256").update(JSON.stringify(datos)).digest("hex");
}

/** Niega empleados de otra empresa, otras cuentas ADMIN y alcances que superan al editor. */
export function leerEmpleadoEditable(
  registro: Registro | null,
  empresaId: string,
  administradorId: string,
  opciones: OpcionesAlta,
): DetalleEmpleado | null {
  if (!registro || !ID.test(registro.id) || registro.id === administradorId ||
      !registro.fields || typeof registro.fields !== "object") return null;
  const f = registro.fields;
  if (!Array.isArray(f.EMPRESA) || f.EMPRESA.length !== 1 || f.EMPRESA[0] !== empresaId ||
      f.ROL !== "USUARIO" || typeof f.ACTIVO !== "boolean") return null;

  const branches = f.SUCURSALES_AUTORIZADAS;
  const pred = f.SUCURSAL_PREDETERMINADA;
  if (!Array.isArray(branches) || branches.length < 1 ||
      branches.length > opciones.sucursales.length ||
      !branches.every((id) => typeof id === "string" && ID.test(id) &&
        opciones.sucursales.some((s) => s.id === id)) ||
      new Set(branches).size !== branches.length ||
      !Array.isArray(pred) || pred.length !== 1 || !branches.includes(pred[0])) return null;

  if (!Array.isArray(f.MODULOS) || f.MODULOS.length < 1 ||
      !f.MODULOS.every((v) => typeof v === "string")) return null;
  const modulos: Modulo[] = [];
  for (const original of f.MODULOS) {
    const modulo = normalizarNombreModulo(original);
    if (!modulo || !opciones.modulos.some((m) => m.id === modulo)) return null;
    if (!modulos.includes(modulo)) modulos.push(modulo);
  }
  if (!modulos.includes("CORE")) return null;

  const permisos = leerPermisosAsignados(f);
  if (!permisos || !permisos.every((p) => opciones.permisos.some((o) => o.id === p))) return null;

  return {
    id: registro.id,
    usuario: typeof f.USUARIO === "string" ? f.USUARIO : "",
    nombre: typeof f.NOMBRE === "string" ? f.NOMBRE : "",
    activo: f.ACTIVO,
    sucursalIds: [...branches] as string[],
    sucursalPredeterminadaId: pred[0] as string,
    modulos, permisos, version: versionAcceso(registro),
  };
}

export type ResultadoCambios =
  | { ok: true; campos: Record<string, unknown> }
  | { ok: false; error: string };

/** Verifica que cada permiso, módulo y sucursal nuevos estén dentro del alcance del ADMIN. */
export function construirCambiosEmpleado(solicitud: unknown, opciones: OpcionesAlta): ResultadoCambios {
  if (!solicitud || typeof solicitud !== "object") return { ok: false, error: "Solicitud inválida" };
  const v = solicitud as Record<string, unknown>;
  const sucs = v.sucursalIds;
  const pred = v.sucursalPredeterminadaId;
  const mods = v.modulos;
  const perms = v.permisos;

  if (!Array.isArray(sucs) || sucs.length < 1 || sucs.length > opciones.sucursales.length ||
      !sucs.every((id) => typeof id === "string" && ID.test(id) &&
        opciones.sucursales.some((s) => s.id === id)) ||
      new Set(sucs).size !== sucs.length ||
      typeof pred !== "string" || !sucs.includes(pred))
    return { ok: false, error: "Seleccioná una sucursal predeterminada autorizada" };

  if (!Array.isArray(mods) || !mods.length || mods.length > opciones.modulos.length ||
      !mods.every((id) => typeof id === "string" && opciones.modulos.some((m) => m.id === id)) ||
      new Set(mods).size !== mods.length || !mods.includes("CORE"))
    return { ok: false, error: "Módulos fuera de tus autorizaciones" };

  if (!Array.isArray(perms) || perms.length > opciones.permisos.length ||
      !perms.every((id) => typeof id === "string" && opciones.permisos.some((p) => p.id === id)) ||
      new Set(perms).size !== perms.length ||
      !perms.every((id) => MODULO_DEL_PERMISO[id as Permiso] === "CORE" ||
        mods.includes(MODULO_DEL_PERMISO[id as Permiso])))
    return { ok: false, error: "Permisos fuera de tus autorizaciones o de los módulos seleccionados" };

  const campos: Record<string, unknown> = {
    SUCURSALES_AUTORIZADAS: [...sucs],
    SUCURSAL_PREDETERMINADA: [pred],
    MODULOS: mods.map((id) => opciones.modulos.find((o) => o.id === id)!.opcionAirtable),
  };
  // Los campos no marcados deben quedar vacíos; PATCH parcial conservaría permisos anteriores.
  for (const campo of Object.keys(CAMPOS_PERMISOS)) campos[campo] = [];
  for (const id of perms as Permiso[]) {
    const opcion = opciones.permisos.find((p) => p.id === id)!;
    (campos[opcion.campo] as string[]).push(opcion.opcionAirtable);
  }
  return { ok: true, campos };
}
