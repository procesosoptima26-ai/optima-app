/**
 * OPTIMA — adaptador de SOLO LECTURA de la Base Maestra al Core.
 * La Base Maestra es la unica autoridad de empresa, sucursal y usuario.
 * No acepta la empresa ni los permisos enviados por el navegador.
 */
import {
  construirContextoCore,
  type ResultadoContexto,
} from "./contexto.js";
import { leerPermisosAsignados } from "./permisos-airtable.js";
import {
  MODULOS,
  type Modulo,
  type SucursalCore,
} from "./seguridad.js";

type RegistroAirtable = {
  id: string;
  fields: Record<string, unknown>;
};

export type ResultadoAccesoMaestro =
  | Readonly<{
      ok: true;
      contexto: Extract<ResultadoContexto, { ok: true }>["contexto"];
      sucursalPredeterminada: SucursalCore;
      datosVista: Readonly<{ usuario: string; nombre: string; empresa: string; rol: string }>;
    }>
  | Readonly<{
      ok: false;
      motivo:
        | "DATOS_INCOMPLETOS"
        | "REFERENCIA_NO_ENCONTRADA"
        | "USUARIO_INACTIVO"
        | "EMPRESA_INACTIVA"
        | "EMPRESA_NO_COINCIDE"
        | "REFERENCIAS_INCONSISTENTES"
        | "REGISTROS_INVALIDOS";
    }>;

const ID_REGISTRO = /^rec[A-Za-z0-9]{14}$/;

function exigirEnv(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Variable de Core no configurada: ${nombre}`);
  return valor;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function identificadores(valor: unknown): string[] | null {
  if (!Array.isArray(valor) || !valor.every((id) => typeof id === "string" && ID_REGISTRO.test(id))) {
    return null;
  }
  return valor;
}

function nombreModulo(valor: string): Modulo | null {
  const clave = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, " ");

  const equivalencias: Record<string, Modulo> = {
    "CORE": "CORE",
    "USUARIO": "CORE",
    "INVENTARIO": "INVENTARIO",
    "MOVIMIENTOS": "MOVIMIENTOS",
    "CUENTAS CORRIENTES": "CUENTAS_CORRIENTES",
    "ADMINISTRACION": "ADMINISTRACION",
    "FACTURACION": "FACTURACION",
    "REPORTES": "REPORTES",
    "CONFIGURACION": "CONFIGURACION",
    "AJUSTES": "CONFIGURACION",
    "AUTOMATIZACIONES": "AUTOMATIZACIONES",
    "AUTOMATIZACIONES E INTEGRACIONES": "AUTOMATIZACIONES",
  };
  const modulo = equivalencias[clave];
  return modulo && MODULOS.includes(modulo) ? modulo : null;
}

function leerModulos(valor: unknown): Modulo[] | null {
  if (!Array.isArray(valor)) return null;
  const resultado: Modulo[] = [];
  for (const opcion of valor) {
    const modulo = nombreModulo(texto(opcion));
    // Nunca convertir opciones desconocidas en permisos generales.
    if (!modulo) return null;
    if (!resultado.includes(modulo)) resultado.push(modulo);
  }
  return resultado;
}

async function leerRegistro(baseId: string, tablaId: string, id: string, token: string): Promise<RegistroAirtable | null> {
  if (!ID_REGISTRO.test(id)) return null;
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${tablaId}/${id}`);
  const respuesta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (respuesta.status === 404) return null;
  if (!respuesta.ok) {
    throw new Error(`Fallo consultando Base Maestra (${respuesta.status})`);
  }
  const dato = (await respuesta.json()) as RegistroAirtable;
  if (dato.id !== id || !dato.fields || typeof dato.fields !== "object") return null;
  return dato;
}

/**
 * Construye el contexto empresarial desde registros autenticos de Airtable.
 * Lee permisos explícitos por módulo desde USUARIOS; nunca los deduce de ROL.
 * Un campo vacío otorga cero permisos y una opción inválida deniega el acceso.
 *
 * api/login y api/session consumen este contrato; las API operativas
 * aún deben migrar su comprobación de propiedad empresarial.
 */
