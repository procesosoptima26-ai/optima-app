/** 11C.3 — Habilitaciones técnicas, NO facturación ni contrato comercial. */
import { createHash } from "node:crypto";
import { normalizarNombreModulo } from "./alta-usuarios.js";
import { MODULOS, type Modulo } from "./seguridad.js";

export type ModuloGestionable = Exclude<Modulo, "CORE">;
export type AccionModulo = "habilitar" | "suspender" | "reactivar";
const ID = /^rec[A-Za-z0-9]{14}$/;
const PREFERIDAS: Readonly<Record<ModuloGestionable, string>> = {
  INVENTARIO: "INVENTARIO", MOVIMIENTOS: "MOVIMIENTOS",
  CUENTAS_CORRIENTES: "CUENTAS_CORRIENTES", ADMINISTRACION: "ADMINISTRACION",
  FACTURACION: "FACTURACION", REPORTES: "REPORTES",
  CONFIGURACION: "AJUSTES", AUTOMATIZACIONES: "AUTOMATIZACIONES E INTEGRACIONES",
};

export type EstadoModulos = Readonly<{
  id: string;
  modulos: readonly ModuloGestionable[];
  originales: readonly string[];
  version: string;
}>;
export type ResultadoEstado = { ok: true; estado: EstadoModulos } | { ok: false; error: string };

/** Preserva etiquetas históricas. Falla si la selección contiene opciones extrañas. */
export function leerEstadoModulos(id: string, activa: unknown, valor: unknown): ResultadoEstado {
  if (!ID.test(id) || typeof activa !== "boolean" || !Array.isArray(valor) || !valor.length ||
      !valor.every(op => typeof op === "string" && op.length > 0))
    return { ok: false, error: "Configuración de módulos incompleta o inválida" };
  const originales = valor as string[];
  const normalizados = originales.map(op => normalizarNombreModulo(op));
  if (normalizados.some(op => op === null) || !normalizados.includes("CORE"))
    return { ok: false, error: "Módulos no reconocidos o falta CORE; requiere revisión" };
  const modulos = [...new Set(normalizados)]
    .filter((m): m is ModuloGestionable => m !== null && m !== "CORE");
  const version = createHash("sha256").update(JSON.stringify([id, activa, originales])).digest("hex");
  return { ok: true, estado: { id, modulos, originales: [...originales], version } };
}

export type ResultadoCambio = { ok: true; opciones: string[] } | { ok: false; error: string };
export function prepararCambioModulo(
  estado: EstadoModulos, modulo: unknown, accion: unknown,
): ResultadoCambio {
  if (typeof modulo !== "string" || modulo === "CORE" ||
      !MODULOS.includes(modulo as Modulo) || typeof accion !== "string" ||
      !["habilitar", "reactivar", "suspender"].includes(accion))
    return { ok: false, error: "Módulo o acción no admitidos" };
  const objetivo = modulo as ModuloGestionable;
  const activo = estado.modulos.includes(objetivo);
  if (accion === "suspender" && !activo)
    return { ok: false, error: "El módulo ya está deshabilitado" };
  if (accion !== "suspender" && activo)
    return { ok: false, error: "El módulo ya está habilitado" };
  if (accion === "suspender") {
    const opciones = estado.originales.filter(nombre => normalizarNombreModulo(nombre) !== objetivo);
    // Nunca borrar CORE. Ningún otro campo de EMPRESAS se modifica.
    if (!opciones.some(op => normalizarNombreModulo(op) === "CORE"))
      return { ok: false, error: "No se puede suspender CORE" };
    return { ok: true, opciones };
  }
  return { ok: true, opciones: [...estado.originales, PREFERIDAS[objetivo]] };
}
