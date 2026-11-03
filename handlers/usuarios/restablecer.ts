/** Restablece únicamente el hash y revoca las sesiones antiguas del usuario. */
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { validarClaveNueva } from "../../lib/invitaciones.js";
import { leerUsuario, actualizarPasswordUsuario } from "../../lib/usuarios-maestros.js";
import { consultarRecuperacion, bloquearRecuperacion, liberarRecuperacion, anularRecuperacion, huellaPassword } from "../../lib/recuperacion.js";
import { revocarSesionesUsuario } from "../../lib/session.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  if (process.env.OPTIMA_PASSWORD_RESET_ENABLED !== "true")
    return res.status(503).json({ ok: false, error: "Recuperación todavía no habilitada" });
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = req.body?.password;
  if (!validarClaveNueva(password)) return res.status(400).json({ ok: false, error: "La contraseña debe tener entre 8 y 128 caracteres, una letra, un número y un símbolo" });
  let owner: string | null = null;
  try {
    const datos = await consultarRecuperacion(token);
    if (!datos) return res.status(410).json({ ok: false, error: "Enlace vencido o utilizado. Solicitá uno nuevo." });
    owner = await bloquearRecuperacion(token);
    if (!owner) return res.status(409).json({ ok: false, error: "El cambio está en proceso. Intentá de nuevo en unos momentos." });
    const actual = await leerUsuario(datos.usuarioId);
    if (!actual || actual.fields.ACTIVO !== true ||
        typeof actual.fields.Email !== "string" || actual.fields.Email.trim().toLowerCase() !== datos.email ||
        !Array.isArray(actual.fields.EMPRESA) || actual.fields.EMPRESA.length !== 1 || actual.fields.EMPRESA[0] !== datos.empresaId ||
        typeof actual.fields.PASSWORD_HASH !== "string" || !actual.fields.PASSWORD_HASH.startsWith("$argon2id$") ||
        huellaPassword(actual.fields.PASSWORD_HASH) !== datos.huellaPassword)
      return res.status(410).json({ ok: false, error: "Enlace vencido o utilizado. Solicitá uno nuevo." });
    const nuevoHash = await argon2.hash(password, { type: argon2.argon2id });
    // Revoca primero: ante fallo de Airtable, la contraseña anterior queda intacta,
    // pero se cerrarán las sesiones previas como medida de seguridad.
    await revocarSesionesUsuario(datos.usuarioId);
    await actualizarPasswordUsuario(datos.usuarioId, nuevoHash);
    try { await anularRecuperacion(token); }
    catch (error) { console.error("No se pudo anular enlace ya usado:", error); }
    return res.status(200).json({ ok: true, mensaje: "Contraseña actualizada. Ya podés iniciar sesión." });
  } catch (error) {
    console.error("Error al restablecer la contraseña:", error);
    return res.status(503).json({ ok: false, error: "No se pudo guardar el cambio. Reintentá desde el mismo enlace." });
  } finally {
    if (owner) {
      try { await liberarRecuperacion(token, owner); }
      catch (error) { console.error("Error al liberar bloqueo de recuperación:", error); }
    }
  }
}
