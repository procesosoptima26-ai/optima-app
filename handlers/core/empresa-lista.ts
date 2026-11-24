/** OPTIMA Tarea 9.2 — "¿Esta empresa está lista?" Informe de SOLO LECTURA.
 * Ruta: GET /api/usuarios?accion=empresa_lista&empresaId=<rec>. Solo plataforma con CONSULTAR_CONTRATOS.
 * Nunca devuelve correos, solo cantidades. No escribe nada.
 */
import type { ResultadoAccesoReal195, PeticionSesion195 } from "../../lib/sesion-comercial-real-12c195.js";
import { verificarAccesoComercialReal195 } from "../../lib/sesion-comercial-real-12c195.js";
import { leerContratoOperativoPg, type LecturaContratoOperativo } from "../../core/contrato-vigente-pg-12c19.js";
import { leerCicloVidaPg, type LecturaCicloVida } from "../../core/ciclo-vida-pg.js";
import { crearPoolComercialLectura186 } from "../../lib/pool-lectura-comercial-12c186.js";
import { analizarOpcionesModulos, clasificarIdEstable, evaluarEmpresaLista, type HechosEmpresaLista } from "../../core/empresa-lista.js";
import { leerFichaEmpresa, contarOtrasEmpresasConId, type FichaEmpresa } from "../../lib/empresa-lista-adaptadores.js";
import { listarCorreosAdministradores } from "../../lib/avisos-adaptadores.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
export type PeticionEmpresaLista = PeticionSesion195 & Readonly<{ method?: string; query?: Record<string, unknown>; body?: unknown }>;
export type RespuestaEmpresaLista = {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
};
export type DependenciasEmpresaLista = Readonly<{
  habilitada(): boolean;
  autorizar(req: PeticionEmpresaLista, empresaId: string): Promise<ResultadoAccesoReal195>;
  leerFicha(recId: string): Promise<FichaEmpresa | null>;
  contarRepetidos(idEstable: string, recId: string): Promise<number | null>;
  leerCiclo(idEstable: string): Promise<LecturaCicloVida>;
  leerContrato(idEstable: string): Promise<LecturaContratoOperativo>;
  contarAdministradoresConCorreo(recId: string): Promise<number | null>;
}>;

export function crearEmpresaLista(deps: DependenciasEmpresaLista) {
  return async (req: PeticionEmpresaLista, res: RespuestaEmpresaLista): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (!deps.habilitada()) { res.status(404).json({ ok: false, error: "Ruta no disponible" }); return; }
      if (req.method !== "GET") { res.setHeader("Allow", "GET"); res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
      if (req.body !== undefined && req.body !== null) { res.status(400).json({ ok: false, error: "Solicitud inválida" }); return; }
      const q = req.query ?? {};
      if (Object.keys(q).length !== 2 || q.accion !== "empresa_lista" || typeof q.empresaId !== "string" || !ID.test(q.empresaId)) {
        res.status(400).json({ ok: false, error: "Empresa inválida" }); return;
      }
      const acceso = await deps.autorizar(req, q.empresaId);
      if (!acceso.ok) {
        res.status(acceso.motivo === "SIN_SESION" ? 401 : acceso.motivo === "FUENTE_NO_DISPONIBLE" ? 503 : 403)
          .json({ ok: false, error: "Acceso contractual no autorizado" });
        return;
      }
      if (acceso.acceso.empresaId !== q.empresaId || acceso.acceso.permiso !== "CONSULTAR_CONTRATOS" || !ID.test(acceso.acceso.usuarioId)) {
        res.status(403).json({ ok: false, error: "Acceso contractual no autorizado" }); return;
      }
      const ficha = await deps.leerFicha(q.empresaId);
      if (!ficha) { res.status(503).json({ ok: false, error: "No se pudo leer la empresa" }); return; }
      const idEstable = clasificarIdEstable(ficha.idEstableCrudo);
      const id = idEstable === "VALIDO" ? (ficha.idEstableCrudo as string).trim() : null;

      let idRepetidoEn: number | null = null;
      let cicloVida: HechosEmpresaLista["cicloVida"] = "NO_VERIFICADO";
      let contrato: HechosEmpresaLista["contrato"] = "NO_VERIFICADO";
      if (id !== null) {
        idRepetidoEn = await deps.contarRepetidos(id, q.empresaId);
        try {
          const ciclo = await deps.leerCiclo(id);
          cicloVida = ciclo.ok ? "OK" : ciclo.motivo === "SIN_REGISTRO" ? "SIN_REGISTRO" : "ERROR";
        } catch { cicloVida = "ERROR"; }
        try {
          const lectura = await deps.leerContrato(id);
          contrato = lectura.ok ? lectura.contrato.servicios : lectura.motivo === "NO_VIGENTE" ? "SIN_CONTRATO" : "ERROR";
        } catch { contrato = "ERROR"; }
      }
      const informe = evaluarEmpresaLista({
        activa: ficha.activa, idEstable, idRepetidoEn, opciones: analizarOpcionesModulos(ficha.opcionesModulos),
        cicloVida, contrato, administradoresConCorreo: await deps.contarAdministradoresConCorreo(q.empresaId),
      });
      res.status(200).json({ ok: true, soloConsulta: true, ...informe });
    } catch {
      res.status(503).json({ ok: false, error: "No se pudo completar el chequeo" });
    }
  };
}

export const empresaListaReal = crearEmpresaLista({
  habilitada: () => process.env.OPTIMA_COMERCIAL_CONTRATOS_READ_ENABLED === "true",
  autorizar: (req, empresaId) => verificarAccesoComercialReal195(req, empresaId, "CONSULTAR_CONTRATOS"),
  leerFicha: leerFichaEmpresa,
  contarRepetidos: contarOtrasEmpresasConId,
  leerCiclo: (id) => leerCicloVidaPg(crearPoolComercialLectura186(), id),
  leerContrato: (id) => leerContratoOperativoPg(crearPoolComercialLectura186(), id, new Date().toISOString()),
  contarAdministradoresConCorreo: async (recId) => (await listarCorreosAdministradores(recId))?.length ?? null,
});
