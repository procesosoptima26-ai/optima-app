/**
 * OPTIMA 12C.13 — Puente PURO entre contratación comercial y permisos del Core.
 *
 * NO consulta redes, NO escribe datos y NO habilita funciones por sí solo.
 * NO está integrado a ninguna API ni pantalla. No reemplaza core/seguridad.ts.
 *
 * PRECONDICIÓN PARA UNA FUTURA INTEGRACIÓN:
 * - El servidor obtiene el contexto de una sesión verificada.
 * - El servidor obtiene el contrato vigente y su empresa desde una fuente confiable.
 * - El servidor obtiene los permisos y submódulos asignados al usuario desde
 *   una fuente confiable, NUNCA desde el body ni desde el navegador.
 * - El catálogo de capacidades proviene de código revisado (no del cliente).
 *
 * El Core actual elimina de contexto.permisos los permisos de un módulo no
 * habilitado. Por eso la ruta de submódulo independiente recibe expresamente
 * permisosAsignadosUsuario y submodulosHabilitadosUsuario ya verificados por
 * el servidor. TODAVÍA NO EXISTE el adaptador que los suministra: sin él, esta
 * función no debe conectarse a endpoints operativos.
 */
import {
  MODULO_DEL_PERMISO,
  PERMISOS,
  puedeRealizarAccion,
  type ContextoCore,
  type Permiso,
  type RecursoCore,
} from "./seguridad.js";
import {
  MODULOS_COMERCIALES,
  incluyeNivelModulo,
  incluyeNivelSubmodulo,
  validarContrataciones,
  type DefinicionSubmodulo,
  type ModuloComercial,
  type NivelModulo,
  type NivelSubmodulo,
} from "./reglas-comerciales.js";

/** Una capacidad NO es un permiso de usuario; es una función vendible. */
export type DefinicionCapacidadComercial = Readonly<{
  id: string;
  modulo: ModuloComercial;
  /** null: capacidad exclusiva del módulo completo. */
  submodulo: string | null;
  permiso: Permiso;
  nivelMinimoModulo: NivelModulo;
  /** null: NO disponible mediante contratación independiente. */
  nivelMinimoSubmodulo: NivelSubmodulo | null;
}>;

export type ConsultaAccesoComercial = Readonly<{
  /** Contexto ya armado y verificado por el Core en el servidor. */
  contexto: ContextoCore;
  /** Identidad de empresa asociada al contrato, verificada en servidor. */
  empresaContratacionId: string;
  /** Foto COMPLETA de contrataciones vigentes; nunca un cambio parcial. */
  contrataciones: unknown;
  /** Catálogos estables y confiables, definidos por el proyecto. */
  catalogoSubmodulos: readonly DefinicionSubmodulo[];
  catalogoCapacidades: readonly DefinicionCapacidadComercial[];
  capacidad: string;
  recurso: RecursoCore;
  /** Asignaciones explícitas, verificadas en servidor, para la ruta individual. */
  permisosAsignadosUsuario: readonly Permiso[];
  submodulosHabilitadosUsuario: readonly string[];
}>;

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function clavesExactas(valor: Record<string, unknown>, claves: readonly string[]): boolean {
  return Object.keys(valor).length === claves.length && claves.every((clave) => Object.hasOwn(valor, clave));
}

/**
 * Deniega TODOS los accesos si una sola definición del catálogo es inválida.
 * No interpreta etiquetas desconocidas ni niveles fuera de las dos escalas.
 */
function catalogoCapacidadesValido(
  capacidades: unknown,
  submodulos: readonly DefinicionSubmodulo[],
): capacidades is readonly DefinicionCapacidadComercial[] {
  if (!Array.isArray(capacidades)) return false;
  const ids = new Set<string>();
  for (const capacidad of capacidades) {
    if (!esRegistro(capacidad) || !clavesExactas(capacidad, [
      "id", "modulo", "submodulo", "permiso", "nivelMinimoModulo", "nivelMinimoSubmodulo",
    ])) return false;
    if (typeof capacidad.id !== "string" ||
        !/^[a-z][a-z0-9_.]{2,79}$/.test(capacidad.id) || ids.has(capacidad.id)) return false;
    if (!MODULOS_COMERCIALES.includes(capacidad.modulo as ModuloComercial) ||
        typeof capacidad.permiso !== "string" ||
        !PERMISOS.includes(capacidad.permiso as Permiso) ||
        MODULO_DEL_PERMISO[capacidad.permiso as Permiso] !== capacidad.modulo ||
        !incluyeNivelModulo("PREMIUM", capacidad.nivelMinimoModulo)) return false;

    if (capacidad.submodulo === null) {
      if (capacidad.nivelMinimoSubmodulo !== null) return false;
    } else {
      if (typeof capacidad.submodulo !== "string" ||
          !submodulos.some((s) => s.id === capacidad.submodulo && s.moduloPadre === capacidad.modulo) ||
          (capacidad.nivelMinimoSubmodulo !== null &&
            !incluyeNivelSubmodulo("PREMIUM", capacidad.nivelMinimoSubmodulo))) return false;
    }
    ids.add(capacidad.id);
  }
  return true;
}

