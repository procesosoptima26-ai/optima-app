/**
 * OPTIMA 12C.16.2 — Catálogo comercial jerárquico funcional v1.0 (10-11-2026).
 * Fuente: OPTIMA_Catalogo_Comercial_Jerarquico_v1_0.docx.
 * 6 módulos, 29 submódulos. Es descripción comercial, NO garantía de implementación.
 * Este módulo NO consulta redes, NO escribe contratos y NO concede permisos.
 * IDs históricos CHEQUES y BANCOS conservados por compatibilidad con 12C.12–15.2.
 * Otros IDs son identificadores nuevos y no implican una migración de datos existente.
 */
import type { DefinicionSubmodulo, ModuloComercial } from "./reglas-comerciales.js";

export type FichaSubmoduloComercial = Readonly<{
  id: string;
  moduloPadre: ModuloComercial;
  nombre: string;
  /** Alcance de la contratación individual ESTANDAR. */
  estandar: string;
  /** Prestaciones adicionales a ESTANDAR en la modalidad individual PREMIUM. */
  premium: string;
}>;

const FICHAS: readonly FichaSubmoduloComercial[] = [
  { id: "INV_PRODUCTOS", moduloPadre: "INVENTARIO", nombre: "Productos",
    estandar: "Catálogo, alta y consultas", premium: "Calidad del maestro y asistencia inteligente" },
  { id: "INV_STOCK_UBICACIONES", moduloPadre: "INVENTARIO", nombre: "Stock y ubicaciones",
    estandar: "Existencias por sucursal/ubicación", premium: "Análisis de distribución y necesidades" },
  { id: "INV_LOTES_VENCIMIENTOS", moduloPadre: "INVENTARIO", nombre: "Lotes y vencimientos",
    estandar: "Registro, consulta y alertas de vencimiento", premium: "Seguimiento automático y propuestas asistidas" },
  { id: "INV_CONTEOS_CONTROL_FISICO", moduloPadre: "INVENTARIO", nombre: "Conteos y control físico",
    estandar: "Conteo, diferencias y segundo conteo", premium: "Análisis inteligente de diferencias" },
  { id: "INV_COMPARACION_EXTERNA", moduloPadre: "INVENTARIO", nombre: "Comparación externa",
    estandar: "Comparación con archivo/sistema externo", premium: "Conciliación asistida de diferencias" },
  { id: "INV_COSTOS_PRECIOS", moduloPadre: "INVENTARIO", nombre: "Costos y precios",
    estandar: "Registro y consulta de costos/precios", premium: "Sugerencias de actualización sujetas a confirmación" },
  { id: "MOV_RECEPCION_MERCADERIA", moduloPadre: "MOVIMIENTOS", nombre: "Recepción de mercadería",
    estandar: "Ingresos manuales, lotes y ubicación", premium: "Lectura asistida de facturas y recepción preparada" },
  { id: "MOV_VENTAS_EGRESOS", moduloPadre: "MOVIMIENTOS", nombre: "Ventas y egresos",
    estandar: "Salidas y ventas manuales", premium: "POS/importaciones/sincronizaciones compatibles" },
  { id: "MOV_REPOSICION", moduloPadre: "MOVIMIENTOS", nombre: "Reposición",
    estandar: "Registro y seguimiento", premium: "Propuestas inteligentes de reposición" },
  { id: "MOV_TRANSFERENCIAS", moduloPadre: "MOVIMIENTOS", nombre: "Transferencias",
    estandar: "Entre ubicaciones o sucursales", premium: "Preparación y seguimiento automatizado" },
  { id: "MOV_DEVOLUCIONES_BAJAS", moduloPadre: "MOVIMIENTOS", nombre: "Devoluciones y bajas",
    estandar: "Devoluciones, roturas, merma, vencimiento", premium: "Detección de patrones y anomalías" },
  { id: "MOV_AJUSTES_CORRECCIONES", moduloPadre: "MOVIMIENTOS", nombre: "Ajustes y correcciones",
    estandar: "Correcciones con motivos y autorización", premium: "Detección asistida de inconsistencias" },
  { id: "CC_CUENTAS_POR_COBRAR", moduloPadre: "CUENTAS_CORRIENTES", nombre: "Cuentas por cobrar",
    estandar: "Clientes, saldos, documentos, cobros parciales, vencimientos, estados y resúmenes", premium: "Análisis de deudores, seguimiento y cobranza asistida" },
  { id: "CC_CUENTAS_POR_PAGAR", moduloPadre: "CUENTAS_CORRIENTES", nombre: "Cuentas por pagar",
    estandar: "Proveedores, saldos, documentos, pagos parciales, vencimientos, estados y resúmenes", premium: "Prioridades inteligentes y seguimiento automatizado" },
  { id: "ADM_CAJA_FONDOS", moduloPadre: "ADMINISTRACION", nombre: "Caja y fondos",
    estandar: "Caja operativa, caja fuerte, saldos y transferencias internas", premium: "Anomalías y controles inteligentes" },
  { id: "CHEQUES", moduloPadre: "ADMINISTRACION", nombre: "Cheques",
    estandar: "Emitidos/recibidos, estados, vencimientos, alertas y calendario", premium: "Análisis de concentración, avisos automáticos, integraciones compatibles" },
  { id: "BANCOS", moduloPadre: "ADMINISTRACION", nombre: "Bancos",
    estandar: "Cuentas y operaciones bancarias manuales", premium: "Sincronización y análisis de anomalías" },
  { id: "ADM_CONCILIACION_BANCARIA", moduloPadre: "ADMINISTRACION", nombre: "Conciliación bancaria",
    estandar: "Cruce manual, acreditaciones, retenciones/comisiones y diferencias", premium: "Matching y conciliación asistida" },
  { id: "ADM_JORNADAS_CONCILIACION_GENERAL", moduloPadre: "ADMINISTRACION", nombre: "Jornadas y conciliación general",
    estandar: "Cierres diarios, medios de cobro, diferencias", premium: "Lectura y conciliación asistida" },
  { id: "ADM_PAGOS_PLANIFICACION", moduloPadre: "ADMINISTRACION", nombre: "Pagos y planificación",
    estandar: "Pagos, programación, compromisos, calendario", premium: "Proyección y seguimiento automatizado" },
  { id: "ADM_DOCUMENTOS_ADMINISTRATIVOS", moduloPadre: "ADMINISTRACION", nombre: "Documentos administrativos",
    estandar: "Carga, archivo y vinculación de comprobantes", premium: "Extracción inteligente de foto/PDF" },
  { id: "FAC_REMITOS", moduloPadre: "FACTURACION", nombre: "Remitos",
    estandar: "Emisión, historial, estados, PDF", premium: "Asistencia y automatizaciones" },
  { id: "FAC_FACTURACION_ELECTRONICA", moduloPadre: "FACTURACION", nombre: "Facturación electrónica",
    estandar: "Facturas, ARCA, CAE, NC/ND, validaciones, errores, PDF e historial", premium: "Preparación inteligente e integraciones ampliadas" },
  { id: "FAC_FACTURACION_MASIVA", moduloPadre: "FACTURACION", nombre: "Facturación masiva",
    estandar: "Procesamiento controlado de múltiples comprobantes", premium: "Asistencia e integraciones avanzadas" },
  { id: "REP_OPERATIVOS", moduloPadre: "REPORTES", nombre: "Reportes operativos",
    estandar: "Existencias, lotes y movimientos disponibles", premium: "Patrones y análisis inteligente" },
  { id: "REP_COMERCIALES", moduloPadre: "REPORTES", nombre: "Reportes comerciales",
    estandar: "Ventas/productos/clientes disponibles", premium: "Tendencias e IA analítica" },
  { id: "REP_FINANCIEROS", moduloPadre: "REPORTES", nombre: "Reportes financieros",
    estandar: "Fondos, bancos, pagos, compromisos disponibles", premium: "Proyecciones y análisis de riesgos" },
  { id: "REP_RENTABILIDAD", moduloPadre: "REPORTES", nombre: "Rentabilidad",
    estandar: "Márgenes/costos/ventas que tengan datos de origen", premium: "Análisis de variaciones y recomendaciones" },
  { id: "REP_CONTABLES_FISCALES", moduloPadre: "REPORTES", nombre: "Contables y fiscales",
    estandar: "Libros IVA Compras/Ventas y registros fiscales disponibles; exportación para contador", premium: "Conciliación y detección inteligente de inconsistencias" },
];

