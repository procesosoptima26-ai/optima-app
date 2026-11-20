/**
 * OPTIMA Core — avisos de vencimiento: entradas HTTP (Tarea 5, avisos).
 *  - ciclo_vida_avisos (POST, manual): OPTIMA simula o envía los avisos de UNA empresa.
 *    Solo administrador de plataforma con GESTIONAR_CICLO_VIDA, mismo origen, JSON estricto.
 *  - ciclo_vida_avisos_cron (GET, tarea diaria): recorre todas las empresas y envía lo que
 *    corresponda. Solo con el secreto de la tarea programada; no usa sesión de usuario.
 * Ambas quedan APAGADAS salvo que se creen sus interruptores de entorno.
 */
import { timingSafeEqual, createHash } from "node:crypto";
import { procesarAvisosEmpresa, type DependenciasAvisos, type ModoAvisos,
  type ResultadoAvisoEmpresa } from "../../core/avisos-proceso.js";
import { leerCicloVidaPg } from "../../core/ciclo-vida-pg.js";
import { verificarAccesoComercialReal195 } from "../../lib/sesion-comercial-real-12c195.js";
import type { PeticionSesion195, ResultadoAccesoReal195 } from "../../lib/sesion-comercial-real-12c195.js";
import { esIdEmpresaEstable } from "../../lib/empresa-estable.js";
import { crearPoolComercialLectura186 } from "../../lib/pool-lectura-comercial-12c186.js";
import { ambienteActual } from "../../lib/almacen-derechos-redis.js";
import { enviarCorreoResend, leerEmpresaCliente, liberarAvisoRedis, listarCorreosAdministradores,
  listarEmpresasClientes, reservarAvisoRedis, type EmpresaCliente } from "../../lib/avisos-adaptadores.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const PERMISO = "GESTIONAR_CICLO_VIDA" as const;
const MAX_EMPRESAS_CRON = 200;
export type PeticionAvisos = PeticionSesion195 & Readonly<{
  method?: string; query?: Record<string, unknown>; body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}>;
export type RespuestaAvisos = {
  setHeader(nombre: string, valor: string): unknown;
  status(codigo: number): { json(datos: unknown): unknown };
};
export type DependenciasAvisosHttp = Readonly<{
  habilitadaManual(): boolean;
  habilitadaCron(): boolean;
  origenPermitido(): string;
  secretoCron(): string;
  verificar(req: PeticionAvisos, empresaId: string): Promise<ResultadoAccesoReal195>;
  leerEmpresa(recId: string): Promise<EmpresaCliente | null>;
  listarEmpresas(): Promise<readonly EmpresaCliente[]>;
  proceso: DependenciasAvisos;
  ahora(): string;
}>;

