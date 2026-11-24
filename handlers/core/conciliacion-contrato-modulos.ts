/** OPTIMA Tarea 9.1 — Informe de SOLO LECTURA: módulos del campo viejo (Airtable) vs contrato (Neon).
 * Ruta: GET /api/usuarios?accion=modulos_vs_contrato&empresaId=<rec>. Solo plataforma con
 * CONSULTAR_CONTRATOS. No escribe nada. Usa el mismo interruptor de lectura de contratos.
 */
import type { ResultadoAccesoReal195, PeticionSesion195 } from "../../lib/sesion-comercial-real-12c195.js";
import { verificarAccesoComercialReal195 } from "../../lib/sesion-comercial-real-12c195.js";
import { leerContratoOperativoPg, type LecturaContratoOperativo } from "../../core/contrato-vigente-pg-12c19.js";
import { esIdEmpresaEstable } from "../../lib/empresa-estable.js";
import { crearPoolComercialLectura186 } from "../../lib/pool-lectura-comercial-12c186.js";
import { conciliarModulos } from "../../core/conciliacion-contrato-modulos.js";
import { leerModulosLegacyEmpresa, type ModulosLegacy } from "../../lib/conciliacion-contrato-adaptadores.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
export type PeticionConciliacion = PeticionSesion195 & Readonly<{ method?: string; query?: Record<string, unknown>; body?: unknown }>;
export type RespuestaConciliacion = {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
};
export type DependenciasConciliacion = Readonly<{
  habilitada(): boolean;
  autorizar(req: PeticionConciliacion, empresaId: string): Promise<ResultadoAccesoReal195>;
  /** Contrato vigente de la empresa (por ID estable). */
  leerContrato(idEstable: string): Promise<LecturaContratoOperativo>;
  leerLegacy(recId: string): Promise<ModulosLegacy>;
}>;

export function crearConciliacionContratoModulos(deps: DependenciasConciliacion) {
  return async (req: PeticionConciliacion, res: RespuestaConciliacion): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (!deps.habilitada()) { res.status(404).json({ ok: false, error: "Ruta no disponible" }); return; }
      if (req.method !== "GET") { res.setHeader("Allow", "GET"); res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
      if (req.body !== undefined && req.body !== null) { res.status(400).json({ ok: false, error: "Solicitud inválida" }); return; }
      const q = req.query ?? {};
      if (Object.keys(q).length !== 2 || q.accion !== "modulos_vs_contrato" ||
          typeof q.empresaId !== "string" || !ID.test(q.empresaId)) {
        res.status(400).json({ ok: false, error: "Empresa inválida" }); return;
      }
      const acceso = await deps.autorizar(req, q.empresaId);
      if (!acceso.ok) {
        res.status(acceso.motivo === "SIN_SESION" ? 401 : acceso.motivo === "FUENTE_NO_DISPONIBLE" ? 503 : 403)
          .json({ ok: false, error: "Acceso contractual no autorizado" });
        return;
      }
      if (acceso.acceso.empresaId !== q.empresaId || acceso.acceso.permiso !== "CONSULTAR_CONTRATOS" ||
          !ID.test(acceso.acceso.usuarioId)) {
        res.status(403).json({ ok: false, error: "Acceso contractual no autorizado" }); return;
      }
      const idEstable = acceso.acceso.empresaEstableId;
      if (!esIdEmpresaEstable(idEstable)) { res.status(503).json({ ok: false, error: "No se pudo verificar la empresa" }); return; }
      const legacy = await deps.leerLegacy(q.empresaId);
      if (!legacy.ok) { res.status(503).json({ ok: false, error: "No se pudieron leer los módulos de la empresa" }); return; }
      const contrato = await deps.leerContrato(idEstable);
      let servicios = null;
      if (contrato.ok) servicios = contrato.contrato.servicios;
      else if (contrato.motivo !== "NO_VIGENTE") { res.status(503).json({ ok: false, error: "No se pudo verificar el contrato comercial" }); return; }
      const informe = conciliarModulos(legacy.modulos, servicios);
      if (informe === null) { res.status(503).json({ ok: false, error: "El contrato tiene datos que requieren revisión" }); return; }
      res.status(200).json({ ok: true, soloConsulta: true, ...informe });
    } catch {
      res.status(503).json({ ok: false, error: "No se pudo completar el informe" });
    }
  };
}

export const conciliacionContratoModulosReal = crearConciliacionContratoModulos({
  habilitada: () => process.env.OPTIMA_COMERCIAL_CONTRATOS_READ_ENABLED === "true",
  autorizar: (req, empresaId) => verificarAccesoComercialReal195(req, empresaId, "CONSULTAR_CONTRATOS"),
  leerContrato: (idEstable) => leerContratoOperativoPg(crearPoolComercialLectura186(), idEstable, new Date().toISOString()),
  leerLegacy: leerModulosLegacyEmpresa,
});
