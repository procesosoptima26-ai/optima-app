/**
 * OPTIMA Core — proceso de avisos de vencimiento de UNA empresa (Tarea 5, avisos).
 *
 * Une el cálculo puro (avisos-vencimiento.ts) con las acciones reales (leer el ciclo de vida,
 * buscar destinatarios, reservar el aviso para no repetirlo y enviar el correo), que llegan
 * inyectadas. Así se prueba todo sin Internet y sin enviar nada de verdad.
 *
 * Reglas de seguridad:
 *  - SIMULAR no envía, no reserva y no cambia nada.
 *  - ENVIAR reserva el aviso ANTES de enviar (un solo aviso por tipo, empresa y período). Si no se
 *    pudo enviar a nadie, libera la reserva para reintentar más tarde.
 *  - Nunca se devuelven las direcciones completas: solo una versión enmascarada.
 *  - Máximo 5 destinatarios por empresa y un correo individual a cada uno.
 */
import { evaluarCicloVida } from "./ciclo-vida-contrato.js";
import { calcularAviso, claveAviso, redactarAviso, type TipoAviso } from "./avisos-vencimiento.js";
import type { LecturaCicloVida } from "./ciclo-vida-pg.js";
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";

export const MAX_DESTINATARIOS_AVISO = 5;
export const VIGENCIA_RESERVA_AVISO_SEGUNDOS = 120 * 24 * 60 * 60;

export type ModoAvisos = "SIMULAR" | "ENVIAR";
export type EmpresaAviso = Readonly<{ idEstable: string; nombre: string; recId: string }>;
export type CorreoAviso = Readonly<{ para: string; asunto: string; texto: string }>;

export type DependenciasAvisos = Readonly<{
  leerCiclo(idEstable: string): Promise<LecturaCicloVida>;
  /** Correos de los usuarios ADMIN activos de la empresa; null si no se pudo consultar. */
  listarDestinatarios(recEmpresaId: string): Promise<readonly string[] | null>;
  /** true si la reserva es nueva; false si ya existía (aviso ya enviado). Lanza si no se pudo consultar. */
  reservar(clave: string, vigenciaSegundos: number): Promise<boolean>;
  liberar(clave: string): Promise<void>;
  /** true si el correo fue aceptado para envío. */
  enviar(correo: CorreoAviso): Promise<boolean>;
  ambiente(): string;
}>;

export type ResultadoAvisoEmpresa = Readonly<{
  empresa: string;
  resultado: "SIN_AVISO" | "SIMULADO" | "ENVIADO" | "ENVIADO_PARCIAL" | "YA_ENVIADO" | "SIN_DESTINATARIOS"
    | "SIN_REGISTRO" | "NO_DISPONIBLE" | "ERROR_ENVIO";
  tipo?: TipoAviso;
  diasRestantes?: number;
  destinatarios?: readonly string[];
  enviados?: number;
  fallidos?: number;
}>;

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function enmascararCorreo(correo: string): string {
  const [usuario = "", dominio = ""] = correo.split("@");
  return `${usuario.slice(0, 1)}***@${dominio}`;
}

function limpiarDestinatarios(lista: readonly string[]): string[] {
  const vistos = new Set<string>();
  for (const bruto of lista) {
    if (typeof bruto !== "string") continue;
    const c = bruto.trim().toLowerCase();
    if (c.length <= 250 && CORREO.test(c)) vistos.add(c);
  }
  return [...vistos].slice(0, MAX_DESTINATARIOS_AVISO);
}

export async function procesarAvisosEmpresa(
  deps: DependenciasAvisos, empresa: EmpresaAviso, modo: ModoAvisos, ahoraIso: string,
): Promise<ResultadoAvisoEmpresa> {
  const nombre = empresa.nombre;
  if (!esIdEmpresaEstable(empresa.idEstable)) return { empresa: nombre, resultado: "NO_DISPONIBLE" };
  const lectura = await deps.leerCiclo(empresa.idEstable);
  if (!lectura.ok) {
    return { empresa: nombre, resultado: lectura.motivo === "SIN_REGISTRO" ? "SIN_REGISTRO" : "NO_DISPONIBLE" };
  }
  if (!evaluarCicloVida(lectura.hechos, ahoraIso).ok) return { empresa: nombre, resultado: "NO_DISPONIBLE" };
  const calculo = calcularAviso(lectura.hechos, ahoraIso);
  if (!calculo.ok) return { empresa: nombre, resultado: "NO_DISPONIBLE" };
  const aviso = calculo.aviso;
  if (aviso === null) return { empresa: nombre, resultado: "SIN_AVISO" };

  const lista = await deps.listarDestinatarios(empresa.recId);
  if (lista === null) return { empresa: nombre, resultado: "NO_DISPONIBLE" };
  const destinatarios = limpiarDestinatarios(lista);
  const base = { empresa: nombre, tipo: aviso.tipo, diasRestantes: aviso.diasRestantes } as const;
  if (destinatarios.length === 0) return { ...base, resultado: "SIN_DESTINATARIOS" };
  const enmascarados = destinatarios.map(enmascararCorreo);
  if (modo === "SIMULAR") return { ...base, resultado: "SIMULADO", destinatarios: enmascarados };

  const clave = claveAviso(deps.ambiente(), empresa.idEstable, aviso);
  let nueva: boolean;
  try { nueva = await deps.reservar(clave, VIGENCIA_RESERVA_AVISO_SEGUNDOS); }
  catch { return { ...base, resultado: "NO_DISPONIBLE" }; }
  if (!nueva) return { ...base, resultado: "YA_ENVIADO" };

  const { asunto, texto } = redactarAviso(aviso, nombre);
  let enviados = 0;
  let fallidos = 0;
  for (const para of destinatarios) {
    let ok = false;
    try { ok = await deps.enviar({ para, asunto, texto }); } catch { ok = false; }
    if (ok) enviados++; else fallidos++;
  }
  if (enviados === 0) {
    // No llegó a nadie: se libera para que el próximo intento pueda volver a enviarlo.
    try { await deps.liberar(clave); } catch { /* vence sola; no se repite el envío ahora */ }
    return { ...base, resultado: "ERROR_ENVIO", destinatarios: enmascarados, enviados, fallidos };
  }
  return { ...base, resultado: fallidos === 0 ? "ENVIADO" : "ENVIADO_PARCIAL",
    destinatarios: enmascarados, enviados, fallidos };
}
