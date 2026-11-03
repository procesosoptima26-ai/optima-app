/** Permisos de presentación de OPTIMA. No reemplazan la verificación de las API. */
export type SesionConPermisos = Readonly<{
  modulos: readonly string[];
  permisos?: readonly string[];
}> | null | undefined;

export function permiteAccionUI(
  usuario: SesionConPermisos, modulo: string, permiso: string
): boolean {
  return Boolean(usuario?.modulos.includes(modulo) && usuario.permisos?.includes(permiso));
}

/** Los ajustes se validan por tipo real, no por la etiqueta de la pestaña. */
export function permisoMovimientoPorTipo(tipo: string): "movimientos.crear" | "movimientos.ajustar" {
  const normalizado = tipo.trim().toUpperCase();
  return normalizado === "AJUSTE +" || normalizado === "AJUSTE -" ||
    normalizado === "AJUSTE POSITIVO" || normalizado === "AJUSTE NEGATIVO"
    ? "movimientos.ajustar" : "movimientos.crear";
}

export function permiteMovimientoUI(usuario: SesionConPermisos, tipo: string): boolean {
  return permiteAccionUI(usuario, "MOVIMIENTOS", permisoMovimientoPorTipo(tipo));
}

export type ModoMovimientoUI = "recepcion" | "reposicion" | "individual" | "stock";
export function permiteModoMovimientoUI(usuario: SesionConPermisos, modo: ModoMovimientoUI): boolean {
  if (modo === "stock") return permiteAccionUI(usuario, "MOVIMIENTOS", "movimientos.ver");
  // En la vista individual también se cargan INGRESO y EGRESO ordinarios.
  if (modo === "individual") return permiteAccionUI(usuario, "MOVIMIENTOS", "movimientos.ajustar") ||
    permiteAccionUI(usuario, "MOVIMIENTOS", "movimientos.crear");
  return permiteAccionUI(usuario, "MOVIMIENTOS", "movimientos.crear");
}

export function modoMovimientoInicialUI(usuario: SesionConPermisos): ModoMovimientoUI {
  for (const modo of ["recepcion", "individual", "stock"] as const) {
    if (permiteModoMovimientoUI(usuario, modo)) return modo;
  }
  return "stock";
}
