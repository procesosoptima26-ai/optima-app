import empresa from "../handlers/core/empresa.js";
import plataforma from "../handlers/core/plataforma.js";
import gestion_modulos from "../handlers/core/gestion-modulos.js";
import sucursales from "../handlers/core/sucursales.js";
/** Router OPTIMA: agrupa endpoints sin alterar las autorizaciones internas. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import opciones from "../handlers/usuarios/opciones.js";
import listar from "../handlers/usuarios/listar.js";
import { detalleEmpleado, editarEmpleado } from "../handlers/usuarios/editar.js";
import invitar from "../handlers/usuarios/invitar.js";
import validar_invitacion from "../handlers/usuarios/validar-invitacion.js";
import activar from "../handlers/usuarios/activar.js";
import solicitar_recuperacion from "../handlers/usuarios/solicitar-recuperacion.js";
import restablecer from "../handlers/usuarios/restablecer.js";

const handlers = { empresa, plataforma, gestion_modulos, sucursales, opciones, listar, detalle: detalleEmpleado, editar: editarEmpleado, invitar, "validar-invitacion": validar_invitacion, activar,
  "solicitar-recuperacion": solicitar_recuperacion, restablecer };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const accion = req.query.accion;
  if (typeof accion !== "string" || !Object.prototype.hasOwnProperty.call(handlers, accion)) {
    return res.status(404).json({ ok: false, error: "Ruta inexistente" });
  }
  return handlers[accion as keyof typeof handlers](req, res);
}
