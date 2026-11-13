/**
 * OPTIMA 12C.12 — Reglas comerciales puras.
 * No consulta ni escribe Airtable, no concede permisos y no cambia el Core.
 * Se valida una configuración COMPLETA de contrataciones activas, no un cambio parcial.
 */
export const MODULOS_COMERCIALES = [
  "INVENTARIO", "MOVIMIENTOS", "CUENTAS_CORRIENTES",
  "ADMINISTRACION", "FACTURACION", "REPORTES",
] as const;

export const NIVELES_MODULO = ["ESENCIAL", "GESTION", "AVANZADO", "PREMIUM"] as const;
export const NIVELES_SUBMODULO = ["ESTANDAR", "PREMIUM"] as const;

export type ModuloComercial = (typeof MODULOS_COMERCIALES)[number];
export type NivelModulo = (typeof NIVELES_MODULO)[number];
export type NivelSubmodulo = (typeof NIVELES_SUBMODULO)[number];

/** El catálogo debe provenir de código confiable, jamás del navegador. */
export type DefinicionSubmodulo = Readonly<{
  id: string;
  moduloPadre: ModuloComercial;
}>;

export type ContratacionComercial =
  | Readonly<{ modalidad: "MODULO_PRINCIPAL"; modulo: ModuloComercial; nivel: NivelModulo }>
  | Readonly<{ modalidad: "SUBMODULO_INDEPENDIENTE"; submodulo: string; nivel: NivelSubmodulo }>;

export type ResultadoValidacion =
  | Readonly<{ ok: true; contrataciones: readonly ContratacionComercial[] }>
  | Readonly<{ ok: false; errores: readonly string[] }>;

export type CoberturaSubmodulo =
  | Readonly<{ modalidad: "MODULO_PRINCIPAL"; nivel: NivelModulo }>
  | Readonly<{ modalidad: "SUBMODULO_INDEPENDIENTE"; nivel: NivelSubmodulo }>;

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function tieneClavesExactas(registro: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const claves = Object.keys(registro);
  return claves.length === esperadas.length && esperadas.every((clave) => Object.prototype.hasOwnProperty.call(registro, clave));
}

function esModulo(valor: unknown): valor is ModuloComercial {
  return typeof valor === "string" && MODULOS_COMERCIALES.some((modulo) => modulo === valor);
}

function esNivelModulo(valor: unknown): valor is NivelModulo {
  return typeof valor === "string" && NIVELES_MODULO.some((nivel) => nivel === valor);
}

function esNivelSubmodulo(valor: unknown): valor is NivelSubmodulo {
  return typeof valor === "string" && NIVELES_SUBMODULO.some((nivel) => nivel === valor);
}

/** Nunca confundir el nivel de un módulo con el de una solución individual. */
export function incluyeNivelModulo(contratado: unknown, requerido: unknown): boolean {
  return esNivelModulo(contratado) && esNivelModulo(requerido) &&
    NIVELES_MODULO.indexOf(contratado) >= NIVELES_MODULO.indexOf(requerido);
}

export function incluyeNivelSubmodulo(contratado: unknown, requerido: unknown): boolean {
  return esNivelSubmodulo(contratado) && esNivelSubmodulo(requerido) &&
    NIVELES_SUBMODULO.indexOf(contratado) >= NIVELES_SUBMODULO.indexOf(requerido);
}

/**
 * Valida el catálogo autorizado y una foto completa de los servicios activos.
 * Una entrada inválida no produce contrataciones parciales ni habilitaciones.
 */
