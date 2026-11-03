import dotenv from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigirAutorizacion } from "../../lib/autorizacion.js";

dotenv.config({ path: ".env.local" });

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type AirtableResponse = {
  records?: AirtableRecord[];
  offset?: string;
  error?: unknown;
};

type RolTercero = "CLIENTE" | "PROVEEDOR" | "EMPLEADO" | "OTRO";

function getEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta configurar la variable de entorno: ${name}`);
  }

  return value;
}

function normalizarTexto(valor: unknown): string {
  if (typeof valor === "string") {
    return valor.trim();
  }

  if (typeof valor === "number") {
    return String(valor);
  }

  if (Array.isArray(valor)) {
    return valor
      .map((item) => normalizarTexto(item))
      .filter(Boolean)
      .join(", ");
  }

  return "";
}

function normalizarLista(valor: unknown): string[] {
  if (!Array.isArray(valor)) {
    return [];
  }

  return valor
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizarBooleano(valor: unknown): boolean {
  return valor === true;
}

function getAirtableConfig() {
  return {
    token: getEnv("AIRTABLE_TOKEN"),
    baseId: getEnv("AIRTABLE_ADMIN_BASE_ID"),
    tercerosTable:
      process.env.AIRTABLE_ADMIN_TERCEROS_TABLE_NAME || "TERCEROS",
  };
}

function mapearTercero(record: AirtableRecord) {
  return {
    id: record.id,
    tercero: normalizarTexto(record.fields.TERCERO),
    codigoTercero: normalizarTexto(record.fields.CÓDIGO_TERCERO),
    roles: normalizarLista(record.fields.ROLES),
    tipoPersona: normalizarTexto(record.fields.TIPO_PERSONA),
    nombre: normalizarTexto(record.fields.NOMBRE),
    apellido: normalizarTexto(record.fields.APELLIDO),
    razonSocial: normalizarTexto(record.fields["RAZÓN_SOCIAL"]),
    nombreComercial: normalizarTexto(record.fields.NOMBRE_COMERCIAL),
    tipoDocumento: normalizarTexto(record.fields.TIPO_DOCUMENTO),
    numeroDocumento: normalizarTexto(record.fields["NÚMERO_DOCUMENTO"]),
    cuitCuil: normalizarTexto(record.fields.CUIT_CUIL),
    condicionIva: normalizarTexto(record.fields["CONDICIÓN_IVA"]),
    telefono: normalizarTexto(record.fields["TELÉFONO"]),
    email: normalizarTexto(record.fields.EMAIL),
    direccion: normalizarTexto(record.fields["DIRECCIÓN"]),
    localidad: normalizarTexto(record.fields.LOCALIDAD),
    provincia: normalizarTexto(record.fields.PROVINCIA),
    observaciones: normalizarTexto(record.fields.OBSERVACIONES),
    activo: normalizarBooleano(record.fields.ACTIVO),
  };
}

function obtenerRol(req: VercelRequest): RolTercero | undefined {
  const valor = typeof req.query.rol === "string"
    ? req.query.rol.trim().toUpperCase()
    : "";

  const rolesPermitidos: RolTercero[] = [
    "CLIENTE",
    "PROVEEDOR",
    "EMPLEADO",
    "OTRO",
  ];

  if (!valor) {
    return undefined;
  }

  if (!rolesPermitidos.includes(valor as RolTercero)) {
    throw new Error("El rol solicitado no es válido");
  }

  return valor as RolTercero;
}


// La base MAESTRA y la base ADMIN tienen IDs de empresa diferentes.
// Las vinculamos usando CLAVE_EMPRESA, no intercambiando record IDs.
function compararClave(valor: unknown): string {
  return normalizarTexto(valor).toUpperCase();
}

async function resolverEmpresaAdministrativa(
  empresaMaestraId: string
): Promise<string | null> {
  const token = getEnv("AIRTABLE_TOKEN");
  const masterBase = getEnv("AIRTABLE_USERS_BASE_ID");
  const masterCompanies = getEnv("AIRTABLE_COMPANIES_TABLE_ID");
  const adminBase = getEnv("AIRTABLE_ADMIN_BASE_ID");
  const adminCompanies = getEnv("AIRTABLE_ADMIN_EMPRESAS_TABLE_ID");

  const urlMaestra = new URL(
    `https://api.airtable.com/v0/${masterBase}/${encodeURIComponent(
      masterCompanies
    )}/${encodeURIComponent(empresaMaestraId)}`
  );
  const respuestaMaestra = await fetch(urlMaestra.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (respuestaMaestra.status === 404) return null;
  if (!respuestaMaestra.ok) {
    throw new Error("No se pudo verificar la empresa maestra");
  }
  const maestra = (await respuestaMaestra.json()) as AirtableRecord;
  const clave = compararClave(maestra.fields?.CLAVE_EMPRESA);
  if (!clave) return null;

  const coincidencias: string[] = [];
  let offset: string | undefined;
  do {
    const urlAdmin = new URL(
      `https://api.airtable.com/v0/${adminBase}/${encodeURIComponent(
        adminCompanies
      )}`
    );
    urlAdmin.searchParams.set("pageSize", "100");
    urlAdmin.searchParams.append("fields[]", "CLAVE_EMPRESA");
    if (offset) urlAdmin.searchParams.set("offset", offset);

    const respuestaAdmin = await fetch(urlAdmin.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!respuestaAdmin.ok) {
      throw new Error("No se pudo verificar la empresa administrativa");
    }
    const pagina = (await respuestaAdmin.json()) as AirtableResponse;
    for (const record of pagina.records || []) {
      if (compararClave(record.fields.CLAVE_EMPRESA) === clave) {
        coincidencias.push(record.id);
      }
    }
    offset = pagina.offset;
  } while (offset);

  // Sin equivalencia, o con claves ambiguas: acceso denegado.
  return coincidencias.length === 1 ? coincidencias[0] : null;
}

async function listarTerceros(rol: RolTercero | undefined, empresaAdminId: string) {
  const { token, baseId, tercerosTable } = getAirtableConfig();

  const terceros: ReturnType<typeof mapearTercero>[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tercerosTable
      )}`
    );

    url.searchParams.set("pageSize", "100");
    url.searchParams.set("sort[0][field]", "TERCERO");
    url.searchParams.set("sort[0][direction]", "asc");

    if (rol) {
      url.searchParams.set(
        "filterByFormula",
        `FIND("${rol}", ARRAYJOIN({ROLES}, ",")) > 0`
      );
    }

    if (offset) {
      url.searchParams.set("offset", offset);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = (await response.json()) as AirtableResponse;

    if (!response.ok) {
      console.error("Error listando terceros:", data);
      throw new Error("No se pudieron obtener los terceros");
    }

    // Nunca devolver terceros sin vínculo con la empresa autorizada.
    const registrosDeEmpresa = (data.records || []).filter((record) =>
      Array.isArray(record.fields.EMPRESA) &&
      record.fields.EMPRESA.includes(empresaAdminId)
    );
    terceros.push(...registrosDeEmpresa.map(mapearTercero));
    offset = data.offset;
  } while (offset);

  return terceros;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        error: "Método no permitido",
      });
    }

    const autorizado = await exigirAutorizacion(req, res, {
      modulos: ["ADMINISTRACION"],
      permiso: "administracion.ver",
    });
    if (!autorizado) return;

    const empresaAdminId = await resolverEmpresaAdministrativa(
      autorizado.empresaId
    );
    if (!empresaAdminId) {
      return res.status(403).json({
        ok: false,
        error: "La empresa no tiene una vinculación administrativa válida",
      });
    }

    const rol = obtenerRol(req);
    const terceros = await listarTerceros(rol, empresaAdminId);

    return res.status(200).json({
      ok: true,
      rol: rol || null,
      terceros,
    });
  } catch (error) {
    console.error("Error en administración/terceros:", error);

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Error interno del servidor",
    });
  }
}
