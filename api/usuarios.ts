/** Router OPTIMA: agrupa endpoints sin alterar las autorizaciones internas. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import opciones from "../handlers/usuarios/opciones.js";
import invitar from "../handlers/usuarios/invitar.js";
import validar_invitacion from "../handlers/usuarios/validar-invitacion.js";
import activar from "../handlers/usuarios/activar.js";

const handlers = { opciones, invitar, "validar-invitacion": validar_invitacion, activar };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const accion = req.query.accion;
  if (typeof accion !== "string" || !Object.prototype.hasOwnProperty.call(handlers, accion)) {
    return res.status(404).json({ ok: false, error: "Ruta inexistente" });
  }
  return handlers[accion as keyof typeof handlers](req, res);
}
