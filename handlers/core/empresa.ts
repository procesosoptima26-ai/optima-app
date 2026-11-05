import type { VercelRequest, VercelResponse } from "@vercel/node";
import { autenticarAdministrador } from "../../lib/usuarios-maestros.js";
import { catalogoParaEmpresa } from "../../core/catalogo-modulos.js";

/**
 * Paso 11C.1 - Consulta de la empresa propia y catálogo informativo.
 * No acepta empresaId del navegador ni ejecuta escrituras en Airtable.
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

  // La autorización y la empresa salen de la sesión real, no del query/body.
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
      // Nombre histórico de la propiedad, conservado por compatibilidad.
      modulosContratados: contexto.modulosEmpresa.filter(modulo => modulo !== "CORE"),
    },
    modulosUsuario: contexto.modulosUsuario.filter(modulo => modulo !== "CORE"),
    catalogoModulos: catalogoParaEmpresa(contexto.modulosEmpresa),
    sucursalesAutorizadas: contexto.sucursalesAutorizadas
      .filter(sucursal => sucursal.activa)
      .map(sucursal => ({ id: sucursal.id, nombre: sucursal.nombre })),
  });
}
