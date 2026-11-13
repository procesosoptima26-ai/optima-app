/** Vista pública DELIMITADA del historial del Core. No contiene contraseñas, tokens ni cabeceras. */
const ID = /^rec[A-Za-z0-9]{14}$/;
const CODIGO = /^[A-Z][A-Z0-9_]{1,79}$/;
const FECHA_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ESTADOS = new Set(["INTENTO", "CONFIRMADO", "RECHAZADO", "FALLIDO", "INDETERMINADO", "CONCILIADO"]);
const ORIGENES = new Set(["API", "PANEL", "AUTOMATIZACION"]);
const TECNICAS = new Set([
  "MODULOS_CONTRATADOS", "ACTIVA", "VERSION", "SUCURSALES", "SUCURSAL_PRINCIPAL",
  "MODULOS_HABILITADOS", "PERMISOS", "NOMBRE_SUCURSAL", "SUCURSAL_ID",
  "USUARIO_AFECTADO_ID", "INVITACION_ACEPTADA_POR_PROVEEDOR",
  "CREDENCIAL_ACTUALIZADA", "SESIONES_REVOCADAS",
]);

export type EventoVisibleAuditoria = Readonly<{
  id: string;
  operacionId: string;
  fechaHoraUtc: string;
  actor: string;
  accion: string;
  modulo: string;
  recursoTipo: string;
  recursoId: string;
  resultado: string;
  origen: string;
  motivo: string;
  detalle: string;
  anterior: Readonly<Record<string, unknown>> | null;
  nuevo: Readonly<Record<string, unknown>> | null;
}>;

export function idRegistroValido(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function stringAcotado(value: unknown, max: number, min = 0): string | null {
  return typeof value === "string" && value.length >= min && value.length <= max &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ? value : null;
}

/** No confiar en las filas de Airtable sin validar también el alcance en el servidor. */
function estadoTecnico(raw: unknown): Readonly<Record<string, unknown>> | null | undefined {
  if (raw === "" || raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw.length > 4000) return undefined;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return undefined; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const obj = data as Record<string, unknown>;
  if (Object.keys(obj).length === 0 || Object.keys(obj).some(k => !TECNICAS.has(k))) return undefined;
  // Se conserva una lista blanca de claves; los valores también se limitan a primitivos/arrays.
  for (const value of Object.values(obj)) {
    if (typeof value === "boolean") continue;
    if (typeof value === "string" && value.length <= 100 && !/[\x00-\x1f\x7f]/.test(value)) continue;
    if (Array.isArray(value) && value.length <= 100 &&
      value.every(v => typeof v === "string" && v.length <= 100 && !/[\x00-\x1f\x7f]/.test(v))) continue;
    return undefined;
  }
  return obj;
}

export function proyectarEventoAuditoria(
  registro: unknown, empresaId: string,
): EventoVisibleAuditoria | null {
  if (!idRegistroValido(empresaId) || !registro || typeof registro !== "object" || Array.isArray(registro)) return null;
  const row = registro as { id?: unknown; fields?: unknown };
  if (!idRegistroValido(row.id) || !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields)) return null;
  const f = row.fields as Record<string, unknown>;
  if (f.EMPRESA_ID !== empresaId) return null;
  if (typeof f.OPERACION_ID !== "string" || !UUID.test(f.OPERACION_ID)) return null;
  if (stringAcotado(f.ACTOR_USUARIO,100,1) === null ||
      typeof f.ACCION !== "string" || !CODIGO.test(f.ACCION) ||
      typeof f.MODULO !== "string" || !CODIGO.test(f.MODULO) ||
      typeof f.RECURSO_TIPO !== "string" || !CODIGO.test(f.RECURSO_TIPO) ||
      !idRegistroValido(f.RECURSO_ID) || stringAcotado(f.MOTIVO,500,1) === null ||
      (typeof (f.DETALLE ?? "") !== "string" || (f.DETALLE !== undefined && f.DETALLE !== "" && !CODIGO.test(f.DETALLE as string)))) return null;
  if (!ESTADOS.has(String(f.RESULTADO)) || !ORIGENES.has(String(f.ORIGEN))) return null;
  const fecha = stringAcotado(f.FECHA_HORA_UTC,40,15);
  if (!fecha || !FECHA_UTC.test(fecha) || !Number.isFinite(Date.parse(fecha)) ||
      new Date(fecha).toISOString() !== fecha) return null;
  const anterior = estadoTecnico(f.ESTADO_ANTERIOR);
  const nuevo = estadoTecnico(f.ESTADO_NUEVO);
  if (anterior === undefined || nuevo === undefined) return null;
  return {
    id: row.id, operacionId: f.OPERACION_ID, fechaHoraUtc: fecha,
    actor: f.ACTOR_USUARIO as string, accion: f.ACCION as string,
    modulo: f.MODULO as string, recursoTipo: f.RECURSO_TIPO as string,
    recursoId: f.RECURSO_ID, resultado: String(f.RESULTADO), origen: String(f.ORIGEN),
    motivo: f.MOTIVO as string, detalle: String(f.DETALLE ?? ""), anterior, nuevo,
  };
}
