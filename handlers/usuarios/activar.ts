/** El empleado crea su propia contraseña mediante token de un solo uso. */
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consultarInvitacion, bloquearActivacion, liberarBloqueoActivacion, anularInvitacion, validarClaveNueva } from "../../lib/invitaciones.js";
import { activarUsuario, leerUsuario } from "../../lib/usuarios-maestros.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = req.body?.password;
  if (!validarClaveNueva(password)) {
    return res.status(400).json({ ok: false, error: "Usá una contraseña de 8 a 128 caracteres, con al menos una letra, un número y un símbolo" });
  }
  let propietario: string | null = null;
  try {
    const invitacion = await consultarInvitacion(token);
    if (!invitacion) return res.status(410).json({ ok: false, error: "Invitación vencida o utilizada" });
    propietario = await bloquearActivacion(token);
    if (!propietario) return res.status(409).json({ ok: false, error: "La activación está en proceso. Reintentá en un momento." });
    const registro = await leerUsuario(invitacion.usuarioId);
    if (!registro || registro.fields.ACTIVO === true || registro.fields.PASSWORD_HASH ||
        registro.fields.Email !== invitacion.email ||
        !Array.isArray(registro.fields.EMPRESA) ||
        registro.fields.EMPRESA.length !== 1 ||
        registro.fields.EMPRESA[0] !== invitacion.empresaId) {
      return res.status(410).json({ ok: false, error: "Invitación vencida o utilizada" });
    }
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await activarUsuario(invitacion.usuarioId, hash);
    // Si Redis falla en este punto, ACTIVO ya impide reutilizar el enlace.
    try { await anularInvitacion(token); }
    catch (fallo) { console.error("No se pudo anular enlace de cuenta activada:", fallo); }
    return res.status(200).json({ ok: true, mensaje: "Cuenta activada. Ya podés iniciar sesión." });
  } catch (error) {
    console.error("Error activando invitación:", error);
    return res.status(503).json({ ok: false, error: "No se pudo completar la activación. Podés volver a intentarlo desde el mismo enlace." });
  } finally {
    if (propietario) {
      try { await liberarBloqueoActivacion(token, propietario); }
      catch (fallo) { console.error("No se pudo liberar bloqueo de activación:", fallo); }
    }
  }
}
