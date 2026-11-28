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
 * Formulario para crear un producto nuevo (lo usan Recepción y Ventas).
 * Para qué sirve: Producto, Marca, Presentación y Especificación se ELIGEN de las opciones que ya
 * existen (con buscador), así no se mezclan mayúsculas, tildes ni "1kg / 1 Kg". Además permite
 * elegir el Proveedor y la Cant. pack en el mismo paso, sin entrar después a Airtable.
 */

type Opciones = {
  producto: string[];
  marca: string[];
  presentacion: string[];
  especificacion: string[];
  proveedores: { id: string; nombre: string }[];
};

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

export default function FormularioProductoNuevo({
  codigo, nombreSugerido, deshabilitado, textoBoton, onCreado, onCancelar, onError, onOcupado,
}: Props) {
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [errorOpciones, setErrorOpciones] = useState("");
  const [producto, setProducto] = useState<string[]>([]);
  const [marca, setMarca] = useState<string[]>([]);
  const [presentacion, setPresentacion] = useState<string[]>([]);
  const [especificacion, setEspecificacion] = useState<string[]>([]);
  const [proveedor, setProveedor] = useState<string[]>([]);
  const [cantPack, setCantPack] = useState("");
  const [guardando, setGuardando] = useState(false);

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
        if (igual) setProducto([igual]);
      } catch (e) {
        if (vigente) setErrorOpciones(e instanceof Error ? e.message : "No se pudieron cargar las opciones.");
      }
    })();
    return () => { vigente = false; };
  }, [nombreSugerido]);

  const nombresProveedores = useMemo(() => (opciones?.proveedores ?? []).map((p) => p.nombre), [opciones]);
  const packNormalizado = normalizarCantPack(cantPack);
  const vistaPrevia = nombreMaster({
    producto: producto[0] ?? "", marca: marca[0], especificacion, presentacion: presentacion[0],
  });

  async function guardar() {
    if (!producto[0]) { onError("Elegí o agregá el Producto (por ejemplo «Arroz»)."); return; }
    if (packNormalizado === null) { onError("La cantidad por pack debe ser un número entero mayor a 0."); return; }
    const elegido = opciones?.proveedores.find((p) => p.nombre === proveedor[0]);
    setGuardando(true);
    onOcupado?.(true);
    try {
      const respuesta = await fetch("/api/productos-movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo,
          producto: producto[0],
          marca: marca[0] ?? "",
          presentacion: presentacion[0] ?? "",
          especificacion,
          ...(proveedor[0] ? (elegido ? { proveedorId: elegido.id } : { proveedorNuevo: proveedor[0] }) : {}),
          cantPack: packNormalizado,
        }),
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

  if (errorOpciones) return <div className="mov-empty" role="alert">{errorOpciones}</div>;
  if (!opciones) return <div className="mov-product-searching">Cargando opciones...</div>;

  const bloqueado = Boolean(deshabilitado) || guardando;
  return (
    <div className="mov-new-product-form">
      <SelectorOpcion etiqueta="Producto" campo="producto" obligatorio opciones={opciones.producto}
        elegidos={producto} deshabilitado={bloqueado} onCambio={setProducto} />
      <div className="mov-two-columns">
        <SelectorOpcion etiqueta="Marca" campo="marca" opciones={opciones.marca}
          elegidos={marca} deshabilitado={bloqueado} onCambio={setMarca} />
        <SelectorOpcion etiqueta="Presentación" campo="presentacion" opciones={opciones.presentacion}
          elegidos={presentacion} deshabilitado={bloqueado} onCambio={setPresentacion} />
      </div>
      <SelectorOpcion etiqueta="Especificación" campo="especificacion" multiple opciones={opciones.especificacion}
        elegidos={especificacion} deshabilitado={bloqueado} onCambio={setEspecificacion} />
      <div className="mov-two-columns">
        <SelectorOpcion etiqueta="Proveedor" campo="proveedor" opciones={nombresProveedores}
          elegidos={proveedor} deshabilitado={bloqueado} onCambio={setProveedor} />
        <label className="mov-field">
          Cant. pack (opcional)
          <input
            inputMode="numeric"
            value={cantPack}
            disabled={bloqueado}
            maxLength={4}
            placeholder="Unidades por pack"
            onChange={(e) => setCantPack(e.target.value.replace(/\D/g, ""))}
          />
        </label>
      </div>
      {proveedor[0] && !opciones.proveedores.some((p) => p.nombre === proveedor[0]) && (
        <small>El proveedor «{proveedor[0]}» se va a crear solo con el nombre. Administración completa el resto de los datos.</small>
      )}
      {vistaPrevia && <small>Así va a quedar el nombre: <strong>{vistaPrevia}</strong></small>}
      <button type="button" className="mov-create-product-button" onClick={() => void guardar()} disabled={bloqueado}>
        {guardando ? "Creando producto..." : textoBoton}
      </button>
      {onCancelar && (
        <button type="button" className="mov-refresh-button" onClick={onCancelar} disabled={bloqueado}>Cancelar</button>
      )}
    </div>
  );
}
