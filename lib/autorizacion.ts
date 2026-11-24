/**
 * Guard central de las API operativas (etapa de compatibilidad).
 * La identidad viene exclusivamente de Redis y OPTIMA - BASE MAESTRA.
 *
 * Las API antiguas aún guardan sucursales como NOMBRE. Se admite ese
 * identificador únicamente para la empresa piloto explícitamente configurada.
 * No se declara completo el aislamiento de los datos operativos hasta que
 * cada registro tenga la empresa/sucursal por ID y se migren sus API.
 *
 * Cada operación debe declarar el/los permisos exigidos; no se infieren del rol.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buscarSesion, leerTokenSesion, borrarCookieSesion } from "./session.js";
import { sucursalSolicitada as resolverSucursalOperativa } from "./alcance-operativo.js";
import { leerAccesoCoreDesdeAirtable } from "../core/airtable.js";
import { autorizarCapacidadOperativaReal } from "../core/autorizacion-comercial-operativa-12c19.js";
import { puedeRealizarAccion, MODULO_DEL_PERMISO,
  type ContextoCore, type Modulo, type Permiso, MODULOS } from "../core/seguridad.js";

export type UsuarioAutorizado = Readonly<{
  usuarioId: string;
  usuario: string;
  empresaId: string;
  rol: string;
  /** Nombres heredados, solo para filtros de las API anteriores. */
  sucursales: string[];
  /** Identificadores estables y verificados por la Base Maestra. */
  sucursalIds: string[];
  modulos: Modulo[];
  contexto: ContextoCore;
}>;

type OpcionesAutorizacion = Readonly<{
  modulos: readonly string[];
  /** Obligatorias: acciones específicas de esta operación, TODAS deben estar habilitadas. */
  permiso: Permiso | readonly Permiso[];
  /** ID de sucursal preferido; se acepta nombre solo en modo piloto. */
  sucursal?: string;
  /** ID inmutable y revisado de capacidad real: nunca se deriva del navegador. */
  capacidadComercial?: string;
}>;

function normalizar(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase().replace(/[_\s]+/g, " ");
}

function resolverModulo(nombre: string): Modulo | null {
  const equivalencias: Readonly<Record<string, Modulo>> = {
    CORE: "CORE", USUARIO: "CORE",
    INVENTARIO: "INVENTARIO", MOVIMIENTOS: "MOVIMIENTOS",
    "CUENTAS CORRIENTES": "CUENTAS_CORRIENTES", ADMINISTRACION: "ADMINISTRACION",
    FACTURACION: "FACTURACION", REPORTES: "REPORTES",
    AJUSTES: "CONFIGURACION", CONFIGURACION: "CONFIGURACION",
    AUTOMATIZACIONES: "AUTOMATIZACIONES",
    "AUTOMATIZACIONES E INTEGRACIONES": "AUTOMATIZACIONES",
  };
  const modulo = equivalencias[normalizar(nombre)];
  return modulo && MODULOS.includes(modulo) ? modulo : null;
}


