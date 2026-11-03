/** El empleado crea su propia contraseña mediante token de un solo uso. */
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consultarInvitacion, consumirInvitacion, validarClaveNueva } from "../../lib/invitaciones.js";
import { activarUsuario, leerUsuario } from "../../lib/usuarios-maestros.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = req.body?.password;
  if (!validarClaveNueva(password)) {
    return res.status(400).json({ ok: false, error: "Usá una contraseña de 12 a 128 caracteres, con letras y números" });
  }
  try {
    const invitacion = await consultarInvitacion(token);
    if (!invitacion) return res.status(410).json({ ok: false, error: "Invitación vencida o utilizada" });
    const registro = await leerUsuario(invitacion.usuarioId);
    if (!registro || registro.fields.ACTIVO === true || registro.fields.PASSWORD_HASH ||
        registro.fields.Email !== invitacion.email ||
        !Array.isArray(registro.fields.EMPRESA) ||
        registro.fields.EMPRESA.length !== 1 ||
        registro.fields.EMPRESA[0] !== invitacion.empresaId) {
      return res.status(410).json({ ok: false, error: "Invitación vencida o utilizada" });
    }
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    // GETDEL atómico evita que dos peticiones activen con el mismo enlace.
    const reclamado = await consumirInvitacion(token);
    if (!reclamado || reclamado.usuarioId !== invitacion.usuarioId ||
        reclamado.empresaId !== invitacion.empresaId || reclamado.email !== invitacion.email) {
      return res.status(410).json({ ok: false, error: "Invitación vencida o utilizada" });
    }
    await activarUsuario(invitacion.usuarioId, hash);
    return res.status(200).json({ ok: true, mensaje: "Cuenta activada. Ya podés iniciar sesión." });
  } catch (error) {
    console.error("Error activando invitación:", error);
    return res.status(503).json({ ok: false, error: "No se pudo completar la activación. Contactá al administrador." });
  }
}