/**
 * Alcance de empresa/sucursal para la ruta de submódulo independiente.
 * La ruta de módulo completo reutiliza puedeRealizarAccion() del Core.
 * El endpoint seguirá teniendo que comprobar titularidad de cada registro.
 */
function recursoEnAlcance(contexto: ContextoCore, recurso: RecursoCore, modulo: ModuloComercial): boolean {
  if (!contexto.activo || !contexto.empresa.activa ||
      !contexto.usuarioId || !contexto.empresa.id || !recurso?.empresaId ||
      recurso.empresaId !== contexto.empresa.id) return false;
  if (!Array.isArray(contexto.sucursalesAutorizadas)) return false;
  if ((modulo === "INVENTARIO" || modulo === "MOVIMIENTOS") && !recurso.sucursalId) return false;
  if (recurso.sucursalId !== undefined) {
    if (!recurso.sucursalId) return false;
    return contexto.sucursalesAutorizadas.some((s) =>
      s.activa && s.id === recurso.sucursalId && s.empresaId === contexto.empresa.id);
  }
  return true;
}

/**
 * Resultado booleano, denegación por defecto. No modifica ningún argumento.
 * NO es una autorización de API hasta incorporar los adaptadores verificados.
 */
export function puedeUsarCapacidadComercial(consulta: ConsultaAccesoComercial): boolean {
  if (!consulta || !consulta.contexto || !consulta.recurso ||
      !consulta.contexto.empresa || typeof consulta.capacidad !== "string" ||
      typeof consulta.empresaContratacionId !== "string" ||
      consulta.empresaContratacionId !== consulta.contexto.empresa.id ||
      !Array.isArray(consulta.permisosAsignadosUsuario) ||
      !Array.isArray(consulta.submodulosHabilitadosUsuario)) return false;

  const contratos = validarContrataciones(consulta.contrataciones, consulta.catalogoSubmodulos);
  if (!contratos.ok || !catalogoCapacidadesValido(consulta.catalogoCapacidades, consulta.catalogoSubmodulos)) {
    return false;
  }
  const definicion = consulta.catalogoCapacidades.find((c) => c.id === consulta.capacidad);
  if (!definicion || !recursoEnAlcance(consulta.contexto, consulta.recurso, definicion.modulo)) {
    return false;
  }

  const principal = contratos.contrataciones.find((c) =>
    c.modalidad === "MODULO_PRINCIPAL" && c.modulo === definicion.modulo);
  if (principal?.modalidad === "MODULO_PRINCIPAL") {
    return incluyeNivelModulo(principal.nivel, definicion.nivelMinimoModulo) &&
      puedeRealizarAccion(consulta.contexto, definicion.permiso, consulta.recurso);
  }

  // No existe módulo principal contratado: solo una capacidad asociada
  // explícitamente a un submódulo puede acceder mediante esta modalidad.
  if (!definicion.submodulo || !definicion.nivelMinimoSubmodulo) return false;
  const individual = contratos.contrataciones.find((c) =>
    c.modalidad === "SUBMODULO_INDEPENDIENTE" && c.submodulo === definicion.submodulo);
  if (individual?.modalidad !== "SUBMODULO_INDEPENDIENTE" ||
      !incluyeNivelSubmodulo(individual.nivel, definicion.nivelMinimoSubmodulo)) return false;

  // Ambas asignaciones deben venir verificadas del usuario actual en servidor.
  // Un contrato de empresa solo NO concede acceso a todos sus empleados.
  return consulta.submodulosHabilitadosUsuario.includes(definicion.submodulo) &&
    consulta.permisosAsignadosUsuario.includes(definicion.permiso);
}