export async function exigirAutorizacion(
  req: VercelRequest,
  res: VercelResponse,
  opciones: OpcionesAutorizacion
): Promise<UsuarioAutorizado | null> {
  res.setHeader("Cache-Control", "no-store");
  if (!opciones.modulos.length) throw new Error("Debés indicar al menos un módulo para la API");

  const token = leerTokenSesion(req);
  if (!token) {
    borrarCookieSesion(res);
    res.status(401).json({ ok: false, error: "Tenés que iniciar sesión" });
    return null;
  }

  try {
    const sesion = await buscarSesion(token);
    if (!sesion) {
      borrarCookieSesion(res);
      res.status(401).json({ ok: false, error: "La sesión venció" });
      return null;
    }

    const acceso = await leerAccesoCoreDesdeAirtable(sesion.usuarioId);
    if (!acceso.ok) {
      borrarCookieSesion(res);
      res.status(403).json({ ok: false, error: "El usuario, su empresa o sus vínculos no están habilitados" });
      return null;
    }
    const { contexto } = acceso;

    // Aislamiento temporal: las tablas operativas existentes aún no tienen
    // todos sus registros identificados por EMPRESA. Solo la empresa piloto
    // declarada puede usar estas API heredadas. SIN CONFIGURACIÓN, NO HAY ACCESO.
    const empresaPiloto = process.env.OPTIMA_LEGACY_COMPANY_ID?.trim();
    if (!empresaPiloto) {
      res.status(503).json({ ok: false, error: "Falta configurar el alcance empresarial de estas API" });
      return null;
    }
    if (contexto.empresa.id !== empresaPiloto) {
      res.status(403).json({ ok: false, error: "Esta empresa todavía no tiene habilitadas las API operativas" });
      return null;
    }

    const solicitados = opciones.modulos.map(resolverModulo);
    // Activación controlada: la ruta comercial exige contrato PostgreSQL Y permiso real.
    // MODO TRANSITORIO: el contrato se exige SOLO en los endpoints que ya declaran su
    // `capacidadComercial`. Los endpoints heredados que todavía no la declaran siguen con
    // las reglas heredadas (módulos de la empresa + permisos del usuario + empresa piloto),
    // exactamente como con el control apagado: este modo no libera nada que antes estuviera
    // cerrado. A medida que cada endpoint declare su capacidad, pasa a exigir contrato.
    const exigeComercial = process.env.OPTIMA_COMERCIAL_ENFORCE_ENABLED === "true" &&
      typeof opciones.capacidadComercial === "string" &&
      solicitados.some((modulo) => modulo !== "CORE");
    if (solicitados.some((modulo) => !modulo) ||
        (!exigeComercial && !solicitados.some((modulo) => modulo &&
          contexto.modulosUsuario.includes(modulo) &&
          (modulo === "CORE" || contexto.modulosEmpresa.includes(modulo))))) {
      res.status(403).json({ ok: false, error: "No tenés acceso a este módulo" });
      return null;
    }

    // Evita que el código heredado confunda dos sucursales con el mismo nombre.
    const sucursales = contexto.sucursalesAutorizadas.filter((s) =>
      s.activa && s.empresaId === contexto.empresa.id);
    const nombres = sucursales.map((s) => normalizar(s.nombre));
    if (!nombres.length || new Set(nombres).size !== nombres.length) {
      res.status(403).json({ ok: false, error: "Las sucursales asignadas requieren revisión" });
      return null;
    }
    const sucursalSolicitada = opciones.sucursal === undefined
      ? undefined : resolverSucursalOperativa(contexto, opciones.sucursal);
    if (opciones.sucursal !== undefined && !sucursalSolicitada) {
      res.status(403).json({ ok: false, error: "No tenés acceso a esta sucursal" });
      return null;
    }

    // Convertir la unión a permisos concretos antes de validarlos.
    const permisosNecesarios: Permiso[] = typeof opciones.permiso === "string"
      ? [opciones.permiso] : [...opciones.permiso];
    if (!permisosNecesarios.length || (!exigeComercial && permisosNecesarios.some((permiso) => {
      const modulo = MODULO_DEL_PERMISO[permiso];
      if (!modulo || !solicitados.includes(modulo)) return true;
      // Consultas generales comprueban un ID real de sucursal autorizada.
      // El endpoint sigue obligado a filtrar cada registro por sucursal.
      const sucursalId = sucursalSolicitada?.id ?? sucursales[0]?.id;
      return !puedeRealizarAccion(contexto, permiso, {
        empresaId: contexto.empresa.id,
        ...(sucursalId ? { sucursalId } : {}),
      });
    }))) {
      res.status(403).json({ ok: false, error: "No tenés permiso para esta acción" });
      return null;
    }

    if (exigeComercial) {
      // Un endpoint debe declarar una sola capacidad pública, módulo y permiso.
      // Alcance de sucursal ya verificado y reevaluado en el motor comercial.
      const unico = solicitados.length === 1 && permisosNecesarios.length === 1 &&
        solicitados[0] !== null && MODULO_DEL_PERMISO[permisosNecesarios[0]] === solicitados[0] &&
        typeof opciones.capacidadComercial === "string";
      const sucursalId = sucursalSolicitada?.id ?? sucursales[0]?.id;
      const permitido = unico && await autorizarCapacidadOperativaReal({
        contexto,
        capacidad: opciones.capacidadComercial!,
        modulo: solicitados[0]!,
        permiso: permisosNecesarios[0],
        recurso: { empresaId: contexto.empresa.id, ...(sucursalId ? { sucursalId } : {}) },
      });
      if (!permitido) {
        res.status(403).json({ ok: false, error: "La operación no está habilitada por el contrato y los permisos" });
        return null;
      }
    }

    return {
      usuarioId: contexto.usuarioId,
      usuario: acceso.datosVista.usuario,
      rol: acceso.datosVista.rol,
      empresaId: contexto.empresa.id,
      sucursales: sucursales.map((s) => normalizar(s.nombre)),
      sucursalIds: sucursales.map((s) => s.id),
      modulos: [...contexto.modulosUsuario],
      contexto,
    };
  } catch (error) {
    console.error("Error en autorización central:", error);
    res.status(503).json({ ok: false, error: "No se pudieron verificar los permisos" });
    return null;
  }
}