export async function leerAccesoCoreDesdeAirtable(usuarioId: string): Promise<ResultadoAccesoMaestro> {
  if (!ID_REGISTRO.test(usuarioId)) return { ok: false, motivo: "DATOS_INCOMPLETOS" };

  const token = exigirEnv("AIRTABLE_TOKEN");
  const baseId = exigirEnv("AIRTABLE_USERS_BASE_ID");
  const usuariosTabla = exigirEnv("AIRTABLE_USERS_TABLE_ID");
  const empresasTabla = exigirEnv("AIRTABLE_COMPANIES_TABLE_ID");
  const sucursalesTabla = exigirEnv("AIRTABLE_SUCURSALES_TABLE_ID");

  const usuario = await leerRegistro(baseId, usuariosTabla, usuarioId, token);
  if (!usuario) return { ok: false, motivo: "REFERENCIA_NO_ENCONTRADA" };
  if (usuario.fields.ACTIVO !== true) return { ok: false, motivo: "USUARIO_INACTIVO" };

  const vinculosEmpresa = identificadores(usuario.fields.EMPRESA);
  const autorizadas = identificadores(usuario.fields.SUCURSALES_AUTORIZADAS);
  const predeterminadas = identificadores(usuario.fields.SUCURSAL_PREDETERMINADA);
  const modulosUsuario = leerModulos(usuario.fields.MODULOS);
  const permisosAsignados = leerPermisosAsignados(usuario.fields);

  if (vinculosEmpresa?.length !== 1 || !autorizadas?.length ||
      predeterminadas?.length !== 1 || !modulosUsuario || !permisosAsignados ||
      !autorizadas.includes(predeterminadas[0])) {
    return { ok: false, motivo: "DATOS_INCOMPLETOS" };
  }

  const empresaId = vinculosEmpresa[0];
  const empresa = await leerRegistro(baseId, empresasTabla, empresaId, token);
  if (!empresa) return { ok: false, motivo: "REFERENCIA_NO_ENCONTRADA" };
  if (empresa.fields.ACTIVA !== true) return { ok: false, motivo: "EMPRESA_INACTIVA" };

  const modulosEmpresa = leerModulos(empresa.fields.MODULOS_CONTRATADOS);
  const claveEmpresa = texto(empresa.fields.CLAVE_EMPRESA);
  if (!modulosEmpresa || !claveEmpresa || modulosEmpresa.length === 0) {
    return { ok: false, motivo: "DATOS_INCOMPLETOS" };
  }

  const sucursales: SucursalCore[] = [];
  for (const id of new Set(autorizadas)) {
    const registro = await leerRegistro(baseId, sucursalesTabla, id, token);
    if (!registro) return { ok: false, motivo: "REFERENCIA_NO_ENCONTRADA" };
    const empresaSucursal = identificadores(registro.fields.EMPRESA);
    const nombre = texto(registro.fields.NOMBRE);
    if (empresaSucursal?.length !== 1 || !nombre || empresaSucursal[0] !== empresaId) {
      return { ok: false, motivo: "REFERENCIAS_INCONSISTENTES" };
    }
    sucursales.push({
      id: registro.id,
      empresaId,
      nombre,
      activa: registro.fields.ACTIVA === true,
    });
  }

  const predeterminada = sucursales.find((s) => s.id === predeterminadas[0]);
  if (!predeterminada?.activa) {
    return { ok: false, motivo: "REFERENCIAS_INCONSISTENTES" };
  }

  const resultado = construirContextoCore({
    empresa: {
      id: empresaId,
      clave: claveEmpresa,
      activa: true,
      modulosContratados: modulosEmpresa,
    },
    usuario: {
      id: usuarioId,
      empresaId,
      activo: true,
      sucursalIds: autorizadas,
      modulosHabilitados: modulosUsuario,
      permisosAsignados,
    },
    sucursales,
  });
  if (resultado.ok === false) return { ok: false, motivo: resultado.motivo };
  const usuarioVisible = texto(usuario.fields.USUARIO) || usuarioId;
  const nombreVisible = texto(usuario.fields.NOMBRE) || usuarioVisible;
  const empresaVisible = texto(empresa.fields.NOMBRE_COMERCIAL) || claveEmpresa;
  const rolVisible = texto(usuario.fields.ROL) || "USUARIO";
  return {
    ok: true,
    contexto: resultado.contexto,
    sucursalPredeterminada: predeterminada,
    datosVista: {
      usuario: usuarioVisible,
      nombre: nombreVisible,
      empresa: empresaVisible,
      rol: rolVisible,
    },
  };
}
