export type RolUsuario = "ADMIN" | "USUARIO";

export type Permiso =
  | "inventario.ver"
  | "inventario.crear"
  | "inventario.editarGuardado"
  | "movimientos.ver"
  | "movimientos.crear"
  | "movimientos.ajustar"
  | "movimientos.revisarAjustes"
  | "movimientos.editarGuardado"
  | "cuentasCorrientes.ver"
  | "cuentasCorrientes.crear"
  | "cuentasCorrientes.editarGuardado"
  | "cuentasCorrientes.exportar"
  | "facturacion.ver"
  | "facturacion.crear"
  | "reportes.ver"
  | "reportes.exportar"
  | "ajustes.ver"
  | "ajustes.configurar"
  | "usuarios.ver"
  | "usuarios.gestionar";

const permisosPorRol: Record<RolUsuario, Permiso[]> = {
  USUARIO: [
    "inventario.ver",
    "inventario.crear",

    "movimientos.ver",
    "movimientos.crear",
    "movimientos.ajustar",

    "cuentasCorrientes.ver",
    "cuentasCorrientes.crear",

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

    "cuentasCorrientes.ver",
    "cuentasCorrientes.crear",
    "cuentasCorrientes.editarGuardado",
    "cuentasCorrientes.exportar",

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

function normalizarRol(rol: string): RolUsuario {
  return rol.trim().toUpperCase() === "ADMIN" ? "ADMIN" : "USUARIO";
}

export function tienePermiso(rol: string, permiso: Permiso): boolean {
  const rolNormalizado = normalizarRol(rol);

  return permisosPorRol[rolNormalizado].includes(permiso);
}

export function esAdmin(rol: string): boolean {
  return normalizarRol(rol) === "ADMIN";
}