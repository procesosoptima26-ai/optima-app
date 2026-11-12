/**
 * OPTIMA — barrera conservadora de auditoría transversal.
 * Sólo se activa con OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED=true.
 * Requiere además OPTIMA_CORE_AUDIT_ENFORCE_ENABLED=true y auditoría habilitada.
 * Comparte el bloqueo Redis existente de cambios de módulos: NO agrega tablas,
 * endpoints, estados de auditoría ni escrituras a proveedores por iniciativa propia.
 * El llamador sigue siendo responsable de autenticar y validar el alcance.
 */
import { consultarAuditoriaGlobal, type InformeGlobal } from "./conciliacion-core-global.js";
import { bloquearModulos, liberarModulos, renovarBloqueoModulos } from "./bloqueo-modulos.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
export type CodigoPuertaGlobal = "CONFIGURACION" | "OCUPADA" | "INCIDENCIAS" | "NO_DISPONIBLE" | "BLOQUEO_PERDIDO";

export class ErrorPuertaAuditoriaGlobal extends Error {
  constructor(public readonly codigo: CodigoPuertaGlobal, public readonly pendientes = 0) {
    super(`Auditoría global: ${codigo}`);
    this.name = "ErrorPuertaAuditoriaGlobal";
  }
}

/** Dependencias inyectables ÚNICAMENTE para pruebas locales con mocks. */
export type DependenciasPuertaGlobal = Readonly<{
  consultar?: (empresaId: string) => Promise<InformeGlobal>;
  bloquear?: (empresaId: string) => Promise<string | null>;
  renovar?: (empresaId: string, owner: string) => Promise<boolean>;
  liberar?: (empresaId: string, owner: string) => Promise<void>;
}>;

export function puertaGlobalHabilitada(): boolean {
  return process.env.OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED === "true";
}

/** No habilita escritura: sólo consulta y decide si la empresa puede continuar. */
export async function comprobarPuertaAuditoriaGlobal(
  empresaId: string, deps: DependenciasPuertaGlobal = {},
): Promise<void> {
  if (!puertaGlobalHabilitada()) return;
  if (!ID.test(empresaId) || process.env.OPTIMA_CORE_AUDIT_ENFORCE_ENABLED !== "true" ||
      process.env.OPTIMA_AUDIT_WRITES_ENABLED !== "true")
    throw new ErrorPuertaAuditoriaGlobal("CONFIGURACION");
  let informe: InformeGlobal;
  try {
    informe = await (deps.consultar ?? consultarAuditoriaGlobal)(empresaId);
  } catch {
    throw new ErrorPuertaAuditoriaGlobal("NO_DISPONIBLE");
  }
  if (!informe || typeof informe !== "object" || informe.bloqueada !== false ||
      !Array.isArray(informe.incidencias) || informe.incidencias.length !== 0)
    throw new ErrorPuertaAuditoriaGlobal("INCIDENCIAS", informe?.incidencias?.length ?? 0);
}

/**
 * Bajo el MISMO lock de módulos: consulta histórica -> INTENTO -> negocio -> final.
 * renovar() debe invocarse inmediatamente antes de cualquier escritura de negocio.
 * Sin bandera se conserva exactamente el comportamiento anterior.
 */
export async function ejecutarConPuertaAuditoriaGlobal<T>(
  empresaId: string,
  operacion: (renovarAntesDeEscribir: () => Promise<void>) => Promise<T>,
  deps: DependenciasPuertaGlobal = {},
): Promise<T> {
  if (!puertaGlobalHabilitada()) return operacion(async () => {});
  if (!ID.test(empresaId) || process.env.OPTIMA_CORE_AUDIT_ENFORCE_ENABLED !== "true" ||
      process.env.OPTIMA_AUDIT_WRITES_ENABLED !== "true")
    throw new ErrorPuertaAuditoriaGlobal("CONFIGURACION");
  const bloquear = deps.bloquear ?? bloquearModulos;
  const renovar = deps.renovar ?? renovarBloqueoModulos;
  const liberar = deps.liberar ?? liberarModulos;
  let obtenido: string | null;
  try { obtenido = await bloquear(empresaId); }
  catch { throw new ErrorPuertaAuditoriaGlobal("NO_DISPONIBLE"); }
  if (!obtenido) throw new ErrorPuertaAuditoriaGlobal("OCUPADA");
  const owner = obtenido;
  const asegurarVigencia = async () => {
    let vigente: boolean;
    try { vigente = await renovar(empresaId, owner); }
    catch { throw new ErrorPuertaAuditoriaGlobal("BLOQUEO_PERDIDO"); }
    if (vigente !== true) throw new ErrorPuertaAuditoriaGlobal("BLOQUEO_PERDIDO");
  };
  try {
    await comprobarPuertaAuditoriaGlobal(empresaId, deps);
    await asegurarVigencia();
    return await operacion(asegurarVigencia);
  } finally {
    try { await liberar(empresaId, owner); }
    catch { console.error("Core: no se pudo liberar el bloqueo compartido de auditoría"); }
  }
}
