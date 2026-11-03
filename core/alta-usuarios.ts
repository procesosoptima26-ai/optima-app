/** OPTIMA — contrato puro para invitaciones; sin red ni secretos. */
import { CAMPOS_PERMISOS } from "./permisos-airtable.js";
import { MODULO_DEL_PERMISO, type ContextoCore, type Modulo, type Permiso } from "./seguridad.js";

export const CAMPO_EMAIL_USUARIOS = "Email"; // nombre real en Base Maestra

const modulosCampo: Readonly<Record<Modulo, string>> = {
  CORE: "USUARIO", INVENTARIO: "INVENTARIO", MOVIMIENTOS: "MOVIMIENTOS",
  CUENTAS_CORRIENTES: "CUENTAS_CORRIENTES", ADMINISTRACION: "ADMINISTRACION",
  FACTURACION: "FACTURACION", REPORTES: "REPORTES", CONFIGURACION: "AJUSTES",
  AUTOMATIZACIONES: "AUTOMATIZACIONES E INTEGRACIONES",
};

export function normalizarNombreModulo(valor: string): Modulo | null {
  const k = valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/[\s_]+/g, " ");
  const mapa: Record<string, Modulo> = {
    USUARIO: "CORE", CORE: "CORE", INVENTARIO: "INVENTARIO", MOVIMIENTOS: "MOVIMIENTOS",
    "CUENTAS CORRIENTES": "CUENTAS_CORRIENTES", ADMINISTRACION: "ADMINISTRACION",
    FACTURACION: "FACTURACION", REPORTES: "REPORTES", AJUSTES: "CONFIGURACION",
    CONFIGURACION: "CONFIGURACION", "AUTOMATIZACIONES E INTEGRACIONES": "AUTOMATIZACIONES",
    AUTOMATIZACIONES: "AUTOMATIZACIONES",
  };
  return mapa[k] ?? null;
}

function normalizarOpcion(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/[\s_-]+/g, "_");
}

export type OpcionesAlta = Readonly<{
  modulos: ReadonlyArray<{ id: Modulo; opcionAirtable: string }>;
  sucursales: ReadonlyArray<{ id: string; nombre: string }>;
  permisos: ReadonlyArray<{ id: Permiso; campo: string; opcionAirtable: string }>;
}>;

/** Solo ofrece opciones que el administrador posee de verdad y que su empresa habilita. */
export function opcionesParaAlta(
  contexto: ContextoCore,
  modulosOriginales: unknown,
  camposAdministrador: Record<string, unknown>
): OpcionesAlta {
  const modulos: Array<{ id: Modulo; opcionAirtable: string }> = [];
  if (Array.isArray(modulosOriginales)) {
    for (const valor of modulosOriginales) {
      if (typeof valor !== "string") continue;
      const id = normalizarNombreModulo(valor);
      if (id && contexto.modulosUsuario.includes(id) &&
          (id === "CORE" || contexto.modulosEmpresa.includes(id)) &&
          !modulos.some((m) => m.id === id)) {
        modulos.push({ id, opcionAirtable: valor });
      }
    }
  }
  // El módulo Core existe aun cuando no se ofrezca como producto comercial.
  if (!modulos.some((m) => m.id === "CORE")) modulos.push({ id: "CORE", opcionAirtable: modulosCampo.CORE });

  const permisos: Array<{ id: Permiso; campo: string; opcionAirtable: string }> = [];
  for (const [campo, mapa] of Object.entries(CAMPOS_PERMISOS)) {
    const originales = camposAdministrador[campo];
    if (!Array.isArray(originales)) continue;
    for (const original of originales) {
      if (typeof original !== "string") continue;
      const id = (mapa as Record<string, Permiso>)[normalizarOpcion(original)];
      if (id && contexto.permisos.includes(id) &&
          !permisos.some((p) => p.id === id)) {
        permisos.push({ id, campo, opcionAirtable: original });
      }
    }
  }
  return {
    modulos,
    permisos,
    sucursales: contexto.sucursalesAutorizadas.filter((s) => s.activa)
      .map((s) => ({ id: s.id, nombre: s.nombre })),
  };
}

