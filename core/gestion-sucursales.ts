
/**
 * OPTIMA — Paso 11B
 * Reglas de gestión de sucursales.
 * No modifica Airtable ni realiza consultas externas.
 */

export type SucursalGestion = {
  id: string;
  nombre: string;
  activa: boolean;
};

type Resultado =
  | { ok: true; campos: Record<string, unknown> }
  | { ok: false; error: string };

const ID = /^rec[A-Za-z0-9]{14}$/;

function normalizar(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function validarNombre(
  valor: unknown,
  existentes: readonly SucursalGestion[],
  excluirId?: string
): { ok: true; nombre: string } | { ok: false; error: string } {
  if (typeof valor !== "string") {
    return { ok: false, error: "Nombre inválido" };
  }

  const nombre = valor.trim().replace(/\s+/g, " ");

  if (
    nombre.length < 2 ||
    nombre.length > 80 ||
    /[\x00-\x1F\x7F]/.test(nombre)
  ) {
    return {
      ok: false,
      error: "El nombre debe tener entre 2 y 80 caracteres válidos",
    };
  }

  const duplicada = existentes.some(
    (s) =>
      s.id !== excluirId &&
      normalizar(s.nombre) === normalizar(nombre)
  );

  if (duplicada) {
    return {
      ok: false,
      error: "Ya existe una sucursal con ese nombre",
    };
  }

  return { ok: true, nombre };
}

export function prepararAltaSucursal(
  nombre: unknown,
  empresaId: string,
  existentes: readonly SucursalGestion[]
): Resultado {
  if (!ID.test(empresaId)) {
    return { ok: false, error: "Empresa inválida" };
  }

  const validacion = validarNombre(nombre, existentes);
  if (!validacion.ok) return validacion;

  return {
    ok: true,
    campos: {
      NOMBRE: validacion.nombre,
      EMPRESA: [empresaId],
      ACTIVA: true,
    },
  };
}

export function prepararCambioNombreSucursal(
  sucursalId: string,
  nombre: unknown,
  existentes: readonly SucursalGestion[]
): Resultado {
  if (
    !ID.test(sucursalId) ||
    !existentes.some((s) => s.id === sucursalId)
  ) {
    return { ok: false, error: "Sucursal inexistente" };
  }

  const validacion = validarNombre(
    nombre,
    existentes,
    sucursalId
  );

  if (!validacion.ok) return validacion;

  return {
    ok: true,
    campos: { NOMBRE: validacion.nombre },
  };
}

export function prepararDesactivacionSucursal(
  sucursalId: string,
  existentes: readonly SucursalGestion[],
  cantidadUsuariosAsignados: number
): Resultado {
  const sucursal = existentes.find(
    (s) => s.id === sucursalId
  );

  if (!ID.test(sucursalId) || !sucursal) {
    return { ok: false, error: "Sucursal inexistente" };
  }

  if (!sucursal.activa) {
    return { ok: false, error: "La sucursal ya está inactiva" };
  }

  if (
    !Number.isSafeInteger(cantidadUsuariosAsignados) ||
    cantidadUsuariosAsignados < 0
  ) {
    return {
      ok: false,
      error: "No se verificaron las asignaciones de usuarios",
    };
  }

  if (cantidadUsuariosAsignados > 0) {
    return {
      ok: false,
      error: "La sucursal tiene usuarios asignados",
    };
  }

  const activas = existentes.filter((s) => s.activa);

  if (activas.length <= 1) {
    return {
      ok: false,
      error: "No se puede desactivar la última sucursal activa",
    };
  }

  return {
    ok: true,
    campos: { ACTIVA: false },
  };
}
