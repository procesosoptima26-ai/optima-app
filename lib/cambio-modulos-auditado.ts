/**
 * OPTIMA 12B.3 — orquestación de cambio de módulos con auditoría obligatoria.
 * Nunca modifica módulos sin haber confirmado primero un evento INTENTO.
 * No expone HTTP ni activa ninguna escritura por su cuenta.
 */
import {
  crearOperacionAuditoria,
  registrarEventoAuditoria,
  type ActorAuditoria,
  type EntradaAuditoria,
  type EstadoAuditoria,
  type EstadoTecnicoAuditoria,
} from "./auditoria-eventos.js";
import { leerEstadoModulos, type EstadoModulos } from "../core/gestion-modulos.js";

export type FaseCambioAuditado =
  "AUDITORIA_INICIO" | "AUDITORIA_FINAL" | "CAMBIO_FALLIDO" | "CAMBIO_INDETERMINADO";

export class ErrorCambioAuditado extends Error {
  constructor(
    public readonly codigo: FaseCambioAuditado,
    public readonly operacionId: string,
    public readonly puedeEstarAplicado: boolean,
  ) {
    super(codigo);
    this.name = "ErrorCambioAuditado";
  }
}

type EstadoLeido = Readonly<{ activa: unknown; modulos: unknown }>;
type DatosCambio = Readonly<{
  actor: ActorAuditoria;
  empresaId: string;
  empresaNombre: string;
  modulo: string;
  accion: "habilitar" | "suspender" | "reactivar";
  motivo: string;
  estadoAnterior: EstadoModulos;
  opcionesNuevas: readonly string[];
  escribir: () => Promise<void>;
  releer: () => Promise<EstadoLeido>;
}>;

type ResultadoConfirmado = Readonly<{
  operacionId: string;
  nuevoEstado: EstadoModulos;
}>;

function coinciden(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function snapshot(estado: EstadoModulos): EstadoTecnicoAuditoria {
  return {
    MODULOS_CONTRATADOS: estado.originales,
    ACTIVA: true,
    VERSION: estado.version,
  };
}

/**
 * Entradas confiables: actor verificado por backend, empresa revalidada y
 * cambio calculado por core/gestion-modulos. Las funciones inyectadas permiten
 * simular la red en las pruebas y nunca generan escrituras reales allí.
 */
export async function ejecutarCambioModulosAuditado(datos: DatosCambio): Promise<ResultadoConfirmado> {
  const operacionId = crearOperacionAuditoria();
  const esperado = leerEstadoModulos(datos.empresaId, true, [...datos.opcionesNuevas]);
  if (!esperado.ok || datos.estadoAnterior.id !== datos.empresaId ||
      datos.estadoAnterior.originales.length === 0) {
    throw new ErrorCambioAuditado("AUDITORIA_INICIO", operacionId, false);
  }
  const comun: Omit<EntradaAuditoria, "resultado" | "detalle" | "anterior" | "nuevo"> = {
    operacionId,
    actor: datos.actor,
    empresaId: datos.empresaId,
    empresaNombre: datos.empresaNombre,
    modulo: datos.modulo,
    accion: `MODULO_${datos.accion.toUpperCase()}`,
    recursoTipo: "EMPRESA",
    recursoId: datos.empresaId,
    motivo: datos.motivo,
    origen: "PANEL",
  };
  const anterior = snapshot(datos.estadoAnterior);
  const propuesto = snapshot(esperado.estado);

  // BARRERA 1: ninguna escritura de negocio antes de confirmar INTENTO.
  try {
    await registrarEventoAuditoria({ ...comun, anterior, nuevo: propuesto, resultado: "INTENTO", detalle: "INICIO" });
  } catch {
    throw new ErrorCambioAuditado("AUDITORIA_INICIO", operacionId, false);
  }

  let falloEscritura = false;
  try {
    await datos.escribir();
  } catch {
    // La petición pudo llegar a Airtable: confirmar por lectura, nunca repetir PATCH.
    falloEscritura = true;
  }

  let resultado: EstadoAuditoria = "INDETERMINADO";
  let detalle = "ESTADO_INCIERTO";
  let observado: EstadoModulos | null = null;
  try {
    const estadoLeido = await datos.releer();
    const calculado = leerEstadoModulos(datos.empresaId, estadoLeido.activa, estadoLeido.modulos);
    if (calculado.ok) {
      observado = calculado.estado;
      if (coinciden(observado.originales, esperado.estado.originales)) {
        resultado = "CONFIRMADO";
        detalle = falloEscritura ? "CONFIRMADO_TRAS_ERROR" : "CAMBIO_CONFIRMADO";
      } else if (falloEscritura && observado.version === datos.estadoAnterior.version) {
        resultado = "FALLIDO";
        detalle = "CAMBIO_NO_APLICADO";
      }
    }
  } catch {
    // Falla en verificación: se mantiene INDETERMINADO.
  }

  // BARRERA 2: registrar el resultado. Sin confirmación final, no devolver éxito.
  try {
    await registrarEventoAuditoria({
      ...comun, anterior, nuevo: observado ? snapshot(observado) : null,
      resultado, detalle,
    });
  } catch {
    throw new ErrorCambioAuditado("AUDITORIA_FINAL", operacionId, resultado !== "FALLIDO");
  }

  if (resultado === "CONFIRMADO" && observado) {
    return { operacionId, nuevoEstado: observado };
  }
  if (resultado === "FALLIDO") {
    throw new ErrorCambioAuditado("CAMBIO_FALLIDO", operacionId, false);
  }
  throw new ErrorCambioAuditado("CAMBIO_INDETERMINADO", operacionId, true);
}
