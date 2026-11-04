
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { autenticarAdministrador } from "../lib/usuarios-maestros.js";

/**
 * Paso 11A — Configuración empresarial.
 * Solo lectura: nunca modifica la Base Maestra.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
  }

  const admin = await autenticarAdministrador(req, res);
  if (!admin) return;

  const { contexto } = admin;

  return res.status(200).json({
    ok: true,
    empresa: {
      id: contexto.empresa.id,
      clave: contexto.empresa.clave,
      activa: contexto.empresa.activa,
      coreIncluido: true,
      modulosContratados: contexto.modulosEmpresa.filter(
        (modulo) => modulo !== "CORE"
      ),
    },
    sucursalesAutorizadas: contexto.sucursalesAutorizadas
      .filter((sucursal) => sucursal.activa)
      .map((sucursal) => ({
        id: sucursal.id,
        nombre: sucursal.nombre,
      })),
  });
}
