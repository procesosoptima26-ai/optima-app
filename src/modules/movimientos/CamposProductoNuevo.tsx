import { useEffect, useMemo, useState } from "react";
import {
  claveOpcion,
  formatearOpcionNueva,
  limpiarOpcion,
  nombreMaster,
  normalizarCantPack,
  opcionExistente,
  type CampoOpcion,
} from "../../../lib/producto-opciones.js";

/**
 * Campos para crear un producto nuevo (los usan Recepción, Ventas y Stock).
 * Para qué sirve: Producto, Marca, Presentación y Especificación se ELIGEN de las opciones que ya
 * existen (con buscador), así no se mezclan mayúsculas, tildes ni "1kg / 1 Kg". Además permite
 * elegir el Proveedor y la Cant. pack en el mismo paso, sin entrar después a Airtable.
 * Es un componente "controlado": la pantalla que lo usa guarda los valores y decide cuándo enviarlos.
 */

type Opciones = {
  producto: string[];
  marca: string[];
  presentacion: string[];
  especificacion: string[];
  proveedores: { id: string; nombre: string }[];
};

export type CamposNuevo = {
  producto: string[];
  marca: string[];
  presentacion: string[];
  especificacion: string[];
  proveedor: string[];
  cantPack: string;
};

export const camposNuevoVacios: CamposNuevo = {
  producto: [], marca: [], presentacion: [], especificacion: [], proveedor: [], cantPack: "",
};

/** Lo que se envía al servidor. El servidor reconoce si el proveedor ya existe (aunque cambie mayúsculas o tildes). */
export function cuerpoAltaProducto(c: CamposNuevo) {
  return {
    producto: c.producto[0] ?? "",
    marca: c.marca[0] ?? "",
    presentacion: c.presentacion[0] ?? "",
    especificacion: c.especificacion,
    proveedorNuevo: c.proveedor[0] ?? "",
    cantPack: normalizarCantPack(c.cantPack) ?? "",
  };
}

type Props = {
  valor: CamposNuevo;
  onCambio: (valor: CamposNuevo) => void;
  deshabilitado?: boolean;
  /** Nombre que venía en el archivo de ventas, si lo hay (se deja elegido si ya existe como Producto). */
  nombreSugerido?: string;
  /** Muestra "Así va a quedar el nombre" (la pantalla de Stock ya tiene su propia vista previa). */
  mostrarVistaPrevia?: boolean;
};

type PropsSelector = {
  etiqueta: string;
  campo: CampoOpcion | "proveedor";
  opciones: string[];
  elegidos: string[];
  multiple?: boolean;
  obligatorio?: boolean;
  deshabilitado?: boolean;
  onCambio: (valores: string[]) => void;
};

const MAXIMO_SUGERENCIAS = 8;

