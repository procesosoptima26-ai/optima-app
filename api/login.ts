
import dotenv from "dotenv";
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";

dotenv.config({ path: ".env.local" });

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type AirtableList = {
  records?: AirtableRecord[];
};

function getEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Variable de entorno no configurada: ${nombre}`);
  }
  return valor;
}

function normalizarTexto(valor: unknown): string {
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number") return String(valor);

  if (Array.isArray(valor)) {
    return valor.map(normalizarTexto).filter(Boolean).join(", ");
  }

  if (valor && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;

    if (typeof objeto.name === "string") return objeto.name.trim();
    if (typeof objeto.text === "string") return objeto.text.trim();
    if (typeof objeto.value === "string") return objeto.value.trim();
  }

  return "";
}

function normalizarModulos(valor: unknown): string[] {
  const valores = Array.isArray(valor)
    ? valor
    : normalizarTexto(valor).split(",");

  return valores
    .map((item) =>
      normalizarTexto(item).toUpperCase().replaceAll(" ", "_")
    )
    .filter(Boolean);
}

function normalizarActivo(valor: unknown): boolean {
  return (
    valor === true ||
    valor === 1 ||
    valor === "1" ||
    valor === "true"
  );
}

function escaparFormulaAirtable(valor: string): string {
  return valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function consultarAirtable<T>(
  url: URL,
  token: string
): Promise<T> {
  const respuesta = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!respuesta.ok) {
    console.error(
      "Airtable API error:",
      respuesta.status,
      url.pathname
    );
    throw new Error(
      `Error de consulta a Airtable (${respuesta.status})`
    );
  }

  return (await respuesta.json()) as T;
}

async function obtenerEmpresa(
  vinculos: unknown,
  baseId: string,
  tablaEmpresas: string,
  token: string
): Promise<{ empresa: string; empresaId: string }> {
  const empresaId =
    Array.isArray(vinculos) && vinculos.length > 0
      ? normalizarTexto(vinculos[0])
      : "";

  if (!/^rec[A-Za-z0-9]{14}$/.test(empresaId)) {
    throw new Error(
      "El usuario no tiene una empresa vinculada válida"
    );
  }

  const url = new URL(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
      tablaEmpresas
    )}/${empresaId}`
  );

  const empresaRegistro = await consultarAirtable<AirtableRecord>(
    url,
    token
  );

  const nombre = normalizarTexto(
    empresaRegistro.fields?.NOMBRE_COMERCIAL
  );

  if (!nombre) {
    throw new Error(
      "La empresa vinculada no tiene un nombre comercial válido"
    );
  }

  return {
    empresa: nombre,
    empresaId,
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
  }

  try {
    const usuario = String(req.body?.usuario ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!usuario || !password) {
      return res.status(400).json({
        ok: false,
        error: "Faltan usuario y contraseña",
      });
    }

    const token = getEnv("AIRTABLE_TOKEN");
    const baseId = getEnv("AIRTABLE_USERS_BASE_ID");
    const tablaUsuarios = getEnv("AIRTABLE_USERS_TABLE_ID");
    const tablaEmpresas = getEnv("AIRTABLE_COMPANIES_TABLE_ID");

    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tablaUsuarios
      )}`
    );

    url.searchParams.set(
      "filterByFormula",
      `LOWER({USUARIO}) = "${escaparFormulaAirtable(
        usuario.toLowerCase()
      )}"`
    );

    url.searchParams.set("maxRecords", "1");

    const datos = await consultarAirtable<AirtableList>(
      url,
      token
    );

    const registro = datos.records?.[0];

    if (!registro) {
      return res.status(401).json({
        ok: false,
        error: "Usuario o contraseña incorrectos",
      });
    }

    // Autenticación exclusivamente mediante Argon2id.
    const passwordHash = normalizarTexto(
      registro.fields.PASSWORD_HASH
    );

    if (!passwordHash.startsWith("$argon2id$")) {
      console.error(
        "El usuario no tiene un hash Argon2id válido:",
        registro.id
      );

      return res.status(403).json({
        ok: false,
        error: "La cuenta requiere actualización de seguridad",
      });
    }

    const passwordCorrecta = await argon2.verify(
      passwordHash,
      password
    );

    if (!passwordCorrecta) {
      return res.status(401).json({
        ok: false,
        error: "Usuario o contraseña incorrectos",
      });
    }

    if (!normalizarActivo(registro.fields.ACTIVO)) {
      return res.status(403).json({
        ok: false,
        error: "El usuario no está activo",
      });
    }

    const sucursal = normalizarTexto(
      registro.fields.SUCURSAL
    ).toUpperCase();

    if (!sucursal) {
      return res.status(403).json({
        ok: false,
        error: "El usuario no tiene sucursal asignada",
      });
    }

    const { empresa, empresaId } = await obtenerEmpresa(
      registro.fields.EMPRESA,
      baseId,
      tablaEmpresas,
      token
    );

    return res.status(200).json({
      ok: true,
      usuario: {
        usuario: normalizarTexto(registro.fields.USUARIO),
        nombre: normalizarTexto(registro.fields.NOMBRE),
        empresa,
        empresaId,
        rol: normalizarTexto(registro.fields.ROL),
        sucursal,
        modulos: normalizarModulos(registro.fields.MODULOS),
      },
    });
  } catch (error) {
    console.error("Error interno iniciando sesión:", error);

    return res.status(500).json({
      ok: false,
      error: "Error interno iniciando sesión",
    });
  }
}
