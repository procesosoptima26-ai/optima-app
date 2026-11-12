
import type {
  VercelRequest,
  VercelResponse,
} from "@vercel/node";

import {
  buscarSesion,
  eliminarSesion,
  renovarSesion,
  leerTokenSesion,
  establecerCookieSesion,
  borrarCookieSesion,
} from "../lib/session.js";
import { leerAccesoCoreDesdeAirtable } from "../core/airtable.js";
import { leerAccesoPlataforma } from "../core/acceso-plataforma.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader("Cache-Control", "no-store");

  // Solo aceptamos solicitudes POST.
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
  }

  // 1. Leer la cookie enviada por el navegador.
  const tokenSesion = leerTokenSesion(req);

  if (!tokenSesion) {
    borrarCookieSesion(res);

    return res.status(401).json({
      ok: false,
      error: "No hay una sesión activa",
    });
  }

  try {
    // 2. Comprobar que la sesión existe en Redis.
    const sesion = await buscarSesion(tokenSesion);

    if (!sesion) {
      borrarCookieSesion(res);

      return res.status(401).json({
        ok: false,
        error: "La sesión venció",
      });
    }

    // 3. La sesión Redis NO equivale a una cuenta aún autorizada.
    //    Revalidar usuario y empresa en la fuente autoritativa antes de renovar.
    //    Una cuenta configurada como PLATAFORMA nunca puede caer al Core cliente.
    const plataforma = await leerAccesoPlataforma(sesion.usuarioId);
    const autorizado = plataforma === null
      ? (await leerAccesoCoreDesdeAirtable(sesion.usuarioId)).ok
      : plataforma !== false;
    if (!autorizado) {
      await eliminarSesion(tokenSesion);
      borrarCookieSesion(res);
      return res.status(401).json({
        ok: false,
        error: "La sesión ya no está autorizada",
      });
    }

    // 4. Renovar el vencimiento en Redis solo después de validar el acceso.
    const renovada = await renovarSesion(tokenSesion);

    if (!renovada) {
      borrarCookieSesion(res);

      return res.status(401).json({
        ok: false,
        error: "La sesión ya no está disponible",
      });
    }

    // 5. Renovar también la cookie del navegador.
    establecerCookieSesion(res, tokenSesion);

    return res.status(200).json({
      ok: true,
      mensaje: "Sesión renovada correctamente",
    });
  } catch (error) {
    console.error(
      "Error renovando la sesión:",
      error
    );

    return res.status(503).json({
      ok: false,
      error: "No se pudo renovar la sesión",
    });
  }
}
