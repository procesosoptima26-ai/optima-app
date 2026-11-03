/** Simulación de la Base Maestra para las pruebas de API heredadas. Nunca usa la red. */
export const GOYA_CORE_ID = "rec88888888888888";
export const BELLA_VISTA_CORE_ID = "rec77777777777777";

export type MockCore = Readonly<{
  base: string;
  tablaUsuarios: string;
  tablaEmpresas: string;
  tablaSucursales: string;
  usuarioId: string;
  empresaId: string;
  usuarioActivo?: boolean;
  empresaActiva?: boolean;
  modulos?: string[];
  contratados?: string[];
  sucursales?: string[];
  claveEmpresa?: string;
  permisos?: Readonly<Record<string, readonly string[]>>;
}>;

export function respuestaCoreSimulada(direccion: string, opt: MockCore): Response | null {
  const url = new URL(direccion);
  if (url.hostname !== "api.airtable.com") return null;
  const base = `/v0/${opt.base}/`;
  if (!url.pathname.startsWith(base)) return null;
  const recurso = url.pathname.slice(base.length);
  const sucursales = opt.sucursales ?? ["GOYA"];
  const sucursalId = (nombre: string) => nombre === "GOYA" ? GOYA_CORE_ID : BELLA_VISTA_CORE_ID;
  if (recurso === `${opt.tablaUsuarios}/${opt.usuarioId}`) {
    return Response.json({ id: opt.usuarioId, fields: {
      USUARIO: "EMPLEADO_PRUEBA", NOMBRE: "Empleado de prueba", ROL: "USUARIO",
      ACTIVO: opt.usuarioActivo ?? true,
      EMPRESA: [opt.empresaId],
      MODULOS: opt.modulos ?? ["MOVIMIENTOS"],
      ...(opt.permisos ?? {
        PERMISOS_MOVIMIENTOS: ["VER", "CREAR", "AJUSTAR", "REVISAR AJUSTES", "EDITAR GUARDADO"],
        PERMISOS_INVENTARIO: ["VER", "CREAR", "EDITAR GUARDADO"],
        PERMISOS_ADMINISTRACION: ["VER", "GESTIONAR TERCEROS"],
      }),
      SUCURSALES_AUTORIZADAS: sucursales.map(sucursalId),
      SUCURSAL_PREDETERMINADA: [sucursalId(sucursales[0])],
    } });
  }
  if (recurso === `${opt.tablaEmpresas}/${opt.empresaId}`) {
    return Response.json({ id: opt.empresaId, fields: {
      ACTIVA: opt.empresaActiva ?? true,
      CLAVE_EMPRESA: opt.claveEmpresa ?? "FRIOTEKA",
      NOMBRE_COMERCIAL: "Empresa de prueba",
      MODULOS_CONTRATADOS: opt.contratados ?? [
        "INVENTARIO", "MOVIMIENTOS", "ADMINISTRACION", "REPORTES", "USUARIO",
      ],
    } });
  }
  if (recurso === `${opt.tablaSucursales}/${GOYA_CORE_ID}` ||
      recurso === `${opt.tablaSucursales}/${BELLA_VISTA_CORE_ID}`) {
    const id = recurso.split("/").at(-1);
    return Response.json({ id, fields: {
      NOMBRE: id === GOYA_CORE_ID ? "GOYA" : "BELLA VISTA",
      ACTIVA: true,
      EMPRESA: [opt.empresaId],
    } });
  }
  return null;
}
