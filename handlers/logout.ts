
import type {
  VercelRequest,
  VercelResponse,
} from "@vercel/node";

import {
  leerTokenSesion,
  eliminarSesion,
  borrarCookieSesion,
} from "../lib/session.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
  }

  const tokenSesion = leerTokenSesion(req);

  try {
    // Eliminar la sesión del servidor.
    if (tokenSesion) {
      await eliminarSesion(tokenSesion);
    }

    // Eliminar la cookie del navegador.
    borrarCookieSesion(res);

    return res.status(200).json({
      ok: true,
      mensaje: "Sesión cerrada correctamente",
    });
  } catch (error) {
    console.error(
      "No se pudo revocar la sesión:",
      error
    );

    // Borrar la cookie local aunque Redis haya fallado.
    borrarCookieSesion(res);

    return res.status(503).json({
      ok: false,
      error:
        "No se pudo confirmar el cierre de sesión en el servidor",
    });
  }
}
