import dotenv from "dotenv";
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  generarTokenSesion,
  guardarSesion,
  establecerCookieSesion,
} from "../lib/session.js";
import { leerAccesoCoreDesdeAirtable } from "../core/airtable.js";
import { leerAccesoPlataforma, presentarUsuarioPlataforma } from "../core/acceso-plataforma.js";
import { presentarUsuarioCore } from "../core/usuario-publico.js";

dotenv.config({ path: ".env.local" });

type RegistroAirtable = { id: string; fields: Record<string, unknown> };
type RespuestaAirtable = { records?: RegistroAirtable[] };

function exigirEnv(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) throw new Error(`Falta configurar ${nombre}`);
  return valor;
}

function escaparFormula(valor: string): string {
  return valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** El único uso de PASSWORD_HASH es la verificación; nunca sale del servidor. */
async function buscarUsuarioPorNombre(usuario: string): Promise<RegistroAirtable | null> {
  const base = exigirEnv("AIRTABLE_USERS_BASE_ID");
  const tabla = exigirEnv("AIRTABLE_USERS_TABLE_ID");
  const token = exigirEnv("AIRTABLE_TOKEN");
  const url = new URL(`https://api.airtable.com/v0/${base}/${tabla}`);
  url.searchParams.set("filterByFormula", `LOWER({USUARIO}) = "${escaparFormula(usuario.toLowerCase())}"`);
  url.searchParams.set("maxRecords", "1");
  const respuesta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!respuesta.ok) throw new Error(`Fallo buscando usuario (${respuesta.status})`);
  const datos = (await respuesta.json()) as RespuestaAirtable;
  return datos.records?.[0] ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  try {
    const usuario = typeof req.body?.usuario === "string" ? req.body.usuario.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!usuario || !password) return res.status(400).json({ ok: false, error: "Faltan usuario y contraseña" });

    const registro = await buscarUsuarioPorNombre(usuario);
    if (!registro) return res.status(401).json({ ok: false, error: "Usuario o contraseña incorrectos" });

    const hash = registro.fields.PASSWORD_HASH;
    if (typeof hash !== "string" || !hash.startsWith("$argon2id$")) {
      return res.status(403).json({ ok: false, error: "La cuenta requiere actualización de seguridad" });
    }
    if (!(await argon2.verify(hash, password))) {
      return res.status(401).json({ ok: false, error: "Usuario o contraseña incorrectos" });
    }

    // Identidad global por ID explícito y empresa de plataforma por ID (no por ROL solo).
    // Un candidato inválido NO puede entrar por la ruta de un cliente.
    const plataforma = await leerAccesoPlataforma(registro.id);
    if (plataforma !== null) {
      if (!plataforma) return res.status(403).json({ ok: false, error: "Cuenta de plataforma no autorizada" });
      const token = generarTokenSesion();
      await guardarSesion(token, { usuarioId: registro.id });
      establecerCookieSesion(res, token);
      return res.status(200).json({ ok: true, usuario: presentarUsuarioPlataforma(plataforma) });
    }

    // La Base Maestra decide: empresa activa, sucursales reales, módulos contratados.
    const acceso = await leerAccesoCoreDesdeAirtable(registro.id);
    if (!acceso.ok) {
      return res.status(403).json({ ok: false, error: "El usuario no tiene una configuración de acceso válida" });
    }

    // Guardar sesión SOLO después de verificar la identidad completa del Core.
    const token = generarTokenSesion();
    await guardarSesion(token, { usuarioId: registro.id });
    establecerCookieSesion(res, token);
    return res.status(200).json({ ok: true, usuario: presentarUsuarioCore(acceso) });
  } catch (error) {
    console.error("Error iniciando sesión OPTIMA:", error);
    return res.status(503).json({ ok: false, error: "No se pudo verificar el inicio de sesión" });
  }
}
