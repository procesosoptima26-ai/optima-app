/** Paso 10A — listado SOLO LECTURA, aislado por empresa real de la sesión. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { airtableUsuarios, autenticarAdministrador, type RegistroAirtable } from "../../lib/usuarios-maestros.js";

const ID = /^rec[A-Za-z0-9]{14}$/;
const CAMPOS = ["EMPRESA", "USUARIO", "NOMBRE", "Email", "ROL", "ACTIVO", "MODULOS", "SUCURSALES_AUTORIZADAS"];
const MAX_PAGINAS = 25;

type UsuarioVisible = Readonly<{
  id: string;
  usuario: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  modulos: string[];
  sucursales: string[];
  sucursalesNoVisibles: number;
}>;

function cadenas(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

/** Lista blanca: jamás se incluyen PASSWORD_HASH, tokens ni claves de terceros. */
export function usuarioParaListado(
  registro: RegistroAirtable,
  empresaId: string,
  sucursalesDisponibles: ReadonlyArray<{ id: string; nombre: string }>,
): UsuarioVisible | null {
  if (!registro || !ID.test(registro.id) || !registro.fields || typeof registro.fields !== "object") return null;
  const f = registro.fields;
  if (!Array.isArray(f.EMPRESA) || f.EMPRESA.length !== 1 || f.EMPRESA[0] !== empresaId) return null;
  const ids = [...new Set(cadenas(f.SUCURSALES_AUTORIZADAS).filter((s) => ID.test(s)))];
  const disponibles = new Map(sucursalesDisponibles.map((s) => [s.id, s.nombre]));
  const visibles = ids.filter((s) => disponibles.has(s)).map((s) => disponibles.get(s)!);
  const rol = f.ROL === "ADMIN" ? "ADMIN" : f.ROL === "USUARIO" ? "USUARIO" : "SIN DEFINIR";
  return {
    id: registro.id,
    usuario: typeof f.USUARIO === "string" ? f.USUARIO : "",
    nombre: typeof f.NOMBRE === "string" ? f.NOMBRE : "",
    email: typeof f.Email === "string" ? f.Email : "",
    rol,
    activo: f.ACTIVO === true,
    modulos: cadenas(f.MODULOS),
    sucursales: visibles,
    sucursalesNoVisibles: ids.length - visibles.length,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });
  // Reutilizamos la autorización probada: ADMIN + usuarios.gestionar.
  const admin = await autenticarAdministrador(req, res);
  if (!admin) return;
  try {
    const empresaId = admin.contexto.empresa.id; // Jamás se acepta empresaId del navegador.
    const usuarios: UsuarioVisible[] = [];
    let offset: string | null = null;
    const vistos = new Set<string>();
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const params = new URLSearchParams();
      params.set("pageSize", "100");
      for (const campo of CAMPOS) params.append("fields[]", campo);
      if (offset) params.set("offset", offset);
      const datos = await airtableUsuarios("GET", `?${params.toString()}`);
      if (!Array.isArray(datos.records)) throw new Error("Listado Airtable inválido");
      for (const registro of datos.records) {
        const u = usuarioParaListado(registro as RegistroAirtable, empresaId, admin.opciones.sucursales);
        if (u && !vistos.has(u.id)) { vistos.add(u.id); usuarios.push(u); }
      }
      if (datos.offset === undefined || datos.offset === null || datos.offset === "") {
        usuarios.sort((a, b) => a.usuario.localeCompare(b.usuario, "es"));
        return res.status(200).json({ ok: true, usuarios });
      }
      if (typeof datos.offset !== "string" || datos.offset.length > 1000 || datos.offset === offset)
        throw new Error("Paginación Airtable inválida");
      offset = datos.offset;
    }
    // Nunca devolver un listado parcial como si estuviera completo.
    throw new Error("Listado supera el límite de páginas configurado");
  } catch (error) {
    console.error("No se pudo listar usuarios de la empresa:", error);
    return res.status(503).json({ ok: false, error: "No se pudo completar el listado de usuarios" });
  }
}