export type SolicitudInvitacion = Readonly<{
  usuario: string;
  nombre: string;
  email: string;
  sucursalIds: string[];
  sucursalPredeterminadaId: string;
  modulos: Modulo[];
  permisos: Permiso[];
}>;

export type ResultadoAlta =
  | { ok: true; campos: Record<string, unknown>; usuario: string; email: string }
  | { ok: false; error: string };

/** Deniega asignaciones fuera del alcance del administrador y sin una sucursal real. */
export function construirAltaInvitado(
  peticion: unknown, contexto: ContextoCore, disponibles: OpcionesAlta
): ResultadoAlta {
  if (!peticion || typeof peticion !== "object") return { ok: false, error: "Solicitud inválida" };
  const v = peticion as Record<string, unknown>;
  const usuario = typeof v.usuario === "string" ? v.usuario.trim().toUpperCase() : "";
  const nombre = typeof v.nombre === "string" ? v.nombre.trim() : "";
  const email = typeof v.email === "string" ? v.email.trim().toLowerCase() : "";
  if (!/^[A-Z0-9._-]{3,40}$/.test(usuario) || !nombre || nombre.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 250) {
    return { ok: false, error: "Usuario, nombre o correo inválidos" };
  }
  if (!Array.isArray(v.sucursalIds) || !v.sucursalIds.length ||
      !v.sucursalIds.every((s) => typeof s === "string") ||
      typeof v.sucursalPredeterminadaId !== "string") {
    return { ok: false, error: "Seleccioná las sucursales y una predeterminada" };
  }
  const sucursalIds = [...new Set(v.sucursalIds as string[])];
  if (!sucursalIds.includes(v.sucursalPredeterminadaId) ||
      !sucursalIds.every((id) => disponibles.sucursales.some((s) => s.id === id))) {
    return { ok: false, error: "Sucursal fuera de tu empresa o de tus autorizaciones" };
  }
  if (!Array.isArray(v.modulos) || !Array.isArray(v.permisos) ||
      !v.modulos.every((s) => typeof s === "string") ||
      !v.permisos.every((s) => typeof s === "string")) {
    return { ok: false, error: "Módulos o permisos inválidos" };
  }
  const mods = [...new Set(v.modulos as string[])];
  const perms = [...new Set(v.permisos as string[])];
  if (!mods.includes("CORE") ||
      !mods.every((id) => disponibles.modulos.some((m) => m.id === id)) ||
      !perms.every((id) => disponibles.permisos.some((p) => p.id === id)) ||
      !perms.every((id) => MODULO_DEL_PERMISO[id as Permiso] === "CORE" ||
        mods.includes(MODULO_DEL_PERMISO[id as Permiso]))) {
    return { ok: false, error: "No podés conceder un módulo o permiso que no tenés" };
  }
  const campos: Record<string, unknown> = {
    USUARIO: usuario,
    NOMBRE: nombre,
    [CAMPO_EMAIL_USUARIOS]: email,
    EMPRESA: [contexto.empresa.id],
    ROL: "USUARIO", // Un administrador común nunca crea otro administrador.
    ACTIVO: false,
    MODULOS: mods.map((id) => disponibles.modulos.find((m) => m.id === id)!.opcionAirtable),
    SUCURSALES_AUTORIZADAS: sucursalIds,
    SUCURSAL_PREDETERMINADA: [v.sucursalPredeterminadaId],
  };
  for (const p of disponibles.permisos) {
    if (perms.includes(p.id)) {
      const actuales = campos[p.campo] as string[] | undefined;
      campos[p.campo] = [...(actuales ?? []), p.opcionAirtable];
    }
  }
  return { ok: true, campos, usuario, email };
}