/** Información para administración/comercial; no sirve como permiso operativo. */
export const CATALOGO_COMERCIAL_JERARQUICO: readonly FichaSubmoduloComercial[] =
  Object.freeze(FICHAS.map((ficha) => Object.freeze({ ...ficha })));

/**
 * Adaptador ESTRICTO para el motor 12C.12. Ese motor exige solo id y moduloPadre:
 * jamás pasarle FichaSubmoduloComercial, que contiene campos adicionales.
 */
export const CATALOGO_SUBMODULOS_CONTRATACION: readonly DefinicionSubmodulo[] =
  Object.freeze(CATALOGO_COMERCIAL_JERARQUICO.map(({ id, moduloPadre }) =>
    Object.freeze({ id, moduloPadre })));

export function buscarSubmoduloComercial(id: string): FichaSubmoduloComercial | null {
  return CATALOGO_COMERCIAL_JERARQUICO.find((ficha) => ficha.id === id) ?? null;
}

export function submodulosDeModulo(modulo: ModuloComercial): readonly FichaSubmoduloComercial[] {
  return CATALOGO_COMERCIAL_JERARQUICO.filter((ficha) => ficha.moduloPadre === modulo);
}

/**
 * Condiciones de diseño que aún NO son autorización ejecutable:
 * - Historial de Movimientos, maestros de terceros y Core NO son submódulos vendibles.
 * - Reportes solo aprovecha datos de origen efectivamente disponibles.
 * - Libros IVA dentro de REPORTES completo comienzan en GESTION; esta regla
 *   se aplicará cuando exista un catálogo de capacidades verificadas.
 * - Una dependencia técnica NO fuerza la contratación de otro módulo principal.
 * - Ninguna capacidad aquí descrita está certificada como implementada.
 */
