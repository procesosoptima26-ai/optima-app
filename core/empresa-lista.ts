/**
 * OPTIMA Core — Tarea 9.2: chequeo "¿esta empresa está lista para operar?" (SOLO LECTURA).
 *
 * Hoy las empresas se crean a mano en Airtable. Este chequeo junta en un informe todo lo que hay
 * que revisar al dar de alta un cliente, para no olvidarse de nada. No crea ni modifica nada.
 * Es una función pura: recibe hechos ya leídos y devuelve el informe.
 */
import { normalizarNombreModulo } from "./alta-usuarios.js";
import { esIdEmpresaEstable } from "../lib/empresa-estable.js";
import { conciliarModulos } from "./conciliacion-contrato-modulos.js";
import type { ContratacionComercial } from "./reglas-comerciales.js";
import type { ModuloGestionable } from "./gestion-modulos.js";

export type EstadoControl = "OK" | "FALTA" | "AVISO" | "NO_VERIFICADO";
export type Control = Readonly<{ id: string; titulo: string; estado: EstadoControl; ayuda: string }>;
export type InformeEmpresaLista = Readonly<{ lista: boolean; controles: readonly Control[] }>;

export type OpcionesModulos = Readonly<{ reconocidas: boolean; tieneUsuario: boolean; modulos: readonly ModuloGestionable[] }>;

/** Interpreta las opciones del campo MODULOS_CONTRATADOS (sin exigir nada; solo describe). */
export function analizarOpcionesModulos(valor: unknown): OpcionesModulos {
  if (valor === undefined || valor === null) return { reconocidas: true, tieneUsuario: false, modulos: [] };
  if (!Array.isArray(valor) || !valor.every((v) => typeof v === "string")) return { reconocidas: false, tieneUsuario: false, modulos: [] };
  let reconocidas = true; let tieneUsuario = false;
  const modulos = new Set<ModuloGestionable>();
  for (const op of valor as string[]) {
    const m = normalizarNombreModulo(op);
    if (m === null) { reconocidas = false; continue; }
    if (m === "CORE") tieneUsuario = true; else modulos.add(m);
  }
  return { reconocidas, tieneUsuario, modulos: [...modulos] };
}

/** Clasifica el ID estable crudo que viene de Airtable. */
export function clasificarIdEstable(bruto: unknown): "VALIDO" | "FALTA" | "INVALIDO" {
  if (bruto === undefined || bruto === null) return "FALTA";
  if (typeof bruto !== "string") return "INVALIDO";
  const v = bruto.trim();
  if (v === "") return "FALTA";
  return esIdEmpresaEstable(v) ? "VALIDO" : "INVALIDO";
}

export type HechosEmpresaLista = Readonly<{
  activa: boolean;
  idEstable: "VALIDO" | "FALTA" | "INVALIDO";
  /** Cantidad de OTRAS empresas con el mismo ID estable; null si no se pudo comprobar. */
  idRepetidoEn: number | null;
  opciones: OpcionesModulos;
  cicloVida: "OK" | "SIN_REGISTRO" | "ERROR" | "NO_VERIFICADO";
  /** servicios del contrato vigente; "SIN_CONTRATO" si no hay; "ERROR" si no se pudo leer. */
  contrato: readonly ContratacionComercial[] | "SIN_CONTRATO" | "ERROR" | "NO_VERIFICADO";
  /** Cantidad de administradores activos con correo; null si no se pudo consultar. */
  administradoresConCorreo: number | null;
}>;

const c = (id: string, titulo: string, estado: EstadoControl, ayuda: string): Control => ({ id, titulo, estado, ayuda });

