import { useState } from "react";
import CamposProductoNuevo, { camposNuevoVacios, cuerpoAltaProducto, type CamposNuevo } from "./CamposProductoNuevo";
import { normalizarCantPack } from "../../../lib/producto-opciones.js";

/**
 * Formulario para crear un producto nuevo con su propio botón (lo usan Recepción y Ventas).
 * Los campos viven en CamposProductoNuevo; la pantalla de Stock usa esos mismos campos
 * pero guarda el producto junto con el lote.
 */

export type ProductoCreado = {
  id: string;
  codigo: string;
  codigoNormalizado: string;
  nombre: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
};

type Props = {
  codigo: string;
  /** Nombre que venía en el archivo de ventas, si lo hay (se busca como Producto). */
  nombreSugerido?: string;
  deshabilitado?: boolean;
  textoBoton: string;
  onCreado: (producto: ProductoCreado, proveedorNuevo: boolean) => void | Promise<void>;
  onCancelar?: () => void;
  onError: (mensaje: string) => void;
  /** Avisa a la pantalla que se está guardando (para frenar otros botones). */
  onOcupado?: (ocupado: boolean) => void;
};

export default function FormularioProductoNuevo({
  codigo, nombreSugerido, deshabilitado, textoBoton, onCreado, onCancelar, onError, onOcupado,
}: Props) {
  const [campos, setCampos] = useState<CamposNuevo>(camposNuevoVacios);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!campos.producto[0]) { onError("Elegí o agregá el Producto (por ejemplo «Arroz»)."); return; }
    if (normalizarCantPack(campos.cantPack) === null) { onError("La cantidad por pack debe ser un número entero mayor a 0."); return; }
    setGuardando(true);
    onOcupado?.(true);
    try {
      const respuesta = await fetch("/api/productos-movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, ...cuerpoAltaProducto(campos) }),
      });
      const datos = (await respuesta.json()) as {
        ok?: boolean; error?: string; producto?: ProductoCreado; proveedor?: { creado?: boolean } | null;
      };
      if (!respuesta.ok || !datos.ok || !datos.producto) throw new Error(datos.error || "No se pudo crear el producto.");
      await onCreado(datos.producto, Boolean(datos.proveedor?.creado));
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo crear el producto.");
    } finally {
      setGuardando(false);
      onOcupado?.(false);
    }
  }

  const bloqueado = Boolean(deshabilitado) || guardando;
  return (
    <div className="mov-new-product-form">
      <CamposProductoNuevo valor={campos} onCambio={setCampos} deshabilitado={bloqueado} nombreSugerido={nombreSugerido} />
      <button type="button" className="mov-create-product-button" onClick={() => void guardar()} disabled={bloqueado}>
        {guardando ? "Creando producto..." : textoBoton}
      </button>
      {onCancelar && (
        <button type="button" className="mov-refresh-button" onClick={onCancelar} disabled={bloqueado}>Cancelar</button>
      )}
    </div>
  );
}
