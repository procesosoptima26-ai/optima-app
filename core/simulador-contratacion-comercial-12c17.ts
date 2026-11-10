/**
 * OPTIMA 12C.17.1 — Simulador PURO de propuestas comerciales.
 *
 * No lee ni escribe Airtable, no consulta usuarios y no autoriza operaciones.
 * Únicamente evalúa configuraciones completas mediante el motor ya probado
 * de 12C.12 y el catálogo funcional de seis módulos y 29 submódulos.
 *
 * No implementa vigencias, versionado de contratos ni cambios automáticos:
 * una transición es una COMPARACIÓN informativa de dos propuestas completas.
 */
import {
  MODULOS_COMERCIALES,
  validarContrataciones,
  type ContratacionComercial,
  type CoberturaSubmodulo,
} from "./reglas-comerciales.js";
import { CATALOGO_COMERCIAL_JERARQUICO, CATALOGO_SUBMODULOS_CONTRATACION } from "./catalogo-comercial-jerarquico.js";

export type FichaCoberturaSimulada = Readonly<{
  submodulo: string;
  modulo: string;
  nombre: string;
  cobertura: CoberturaSubmodulo | null;
}>;

export type ResultadoSimulacionComercial =
  | Readonly<{
      ok: true;
      /** Propuesta validada. NO significa servicios implementados ni permiso operativo. */
      propuesta: readonly ContratacionComercial[];
      modulosCompletos: number;
      submodulosIndividuales: number;
      submodulosCubiertos: number;
      cobertura: readonly FichaCoberturaSimulada[];
      accesoOperativoHabilitado: false;
      simulacion: true;
    }>
  | Readonly<{
      ok: false;
      errores: readonly string[];
      accesoOperativoHabilitado: false;
      simulacion: true;
    }>;

export type CambioCobertura = Readonly<{
  submodulo: string;
  modulo: string;
  nombre: string;
  anterior: CoberturaSubmodulo | null;
  propuesta: CoberturaSubmodulo | null;
  tipo: "ALTA" | "BAJA" | "CAMBIO_NIVEL" | "CAMBIO_MODALIDAD";
}>;

export type ResultadoComparacionComercial =
  | Readonly<{
      ok: true;
      cambios: readonly CambioCobertura[];
      sinCambios: boolean;
      accesoOperativoHabilitado: false;
      simulacion: true;
    }>
  | Readonly<{
      ok: false;
      errores: readonly string[];
      accesoOperativoHabilitado: false;
      simulacion: true;
    }>;

/** Siempre representa el snapshot COMPLETO que se desea simular. */
export function simularPropuestaComercial(entrada: unknown): ResultadoSimulacionComercial {
  const validacion = validarContrataciones(entrada, CATALOGO_SUBMODULOS_CONTRATACION);
  if (validacion.ok === false) {
    return {
      ok: false,
      errores: Object.freeze([...validacion.errores]),
      simulacion: true,
      accesoOperativoHabilitado: false,
    };
  }

  // El motor devuelve una copia validada; nunca conservar referencias al input.
  const principales = new Map<string, CoberturaSubmodulo>();
  const individuales = new Map<string, CoberturaSubmodulo>();
  for (const contrato of validacion.contrataciones) {
    if (contrato.modalidad === "MODULO_PRINCIPAL") {
      principales.set(contrato.modulo, Object.freeze({
        modalidad: "MODULO_PRINCIPAL", nivel: contrato.nivel,
      }));
    } else {
      individuales.set(contrato.submodulo, Object.freeze({
        modalidad: "SUBMODULO_INDEPENDIENTE", nivel: contrato.nivel,
      }));
    }
  }

  const cobertura: FichaCoberturaSimulada[] = CATALOGO_COMERCIAL_JERARQUICO.map((ficha) => Object.freeze({
    submodulo: ficha.id,
    modulo: ficha.moduloPadre,
    nombre: ficha.nombre,
    cobertura: principales.get(ficha.moduloPadre) ?? individuales.get(ficha.id) ?? null,
  }));
  return Object.freeze({
    ok: true,
    propuesta: Object.freeze(validacion.contrataciones.map(c => Object.freeze({ ...c }))),
    modulosCompletos: validacion.contrataciones.filter(c => c.modalidad === "MODULO_PRINCIPAL").length,
    submodulosIndividuales: validacion.contrataciones.filter(c => c.modalidad === "SUBMODULO_INDEPENDIENTE").length,
    submodulosCubiertos: cobertura.filter(c => c.cobertura !== null).length,
    cobertura: Object.freeze(cobertura),
    simulacion: true,
    accesoOperativoHabilitado: false,
  });
}

function coberturasIguales(a: CoberturaSubmodulo | null, b: CoberturaSubmodulo | null): boolean {
  return a === null && b === null || a !== null && b !== null &&
    a.modalidad === b.modalidad && a.nivel === b.nivel;
}

/** Compara dos snapshots completos: NO registra una versión ni migra contratos. */
export function compararPropuestasComerciales(
  anterior: unknown,
  siguiente: unknown,
): ResultadoComparacionComercial {
  const a = simularPropuestaComercial(anterior);
  const b = simularPropuestaComercial(siguiente);
  if (a.ok === false || b.ok === false) {
    return Object.freeze({
      ok: false,
      errores: Object.freeze([
        ...(a.ok === false ? a.errores.map(e => `Anterior: ${e}`) : []),
        ...(b.ok === false ? b.errores.map(e => `Propuesta: ${e}`) : []),
      ]),
      simulacion: true,
      accesoOperativoHabilitado: false,
    });
  }
  const cambios: CambioCobertura[] = [];
  for (let i = 0; i < CATALOGO_COMERCIAL_JERARQUICO.length; i++) {
    const antes = a.cobertura[i];
    const despues = b.cobertura[i];
    if (coberturasIguales(antes.cobertura, despues.cobertura)) continue;
    const tipo: CambioCobertura["tipo"] = !antes.cobertura ? "ALTA" :
      !despues.cobertura ? "BAJA" :
      antes.cobertura.modalidad !== despues.cobertura.modalidad ? "CAMBIO_MODALIDAD" :
      "CAMBIO_NIVEL";
    cambios.push(Object.freeze({
      submodulo: antes.submodulo,
      modulo: antes.modulo,
      nombre: antes.nombre,
      anterior: antes.cobertura,
      propuesta: despues.cobertura,
      tipo,
    }));
  }
  return Object.freeze({
    ok: true,
    cambios: Object.freeze(cambios),
    sinCambios: cambios.length === 0,
    simulacion: true,
    accesoOperativoHabilitado: false,
  });
}

/** Lista de los seis módulos para controles de consistencia en pruebas locales. */
export function resumenCatalogoDeSimulacion() {
  return Object.freeze({
    modulos: MODULOS_COMERCIALES.length,
    submodulos: CATALOGO_COMERCIAL_JERARQUICO.length,
  });
}
