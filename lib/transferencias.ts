/**
 * OPTIMA — Transferencias entre sucursales (lógica pura, sin red).
 *
 * Quién envía elige la sucursal y la ubicación de destino, y la mercadería
 * entra directo al stock de destino. Acá se decide QUÉ destinos se ofrecen y
 * si un destino es válido. El servidor siempre vuelve a validar: la pantalla
 * solo ayuda, nunca es la que decide.
 */

export type UbicacionTransferencia = Readonly<{
  id: string;
  nombre: string;
  tipoUbicacion: string;
  sucursalCoreId: string | null;
}>;

export type SucursalTransferencia = Readonly<{
  id: string;
  nombre: string;
  activa: boolean;
}>;

export type DestinoTransferencia = {
  sucursalId: string;
  sucursalNombre: string;
  ubicaciones: { id: string; nombre: string; tipoUbicacion: string }[];
};

/** Sucursales activas de la empresa distintas de la de origen, con sus ubicaciones. */
export function destinosTransferencia(
  sucursalesEmpresa: readonly SucursalTransferencia[],
  ubicaciones: readonly UbicacionTransferencia[],
  sucursalOrigenId: string,
): DestinoTransferencia[] {
  return sucursalesEmpresa
    .filter((s) => s.activa && s.id !== sucursalOrigenId)
    .map((s) => ({
      sucursalId: s.id,
      sucursalNombre: s.nombre,
      ubicaciones: ubicaciones
        .filter((u) => u.sucursalCoreId === s.id)
        .map((u) => ({ id: u.id, nombre: u.nombre, tipoUbicacion: u.tipoUbicacion })),
    }))
    .filter((d) => d.ubicaciones.length > 0)
    .sort((a, b) => a.sucursalNombre.localeCompare(b.sucursalNombre, "es"));
}

/**
 * Devuelve un mensaje de error, o "" si la transferencia es válida.
 * `sucursalesActivasEmpresaIds` = SOLO sucursales activas de la empresa del usuario.
 */
export function validarTransferencia(entrada: {
  tipoMovimiento: string;
  origen: UbicacionTransferencia | null;
  destino: UbicacionTransferencia | null;
  sucursalUsuarioId: string;
  sucursalesActivasEmpresaIds: ReadonlySet<string>;
}): string {
  const { origen, destino } = entrada;
  if (entrada.tipoMovimiento !== "EGRESO") {
    return "La transferencia debe registrarse como egreso desde la sucursal de origen.";
  }
  if (!origen) return "La transferencia necesita una ubicación de origen.";
  if (!destino) return "La transferencia necesita una ubicación de destino.";
  if (origen.sucursalCoreId !== entrada.sucursalUsuarioId) {
    return "La ubicación de origen no pertenece a la sucursal del usuario.";
  }
  if (!destino.sucursalCoreId ||
      !entrada.sucursalesActivasEmpresaIds.has(destino.sucursalCoreId)) {
    return "La ubicación de destino no pertenece a una sucursal activa de tu empresa.";
  }
  if (destino.sucursalCoreId === origen.sucursalCoreId) {
    return "Para mover mercadería dentro de la misma sucursal usá Reposición, no Transferencia.";
  }
  return "";
}

export function esMotivoTransferencia(motivo: unknown): boolean {
  return typeof motivo === "string" && motivo.trim().toUpperCase() === "TRANSFERENCIA";
}
