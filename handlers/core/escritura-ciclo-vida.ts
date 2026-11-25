/**
 * OPTIMA Core — acciones de OPTIMA sobre el ciclo de vida de una empresa cliente (Tarea 5.4).
 * Dos operaciones en /api/usuarios: ciclo_vida_estado (GET, lee estado y revisión) y
 * ciclo_vida_accion (POST, renovar/suspender/levantar/cancelar/reactivar).
 * SOLO Preview, SOLO con OPTIMA_COMERCIAL_CICLO_VIDA_WRITE_ENABLED=true, SOLO un administrador
 * de plataforma con el permiso GESTIONAR_CICLO_VIDA. Quién actúa y sobre qué empresa lo decide
 * el servidor; nada de eso se acepta desde el cuerpo de la petición.
 */
import type { PoolPgNode183 } from "../../core/adaptador-pg-node-12c183.js";
import { aplicarAccionCicloVidaPg, ACCIONES_CICLO_VIDA, type AccionCicloVida,
  type ResultadoAccionCicloVida, type SolicitudCicloVida } from "../../core/ciclo-vida-acciones.js";
import { leerCicloVidaPg, type LecturaCicloVida } from "../../core/ciclo-vida-pg.js";
import { evaluarCicloVida } from "../../core/ciclo-vida-contrato.js";
import { verificarAccesoComercialReal195 } from "../../lib/sesion-comercial-real-12c195.js";
import type { PeticionSesion195, ResultadoAccesoReal195 } from "../../lib/sesion-comercial-real-12c195.js";
import { esIdEmpresaEstable } from "../../lib/empresa-estable.js";
import { crearPoolCicloVidaEscritura } from "../../lib/pool-escritura-ciclo-vida.js";
import { crearPoolComercialLectura186 } from "../../lib/pool-lectura-comercial-12c186.js";
import { crearAlmacenDerechosRedis } from "../../lib/almacen-derechos-redis.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const MAX_BYTES = 4096;
const PERMISO = "GESTIONAR_CICLO_VIDA" as const;
export type PeticionCicloVida = PeticionSesion195 & Readonly<{
  method?: string; query?: Record<string, unknown>; body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}>;
export type RespuestaCicloVida = {
  setHeader(nombre: string, valor: string): unknown;
  status(codigo: number): { json(datos: unknown): unknown };
};
export type DependenciasCicloVida = Readonly<{
  habilitada(): boolean;
  origenPermitido(): string;
  verificar(req: PeticionCicloVida, empresaId: string): Promise<ResultadoAccesoReal195>;
  poolEscritura(): PoolPgNode183;
  poolLectura(): PoolPgNode183;
  aplicar(pool: PoolPgNode183, actor: string, solicitud: SolicitudCicloVida): Promise<ResultadoAccionCicloVida>;
  leer(pool: PoolPgNode183, empresaEstableId: string): Promise<LecturaCicloVida>;
  ahora(): string;
  /** Invalida la caché de derechos de la empresa tras un cambio de ciclo de vida (mejor esfuerzo). */
  invalidarDerechos(empresaEstableId: string): Promise<void>;
}>;

function origenValido(req: PeticionCicloVida, esperado: string): boolean {
  const origin = req.headers?.origin;
  if (typeof origin !== "string" || typeof esperado !== "string") return false;
  try {
    const a = new URL(origin), b = new URL(esperado);
    return a.protocol === "https:" && b.protocol === "https:" && a.origin === b.origin &&
      origin === a.origin && esperado === b.origin;
  } catch { return false; }
}
function error(res: RespuestaCicloVida, codigo: number): void {
  res.status(codigo).json({ ok: false, error: codigo === 400 ? "Solicitud inválida" :
    codigo === 404 ? "Ruta no disponible" : codigo === 405 ? "Método no permitido" :
    codigo === 401 ? "Sesión requerida" : codigo === 403 ? "Operación no autorizada" :
    codigo === 409 ? "Conflicto" : "Operación no disponible" });
}
function cuerpoValido(body: unknown): body is { tipo: AccionCicloVida; motivo: string; revisionEsperada: number; nuevoPeriodoHasta?: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const o = body as Record<string, unknown>;
  const claves = Object.keys(o);
  const obligatorias = ["tipo", "motivo", "revisionEsperada"];
  if (!obligatorias.every(k => claves.includes(k)) ||
      claves.some(k => ![...obligatorias, "nuevoPeriodoHasta"].includes(k))) return false;
  if (typeof o.tipo !== "string" || !ACCIONES_CICLO_VIDA.includes(o.tipo as AccionCicloVida)) return false;
  if (o.nuevoPeriodoHasta !== undefined && typeof o.nuevoPeriodoHasta !== "string") return false;
  try { return Buffer.byteLength(JSON.stringify(body), "utf8") <= MAX_BYTES; } catch { return false; }
}
function statusAccion(r: Extract<ResultadoAccionCicloVida, { ok: false }>): number {
  return r.motivo === "SOLICITUD_INVALIDA" ? 400 : r.motivo === "ERROR_BD" ? 503 : 409;
}

