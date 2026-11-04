
/**
 * OPTIMA — contrato central de identidad y autorización.
 * Fuente funcional: Mapa Maestro, Bloque 1 (Core).
 *
 * Este módulo NO hace peticiones ni identifica usuarios por sí mismo.
 * Recibe datos verificados por el servidor y evalúa sus alcances.
 */

export const MODULOS = [
  "CORE",
  "INVENTARIO",
  "MOVIMIENTOS",
  "CUENTAS_CORRIENTES",
  "ADMINISTRACION",
  "FACTURACION",
  "REPORTES",
  "CONFIGURACION",
  "AUTOMATIZACIONES",
] as const;

export type Modulo = (typeof MODULOS)[number];
export type RolUsuario = "ADMIN" | "USUARIO";

// Se mantienen los permisos que OPTIMA ya utiliza en sus pantallas.
// La ampliación de roles no requiere cambiar este contrato: los permisos
// efectivos se obtendrán de la asignación del usuario, no del nombre del rol.
export const PERMISOS = [
  "inventario.ver",
  "inventario.crear",
  "inventario.editarGuardado",
  "movimientos.ver",
  "movimientos.crear",
  "movimientos.ajustar",
  "movimientos.revisarAjustes",
  "movimientos.editarGuardado",
  "administracion.ver",
  "administracion.gestionarTerceros",
  "administracion.gestionarDocumentos",
  "administracion.gestionarPagos",
  "administracion.gestionarCheques",
  "administracion.gestionarBancos",
  "administracion.configurar",
  "facturacion.ver",
  "facturacion.crear",
  "reportes.ver",
  "reportes.exportar",
  "ajustes.ver",
  "ajustes.configurar",
  "usuarios.ver",
  "usuarios.gestionar",
  "sucursales.gestionar",
] as const;

export type Permiso = (typeof PERMISOS)[number];

export const MODULO_DEL_PERMISO: Readonly<Record<Permiso, Modulo>> = {
  "inventario.ver": "INVENTARIO",
  "inventario.crear": "INVENTARIO",
  "inventario.editarGuardado": "INVENTARIO",
  "movimientos.ver": "MOVIMIENTOS",
  "movimientos.crear": "MOVIMIENTOS",
  "movimientos.ajustar": "MOVIMIENTOS",
  "movimientos.revisarAjustes": "MOVIMIENTOS",
  "movimientos.editarGuardado": "MOVIMIENTOS",
  "administracion.ver": "ADMINISTRACION",
  "administracion.gestionarTerceros": "ADMINISTRACION",
  "administracion.gestionarDocumentos": "ADMINISTRACION",
  "administracion.gestionarPagos": "ADMINISTRACION",
  "administracion.gestionarCheques": "ADMINISTRACION",
  "administracion.gestionarBancos": "ADMINISTRACION",
  "administracion.configurar": "ADMINISTRACION",
  "facturacion.ver": "FACTURACION",
  "facturacion.crear": "FACTURACION",
  "reportes.ver": "REPORTES",
  "reportes.exportar": "REPORTES",
  "ajustes.ver": "CONFIGURACION",
  "ajustes.configurar": "CONFIGURACION",
  "usuarios.ver": "CORE",
  "usuarios.gestionar": "CORE",
  "sucursales.gestionar": "CORE",
};

// Compatibilidad EXACTA con los permisos de UI existentes.
// No se utiliza este mapa como autoridad del servidor.
const PERMISOS_UI_POR_ROL: Readonly<Record<RolUsuario, readonly Permiso[]>> = {
  USUARIO: [
    "inventario.ver",
    "inventario.crear",
    "movimientos.ver",
    "movimientos.crear",
    "movimientos.ajustar",
    "administracion.ver",
    "reportes.ver",
    "usuarios.ver",
  ],
  ADMIN: [
    "inventario.ver",
    "inventario.crear",
    "inventario.editarGuardado",
    "movimientos.ver",
    "movimientos.crear",
    "movimientos.ajustar",
    "movimientos.revisarAjustes",
    "movimientos.editarGuardado",
    "administracion.ver",
    "administracion.gestionarTerceros",
    "administracion.gestionarDocumentos",
    "administracion.gestionarPagos",
    "administracion.gestionarCheques",
    "administracion.gestionarBancos",
    "administracion.configurar",
    "facturacion.ver",
    "facturacion.crear",
    "reportes.ver",
    "reportes.exportar",
    "ajustes.ver",
    "ajustes.configurar",
    "usuarios.ver",
    "usuarios.gestionar",
  ],
};

