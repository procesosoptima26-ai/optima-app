/**
 * OPTIMA DA-01 / P3E — identidad contractual REAL, validada en servidor.
 * Redis => identidad de plataforma => Base Maestra => permisos comerciales explícitos.
 * La empresa cliente es un OBJETIVO, nunca la empresa propia del administrador.
 * No concede permisos por ROL ni por conocer un ID de empresa.
 * No crea sesión, contratos, permisos o registros. No exportar estas dependencias al cliente.
 *
 * Requiere campo Airtable USUARIOS.PERMISOS_CONTRATOS de selección múltiple;
 * mientras ese campo no exista, DENIEGA todo. No se modifica Airtable aquí.
 */
const ID = /^rec[A-Za-z0-9]{14}$/;
const PERMISOS = [
  'CONSULTAR_CONTRATOS',
  'GESTIONAR_BORRADORES',
  'APROBAR_CONTRATO',
  'ACTIVAR_CONTRATO',
] as const;
export type PermisoContrato195 = (typeof PERMISOS)[number];
export type PeticionSesion195 = Readonly<{cookies?: Record<string, unknown>}>;
type Sesion195 = Readonly<{usuarioId: string}>;
type Plataforma195 = Readonly<{usuarioId: string; empresaId: string}>;
type Usuario195 = Readonly<{id: string; fields: Record<string, unknown>}>;

export type DependenciasSesionComercial195 = Readonly<{
  leerToken(req: PeticionSesion195): string | null;
  buscarSesion(token: string): Promise<Sesion195 | null>;
  leerPlataforma(usuarioId: string): Promise<Plataforma195 | null | false>;
  leerUsuario(usuarioId: string): Promise<Usuario195 | null>;
  empresaClienteActiva(empresaId: string): Promise<boolean>;
}>;
export type AccesoComercialReal195 = Readonly<{
  usuarioId: string;
  empresaId: string;
  permiso: PermisoContrato195;
}>;
export type ResultadoAccesoReal195 =
  | Readonly<{ok: true; acceso: AccesoComercialReal195}>
  | Readonly<{ok: false; motivo: 'SIN_SESION' | 'SIN_PERMISO' | 'EMPRESA_INVALIDA' | 'FUENTE_NO_DISPONIBLE'}>;

function listaPermisos(valor: unknown): ReadonlySet<PermisoContrato195> | null {
  if (!Array.isArray(valor) || valor.length < 1 || valor.length > PERMISOS.length) return null;
  const aprobados = new Set<PermisoContrato195>();
  for (const entrada of valor) {
    if (typeof entrada !== 'string' || !PERMISOS.includes(entrada as PermisoContrato195) ||
        aprobados.has(entrada as PermisoContrato195)) return null;
    aprobados.add(entrada as PermisoContrato195);
  }
  return aprobados;
}

/** Todas las identidades se obtienen desde proveedores de SERVIDOR y se revisan por solicitud. */
export function crearVerificadorAccesoComercialReal195(deps: DependenciasSesionComercial195) {
  return async (
    req: PeticionSesion195, empresaObjetivoId: string, permiso: PermisoContrato195,
  ): Promise<ResultadoAccesoReal195> => {
    if (!ID.test(empresaObjetivoId) || !PERMISOS.includes(permiso)) {
      return {ok: false, motivo: 'EMPRESA_INVALIDA'};
    }
    let token: string | null;
    try { token = deps.leerToken(req); }
    catch { return {ok: false, motivo: 'SIN_SESION'}; }
    if (!token) return {ok: false, motivo: 'SIN_SESION'};
    try {
      const sesion = await deps.buscarSesion(token);
      if (!sesion || !ID.test(sesion.usuarioId)) return {ok: false, motivo: 'SIN_SESION'};
      const plataforma = await deps.leerPlataforma(sesion.usuarioId);
      if (!plataforma || plataforma.usuarioId !== sesion.usuarioId ||
          !ID.test(plataforma.empresaId) || empresaObjetivoId === plataforma.empresaId) {
        return {ok: false, motivo: 'SIN_PERMISO'};
      }
      // La consulta siempre lee el registro exacto del actor autenticado.
      const usuario = await deps.leerUsuario(sesion.usuarioId);
      if (!usuario || usuario.id !== sesion.usuarioId || usuario.fields.ACTIVO !== true ||
          usuario.fields.ROL !== 'ADMIN' ||
          !Array.isArray(usuario.fields.EMPRESA) || usuario.fields.EMPRESA.length !== 1 ||
          usuario.fields.EMPRESA[0] !== plataforma.empresaId) {
        return {ok: false, motivo: 'SIN_PERMISO'};
      }
      const asignados = listaPermisos(usuario.fields.PERMISOS_CONTRATOS);
      if (!asignados?.has(permiso)) return {ok: false, motivo: 'SIN_PERMISO'};
      if (!await deps.empresaClienteActiva(empresaObjetivoId)) {
        return {ok: false, motivo: 'EMPRESA_INVALIDA'};
      }
      return {ok: true, acceso: {usuarioId: sesion.usuarioId, empresaId: empresaObjetivoId, permiso}};
    } catch {
      return {ok: false, motivo: 'FUENTE_NO_DISPONIBLE'};
    }
  };
}

/** Adaptador de producción; ningún dato de la solicitud puede sustituir la sesión. */
export async function verificarAccesoComercialReal195(
  req: PeticionSesion195, empresaObjetivoId: string, permiso: PermisoContrato195,
): Promise<ResultadoAccesoReal195> {
  const [{leerTokenSesion, buscarSesion}, {leerAccesoPlataforma}, {leerUsuario},
    {empresaClienteMaestra185}] = await Promise.all([
      import('./session.js'), import('../core/acceso-plataforma.js'),
      import('./usuarios-maestros.js'), import('../handlers/core/consulta-historial-pg-12c185.js'),
    ]);
  return crearVerificadorAccesoComercialReal195({
    leerToken: req => leerTokenSesion(req as Parameters<typeof leerTokenSesion>[0]),
    buscarSesion,
    leerPlataforma: leerAccesoPlataforma,
    leerUsuario,
    empresaClienteActiva: empresaClienteMaestra185,
  })(req, empresaObjetivoId, permiso);
}

/**
 * Fuente compatible con P3C/P3D: emite SOLO el permiso requerido y comprobado.
 * Se vuelve a autenticar CADA vez que el motor la invoca; no conserva autorizaciones.
 * No montarla aún en una ruta de escritura sin PostgreSQL real, RLS y auditoría.
 */
export function crearFuenteContratoReal195(
  req: PeticionSesion195, empresaObjetivoId: string,
  permiso: Exclude<PermisoContrato195, 'CONSULTAR_CONTRATOS'>,
  verificar = verificarAccesoComercialReal195,
): () => Promise<unknown> {
  return async () => {
    const resultado = await verificar(req, empresaObjetivoId, permiso);
    if (!resultado.ok || resultado.acceso.permiso !== permiso) {
      throw new Error('No se verificó el permiso contractual en servidor');
    }
    // Las capas P3C/P3D consumen esta identidad, no una identidad del navegador.
    return {verificadaEnServidor: true as const,
      usuarioId: resultado.acceso.usuarioId,
      empresaId: resultado.acceso.empresaId,
      permisos: [permiso]};
  };
}