export function crearOperacionCicloVida(operacion: "ciclo_vida_estado" | "ciclo_vida_accion", deps: DependenciasCicloVida) {
  return async (req: PeticionCicloVida, res: RespuestaCicloVida): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (!deps.habilitada()) { error(res, 404); return; }
      const metodo = operacion === "ciclo_vida_accion" ? "POST" : "GET";
      if (req.method !== metodo) { res.setHeader("Allow", metodo); error(res, 405); return; }
      const q = req.query ?? {};
      if (Object.keys(q).length !== 2 || q.accion !== operacion || typeof q.empresaId !== "string" || !ID.test(q.empresaId)) {
        error(res, 400); return;
      }
      if (operacion === "ciclo_vida_accion") {
        if (!origenValido(req, deps.origenPermitido())) { error(res, 403); return; }
        const tipo = req.headers?.["content-type"];
        if (typeof tipo !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(tipo)) { error(res, 400); return; }
        if (!cuerpoValido(req.body)) { error(res, 400); return; }
      } else if (req.body !== undefined && req.body !== null) { error(res, 400); return; }

      const acceso = await deps.verificar(req, q.empresaId);
      if (!acceso.ok) { error(res, acceso.motivo === "SIN_SESION" ? 401 : acceso.motivo === "FUENTE_NO_DISPONIBLE" ? 503 : 403); return; }
      const a = acceso.acceso;
      if (a.empresaId !== q.empresaId || a.permiso !== PERMISO || !ID.test(a.usuarioId)) { error(res, 403); return; }
      // Sin ID estable verificado no hay forma segura de ubicar a la empresa en Neon.
      if (!esIdEmpresaEstable(a.empresaEstableId)) { error(res, 503); return; }

      if (operacion === "ciclo_vida_estado") {
        const l = await deps.leer(deps.poolLectura(), a.empresaEstableId);
        if (!l.ok) {
          if (l.motivo === "SIN_REGISTRO") { res.status(200).json({ ok: true, registrada: false, revision: 0 }); return; }
          error(res, 503); return;
        }
        const ev = evaluarCicloVida(l.hechos, deps.ahora());
        if (!ev.ok) { error(res, 503); return; }
        res.status(200).json({ ok: true, registrada: true, revision: l.revision, hechos: l.hechos,
          estado: ev.estado, motivo: ev.motivo, cambiaEn: ev.cambiaEn });
        return;
      }
      const b = req.body as { tipo: AccionCicloVida; motivo: string; revisionEsperada: number; nuevoPeriodoHasta?: string };
      const r = await deps.aplicar(deps.poolEscritura(), a.usuarioId, {
        empresaId: a.empresaEstableId, accion: b.tipo, motivo: b.motivo, revisionEsperada: b.revisionEsperada,
        ...(b.nuevoPeriodoHasta === undefined ? {} : { nuevoPeriodoHasta: b.nuevoPeriodoHasta }) });
      if (!r.ok) { error(res, statusAccion(r)); return; }
      // El cambio ya está confirmado en Neon. Si Redis falla, los apuntes vencen solos en 60 s.
      try { await deps.invalidarDerechos(a.empresaEstableId); } catch { console.error("[ciclo-vida] no se pudo invalidar la caché de derechos"); }
      res.status(200).json({ ok: true, revision: r.revision, estado: r.estado, hechos: r.hechos });
    } catch { error(res, 503); }
  };
}

const poolEscritura = crearPoolCicloVidaEscritura();
const poolLectura = crearPoolComercialLectura186();
const reales: DependenciasCicloVida = {
  habilitada: () => (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") &&
    process.env.OPTIMA_COMERCIAL_CICLO_VIDA_WRITE_ENABLED === "true",
  origenPermitido: () => process.env.OPTIMA_COMERCIAL_WRITE_ORIGIN ?? "",
  verificar: (req, empresaId) => verificarAccesoComercialReal195(req, empresaId, PERMISO),
  poolEscritura: () => poolEscritura,
  poolLectura: () => poolLectura,
  aplicar: aplicarAccionCicloVidaPg,
  leer: leerCicloVidaPg,
  ahora: () => new Date().toISOString(),
  invalidarDerechos: (empresaEstableId) => crearAlmacenDerechosRedis().invalidarEmpresa(empresaEstableId),
};
export const cicloVidaEstadoCore = crearOperacionCicloVida("ciclo_vida_estado", reales);
export const cicloVidaAccionCore = crearOperacionCicloVida("ciclo_vida_accion", reales);
