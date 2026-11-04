
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { autenticarAdministrador } from "../../lib/usuarios-maestros.js";
import { prepararAltaSucursal } from "../../core/gestion-sucursales.js";
import { bloquearAltaSucursal, liberarAltaSucursal } from "../../lib/bloqueo-sucursales.js";

const ID = /^rec[A-Za-z0-9]{14}$/;

type Registro = {
  id: string;
  fields: Record<string, unknown>;
};

async function leerRegistro(
  base: string,
  tabla: string,
  id: string,
  token: string
): Promise<Registro> {
  if (!ID.test(id) || !/^tbl[A-Za-z0-9]{14}$/.test(tabla)) {
    throw new Error("Identificador inválido");
  }

  const url = `https://api.airtable.com/v0/${base}/${tabla}/${id}`;

  const respuesta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!respuesta.ok) {
    throw new Error("No se pudo consultar Base Maestra");
  }

  const registro = await respuesta.json() as Registro;

  if (
    registro.id !== id ||
    !registro.fields ||
    typeof registro.fields !== "object"
  ) {
    throw new Error("Registro inválido");
  }

  return registro;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
  }

  // Autorización existente: ADMIN con usuarios.gestionar.
  // Esta ruta es únicamente de lectura.
  const admin = await autenticarAdministrador(
    req, res,
    req.method === "POST" ? "sucursales.gestionar" : "usuarios.gestionar"
  );
  if (!admin) return;

  const empresaId = admin.contexto.empresa.id;
  let propietario: string | null = null;

  try {
    const base = process.env.AIRTABLE_USERS_BASE_ID;
    const tablaEmpresas = process.env.AIRTABLE_COMPANIES_TABLE_ID;
    const tablaSucursales = process.env.AIRTABLE_SUCURSALES_TABLE_ID;
    const token = process.env.AIRTABLE_TOKEN;

    if (!base || !tablaEmpresas || !tablaSucursales || !token) {
      throw new Error("Configuración incompleta");
    }

    if (req.method === "POST") {
      if (req.body?.accion !== "crear") {
        return res.status(400).json({
          ok: false, error: "Operación no admitida"
        });
      }

      propietario = await bloquearAltaSucursal(empresaId);

      if (!propietario) {
        return res.status(409).json({
          ok: false,
          error: "Otra creación de sucursal está en proceso"
        });
      }
    }

    // La empresa se obtiene de la sesión, nunca del navegador.
    const empresa = await leerRegistro(
      base, tablaEmpresas, empresaId, token
    );

    const ids = empresa.fields.SUCURSALES ?? [];

    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      !ids.every((id) => typeof id === "string" && ID.test(id)) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error("Vínculos de sucursales inválidos");
    }

    const sucursales = await Promise.all(
      ids.map(async (id: string) => {
        const registro = await leerRegistro(
          base, tablaSucursales, id, token
        );

        const campos = registro.fields;

        // Verificación cruzada para impedir mezclar empresas.
        if (
          !Array.isArray(campos.EMPRESA) ||
          campos.EMPRESA.length !== 1 ||
          campos.EMPRESA[0] !== empresaId ||
          typeof campos.NOMBRE !== "string" ||
          !campos.NOMBRE.trim()
        ) {
          throw new Error("Sucursal inconsistente");
        }

        return {
          id: registro.id,
          nombre: campos.NOMBRE.trim(),
          activa: campos.ACTIVA === true,
          autorizada: admin.contexto.sucursalesAutorizadas.some(
            (s) => s.id === registro.id && s.activa
          ),
        };
      })
    );

    sucursales.sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es")
    );


    if (req.method === "POST") {
      const alta = prepararAltaSucursal(
        req.body?.nombre, empresaId, sucursales
      );

      if (!alta.ok) {
        return res.status(400).json({
          ok: false, error: alta.error
        });
      }

      const respuesta = await fetch(
        `https://api.airtable.com/v0/${base}/${tablaSucursales}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: alta.campos,
            typecast: false,
          }),
        }
      );

      if (!respuesta.ok) {
        throw new Error("Airtable rechazó el alta");
      }

      const creada = await respuesta.json() as Registro;

      if (
        !ID.test(creada.id) ||
        !creada.fields ||
        !Array.isArray(creada.fields.EMPRESA) ||
        creada.fields.EMPRESA.length !== 1 ||
        creada.fields.EMPRESA[0] !== empresaId ||
        creada.fields.ACTIVA !== true
      ) {
        throw new Error("No se pudo confirmar el alta");
      }

      return res.status(201).json({
        ok: true,
        sucursal: {
          id: creada.id,
          nombre: creada.fields.NOMBRE,
          activa: true,
        },
      });
    }

    return res.status(200).json({
      ok: true,
      sucursales,
    });
  } catch (error) {
    console.error("Paso 11B:", error);

    return res.status(503).json({
      ok: false,
      error: "No se pudieron consultar las sucursales",
    });
  } finally {
    if (propietario) {
      try {
        await liberarAltaSucursal(empresaId, propietario);
      } catch (error) {
        console.error("No se pudo liberar el bloqueo:", error);
      }
    }
  }
}
