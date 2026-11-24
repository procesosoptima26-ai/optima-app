/**
 * OPTIMA Core — Tarea 9.1: puente entre el campo viejo de módulos (Airtable) y el contrato (Neon).
 *
 * Decisión de Antonella (23-11): "el contrato manda". Esta primera etapa es SOLO LECTURA: compara
 * los módulos que el campo viejo MODULOS_CONTRATADOS tiene hoy con los módulos que implica el
 * contrato vigente, y sugiere qué habría que cambiar. No escribe nada.
 *
 * Reglas:
 *  - Un módulo principal contratado cuenta como ese módulo.
 *  - Un submódulo suelto cuenta como su módulo padre (el campo viejo no sabe de submódulos).
 *  - Solo se comparan los 6 módulos comerciales; CORE, Configuración y Automatizaciones del campo
 *    viejo no son vendibles y se ignoran.
 *  - Sin contrato vigente NO se sugiere quitar nada (evita dejar sin acceso a un cliente por error).
 */
import { MODULOS_COMERCIALES, type ContratacionComercial, type ModuloComercial } from "./reglas-comerciales.js";
import { buscarSubmoduloComercial } from "./catalogo-comercial-jerarquico.js";
import type { ModuloGestionable } from "./gestion-modulos.js";

export type AccionSugerida = Readonly<{ accion: "habilitar" | "suspender"; modulo: ModuloComercial }>;
export type ResultadoConciliacion = Readonly<{
  estadoContrato: "VIGENTE" | "SIN_CONTRATO_VIGENTE";
  modulosAirtable: readonly ModuloComercial[];
  modulosContrato: readonly ModuloComercial[];
  coincide: boolean;
  /** Están en Airtable pero el contrato no los incluye. */
  sobranEnAirtable: readonly ModuloComercial[];
  /** El contrato los incluye pero Airtable no los tiene habilitados. */
  faltanEnAirtable: readonly ModuloComercial[];
  accionesSugeridas: readonly AccionSugerida[];
}>;

const ORDEN = new Map(MODULOS_COMERCIALES.map((m, i) => [m, i] as const));
const ordenar = (xs: Iterable<ModuloComercial>): ModuloComercial[] =>
  [...new Set(xs)].sort((a, b) => (ORDEN.get(a) ?? 0) - (ORDEN.get(b) ?? 0));

/** Módulos que implica un contrato (submódulo suelto = su módulo padre). Devuelve null si algo no cuadra. */
export function modulosImplicadosPorContrato(servicios: readonly ContratacionComercial[]): ModuloComercial[] | null {
  const salida: ModuloComercial[] = [];
  for (const s of servicios) {
    if (s.modalidad === "MODULO_PRINCIPAL") {
      if (!MODULOS_COMERCIALES.includes(s.modulo)) return null;
      salida.push(s.modulo);
    } else if (s.modalidad === "SUBMODULO_INDEPENDIENTE") {
      const ficha = buscarSubmoduloComercial(s.submodulo);
      if (!ficha) return null;
      salida.push(ficha.moduloPadre);
    } else return null;
  }
  return ordenar(salida);
}

/** Se queda solo con los módulos comerciales del campo viejo (ya normalizados por leerEstadoModulos). */
export function soloComerciales(modulos: readonly ModuloGestionable[]): ModuloComercial[] {
  return ordenar(modulos.filter((m): m is ModuloComercial => (MODULOS_COMERCIALES as readonly string[]).includes(m)));
}

/** `servicios` = null significa "no hay contrato vigente". */
export function conciliarModulos(
  modulosAirtable: readonly ModuloGestionable[],
  servicios: readonly ContratacionComercial[] | null,
): ResultadoConciliacion | null {
  const airtable = soloComerciales(modulosAirtable);
  if (servicios === null) {
    return Object.freeze({
      estadoContrato: "SIN_CONTRATO_VIGENTE" as const, modulosAirtable: airtable, modulosContrato: [],
      coincide: false, sobranEnAirtable: airtable, faltanEnAirtable: [], accionesSugeridas: [],
    });
  }
  const contrato = modulosImplicadosPorContrato(servicios);
  if (contrato === null) return null;
  const sobran = airtable.filter((m) => !contrato.includes(m));
  const faltan = contrato.filter((m) => !airtable.includes(m));
  return Object.freeze({
    estadoContrato: "VIGENTE" as const, modulosAirtable: airtable, modulosContrato: contrato,
    coincide: sobran.length === 0 && faltan.length === 0,
    sobranEnAirtable: sobran, faltanEnAirtable: faltan,
    accionesSugeridas: Object.freeze([
      ...faltan.map((modulo) => ({ accion: "habilitar" as const, modulo })),
      ...sobran.map((modulo) => ({ accion: "suspender" as const, modulo })),
    ]),
  });
}
