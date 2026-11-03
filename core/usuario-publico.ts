/**
 * Contrato de presentación para el navegador.
 * Identidad derivada de relaciones verificadas POR EL SERVIDOR.
 * No envía contraseñas, tokens ni permisos que todavía no fueron asignados.
 */
import type { ResultadoAccesoMaestro } from "./airtable.js";
import type { Modulo } from "./seguridad.js";

type AccesoVerificado = Extract<ResultadoAccesoMaestro, { ok: true }>;

const nombreModuloUI: Readonly<Record<Modulo, string>> = {
  CORE: "USUARIO",
  INVENTARIO: "INVENTARIO",
  MOVIMIENTOS: "MOVIMIENTOS",
  CUENTAS_CORRIENTES: "CUENTAS_CORRIENTES",
  ADMINISTRACION: "ADMINISTRACION",
  FACTURACION: "FACTURACION",
  REPORTES: "REPORTES",
  CONFIGURACION: "AJUSTES",
  AUTOMATIZACIONES: "AUTOMATIZACIONES",
};

export function presentarUsuarioCore(acceso: AccesoVerificado) {
  const { contexto, sucursalPredeterminada, datosVista } = acceso;
  return {
    usuario: datosVista.usuario,
    nombre: datosVista.nombre,
    empresa: datosVista.empresa,
    empresaId: contexto.empresa.id,
    rol: datosVista.rol,
    sucursal: sucursalPredeterminada.nombre,
    sucursalId: sucursalPredeterminada.id,
    sucursales: contexto.sucursalesAutorizadas.map((s) => ({ id: s.id, nombre: s.nombre })),
    modulos: [...new Set(contexto.modulosUsuario.map((m) => nombreModuloUI[m]))],
    permisos: [...contexto.permisos],
  };
}
