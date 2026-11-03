/**
 * Core OPTIMA — armado de contexto verificado.
 *
 * Recibe registros previamente consultados POR EL SERVIDOR a una fuente
 * autoritativa. No debe recibir empresa/usuario/permisos desde req.body.
 *
 * Este archivo NO consulta Airtable: se mantiene desacoplado del proveedor
 * de datos, para servir a todos los módulos y empresas.
 */
import {
  MODULOS,
  PERMISOS,
  MODULO_DEL_PERMISO,
  type ContextoCore,
  type EmpresaCore,
  type Modulo,
  type Permiso,
  type SucursalCore,
} from "./seguridad.js";

export type EmpresaConfigurada = EmpresaCore & Readonly<{
  /** Habilitaciones reales verificadas en el registro de la empresa. */
  modulosContratados: readonly Modulo[];
}>;

export type UsuarioConfigurado = Readonly<{
  id: string;
  activo: boolean;
  empresaId: string;
  /** IDs canónicos de sucursal, no nombres. */
  sucursalIds: readonly string[];
  modulosHabilitados: readonly Modulo[];
  permisosAsignados: readonly Permiso[];
}>;

export type RegistrosContexto = Readonly<{
  usuario: UsuarioConfigurado;
  empresa: EmpresaConfigurada;
  /** Sucursales verificadas desde el catálogo del Core. */
  sucursales: readonly SucursalCore[];
}>;

export type ResultadoContexto =
  | Readonly<{ ok: true; contexto: ContextoCore }>
  | Readonly<{
      ok: false;
      motivo:
        | "REGISTROS_INVALIDOS"
        | "USUARIO_INACTIVO"
        | "EMPRESA_INACTIVA"
        | "EMPRESA_NO_COINCIDE"
        | "REFERENCIAS_INCONSISTENTES";
    }>;

function textoValido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim().length > 0;
}

function listaValida<T extends string>(
  valores: unknown,
  catalogo: readonly T[]
): valores is readonly T[] {
  return (
    Array.isArray(valores) &&
    valores.every((valor) => catalogo.includes(valor as T))
  );
}

function idsValidos(ids: unknown): ids is readonly string[] {
  return Array.isArray(ids) && ids.every(textoValido);
}

/**
 * Construye el contexto que luego consume puedeRealizarAccion().
 * Las habilitaciones efectivas son la intersección entre empresa y usuario.
 * Deniega si la asignación usuario-empresa o los datos del catálogo no cierran.
 * No usa jamás nombres de empresa o sucursal como criterio de pertenencia.
 */
export function construirContextoCore(
  registros: RegistrosContexto
): ResultadoContexto {
  if (!registros || !registros.empresa || !registros.usuario ||
      !Array.isArray(registros.sucursales)) {
    return { ok: false, motivo: "REGISTROS_INVALIDOS" };
  }

  const { usuario, empresa, sucursales } = registros;
  if (
    !textoValido(usuario.id) ||
    !textoValido(usuario.empresaId) ||
    !textoValido(empresa.id) ||
    !textoValido(empresa.clave) ||
    typeof usuario.activo !== "boolean" ||
    typeof empresa.activa !== "boolean" ||
    !idsValidos(usuario.sucursalIds) ||
    !listaValida(empresa.modulosContratados, MODULOS) ||
    !listaValida(usuario.modulosHabilitados, MODULOS) ||
    !listaValida(usuario.permisosAsignados, PERMISOS)
  ) {
    return { ok: false, motivo: "REGISTROS_INVALIDOS" };
  }

  if (!usuario.activo) return { ok: false, motivo: "USUARIO_INACTIVO" };
  if (!empresa.activa) return { ok: false, motivo: "EMPRESA_INACTIVA" };
  if (usuario.empresaId !== empresa.id) {
    return { ok: false, motivo: "EMPRESA_NO_COINCIDE" };
  }

  const sucursalesPorId = new Map<string, SucursalCore>();
  for (const sucursal of sucursales) {
    if (!sucursal || !textoValido(sucursal.id) ||
        !textoValido(sucursal.empresaId) ||
        !textoValido(sucursal.nombre) ||
        typeof sucursal.activa !== "boolean" ||
        sucursalesPorId.has(sucursal.id)) {
      return { ok: false, motivo: "REFERENCIAS_INCONSISTENTES" };
    }
    sucursalesPorId.set(sucursal.id, sucursal);
  }

  const sucursalesPermitidas: SucursalCore[] = [];
  for (const sucursalId of new Set(usuario.sucursalIds)) {
    const sucursal = sucursalesPorId.get(sucursalId);
    // Una sucursal no encontrada NO se transforma en un permiso ficticio.
    if (!sucursal || sucursal.empresaId !== empresa.id) {
      return { ok: false, motivo: "REFERENCIAS_INCONSISTENTES" };
    }
    if (sucursal.activa) sucursalesPermitidas.push({ ...sucursal });
  }

  const modulosEmpresa = [...new Set(empresa.modulosContratados)];
  const modulosUsuario = [...new Set(usuario.modulosHabilitados)]
    .filter((modulo) => modulosEmpresa.includes(modulo));

  const permisos = [...new Set(usuario.permisosAsignados)]
    .filter((permiso) => {
      const modulo = MODULO_DEL_PERMISO[permiso];
      return modulo === "CORE" || modulosUsuario.includes(modulo);
    });

  return {
    ok: true,
    contexto: {
      usuarioId: usuario.id,
      activo: usuario.activo,
      empresa: { id: empresa.id, clave: empresa.clave, activa: empresa.activa },
      sucursalesAutorizadas: sucursalesPermitidas,
      modulosEmpresa,
      modulosUsuario,
      permisos,
    },
  };
}

/**
 * El navegador puede solicitar un ID de sucursal, pero solo el servidor
 * decide si ese ID pertenece a las sucursales activas autorizadas.
 */
export function resolverSucursalAutorizada(
  contexto: ContextoCore,
  sucursalId: string
): SucursalCore | null {
  if (!textoValido(sucursalId) || !contexto.activo || !contexto.empresa.activa) {
    return null;
  }
  return contexto.sucursalesAutorizadas.find(
    (s) => s.activa && s.id === sucursalId && s.empresaId === contexto.empresa.id
  ) ?? null;
}
