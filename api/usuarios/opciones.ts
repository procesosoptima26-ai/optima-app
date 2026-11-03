import type { VercelRequest, VercelResponse } from "@vercel/node";
import { autenticarAdministrador } from "../../lib/usuarios-maestros.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const admin = await autenticarAdministrador(req, res);
  if (!admin) return;
  return res.status(200).json({ ok: true, opciones: admin.opciones });
}