function normalizarRolLegacy(rol: string): RolUsuario {
  return rol.trim().toUpperCase() === "ADMIN" ? "ADMIN" : "USUARIO";
}

/** Compatibilidad con las pantallas actuales; NO usar para autorizar API. */
export function tienePermiso(rol: string, permiso: Permiso): boolean {
  return PERMISOS_UI_POR_ROL[normalizarRolLegacy(rol)].includes(permiso);
}

/** Compatibilidad con las pantallas actuales; NO usar para autorizar API. */
export function esAdmin(rol: string): boolean {
  return normalizarRolLegacy(rol) === "ADMIN";
}

export type EmpresaCore = Readonly<{
  /** ID canónico de OPTIMA: no es el ID de una empresa en una base secundaria. */
  id: string;
  clave: string;
  activa: boolean;
}>;

export type SucursalCore = Readonly<{
  /** ID o clave única dentro del Core, nunca solamente el nombre visible. */
  id: string;
  empresaId: string;
  nombre: string;
  activa: boolean;
}>;

export type ContextoCore = Readonly<{
  usuarioId: string;
  activo: boolean;
  empresa: EmpresaCore;
  sucursalesAutorizadas: readonly SucursalCore[];
  /** Módulos contratados y activos en la empresa. */
  modulosEmpresa: readonly Modulo[];
  /** Módulos habilitados a este usuario dentro de la empresa. */
  modulosUsuario: readonly Modulo[];
  /** Acciones efectivas verificadas por el servidor. */
  permisos: readonly Permiso[];
}>;

export type RecursoCore = Readonly<{
  empresaId: string;
  sucursalId?: string;
}>;

/**
 * Rechaza por defecto cuando faltan datos o un permiso.
 * Nunca confía en el nombre de la sucursal ni en una empresa recibida
 * sin verificar por la API.
 *
 * La API debe construir `contexto` desde su sesión y la base maestra;
 * no debe aceptar `contexto` como body del navegador.
 */
export function puedeRealizarAccion(
  contexto: ContextoCore,
  permiso: Permiso,
  recurso: RecursoCore
): boolean {
  if (!contexto.activo || !contexto.empresa.activa) return false;
  if (!contexto.usuarioId || !contexto.empresa.id || !recurso.empresaId) {
    return false;
  }
  if (contexto.empresa.id !== recurso.empresaId) return false;

  const modulo = MODULO_DEL_PERMISO[permiso];
  if (!modulo || !contexto.permisos.includes(permiso)) return false;

  // El Core no es un módulo comercial: existe siempre.
  if (
    modulo !== "CORE" &&
    (!contexto.modulosEmpresa.includes(modulo) ||
      !contexto.modulosUsuario.includes(modulo))
  ) {
    return false;
  }

  // Inventario y movimientos siempre se verifican contra una sucursal
  // real, incluso cuando el navegador intente omitirla.
  const requiereSucursal = modulo === "INVENTARIO" || modulo === "MOVIMIENTOS";
  if (requiereSucursal && !recurso.sucursalId) return false;

  if (recurso.sucursalId !== undefined) {
    if (!recurso.sucursalId) return false;
    const sucursalPermitida = contexto.sucursalesAutorizadas.some(
      (sucursal) =>
        sucursal.activa &&
        sucursal.id === recurso.sucursalId &&
        sucursal.empresaId === contexto.empresa.id
    );
    if (!sucursalPermitida) return false;
  }

  return true;
}
