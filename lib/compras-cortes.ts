/**
 * OPTIMA - Códigos que cambiaron de producto (confirmados por Antonella el 27-11-2026).
 *
 * Para qué sirve: para estos códigos, el historial de ventas anterior a la fecha
 * indicada pertenece a OTRO producto. El cálculo de compras solo cuenta las ventas
 * desde esa fecha. Está también en el proyecto: OPTIMA_Compras_Codigos_Reutilizados_27-11.md
 */
export type ClaveSucursalCompras = "BELLA" | "GOYA";

export const CORTES_POR_CAMBIO_DE_PRODUCTO: Readonly<Record<ClaveSucursalCompras, Readonly<Record<string, string>>>> = {
  BELLA: {
    "1026": "2026-07-17",
    "1028": "2026-07-20",
    "1029": "2026-07-18",
    "1030": "2026-07-17",
    "1031": "2026-07-17",
    "1032": "2026-07-17",
    "1033": "2026-07-23",
    "1034": "2026-07-17",
    "1050": "2026-07-26",
    "1051": "2026-07-17",
    "1052": "2026-07-17",
    "1054": "2026-08-08",
    "1058": "2026-07-19",
    "1064": "2026-07-18",
    "1071": "2026-08-07",
    "1075": "2026-07-18",
    "1077": "2026-07-29",
    "1083": "2026-08-16",
    "1094": "2026-07-18",
    "1096": "2026-07-17",
    "1098": "2026-07-24",
    "1100": "2026-07-17",
  },
  GOYA: {
    "1013": "2026-07-18",
    "1035": "2026-10-10",
    "1038": "2026-07-17",
  },
};
