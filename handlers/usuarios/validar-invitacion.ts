import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consultarInvitacion } from "../../lib/invitaciones.js";
import { leerUsuario } from "../../lib/usuarios-maestros.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  try {
    const invitacion = await consultarInvitacion(token);
    if (!invitacion) return res.status(410).json({ ok: false, error: "Invitación vencida o inválida" });
    const registro = await leerUsuario(invitacion.usuarioId);
    if (!registro || registro.fields.ACTIVO === true || registro.fields.PASSWORD_HASH ||
        registro.fields.Email !== invitacion.email ||
        !Array.isArray(registro.fields.EMPRESA) ||
        registro.fields.EMPRESA.length !== 1 ||
        registro.fields.EMPRESA[0] !== invitacion.empresaId) {
      return res.status(410).json({ ok: false, error: "Invitación vencida o inválida" });
    }
    return res.status(200).json({ ok: true, usuario: String(registro.fields.USUARIO ?? "") });
  } catch (error) {
    console.error("Error comprobando invitación:", error);
    return res.status(503).json({ ok: false, error: "No se pudo comprobar la invitación" });
  }
}
