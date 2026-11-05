/**
 * OPTIMA 11C.2: identidad de administración global, distinta de ADMIN cliente.
 * Sólo existe para el ID de usuario explicitado por el servidor y vinculado
 * a la empresa OPTIMA por ID canónico. SIN sucursales y SIN permisos operativos.
 * La ausencia de configuración deja esta función DESHABILITADA.
 */
type Registro = { id: string; fields: Record<string, unknown> };
export type AccesoPlataforma = Readonly<{
  usuarioId: string;
  usuario: string;
  nombre: string;
  empresaId: string;
  empresa: string;
}>;

const ID = /^rec[A-Za-z0-9]{14}$/;

function exigirEnv(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`11C.2: falta configurar ${nombre}`);
  return valor;
}

export function esCuentaPlataformaConfigurada(usuarioId: string): boolean {
  const elegido = process.env.OPTIMA_PLATFORM_ADMIN_USER_ID?.trim();
  return ID.test(usuarioId) && elegido === usuarioId;
}

async function registro(base: string, tabla: string, id: string, token: string): Promise<Registro | null> {
  const url = new URL(`https://api.airtable.com/v0/${base}/${tabla}/${id}`);
  const r = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`11C.2: falla consultando Base Maestra (${r.status})`);
  const dato = await r.json() as Registro;
  if (!dato || dato.id !== id || !dato.fields || typeof dato.fields !== "object") return null;
  return dato;
}

function listaVacia(valor: unknown): boolean {
  return valor === undefined || (Array.isArray(valor) && valor.length === 0);
}

/**
 * null: no es el usuario configurado (dejar pasar al Core cliente normal).
 * false: candidato de plataforma con datos inválidos (NUNCA hacer fallback).
 * AccesoPlataforma: identidad comprobada en cada petición.
 */
export async function leerAccesoPlataforma(usuarioId: string): Promise<AccesoPlataforma | false | null> {
  if (!esCuentaPlataformaConfigurada(usuarioId)) return null;

  const empresaId = exigirEnv("OPTIMA_PLATFORM_COMPANY_ID");
  if (!ID.test(empresaId)) throw new Error("11C.2: ID canónico de empresa de plataforma inválido");
  const base = exigirEnv("AIRTABLE_USERS_BASE_ID");
  const tablaUsuarios = exigirEnv("AIRTABLE_USERS_TABLE_ID");
  const tablaEmpresas = exigirEnv("AIRTABLE_COMPANIES_TABLE_ID");
  const token = exigirEnv("AIRTABLE_TOKEN");

  const usuario = await registro(base, tablaUsuarios, usuarioId, token);
  if (!usuario || usuario.fields.ACTIVO !== true || usuario.fields.ROL !== "ADMIN" ||
      !Array.isArray(usuario.fields.EMPRESA) || usuario.fields.EMPRESA.length !== 1 ||
      usuario.fields.EMPRESA[0] !== empresaId ||
      !listaVacia(usuario.fields.SUCURSALES_AUTORIZADAS) ||
      !listaVacia(usuario.fields.SUCURSAL_PREDETERMINADA)) return false;

  const empresa = await registro(base, tablaEmpresas, empresaId, token);
  if (!empresa || empresa.fields.ACTIVA !== true) return false;
  const clave = empresa.fields.CLAVE_EMPRESA;
  if (typeof clave !== "string" || !clave.trim()) return false;

  const usuarioVisible = typeof usuario.fields.USUARIO === "string" ? usuario.fields.USUARIO.trim() : "";
  const nombreVisible = typeof usuario.fields.NOMBRE === "string" ? usuario.fields.NOMBRE.trim() : "";
  const nombreEmpresa = typeof empresa.fields.NOMBRE_COMERCIAL === "string"
    ? empresa.fields.NOMBRE_COMERCIAL.trim() : "";
  if (!usuarioVisible || !nombreVisible || !nombreEmpresa) return false;
  return { usuarioId, usuario: usuarioVisible, nombre: nombreVisible, empresaId, empresa: nombreEmpresa };
}

export function presentarUsuarioPlataforma(acceso: AccesoPlataforma) {
  return {
    usuario: acceso.usuario,
    nombre: acceso.nombre,
    empresa: acceso.empresa,
    empresaId: acceso.empresaId,
    rol: "PLATAFORMA",
    sucursal: "",
    sucursales: [],
    modulos: [],
    permisos: [],
  };
}
