/** Solicitud pública: respuesta genérica para no revelar si una cuenta existe. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buscarUsuarioParaRecuperacion } from "../../lib/usuarios-maestros.js";
import { huellaPassword, permitirOrigen, reservarSolicitud, crearRecuperacion, anularRecuperacion } from "../../lib/recuperacion.js";

const GENERICO = "Si los datos corresponden a una cuenta activa, recibirás un correo con instrucciones.";

function origenPublico(): string {
  const raw = process.env.OPTIMA_PUBLIC_URL;
  if (!raw) throw new Error("Falta URL de OPTIMA");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("OPTIMA_PUBLIC_URL inválida");
  return url.origin;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  if (process.env.OPTIMA_PASSWORD_RESET_ENABLED !== "true")
    return res.status(503).json({ ok: false, error: "Recuperación todavía no habilitada" });
  const usuario = typeof req.body?.usuario === "string" ? req.body.usuario.trim().toUpperCase() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!/^[A-Z0-9._-]{3,40}$/.test(usuario) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 250)
    return res.status(400).json({ ok: false, error: "Ingresá un usuario y correo válidos" });
  if (!process.env.RESEND_API_KEY || !process.env.OPTIMA_EMAIL_FROM)
    return res.status(503).json({ ok: false, error: "Correo de recuperación no configurado" });
  let origin: string;
  try { origin = origenPublico(); }
  catch { return res.status(503).json({ ok: false, error: "URL de recuperación no configurada" }); }

  let token: string | null = null;
  try {
    const ip = req.headers["x-vercel-forwarded-for"];
    const origen = typeof ip === "string" ? ip.split(",")[0]?.trim() ?? "" : "";
    if (!(await permitirOrigen(origen))) return res.status(200).json({ ok: true, mensaje: GENERICO });
    if (!(await reservarSolicitud(usuario, email))) return res.status(200).json({ ok: true, mensaje: GENERICO });
    const registro = await buscarUsuarioParaRecuperacion(usuario, email);
    if (!registro) return res.status(200).json({ ok: true, mensaje: GENERICO });
    const hash = String(registro.fields.PASSWORD_HASH);
    const empresaId = (registro.fields.EMPRESA as string[])[0];
    token = await crearRecuperacion({ usuarioId: registro.id, empresaId, email, huellaPassword: huellaPassword(hash) });
    const enlace = `${origin}/recuperar.html#token=${encodeURIComponent(token)}`;
    const respuesta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "User-Agent": "optima-app/1.0" },
      body: JSON.stringify({
        from: process.env.OPTIMA_EMAIL_FROM,
        to: [email],
        subject: "Restablecé tu contraseña de OPTIMA",
        text: `Hola. Se solicitó cambiar la contraseña de tu cuenta OPTIMA.\nAbrí este enlace (vence en 30 minutos):\n${enlace}\n\nSi no lo solicitaste, ignorá este correo.`,
      }),
    });
    if (!respuesta.ok) throw new Error(`Resend no confirmó el envío (${respuesta.status})`);
    return res.status(200).json({ ok: true, mensaje: GENERICO });
  } catch (error) {
    if (token) {
      try { await anularRecuperacion(token); }
      catch (fallo) { console.error("No se pudo anular recuperación fallida:", fallo); }
    }
    console.error("No se pudo procesar solicitud de recuperación:", error);
    // Misma respuesta externa para cuenta existente o inexistente, incluso ante falla de envío.
    return res.status(200).json({ ok: true, mensaje: GENERICO });
  }
}
