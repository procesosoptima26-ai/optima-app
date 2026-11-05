/**
 * Paso 11C.1 - Catálogo informativo del Core.
 * El campo MODULOS_CONTRATADOS expresa habilitación técnica,
 * no constituye prueba de un contrato comercial ni de implementación terminada.
 */
import { MODULOS, type Modulo } from "./seguridad.js";

type ModuloComercial = Exclude<Modulo, "CORE">;
export type FichaModulo = Readonly<{
  id: ModuloComercial;
  nombre: string;
  descripcion: string;
  habilitadoEnEmpresa: boolean;
}>;

const DESCRIPCIONES: Readonly<Record<ModuloComercial, Readonly<{ nombre: string; descripcion: string }>>> = {
  INVENTARIO: { nombre: "Inventario", descripcion: "Productos, existencias, ubicaciones y vencimientos" },
  MOVIMIENTOS: { nombre: "Movimientos", descripcion: "Recepciones, ventas, transferencias y ajustes" },
  CUENTAS_CORRIENTES: { nombre: "Cuentas corrientes", descripcion: "Saldos de clientes y proveedores" },
  ADMINISTRACION: { nombre: "Administración", descripcion: "Fondos, pagos, bancos y conciliaciones" },
  FACTURACION: { nombre: "Facturación", descripcion: "Remitos y comprobantes" },
  REPORTES: { nombre: "Reportes", descripcion: "Información e indicadores operativos" },
  CONFIGURACION: { nombre: "Configuración", descripcion: "Parámetros por empresa y módulo" },
  AUTOMATIZACIONES: { nombre: "Automatizaciones e integraciones", descripcion: "Reglas, alertas y conexiones externas" },
};

/** Solo se alimenta con módulos validados por el contexto del servidor. */
export function catalogoParaEmpresa(habilitados: readonly Modulo[]): FichaModulo[] {
  const reales = new Set(habilitados.filter(m => m !== "CORE"));
  return MODULOS.filter((m): m is ModuloComercial => m !== "CORE").map(id => ({
    id,
    nombre: DESCRIPCIONES[id].nombre,
    descripcion: DESCRIPCIONES[id].descripcion,
    habilitadoEnEmpresa: reales.has(id),
  }));
}
