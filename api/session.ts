import type { VercelRequest, VercelResponse } from "@vercel/node";
import { obtenerSesion } from "../lib/session";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });
  try {
    const usuario = await obtenerSesion(req);
    res.setHeader("Cache-Control", "no-store");
    if (!usuario) return res.status(401).json({ ok: false, error: "Sesión no válida" });
    return res.status(200).json({ ok: true, usuario });
  } catch (error) {
    console.error("Error validando sesión", error);
    return res.status(503).json({ ok: false, error: "No se pudo validar la sesión" });
  }
}
