import { useMemo, useState } from "react";
import BarcodeScanner from "./components/BarcodeScanner";
import "./App.css";

type ProductoApi = {
  id: string;
  codigo: string;
  nombre: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
};

type RespuestaProductoApi = {
  encontrado: boolean;
  producto: ProductoApi | null;
  error?: string;
};

type RespuestaGuardarStockApi = {
  ok: boolean;
  cantidadRegistros?: number;
  registros?: string[];
  error?: string;
};

type Lote = {
  id: number;
  vencimiento: string;
  cantidad: string;
};

type EstadoProducto = "sin_codigo" | "buscando" | "existente" | "nuevo" | "error";

type MovimientoGuardado = {
  codigo: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
  nombre: string;
  ubicacion: string;
  sinVencimiento: boolean;
  productoNuevo: boolean;
  observaciones: string;
  lotes: Lote[];
};

const ubicaciones = ["Galpón", "Góndola", "Depósito", "Cámara"];

function armarNombre(
  producto: string,
  marca: string,
  especificacion: string,
  presentacion: string
) {
  return [producto, marca, especificacion, presentacion]
    .map((valor) => valor.trim())
    .filter(Boolean)
    .join(" ");
}

function App() {
  const [codigo, setCodigo] = useState("");
  const [producto, setProducto] = useState("");
  const [marca, setMarca] = useState("");
  const [presentacion, setPresentacion] = useState("");
  const [especificacion, setEspecificacion] = useState("");
  const [ubicacion, setUbicacion] = useState("Galpón");
  const [sinVencimiento, setSinVencimiento] = useState(false);
  const [observaciones, setObservaciones] = useState("");
  const [scannerAbierto, setScannerAbierto] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [estadoProducto, setEstadoProducto] =
    useState<EstadoProducto>("sin_codigo");
  const [ultimoMovimiento, setUltimoMovimiento] =
    useState<MovimientoGuardado | null>(null);

  const [lotes, setLotes] = useState<Lote[]>([
    {
      id: Date.now(),
      vencimiento: "",
      cantidad: "",
    },
  ]);

  const nombre = useMemo(() => {
    return armarNombre(producto, marca, especificacion, presentacion);
  }, [producto, marca, especificacion, presentacion]);

  function cargarProductoEncontrado(productoApi: ProductoApi) {
    setProducto(productoApi.producto);
    setMarca(productoApi.marca);
    setPresentacion(productoApi.presentacion);
    setEspecificacion(productoApi.especificacion);
  }

  function limpiarDatosProducto() {
    setProducto("");
    setMarca("");
    setPresentacion("");
    setEspecificacion("");
  }

  async function buscarProductoEnAirtable(codigoIngresado: string) {
    const codigoLimpio = codigoIngresado.trim();

    setCodigo(codigoLimpio);
    setMensaje("");
    setUltimoMovimiento(null);

    if (!codigoLimpio) {
      limpiarDatosProducto();
      setEstadoProducto("sin_codigo");
      return;
    }

    setEstadoProducto("buscando");
    limpiarDatosProducto();

    try {
      const response = await fetch(
        `/api/productos?codigo=${encodeURIComponent(codigoLimpio)}`
      );

      const data = (await response.json()) as RespuestaProductoApi;

      if (!response.ok) {
        throw new Error(data.error || "Error buscando producto");
      }

      if (data.encontrado && data.producto) {
        cargarProductoEncontrado(data.producto);
        setEstadoProducto("existente");
        return;
      }

      setEstadoProducto("nuevo");
    } catch (error) {
      console.error("Error buscando producto:", error);
      limpiarDatosProducto();
      setEstadoProducto("error");
      setMensaje("No se pudo buscar el producto en Airtable.");
    }
  }

  function manejarCambioCodigo(valor: string) {
    setCodigo(valor);
    setMensaje("");
    setUltimoMovimiento(null);

    if (!valor.trim()) {
      limpiarDatosProducto();
      setEstadoProducto("sin_codigo");
    }
  }

  function manejarBlurCodigo() {
    if (!codigo.trim()) return;

    buscarProductoEnAirtable(codigo);
  }

  function manejarEnterCodigo(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      buscarProductoEnAirtable(codigo);
    }
  }

  function agregarLote() {
    setLotes((lotesActuales) => [
      ...lotesActuales,
      {
        id: Date.now(),
        vencimiento: "",
        cantidad: "",
      },
    ]);
  }

  function eliminarLote(id: number) {
    setLotes((lotesActuales) => {
      if (lotesActuales.length === 1) return lotesActuales;

      return lotesActuales.filter((lote) => lote.id !== id);
    });
  }

  function actualizarLote(id: number, campo: keyof Lote, valor: string) {
    setLotes((lotesActuales) =>
      lotesActuales.map((lote) =>
        lote.id === id
          ? {
              ...lote,
              [campo]: valor,
            }
          : lote
      )
    );
  }

  function manejarSinVencimiento(valor: boolean) {
    setSinVencimiento(valor);

    if (valor) {
      setLotes([
        {
          id: Date.now(),
          vencimiento: "",
          cantidad: "",
        },
      ]);
    }
  }

  function validarFormulario() {
    if (!codigo.trim()) {
      return "El código es obligatorio.";
    }

    if (estadoProducto === "buscando") {
      return "Esperá a que termine la búsqueda del producto.";
    }

    if (!producto.trim()) {
      return "El campo Producto es obligatorio.";
    }

    if (estadoProducto === "nuevo" && !marca.trim()) {
      return "El campo Marca es obligatorio para productos nuevos.";
    }

    if (estadoProducto === "nuevo" && !presentacion.trim()) {
      return "El campo Presentación es obligatorio para productos nuevos.";
    }

    if (!ubicacion.trim()) {
      return "La ubicación es obligatoria.";
    }

    for (const lote of lotes) {
      if (!sinVencimiento && !lote.vencimiento) {
        return "Completá la fecha de vencimiento o marcá Sin fecha de vencimiento.";
      }

      if (!lote.cantidad || Number(lote.cantidad) <= 0) {
        return "La cantidad debe ser mayor a cero.";
      }
    }

    return "";
  }

  async function guardarMovimiento() {
    const error = validarFormulario();

    if (error) {
      setMensaje(error);
      return;
    }

    const movimiento: MovimientoGuardado = {
      codigo: codigo.trim(),
      producto: producto.trim(),
      marca: marca.trim(),
      presentacion: presentacion.trim(),
      especificacion: especificacion.trim(),
      nombre,
      ubicacion,
      sinVencimiento,
      productoNuevo: estadoProducto === "nuevo",
      observaciones: observaciones.trim(),
      lotes,
    };

    try {
      setGuardando(true);
      setMensaje("Guardando inventario...");

      const response = await fetch("/api/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(movimiento),
      });

      const data = (await response.json()) as RespuestaGuardarStockApi;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo guardar el inventario");
      }

      setUltimoMovimiento(movimiento);
      setMensaje(
        `Inventario guardado correctamente. Registros creados: ${
          data.cantidadRegistros || lotes.length
        }.`
      );

      console.log("Inventario guardado:", movimiento);
    } catch (error) {
      console.error("Error guardando inventario:", error);
      setMensaje("No se pudo guardar el inventario en Airtable.");
    } finally {
      setGuardando(false);
    }
  }

  function limpiarFormulario() {
    setCodigo("");
    limpiarDatosProducto();
    setUbicacion("Galpón");
    setSinVencimiento(false);
    setObservaciones("");
    setEstadoProducto("sin_codigo");
    setLotes([
      {
        id: Date.now(),
        vencimiento: "",
        cantidad: "",
      },
    ]);
    setMensaje("");
    setUltimoMovimiento(null);
  }

  return (
    <main className="app">
      <section className="app-container">
        <header className="app-header">
          <div>
            <p className="app-kicker">OPTIMA APP</p>
            <h1>Inventario inicial</h1>
            <p>
              Escaneá productos, cargá vencimientos y registrá el stock contado.
            </p>
          </div>
        </header>

        <section className="form-card">
          <div className="field-group">
            <label htmlFor="ubicacion">Ubicación</label>
            <select
              id="ubicacion"
              value={ubicacion}
              onChange={(event) => setUbicacion(event.target.value)}
            >
              {ubicaciones.map((ubicacionDisponible) => (
                <option key={ubicacionDisponible} value={ubicacionDisponible}>
                  {ubicacionDisponible}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label htmlFor="codigo">Código</label>

            <div className="barcode-row">
              <input
                id="codigo"
                type="text"
                value={codigo}
                onChange={(event) => manejarCambioCodigo(event.target.value)}
                onBlur={manejarBlurCodigo}
                onKeyDown={manejarEnterCodigo}
                placeholder="Escaneá o escribí el código"
              />

              <button
                className="camera-button"
                type="button"
                onClick={() => setScannerAbierto(true)}
                aria-label="Abrir cámara"
              >
                📷
              </button>
            </div>
          </div>

          {estadoProducto === "buscando" && (
            <p className="message">Buscando producto...</p>
          )}

          {estadoProducto === "existente" && (
            <section className="product-data-section">
              <div className="field-group">
                <label htmlFor="nombre-existente">Nombre</label>
                <input
                  id="nombre-existente"
                  type="text"
                  value={nombre}
                  readOnly
                />
              </div>
            </section>
          )}

          {estadoProducto === "nuevo" && (
            <section className="product-data-section">
              <div className="product-new-box">
                <strong>Producto nuevo</strong>
                <span>Complete los datos para crearlo:</span>
              </div>

              <div className="field-group">
                <label htmlFor="producto">Producto</label>
                <input
                  id="producto"
                  type="text"
                  value={producto}
                  onChange={(event) => setProducto(event.target.value)}
                  placeholder="Ej: Leche"
                />
              </div>

              <div className="product-grid">
                <div className="field-group">
                  <label htmlFor="marca">Marca</label>
                  <input
                    id="marca"
                    type="text"
                    value={marca}
                    onChange={(event) => setMarca(event.target.value)}
                    placeholder="Ej: La Serenísima"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="presentacion">Presentación</label>
                  <input
                    id="presentacion"
                    type="text"
                    value={presentacion}
                    onChange={(event) => setPresentacion(event.target.value)}
                    placeholder="Ej: 1L"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="especificacion">Especificación</label>
                  <input
                    id="especificacion"
                    type="text"
                    value={especificacion}
                    onChange={(event) => setEspecificacion(event.target.value)}
                    placeholder="Ej: Entera / Sin TACC / 0000"
                  />
                </div>
              </div>

              {nombre && (
                <div className="nombre-preview">
                  <span>Nombre</span>
                  <strong>{nombre}</strong>
                </div>
              )}
            </section>
          )}

          <div className="checkbox-row">
            <input
              id="sin-vencimiento"
              type="checkbox"
              checked={sinVencimiento}
              onChange={(event) => manejarSinVencimiento(event.target.checked)}
            />

            <label htmlFor="sin-vencimiento">Sin fecha de vencimiento</label>
          </div>

          <section className="lotes-section">
            <div className="section-title-row">
              <div>
                <h2>Vencimientos y cantidades</h2>
                <p>Podés cargar uno o varios lotes del mismo producto.</p>
              </div>

              {!sinVencimiento && (
                <button className="secondary-button" type="button" onClick={agregarLote}>
                  + Agregar fecha
                </button>
              )}
            </div>

            {lotes.map((lote, index) => (
              <div className="lote-card" key={lote.id}>
                <div className="lote-title-row">
                  <strong>Lote {index + 1}</strong>

                  {lotes.length > 1 && (
                    <button
                      className="delete-button"
                      type="button"
                      onClick={() => eliminarLote(lote.id)}
                    >
                      Eliminar
                    </button>
                  )}
                </div>

                {!sinVencimiento && (
                  <div className="field-group">
                    <label htmlFor={`vencimiento-${lote.id}`}>
                      Fecha de vencimiento
                    </label>
                    <input
                      id={`vencimiento-${lote.id}`}
                      type="date"
                      value={lote.vencimiento}
                      onChange={(event) =>
                        actualizarLote(lote.id, "vencimiento", event.target.value)
                      }
                    />
                  </div>
                )}

                <div className="field-group">
                  <label htmlFor={`cantidad-${lote.id}`}>Cantidad</label>
                  <input
                    id={`cantidad-${lote.id}`}
                    type="number"
                    min="1"
                    value={lote.cantidad}
                    onChange={(event) =>
                      actualizarLote(lote.id, "cantidad", event.target.value)
                    }
                    placeholder="Ej: 12"
                  />
                </div>
              </div>
            ))}
          </section>

          <div className="field-group">
            <label htmlFor="observaciones">Observaciones</label>
            <textarea
              id="observaciones"
              value={observaciones}
              onChange={(event) => setObservaciones(event.target.value)}
              placeholder="Opcional"
              rows={3}
            />
          </div>

          {mensaje && <p className="message">{mensaje}</p>}

          <div className="actions-row">
            <button
              className="primary-button"
              type="button"
              onClick={guardarMovimiento}
              disabled={guardando}
            >
              {guardando ? "Guardando..." : "Guardar inventario"}
            </button>

            <button
              className="secondary-button"
              type="button"
              onClick={limpiarFormulario}
              disabled={guardando}
            >
              Limpiar
            </button>
          </div>
        </section>

        {ultimoMovimiento && (
          <section className="result-card">
            <h2>Última carga</h2>

            <p>
              <strong>Código:</strong> {ultimoMovimiento.codigo}
            </p>

            <p>
              <strong>Nombre:</strong> {ultimoMovimiento.nombre}
            </p>

            <p>
              <strong>Estado:</strong>{" "}
              {ultimoMovimiento.productoNuevo
                ? "Producto nuevo"
                : "Producto existente"}
            </p>

            <p>
              <strong>Ubicación:</strong> {ultimoMovimiento.ubicacion}
            </p>

            <p>
              <strong>Vencimiento:</strong>{" "}
              {ultimoMovimiento.sinVencimiento ? "Sin vencimiento" : "Con vencimiento"}
            </p>

            <ul>
              {ultimoMovimiento.lotes.map((lote) => (
                <li key={lote.id}>
                  {ultimoMovimiento.sinVencimiento
                    ? "Sin vencimiento"
                    : lote.vencimiento}{" "}
                  — {lote.cantidad} unidades
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>

      {scannerAbierto && (
        <BarcodeScanner
          onScanSuccess={(codigoEscaneado) => {
            buscarProductoEnAirtable(codigoEscaneado);
            setScannerAbierto(false);
          }}
          onClose={() => setScannerAbierto(false)}
        />
      )}
    </main>
  );
}

export default App;
