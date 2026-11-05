import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buscarSesion,
  leerTokenSesion,
  eliminarSesion,
  borrarCookieSesion,
} from "../lib/session.js";
import { leerAccesoCoreDesdeAirtable } from "../core/airtable.js";
import { leerAccesoPlataforma, presentarUsuarioPlataforma } from "../core/acceso-plataforma.js";
import { presentarUsuarioCore } from "../core/usuario-publico.js";

dotenv.config({ path: ".env.local" });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });

  const token = leerTokenSesion(req);
  if (!token) {
    borrarCookieSesion(res);
    return res.status(401).json({ ok: false, error: "No hay una sesión activa" });
  }
  try {
    const sesion = await buscarSesion(token);
    if (!sesion) {
      borrarCookieSesion(res);
      return res.status(401).json({ ok: false, error: "La sesión venció o fue cerrada" });
    }
    const plataforma = await leerAccesoPlataforma(sesion.usuarioId);
    if (plataforma !== null) {
      if (!plataforma) {
        await eliminarSesion(token);
        borrarCookieSesion(res);
        return res.status(401).json({ ok: false, error: "La sesión de plataforma no está autorizada" });
      }
      return res.status(200).json({ ok: true, usuario: presentarUsuarioPlataforma(plataforma) });
    }
    const acceso = await leerAccesoCoreDesdeAirtable(sesion.usuarioId);
    if (!acceso.ok) {
      // Una empresa o usuario desactivado pierde su sesión inmediatamente.
      await eliminarSesion(token);
      borrarCookieSesion(res);
      return res.status(401).json({ ok: false, error: "La sesión no está autorizada" });
    }
    return res.status(200).json({ ok: true, usuario: presentarUsuarioCore(acceso) });
  } catch (error) {
    // Ante fallas de Airtable/Redis no crear una sesión falsa ni renovar permisos.
    console.error("Error verificando la sesión del Core:", error);
    return res.status(503).json({ ok: false, error: "No se pudo verificar la sesión" });
  }
}
