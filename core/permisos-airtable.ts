/** Asignaciones de acciones por módulo en OPTIMA - BASE MAESTRA.
 * Los nombres en Airtable son legibles; las claves del Core son estables.
 * Si existe una opción desconocida, NO se conceden permisos.
 */
import { PERMISOS, type Permiso } from "./seguridad.js";

export const CAMPOS_PERMISOS = {
  PERMISOS_INVENTARIO: {
    VER: "inventario.ver",
    CREAR: "inventario.crear",
    EDITAR_GUARDADO: "inventario.editarGuardado",
  },
  PERMISOS_MOVIMIENTOS: {
    VER: "movimientos.ver",
    CREAR: "movimientos.crear",
    AJUSTAR: "movimientos.ajustar",
    REVISAR_AJUSTES: "movimientos.revisarAjustes",
    EDITAR_GUARDADO: "movimientos.editarGuardado",
  },
  PERMISOS_ADMINISTRACION: {
    VER: "administracion.ver",
    GESTIONAR_TERCEROS: "administracion.gestionarTerceros",
    GESTIONAR_DOCUMENTOS: "administracion.gestionarDocumentos",
    GESTIONAR_PAGOS: "administracion.gestionarPagos",
    GESTIONAR_CHEQUES: "administracion.gestionarCheques",
    GESTIONAR_BANCOS: "administracion.gestionarBancos",
    CONFIGURAR: "administracion.configurar",
  },
  PERMISOS_FACTURACION: {
    VER: "facturacion.ver",
    CREAR: "facturacion.crear",
  },
  PERMISOS_REPORTES: {
    VER: "reportes.ver",
    EXPORTAR: "reportes.exportar",
  },
  PERMISOS_AJUSTES: {
    VER: "ajustes.ver",
    CONFIGURAR: "ajustes.configurar",
  },
  PERMISOS_SUCURSALES: {
    GESTIONAR_SUCURSALES: "sucursales.gestionar",
  },
  PERMISOS_USUARIOS: {
    VER: "usuarios.ver",
    GESTIONAR_USUARIOS: "usuarios.gestionar",
  },
} as const satisfies Record<string, Record<string, Permiso>>;

function clavePermiso(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase().replace(/[\s_-]+/g, "_");
}

/** Airtable omite campos sin selección. Eso significa sin permisos, nunca 'todos'. */
export function leerPermisosAsignados(campos: Record<string, unknown>): Permiso[] | null {
  const resultado = new Set<Permiso>();
  for (const [nombreCampo, opciones] of Object.entries(CAMPOS_PERMISOS)) {
    const asignaciones = campos[nombreCampo];
    if (asignaciones === undefined) continue;
    if (!Array.isArray(asignaciones)) return null;
    for (const entrada of asignaciones) {
      if (typeof entrada !== "string") return null;
      const permiso = (opciones as Record<string, Permiso>)[clavePermiso(entrada)];
      if (!permiso || !PERMISOS.includes(permiso)) return null;
      resultado.add(permiso);
    }
  }
  return [...resultado];
}
