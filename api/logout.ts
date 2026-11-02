import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cerrarSesion, mismoOrigen } from "../lib/session";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  if (!mismoOrigen(req)) return res.status(403).json({ ok: false, error: "Origen no autorizado" });
  try {
    await cerrarSesion(req, res);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error cerrando sesión", error);
    return res.status(503).json({ ok: false, error: "No se pudo cerrar la sesión" });
  }
}
