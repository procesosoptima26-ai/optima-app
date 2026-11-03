/**
 * OPTIMA — aislamiento empresarial de las tablas operativas.
 * Todo vínculo se resuelve con IDs de Airtable, nunca con nombres visibles.
 * Rechaza registros ambiguos o sin relación verificable (fail closed).
 * No modifica Airtable ni la configuración de la empresa.
 */
import type { ContextoCore, SucursalCore } from "../core/seguridad.js";

export type RegistroOperativo = Readonly<{ id: string; fields: Record<string, unknown> }>;
const REGISTRO = /^rec[A-Za-z0-9]{14}$/;

export function idsVinculados(valor: unknown): string[] | null {
  if (!Array.isArray(valor)) return null;
  const ids: string[] = [];
  for (const item of valor) {
    const id = typeof item === "string" ? item :
      item && typeof item === "object" && "id" in item ? (item as { id: unknown }).id : null;
    if (typeof id !== "string" || !REGISTRO.test(id)) return null;
    ids.push(id);
  }
  return ids;
}

export function productoDeEmpresa(campos: Record<string, unknown>, empresaId: string): boolean {
  const empresas = idsVinculados(campos.EMPRESA);
  return Boolean(REGISTRO.test(empresaId) && empresas?.includes(empresaId));
}

export function sucursalRealDeUbicacion(campos: Record<string, unknown>): string | null {
  // La relación definitiva. El campo SUCURSAL (texto) es solo compatibilidad visual.
  const ids = idsVinculados(campos.SUCURSAL_CORE);
  return ids?.length === 1 ? ids[0] : null;
}

export function sucursalAutorizadaPorId(
  contexto: ContextoCore, sucursalId: string,
): SucursalCore | null {
  return contexto.sucursalesAutorizadas.find((s) =>
    s.activa && s.id === sucursalId && s.empresaId === contexto.empresa.id
  ) ?? null;
}

export function ubicacionPermitida(
  campos: Record<string, unknown>, contexto: ContextoCore,
  sucursalEspecificaId?: string,
): boolean {
  const sucursalId = sucursalRealDeUbicacion(campos);
  if (!sucursalId) return false;
  if (sucursalEspecificaId && sucursalEspecificaId !== sucursalId) return false;
  return Boolean(sucursalAutorizadaPorId(contexto, sucursalId));
}

export function ubicacionesDeRegistroPermitidas(
  campos: Record<string, unknown>, claves: readonly string[],
  ubicacionesPorId: ReadonlyMap<string, RegistroOperativo>,
  contexto: ContextoCore, sucursalEspecificaId?: string,
): boolean {
  const ids = claves.flatMap((campo) => {
    const valor = campos[campo];
    if (valor === undefined) return [];
    const encontrados = idsVinculados(valor);
    return encontrados === null ? [null] : encontrados;
  });
  if (!ids.length || ids.some((id) => !id)) return false;
  return ids.every((id) => {
    const ubicacion = ubicacionesPorId.get(id!);
    return Boolean(ubicacion && ubicacionPermitida(ubicacion.fields, contexto, sucursalEspecificaId));
  });
}

export function lotePermitido(
  campos: Record<string, unknown>, productosPorId: ReadonlyMap<string, RegistroOperativo>,
  ubicacionesPorId: ReadonlyMap<string, RegistroOperativo>, contexto: ContextoCore,
  sucursalEspecificaId?: string,
): boolean {
  const productos = idsVinculados(campos.PRODUCTOS);
  if (productos?.length !== 1 || !productoDeEmpresa(productosPorId.get(productos[0])?.fields ?? {}, contexto.empresa.id)) {
    return false;
  }
  return ubicacionesDeRegistroPermitidas(campos, ["UBICACIÓN"], ubicacionesPorId, contexto, sucursalEspecificaId);
}

export function movimientoPermitido(
  campos: Record<string, unknown>, ubicacionesPorId: ReadonlyMap<string, RegistroOperativo>,
  contexto: ContextoCore, sucursalEspecificaId?: string,
): boolean {
  // Los movimientos históricos pueden no tener producto asociado. Su ubicación
  // sigue determinando el titular; las altas nuevas SÍ requieren producto válido.
  return ubicacionesDeRegistroPermitidas(
    campos, ["UBICACIÓN ORIGEN", "UBICACIÓN DESTINO"], ubicacionesPorId,
    contexto, sucursalEspecificaId,
  );
}

function exigirVariable(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Falta configurar ${nombre}`);
  return valor;
}

export function configTablaOperativa(nombreVariableBase: string) {
  const baseId = exigirVariable(nombreVariableBase);
  const baseMaestra = exigirVariable("AIRTABLE_USERS_BASE_ID");
  // No es válido mezclar productos/stock de otra base: los IDs de relaciones
  // pertenecen a una base específica.
  if (baseId !== baseMaestra) {
    throw new Error(`${nombreVariableBase} debe apuntar a OPTIMA - BASE MAESTRA`);
  }
  return { token: exigirVariable("AIRTABLE_TOKEN"), baseId };
}

export async function leerRegistroOperativo(
  nombreVariableBase: string, tabla: string, id: string,
): Promise<RegistroOperativo | null> {
  if (!REGISTRO.test(id)) return null;
  const { token, baseId } = configTablaOperativa(nombreVariableBase);
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tabla)}/${id}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Error verificando recurso (${response.status})`);
  const registro = (await response.json()) as RegistroOperativo;
  return registro.id === id && registro.fields && typeof registro.fields === "object" ? registro : null;
}

export async function productoExistenteDeEmpresa(
  productoId: string, empresaId: string,
  nombreVariableBase = "AIRTABLE_MOVIMIENTOS_BASE_ID",
  nombreVariableTabla = "AIRTABLE_MOVIMIENTOS_PRODUCTOS_TABLE_NAME",
): Promise<boolean> {
  const registro = await leerRegistroOperativo(nombreVariableBase, exigirVariable(nombreVariableTabla), productoId);
  return Boolean(registro && productoDeEmpresa(registro.fields, empresaId));
}

export async function ubicacionExistenteAutorizada(
  ubicacionId: string, contexto: ContextoCore, sucursalId?: string,
): Promise<boolean> {
  const tabla = exigirVariable("AIRTABLE_UBICACIONES_TABLE_NAME");
  const registro = await leerRegistroOperativo("AIRTABLE_MOVIMIENTOS_BASE_ID", tabla, ubicacionId);
  return Boolean(registro && ubicacionPermitida(registro.fields, contexto, sucursalId));
}

export function sucursalSolicitada(contexto: ContextoCore, valor: string): SucursalCore | null {
  const normalizar = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase().replace(/[_\s]+/g, " ");
  const buscadas = contexto.sucursalesAutorizadas.filter((s) =>
    s.activa && s.empresaId === contexto.empresa.id &&
    (s.id === valor || normalizar(s.nombre) === normalizar(valor))
  );
  return buscadas.length === 1 ? buscadas[0] : null;
}
