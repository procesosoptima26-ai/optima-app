/** Invitación por un ADMIN de SU empresa, solo a empleados USUARIO. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { construirAltaInvitado } from "../../core/alta-usuarios.js";
import { crearInvitacion, anularInvitacion, reservarNombreUsuario } from "../../lib/invitaciones.js";
import { autenticarAdministrador, crearUsuarioInactivo, existeNombreUsuario, retirarUsuarioPendiente } from "../../lib/usuarios-maestros.js";

function origenPublico(): string {
  const valor = process.env.OPTIMA_PUBLIC_URL?.trim();
  if (!valor) throw new Error("Falta OPTIMA_PUBLIC_URL");
  const u = new URL(valor);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) {
    throw new Error("OPTIMA_PUBLIC_URL debe ser una URL HTTPS confiable");
  }
  return u.origin;
}

async function enviarEmail(email: string, nombre: string, enlace: string) {
  const key = process.env.RESEND_API_KEY;
  const remitente = process.env.OPTIMA_EMAIL_FROM;
  if (!key || !remitente) throw new Error("Correo de invitaciones no configurado");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "optima-app/1.0" },
    body: JSON.stringify({
      from: remitente,
      to: [email],
      subject: "Activá tu cuenta de OPTIMA",
      text: `Hola ${nombre}. Te invitaron a OPTIMA. Abrí este enlace para establecer tu contraseña (vence en 24 horas):\n${enlace}\n\nSi no esperabas esta invitación, ignorá este correo.`,
    }),
  });
  if (!r.ok) throw new Error(`El proveedor no confirmó el envío (${r.status})`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  if (process.env.OPTIMA_INVITES_ENABLED !== "true") {
    return res.status(503).json({ ok: false, error: "Invitaciones todavía no habilitadas" });
  }
  const admin = await autenticarAdministrador(req, res);
  if (!admin) return;
  const alta = construirAltaInvitado(req.body, admin.contexto, admin.opciones);
  if ("error" in alta) return res.status(400).json({ ok: false, error: alta.error });
  // El chequeo de configuración es anterior a cualquier escritura en Airtable.
  let origin: string;
  try {
    origin = origenPublico();
    if (!process.env.RESEND_API_KEY || !process.env.OPTIMA_EMAIL_FROM) throw new Error("Email no configurado");
  } catch {
    return res.status(503).json({ ok: false, error: "Configurá el correo y la URL del entorno" });
  }
  let idCreado: string | null = null;
  let tokenCreado: string | null = null;
  try {
    if (!(await reservarNombreUsuario(alta.usuario))) {
      return res.status(429).json({ ok: false, error: "Ya hay una invitación en curso para ese usuario" });
    }
    if (await existeNombreUsuario(alta.usuario)) {
      return res.status(409).json({ ok: false, error: "Ese nombre de usuario ya existe" });
    }
    idCreado = await crearUsuarioInactivo(alta.campos);
    tokenCreado = await crearInvitacion({
      tipo: "activacion", usuarioId: idCreado, empresaId: admin.contexto.empresa.id, email: alta.email,
    });
    const enlace = `${origin}/activar.html#token=${encodeURIComponent(tokenCreado)}`;
    await enviarEmail(alta.email, String(alta.campos.NOMBRE), enlace);
    // No devolver el token, el enlace ni datos secretos al administrador.
    return res.status(201).json({ ok: true, mensaje: "Invitación enviada. La cuenta permanece inactiva hasta su activación." });
  } catch (error) {
    if (tokenCreado) {
      try { await anularInvitacion(tokenCreado); }
      catch (fallo) { console.error("No se pudo anular enlace de invitación fallida:", fallo); }
    }
    if (idCreado) {
      try {
        const retirada = await retirarUsuarioPendiente(idCreado, admin.contexto.empresa.id, alta.email);
        if (!retirada) console.error("Invitación fallida: revisar cuenta pendiente antes de reintentar", idCreado);
      } catch (fallo) { console.error("No se pudo retirar cuenta pendiente:", idCreado, fallo); }
    }
    console.error("No se pudo completar la invitación:", error);
    return res.status(503).json({ ok: false, error: "No se pudo enviar la invitación. Verificá el estado antes de reintentar." });
  }
}