export function validarContrataciones(
  entradas: unknown,
  catalogoSubmodulos: readonly DefinicionSubmodulo[],
): ResultadoValidacion {
  const errores: string[] = [];
  const padres = new Map<string, ModuloComercial>();
  if (!Array.isArray(catalogoSubmodulos)) {
    return { ok: false, errores: ["Catálogo de submódulos inválido"] };
  }
  for (const definicion of catalogoSubmodulos) {
    if (!esRegistro(definicion) || !tieneClavesExactas(definicion, ["id", "moduloPadre"]) ||
        typeof definicion.id !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(definicion.id) ||
        esModulo(definicion.id) || !esModulo(definicion.moduloPadre) ||
        padres.has(definicion.id)) {
      errores.push("Catálogo de submódulos desconocido, duplicado o inválido");
      continue;
    }
    padres.set(definicion.id, definicion.moduloPadre);
  }
  if (errores.length) return { ok: false, errores };
  if (!Array.isArray(entradas)) {
    return { ok: false, errores: ["Las contrataciones deben ser una lista"] };
  }

  const contrataciones: ContratacionComercial[] = [];
  const modulos = new Set<ModuloComercial>();
  const submodulos = new Set<string>();
  for (const [indice, entrada] of entradas.entries()) {
    const fila = indice + 1;
    if (!esRegistro(entrada)) {
      errores.push(`Contratación ${fila}: formato inválido`);
      continue;
    }
    if (entrada.modalidad === "MODULO_PRINCIPAL") {
      if (!tieneClavesExactas(entrada, ["modalidad", "modulo", "nivel"]) ||
          !esModulo(entrada.modulo) || !esNivelModulo(entrada.nivel)) {
        errores.push(`Contratación ${fila}: módulo principal o nivel inválido`);
        continue;
      }
      if (modulos.has(entrada.modulo)) {
        errores.push(`Contratación ${fila}: módulo principal duplicado`);
        continue;
      }
      modulos.add(entrada.modulo);
      contrataciones.push({ modalidad: "MODULO_PRINCIPAL", modulo: entrada.modulo, nivel: entrada.nivel });
      continue;
    }
    if (entrada.modalidad === "SUBMODULO_INDEPENDIENTE") {
      if (!tieneClavesExactas(entrada, ["modalidad", "submodulo", "nivel"]) ||
          typeof entrada.submodulo !== "string" || !padres.has(entrada.submodulo) ||
          !esNivelSubmodulo(entrada.nivel)) {
        errores.push(`Contratación ${fila}: submódulo desconocido o nivel inválido`);
        continue;
      }
      if (submodulos.has(entrada.submodulo)) {
        errores.push(`Contratación ${fila}: submódulo duplicado`);
        continue;
      }
      submodulos.add(entrada.submodulo);
      contrataciones.push({ modalidad: "SUBMODULO_INDEPENDIENTE", submodulo: entrada.submodulo, nivel: entrada.nivel });
      continue;
    }
    errores.push(`Contratación ${fila}: modalidad desconocida`);
  }

  for (const submodulo of submodulos) {
    const padre = padres.get(submodulo);
    if (padre && modulos.has(padre)) {
      errores.push(`Incompatibilidad: ${submodulo} y su módulo principal ${padre} no pueden coexistir`);
    }
  }
  return errores.length ? { ok: false, errores } : { ok: true, contrataciones };
}

/**
 * Informa la modalidad y nivel que cubre un submódulo conocido.
 * NO autoriza acciones: todavía faltan las capacidades concretas y permisos de usuario.
 * Ante una configuración inválida, devuelve null (sin cobertura).
 */
export function coberturaSubmodulo(
  entradas: unknown,
  submodulo: string,
  catalogoSubmodulos: readonly DefinicionSubmodulo[],
): CoberturaSubmodulo | null {
  const resultado = validarContrataciones(entradas, catalogoSubmodulos);
  if (!resultado.ok) return null;
  const definicion = catalogoSubmodulos.find((item) => item.id === submodulo);
  if (!definicion) return null;
  for (const contrato of resultado.contrataciones) {
    if (contrato.modalidad === "MODULO_PRINCIPAL" && contrato.modulo === definicion.moduloPadre) {
      return { modalidad: "MODULO_PRINCIPAL", nivel: contrato.nivel };
    }
    if (contrato.modalidad === "SUBMODULO_INDEPENDIENTE" && contrato.submodulo === submodulo) {
      return { modalidad: "SUBMODULO_INDEPENDIENTE", nivel: contrato.nivel };
    }
  }
  return null;
}
