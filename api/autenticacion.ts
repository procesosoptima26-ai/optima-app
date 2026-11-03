/** Router OPTIMA: agrupa endpoints sin alterar las autorizaciones internas. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import login from "../handlers/login.js";
import logout from "../handlers/logout.js";
import session from "../handlers/session.js";
import actividad from "../handlers/actividad.js";

const handlers = { login, logout, session, actividad };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const accion = req.query.accion;
  if (typeof accion !== "string" || !Object.prototype.hasOwnProperty.call(handlers, accion)) {
    return res.status(404).json({ ok: false, error: "Ruta inexistente" });
  }
  return handlers[accion as keyof typeof handlers](req, res);
}
