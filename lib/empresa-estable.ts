/**
 * OPTIMA Core — identificador ESTABLE de empresa.
 *
 * El código interno de Airtable (recXXXXXXXXXXXXXX) cambia si la base se copia,
 * migra o se recrea. Este identificador propio (emp_ + 12 letras minúsculas y
 * números) se genera UNA vez, no se edita y es igual en cualquier base.
 *
 * Módulo puro: no lee variables de entorno, no abre conexiones y no modifica
 * ningún dato. Todavía no se usa en rutas existentes.
 */
import { randomBytes } from "node:crypto";

export const ID_EMPRESA_ESTABLE = /^emp_[a-z0-9]{12}$/;
const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789"; // 36 caracteres
const LIMITE = 252; // 36 * 7: descarta bytes mayores para que no haya sesgo

export function esIdEmpresaEstable(valor: unknown): valor is string {
  return typeof valor === "string" && ID_EMPRESA_ESTABLE.test(valor);
}

/** Lee el campo ID_EMPRESA_ESTABLE de un registro EMPRESAS. null si falta o es inválido. */
export function leerIdEmpresaEstable(campos: unknown): string | null {
  if (!campos || typeof campos !== "object") return null;
  const bruto = (campos as Record<string, unknown>).ID_EMPRESA_ESTABLE;
  if (typeof bruto !== "string") return null;
  const valor = bruto.trim();
  return esIdEmpresaEstable(valor) ? valor : null;
}

/** Genera un identificador nuevo con aleatoriedad criptográfica. */
export function generarIdEmpresaEstable(
  fuente: (cantidad: number) => Uint8Array = (n) => randomBytes(n),
): string {
  let salida = "";
  while (salida.length < 12) {
    for (const byte of fuente(24)) {
      if (byte < LIMITE) salida += ALFABETO[byte % 36];
      if (salida.length === 12) break;
    }
  }
  return `emp_${salida}`;
}
