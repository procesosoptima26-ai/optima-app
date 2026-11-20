/**
 * OPTIMA Core — caché de DERECHOS RESUELTOS (Tarea 6).
 *
 * Qué guarda: únicamente el "SÍ" de una decisión de autorización comercial ya verificada
 * (contrato + ciclo de vida + asignaciones). Nunca guarda "no": una denegación se vuelve a
 * evaluar siempre. Cada apunte vence solo a los 60 s.
 *
 * Seguridad por construcción:
 *  - La clave incluye una HUELLA del contexto completo (usuario, empresa, módulos, permisos,
 *    sucursales) que se lee de Airtable en CADA pedido: si algo de eso cambia, la clave cambia
 *    y no hay acierto de caché.
 *  - La clave incluye la "generación" de la empresa. Renovar/suspender/cancelar/reactivar sube la
 *    generación y todos los apuntes de esa empresa dejan de valer al instante.
 *  - Si Redis falla (leer, escribir o contar), NUNCA se concede por caché: se evalúa completo.
 *  - La clave lleva el ambiente (preview/production) porque Redis es compartido.
 */
import { createHash } from "node:crypto";
import type { ContextoCore } from "./seguridad.js";
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

export const TTL_DERECHOS_SEGUNDOS = 60;

export type AlmacenDerechos = Readonly<{
  /** Generación vigente de la empresa (0 si nunca se invalidó). */
  leerGeneracion(idEmpresaEstable: string): Promise<number>;
  existe(clave: string): Promise<boolean>;
  guardar(clave: string, ttlSegundos: number): Promise<void>;
  /** Sube la generación: invalida de golpe todos los apuntes de la empresa. */
  invalidarEmpresa(idEmpresaEstable: string): Promise<void>;
}>;

export type PeticionDerecho = Readonly<{
  contexto: ContextoCore;
  capacidad: string;
  modulo: string;
  permiso: string;
  recurso: Readonly<{ empresaId: string; sucursalId?: string }>;
}>;

const AMBIENTE = /^[a-z]{1,16}$/;
const ID_USUARIO = /^rec[A-Za-z0-9]{14}$/;
const TOKEN = /^[A-Za-z0-9_.:-]{1,80}$/;

/** JSON con claves ordenadas: la misma información siempre da la misma huella. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor) ?? "null";
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  const o = valor as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort()
    .map(k => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`).join(",")}}`;
}

export function huellaContexto(contexto: ContextoCore): string {
  return createHash("sha256").update(jsonCanonico(contexto)).digest("hex").slice(0, 32);
}

export function claveGeneracionEmpresa(ambiente: string, idEmpresaEstable: string): string {
  if (!AMBIENTE.test(ambiente) || !esIdEmpresaEstable(idEmpresaEstable)) throw new Error("clave inválida");
  return `optima:${ambiente}:derechos:gen:${idEmpresaEstable}`;
}

export function claveDerecho(ambiente: string, generacion: number, p: PeticionDerecho): string {
  const emp = p.contexto.empresa.idEstable;
  if (!AMBIENTE.test(ambiente) || !esIdEmpresaEstable(emp) || !Number.isSafeInteger(generacion) ||
      generacion < 0 || !ID_USUARIO.test(p.contexto.usuarioId) || !TOKEN.test(p.capacidad) ||
      !TOKEN.test(p.permiso) || !TOKEN.test(p.modulo) ||
      (p.recurso.sucursalId !== undefined && !TOKEN.test(p.recurso.sucursalId))) {
    throw new Error("clave inválida");
  }
  const huella = createHash("sha256").update(jsonCanonico({
    contexto: p.contexto, capacidad: p.capacidad, modulo: p.modulo, permiso: p.permiso, recurso: p.recurso,
  })).digest("hex").slice(0, 32);
  return `optima:${ambiente}:derechos:${emp}:g${generacion}:${p.contexto.usuarioId}:${huella}`;
}

/**
 * Envuelve el cálculo completo. `calcular` es la autorización completa (Neon + Airtable).
 * Solo un resultado `true` se guarda; todo fallo de la caché cae al cálculo completo.
 */
export async function autorizarConCache(
  peticion: PeticionDerecho, almacen: AlmacenDerechos, ambiente: string,
  calcular: () => Promise<boolean>, ttlSegundos: number = TTL_DERECHOS_SEGUNDOS,
): Promise<boolean> {
  const emp = peticion.contexto?.empresa?.idEstable;
  let clave: string | null = null;
  try {
    if (!esIdEmpresaEstable(emp)) return calcular(); // el cálculo completo deniega
    clave = claveDerecho(ambiente, await almacen.leerGeneracion(emp), peticion);
    if (await almacen.existe(clave)) return true;
  } catch {
    return calcular(); // la caché nunca concede si no se puede consultar con certeza
  }
  const permitido = await calcular();
  if (permitido === true && clave !== null) {
    try { await almacen.guardar(clave, ttlSegundos); } catch { /* sin caché, igual se concede: ya fue verificado */ }
  }
  return permitido;
}