export function evaluarEmpresaLista(h: HechosEmpresaLista): InformeEmpresaLista {
  const out: Control[] = [];
  out.push(h.activa ? c("empresa_activa", "La empresa está activa", "OK", "")
    : c("empresa_activa", "La empresa está activa", "FALTA", "Marcá la casilla ACTIVA en la tabla EMPRESAS."));

  out.push(h.idEstable === "VALIDO" ? c("id_estable", "Tiene ID estable (emp_ + 12 letras/números)", "OK", "")
    : h.idEstable === "FALTA"
      ? c("id_estable", "Tiene ID estable (emp_ + 12 letras/números)", "FALTA", "Generá uno nuevo con la guía de alta y cargalo en ID_EMPRESA_ESTABLE. Una vez cargado no se edita.")
      : c("id_estable", "Tiene ID estable (emp_ + 12 letras/números)", "FALTA", "El valor cargado tiene un formato inválido. Debe ser emp_ seguido de 12 letras minúsculas o números."));

  out.push(h.idEstable !== "VALIDO" ? c("id_unico", "El ID estable no se repite en otra empresa", "NO_VERIFICADO", "Se comprueba cuando la empresa tenga un ID estable válido.")
    : h.idRepetidoEn === null ? c("id_unico", "El ID estable no se repite en otra empresa", "NO_VERIFICADO", "No se pudo comprobar; reintentá.")
    : h.idRepetidoEn === 0 ? c("id_unico", "El ID estable no se repite en otra empresa", "OK", "")
    : c("id_unico", "El ID estable no se repite en otra empresa", "FALTA", `GRAVE: otra/s ${h.idRepetidoEn} empresa/s tienen el mismo ID. Mezclaría datos entre clientes. Corregilo antes de seguir.`));

  out.push(h.opciones.tieneUsuario ? c("modulo_usuario", "Tiene la opción USUARIO en módulos contratados", "OK", "")
    : c("modulo_usuario", "Tiene la opción USUARIO en módulos contratados", "FALTA", "Agregá la opción USUARIO (módulo base) al campo MODULOS_CONTRATADOS. Sin ella el motor de cambio de módulos se niega a trabajar."));
  out.push(h.opciones.reconocidas ? c("opciones_conocidas", "Todas las opciones de módulos se reconocen", "OK", "")
    : c("opciones_conocidas", "Todas las opciones de módulos se reconocen", "FALTA", "Hay una opción de módulos que el sistema no reconoce. Revisá el campo MODULOS_CONTRATADOS."));

  const sinId = h.idEstable !== "VALIDO";
  const noVer = (id: string, t: string) => c(id, t, "NO_VERIFICADO", "Se comprueba cuando la empresa tenga un ID estable válido.");
  out.push(sinId ? noVer("ciclo_vida", "Tiene registro de ciclo de vida (período pagado)")
    : h.cicloVida === "OK" ? c("ciclo_vida", "Tiene registro de ciclo de vida (período pagado)", "OK", "")
    : h.cicloVida === "SIN_REGISTRO" ? c("ciclo_vida", "Tiene registro de ciclo de vida (período pagado)", "FALTA", "Se crea con la primera acción RENOVACION del ciclo de vida. Sin él, el acceso se denegaría al encender el control de ciclo de vida.")
    : c("ciclo_vida", "Tiene registro de ciclo de vida (período pagado)", "NO_VERIFICADO", "No se pudo leer el ciclo de vida; reintentá."));

  out.push(sinId ? noVer("contrato", "Tiene contrato vigente")
    : h.contrato === "SIN_CONTRATO" ? c("contrato", "Tiene contrato vigente", "FALTA", "Creá, aprobá y activá un contrato (borrador → aprobar → activar).")
    : h.contrato === "ERROR" || h.contrato === "NO_VERIFICADO" ? c("contrato", "Tiene contrato vigente", "NO_VERIFICADO", "No se pudo leer el contrato; reintentá.")
    : c("contrato", "Tiene contrato vigente", "OK", ""));

  if (sinId) out.push(noVer("modulos_alineados", "Los módulos de Airtable coinciden con el contrato"));
  else if (typeof h.contrato === "string") out.push(c("modulos_alineados", "Los módulos de Airtable coinciden con el contrato", "NO_VERIFICADO", "Se comprueba cuando haya un contrato vigente."));
  else {
    const informe = conciliarModulos(h.opciones.modulos, h.contrato);
    out.push(informe === null ? c("modulos_alineados", "Los módulos de Airtable coinciden con el contrato", "NO_VERIFICADO", "El contrato tiene datos que requieren revisión.")
      : informe.coincide ? c("modulos_alineados", "Los módulos de Airtable coinciden con el contrato", "OK", "")
      : c("modulos_alineados", "Los módulos de Airtable coinciden con el contrato", "FALTA", "Usá el informe modulos_vs_contrato y aplicá las acciones sugeridas con el motor auditado."));
  }

  out.push(h.administradoresConCorreo === null ? c("admin_correo", "Hay un administrador activo con correo (recibe los avisos)", "NO_VERIFICADO", "No se pudo consultar; reintentá.")
    : h.administradoresConCorreo > 0 ? c("admin_correo", "Hay un administrador activo con correo (recibe los avisos)", "OK", "")
    : c("admin_correo", "Hay un administrador activo con correo (recibe los avisos)", "AVISO", "Ningún administrador activo tiene correo cargado: no recibirían los avisos de vencimiento."));

  return Object.freeze({ lista: out.every((x) => x.estado === "OK" || x.estado === "AVISO"), controles: Object.freeze(out) });
}
