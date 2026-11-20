/** OPTIMA P3E — API de lectura contractual con sesión real y permiso explícito.
 * Sin escrituras, sin fallback a Airtable, no habilita módulos de clientes.
 * OFF por defecto, no crea bases o contraseñas. Solo administración de plataforma.
 */
import type {PoolPgNode183} from '../../core/adaptador-pg-node-12c183.js';
import type {ResultadoAccesoReal195, PeticionSesion195} from '../../lib/sesion-comercial-real-12c195.js';
import {verificarAccesoComercialReal195} from '../../lib/sesion-comercial-real-12c195.js';
import {leerContratoOperativoPg} from '../../core/contrato-vigente-pg-12c19.js';
import {esIdEmpresaEstable} from '../../lib/empresa-estable.js';
import {crearPoolComercialLectura186} from '../../lib/pool-lectura-comercial-12c186.js';

const ID = /^rec[A-Za-z0-9]{14}$/;
export type PeticionConsulta195 = PeticionSesion195 & Readonly<{
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
}>;
export type RespuestaConsulta195 = {
  setHeader(name: string, value: string): unknown;
  status(code: number): {json(body: unknown): unknown};
};
export type DependenciasConsulta195 = Readonly<{
  habilitada(): boolean;
  autorizar(req: PeticionConsulta195, empresaId: string): Promise<ResultadoAccesoReal195>;
  crearPool(): PoolPgNode183;
  ahora(): string;
}>;

export function crearConsultaContratoCore195(deps: DependenciasConsulta195) {
  return async(req: PeticionConsulta195, res: RespuestaConsulta195): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (!deps.habilitada()) {
        res.status(404).json({ok: false, error: 'Ruta no disponible'});
        return;
      }
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).json({ok: false, error: 'Método no permitido'});
        return;
      }
      if (req.body !== undefined && req.body !== null) {
        res.status(400).json({ok: false, error: 'Solicitud inválida'});
        return;
      }
      const q = req.query ?? {};
      // La ruta comparte /api/usuarios/:accion para no agregar una función.
      // `accion` solo es válido con el nombre exacto de esta operación;
      // nunca habilita identidad, empresa, permisos ni parámetros adicionales.
      const claves = Object.keys(q);
      const consolidada = claves.length === 2 && q.accion === 'contratos_core';
      const directa = claves.length === 1;
      if (!(consolidada || directa) || typeof q.empresaId !== 'string' ||
          !ID.test(q.empresaId)) {
        res.status(400).json({ok: false, error: 'Empresa inválida'});
        return;
      }
      const acceso = await deps.autorizar(req, q.empresaId);
      if (!acceso.ok) {
        const status = acceso.motivo === 'SIN_SESION' ? 401 :
          acceso.motivo === 'FUENTE_NO_DISPONIBLE' ? 503 : 403;
        res.status(status).json({ok: false, error: 'Acceso contractual no autorizado'});
        return;
      }
      if (acceso.acceso.empresaId !== q.empresaId ||
          acceso.acceso.permiso !== 'CONSULTAR_CONTRATOS' || !ID.test(acceso.acceso.usuarioId)) {
        res.status(403).json({ok: false, error: 'Acceso contractual no autorizado'});
        return;
      }
      // Neon identifica a la empresa por su ID ESTABLE, no por el código interno de Airtable.
      const claveNeon = acceso.acceso.empresaEstableId;
      if (!esIdEmpresaEstable(claveNeon)) {
        console.error('[contrato-pg] estado etapa=empresa detalle=empresa sin ID_EMPRESA_ESTABLE valido');
        res.status(503).json({ok: false, error: 'No se pudo verificar el contrato comercial'});
        return;
      }
      const r = await leerContratoOperativoPg(deps.crearPool(), claveNeon, deps.ahora());
      if (!r.ok) {
        if (r.motivo === 'NO_VIGENTE') {
          res.status(200).json({ok: true, soloConsulta: true,
            accesoOperativoHabilitado: false, estado: 'SIN_CONTRATO_VIGENTE', contrato: null});
          return;
        }
        res.status(503).json({ok: false, error: 'No se pudo verificar el contrato comercial'});
        return;
      }
      res.status(200).json({ok: true, soloConsulta: true,
        accesoOperativoHabilitado: false, estado: 'VIGENTE', contrato: r.contrato});
    } catch {
      res.status(503).json({ok: false, error: 'No se pudo verificar el contrato comercial'});
    }
  };
}

export const consultaContratoCoreReal195 = crearConsultaContratoCore195({
  habilitada: () => process.env.OPTIMA_COMERCIAL_CONTRATOS_READ_ENABLED === 'true',
  autorizar: (req, empresaId) => verificarAccesoComercialReal195(req, empresaId, 'CONSULTAR_CONTRATOS'),
  crearPool: () => crearPoolComercialLectura186(),
  ahora: () => new Date().toISOString(),
});