function origenValido(req: PeticionAvisos, esperado: string): boolean {
  const origin = req.headers?.origin;
  if (typeof origin !== "string" || typeof esperado !== "string") return false;
  try {
    const a = new URL(origin), b = new URL(esperado);
    return a.protocol === "https:" && b.protocol === "https:" && a.origin === b.origin &&
      origin === a.origin && esperado === b.origin;
  } catch { return false; }
}
function error(res: RespuestaAvisos, codigo: number): void {
  res.status(codigo).json({ ok: false, error: codigo === 400 ? "Solicitud inválida" :
    codigo === 404 ? "Ruta no disponible" : codigo === 405 ? "Método no permitido" :
    codigo === 401 ? "Sesión requerida" : codigo === 403 ? "Operación no autorizada" :
    "Operación no disponible" });
}
function modoValido(body: unknown): ModoAvisos | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const claves = Object.keys(body);
  const modo = (body as Record<string, unknown>).modo;
  return claves.length === 1 && (modo === "SIMULAR" || modo === "ENVIAR") ? modo : null;
}
function secretoValido(recibido: unknown, esperado: string): boolean {
  if (typeof recibido !== "string" || esperado.length < 32) return false;
  const a = createHash("sha256").update(recibido).digest();
  const b = createHash("sha256").update(`Bearer ${esperado}`).digest();
  return timingSafeEqual(a, b);
}
function cabeceras(res: RespuestaAvisos): void {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function crearAvisosManual(deps: DependenciasAvisosHttp) {
  return async (req: PeticionAvisos, res: RespuestaAvisos): Promise<void> => {
    cabeceras(res);
    try {
      if (!deps.habilitadaManual()) { error(res, 404); return; }
      if (req.method !== "POST") { res.setHeader("Allow", "POST"); error(res, 405); return; }
      const q = req.query ?? {};
      if (Object.keys(q).length !== 2 || q.accion !== "ciclo_vida_avisos" ||
          typeof q.empresaId !== "string" || !ID.test(q.empresaId)) { error(res, 400); return; }
      if (!origenValido(req, deps.origenPermitido())) { error(res, 403); return; }
      const tipo = req.headers?.["content-type"];
      if (typeof tipo !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(tipo)) { error(res, 400); return; }
      const modo = modoValido(req.body);
      if (modo === null) { error(res, 400); return; }

      const acceso = await deps.verificar(req, q.empresaId);
      if (!acceso.ok) { error(res, acceso.motivo === "SIN_SESION" ? 401 : acceso.motivo === "FUENTE_NO_DISPONIBLE" ? 503 : 403); return; }
      const a = acceso.acceso;
      if (a.empresaId !== q.empresaId || a.permiso !== PERMISO || !ID.test(a.usuarioId)) { error(res, 403); return; }
      if (!esIdEmpresaEstable(a.empresaEstableId)) { error(res, 503); return; }

      const empresa = await deps.leerEmpresa(q.empresaId);
      // La empresa del pedido debe coincidir con la que el servidor verificó (mismo ID estable).
      if (!empresa || empresa.idEstable !== a.empresaEstableId) { error(res, 503); return; }
      const resultado = await procesarAvisosEmpresa(deps.proceso, empresa, modo, deps.ahora());
      res.status(200).json({ ok: true, modo, resultado });
    } catch { error(res, 503); }
  };
}

export function crearAvisosCron(deps: DependenciasAvisosHttp) {
  return async (req: PeticionAvisos, res: RespuestaAvisos): Promise<void> => {
    cabeceras(res);
    try {
      if (!deps.habilitadaCron()) { error(res, 404); return; }
      if (req.method !== "GET") { res.setHeader("Allow", "GET"); error(res, 405); return; }
      const q = req.query ?? {};
      if (Object.keys(q).length !== 1 || q.accion !== "ciclo_vida_avisos_cron") { error(res, 400); return; }
      if (!secretoValido(req.headers?.authorization, deps.secretoCron())) { error(res, 401); return; }
      const empresas = (await deps.listarEmpresas()).slice(0, MAX_EMPRESAS_CRON);
      const conteo: Record<string, number> = {};
      const ahora = deps.ahora();
      for (const empresa of empresas) {
        let r: ResultadoAvisoEmpresa["resultado"];
        try { r = (await procesarAvisosEmpresa(deps.proceso, empresa, "ENVIAR", ahora)).resultado; }
        catch { r = "NO_DISPONIBLE"; }
        conteo[r] = (conteo[r] ?? 0) + 1;
      }
      // Solo cantidades: ni nombres de empresas ni direcciones de correo en la respuesta.
      res.status(200).json({ ok: true, empresas: empresas.length, resultados: conteo });
    } catch { error(res, 503); }
  };
}

const poolLectura = crearPoolComercialLectura186();
const reales: DependenciasAvisosHttp = {
  habilitadaManual: () => process.env.VERCEL_ENV === "preview" &&
    process.env.OPTIMA_COMERCIAL_AVISOS_ENABLED === "true",
  habilitadaCron: () => (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") &&
    process.env.OPTIMA_AVISOS_CRON_ENABLED === "true",
  origenPermitido: () => process.env.OPTIMA_COMERCIAL_WRITE_ORIGIN ?? "",
  secretoCron: () => process.env.CRON_SECRET ?? "",
  verificar: (req, empresaId) => verificarAccesoComercialReal195(req, empresaId, PERMISO),
  leerEmpresa: leerEmpresaCliente,
  listarEmpresas: listarEmpresasClientes,
  proceso: {
    leerCiclo: (idEstable) => leerCicloVidaPg(poolLectura, idEstable),
    listarDestinatarios: listarCorreosAdministradores,
    reservar: reservarAvisoRedis,
    liberar: liberarAvisoRedis,
    enviar: enviarCorreoResend,
    ambiente: () => ambienteActual(),
  },
  ahora: () => new Date().toISOString(),
};
export const cicloVidaAvisosCore = crearAvisosManual(reales);
export const cicloVidaAvisosCronCore = crearAvisosCron(reales);