/** Lista desplegable con buscador: elegís una opción existente o agregás una nueva con control de parecidos. */
function SelectorOpcion({ etiqueta, campo, opciones, elegidos, multiple, obligatorio, deshabilitado, onCambio }: PropsSelector) {
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState(false);

  const clave = claveOpcion(busqueda);
  const sugerencias = useMemo(() => {
    const ya = new Set(elegidos.map(claveOpcion));
    return opciones
      .filter((o) => !ya.has(claveOpcion(o)) && (!clave || claveOpcion(o).includes(clave)))
      .slice(0, MAXIMO_SUGERENCIAS);
  }, [opciones, elegidos, clave]);

  const textoNuevo = campo === "proveedor" ? limpiarOpcion(busqueda) : formatearOpcionNueva(campo, busqueda);
  const yaExiste = Boolean(clave) && opcionExistente(busqueda, opciones) !== null;
  const yaElegido = Boolean(clave) && elegidos.some((e) => claveOpcion(e) === clave);
  const puedeAgregar = Boolean(clave) && !yaExiste && !yaElegido;

  function elegir(valor: string) {
    onCambio(multiple ? [...elegidos, valor] : [valor]);
    setBusqueda("");
    setAbierto(false);
  }

  const ocultarInput = !multiple && elegidos.length > 0;

  return (
    <div className="mov-field mov-selector">
      <span>{etiqueta}{obligatorio ? "" : " (opcional)"}</span>
      {elegidos.length > 0 && (
        <div className="mov-selector-elegidos">
          {elegidos.map((e) => (
            <span key={e} className="mov-selector-chip">
              {e}
              <button
                type="button"
                aria-label={`Quitar ${e}`}
                disabled={deshabilitado}
                onClick={() => onCambio(elegidos.filter((x) => x !== e))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {!ocultarInput && (
        <>
          <input
            value={busqueda}
            disabled={deshabilitado}
            maxLength={100}
            placeholder="Buscar..."
            onFocus={() => setAbierto(true)}
            onChange={(e) => { setBusqueda(e.target.value); setAbierto(true); }}
          />
          {abierto && (sugerencias.length > 0 || puedeAgregar) && (
            <ul className="mov-selector-lista">
              {sugerencias.map((o) => (
                <li key={o}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(o)}>{o}</button>
                </li>
              ))}
              {puedeAgregar && (
                <li>
                  <button
                    type="button"
                    className="mov-selector-nueva"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => elegir(textoNuevo)}
                  >
                    ＋ Agregar «{textoNuevo}» como opción nueva
                  </button>
                </li>
              )}
            </ul>
          )}
          {abierto && (
            <button type="button" className="mov-selector-cerrar" onClick={() => setAbierto(false)}>Cerrar lista</button>
          )}
        </>
      )}
    </div>
  );
}

export default function CamposProductoNuevo({ valor, onCambio, deshabilitado, nombreSugerido, mostrarVistaPrevia = true }: Props) {
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [errorOpciones, setErrorOpciones] = useState("");

  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const respuesta = await fetch("/api/productos-movimientos?opciones=1");
        const datos = (await respuesta.json()) as { ok?: boolean; error?: string; opciones?: Opciones };
        if (!respuesta.ok || !datos.ok || !datos.opciones) throw new Error(datos.error || "No se pudieron cargar las opciones.");
        if (!vigente) return;
        setOpciones(datos.opciones);
        // Si el archivo de ventas trae un nombre que ya es un Producto existente, se deja elegido.
        const igual = nombreSugerido ? opcionExistente(nombreSugerido, datos.opciones.producto) : null;
        if (igual && valor.producto.length === 0) onCambio({ ...valor, producto: [igual] });
      } catch (e) {
        if (vigente) setErrorOpciones(e instanceof Error ? e.message : "No se pudieron cargar las opciones.");
      }
    })();
    return () => { vigente = false; };
    // Se cargan una sola vez al abrir; el valor inicial no debe volver a disparar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nombresProveedores = useMemo(() => (opciones?.proveedores ?? []).map((p) => p.nombre), [opciones]);
  const vistaPrevia = nombreMaster({
    producto: valor.producto[0] ?? "", marca: valor.marca[0], especificacion: valor.especificacion, presentacion: valor.presentacion[0],
  });

  if (errorOpciones) return <div className="mov-empty" role="alert">{errorOpciones}</div>;
  if (!opciones) return <div className="mov-product-searching">Cargando opciones...</div>;

  const cambiar = (parcial: Partial<CamposNuevo>) => onCambio({ ...valor, ...parcial });
  const proveedorEsNuevo = valor.proveedor[0] !== undefined && !opcionExistente(valor.proveedor[0], nombresProveedores);
  return (
    <div className="mov-new-product-form">
      <SelectorOpcion etiqueta="Producto" campo="producto" obligatorio opciones={opciones.producto}
        elegidos={valor.producto} deshabilitado={deshabilitado} onCambio={(v) => cambiar({ producto: v })} />
      <div className="mov-two-columns">
        <SelectorOpcion etiqueta="Marca" campo="marca" opciones={opciones.marca}
          elegidos={valor.marca} deshabilitado={deshabilitado} onCambio={(v) => cambiar({ marca: v })} />
        <SelectorOpcion etiqueta="Presentación" campo="presentacion" opciones={opciones.presentacion}
          elegidos={valor.presentacion} deshabilitado={deshabilitado} onCambio={(v) => cambiar({ presentacion: v })} />
      </div>
      <SelectorOpcion etiqueta="Especificación" campo="especificacion" multiple opciones={opciones.especificacion}
        elegidos={valor.especificacion} deshabilitado={deshabilitado} onCambio={(v) => cambiar({ especificacion: v })} />
      <div className="mov-two-columns">
        <SelectorOpcion etiqueta="Proveedor" campo="proveedor" opciones={nombresProveedores}
          elegidos={valor.proveedor} deshabilitado={deshabilitado} onCambio={(v) => cambiar({ proveedor: v })} />
        <label className="mov-field">
          Cant. pack (opcional)
          <input
            inputMode="numeric"
            value={valor.cantPack}
            disabled={deshabilitado}
            maxLength={4}
            placeholder="Unidades por pack"
            onChange={(e) => cambiar({ cantPack: e.target.value.replace(/\D/g, "") })}
          />
        </label>
      </div>
      {proveedorEsNuevo && (
        <small>El proveedor «{valor.proveedor[0]}» se va a crear solo con el nombre. Administración completa el resto de los datos.</small>
      )}
      {mostrarVistaPrevia && vistaPrevia && <small>Así va a quedar el nombre: <strong>{vistaPrevia}</strong></small>}
    </div>
  );
}
