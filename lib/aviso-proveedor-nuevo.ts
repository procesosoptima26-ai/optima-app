/**
 * Aviso a administración cuando alguien crea un PROVEEDOR NUEVO desde un formulario de producto.
 * Para qué sirve: el proveedor nace solo con el nombre; administración tiene que completar
 * razón social, CUIT, contacto, teléfono, condición de IVA y forma de pago. Este mail les avisa
 * en el momento, para que no quede incompleto sin que nadie lo sepa.
 *
 * Reglas de seguridad:
 *  - NUNCA frena ni rompe el alta del producto: cualquier problema (sin mail configurado,
 *    Airtable caído, Resend caído) se registra en el log y se sigue.
 *  - Solo avisa a los usuarios ADMIN activos de ESA empresa (nunca de otra).
 *  - Si el correo no está configurado en el entorno, no envía nada.
 */
import { enviarCorreoResend, listarCorreosAdministradores } from "./avisos-adaptadores.js";
import type { CorreoAviso } from "../core/avisos-proceso.js";

export type DatosAvisoProveedorNuevo = {
  empresaId: string;
  proveedorNombre: string;
  /** Desde qué pantalla se creó (ej. "Recepción / Ventas" o "Stock"). */
  pantalla: string;
  codigoProducto?: string | number;
  productoNombre?: string;
};

export type DependenciasAviso = {
  listarCorreos(empresaId: string): Promise<string[] | null>;
  enviar(correo: CorreoAviso): Promise<boolean>;
};

const dependenciasReales: DependenciasAviso = {
  listarCorreos: listarCorreosAdministradores,
  enviar: enviarCorreoResend,
};

/** Texto del mail (sin datos sensibles: solo nombre del proveedor y producto). */
export function armarCorreoProveedorNuevo(d: DatosAvisoProveedorNuevo, para: string): CorreoAviso {
  const producto = [d.codigoProducto ? String(d.codigoProducto) : "", d.productoNombre ?? ""]
    .filter(Boolean).join(" · ");
  const lineas = [
    "Hola,",
    "",
    `Se creó un proveedor nuevo desde ${d.pantalla}: ${d.proveedorNombre}`,
    producto ? `Producto con el que se creó: ${producto}` : "",
    "",
    "El proveedor quedó cargado solo con el nombre. Falta completar: razón social, CUIT, dirección,",
    "contacto, teléfono, condición de IVA y forma de pago (tabla PROVEEDORES).",
    "",
    "OPTIMA",
  ];
  return {
    para,
    asunto: `OPTIMA: proveedor nuevo para completar (${d.proveedorNombre})`,
    texto: lineas.filter((l, i) => l !== "" || lineas[i - 1] !== "").join("\n"),
  };
}

/**
 * Envía el aviso. Devuelve cuántos mails salieron (0 si no hay a quién avisar o algo falló).
 * No lanza nunca.
 */
export async function avisarProveedorNuevo(
  datos: DatosAvisoProveedorNuevo,
  dependencias: DependenciasAviso = dependenciasReales,
): Promise<number> {
  try {
    const correos = await dependencias.listarCorreos(datos.empresaId);
    if (!correos || correos.length === 0) {
      console.warn("Aviso de proveedor nuevo: no hay administradores con mail para avisar");
      return 0;
    }
    const unicos = [...new Set(correos.map((c) => c.trim().toLowerCase()).filter((c) => c.includes("@")))];
    let enviados = 0;
    for (const para of unicos) {
      try {
        if (await dependencias.enviar(armarCorreoProveedorNuevo(datos, para))) enviados++;
      } catch (e) {
        console.error("Aviso de proveedor nuevo: falló un envío", e instanceof Error ? e.message : e);
      }
    }
    if (enviados === 0) console.warn("Aviso de proveedor nuevo: no se pudo enviar (¿correo sin configurar?)");
    return enviados;
  } catch (e) {
    console.error("Aviso de proveedor nuevo: error", e instanceof Error ? e.message : e);
    return 0;
  }
}
