import { useMemo, useRef, useState } from "react";
import BarcodeScanner from "./components/BarcodeScanner";
import logoOptima from "./assets/logo-optima.png";
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

type Aviso = {
  tipo: "info" | "exito" | "error";
  texto: string;
};

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

function formatearFechaInput(valor: string) {
  const soloNumeros = valor.replace(/\D/g, "").slice(0, 8);

  if (soloNumeros.length <= 2) return soloNumeros;

  if (soloNumeros.length <= 4) {
    return `${soloNumeros.slice(0, 2)}-${soloNumeros.slice(2)}`;
  }

  return `${soloNumeros.slice(0, 2)}-${soloNumeros.slice(
    2,
    4
  )}-${soloNumeros.slice(4)}`;
}

function esFechaValida(dia: number, mes: number, anio: number) {
  const fecha = new Date(anio, mes - 1, dia);

  return (
    fecha.getFullYear() === anio &&
    fecha.getMonth() === mes - 1 &&
    fecha.getDate() === dia
  );
}

function convertirFechaParaApi(fechaTexto: string) {
  const valor = fechaTexto.trim();
  const match = valor.match(/^(\d{2})-(\d{2})-(\d{4})$/);

  if (!match) return "";

  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const anio = Number(match[3]);

  if (!esFechaValida(dia, mes, anio)) return "";

  return `${anio}-${match[2]}-${match[1]}`;
}

function App() {
  const codigoInputRef = useRef<HTMLInputElement | null>(null);

  const [codigo, setCodigo] = useState("");
  const [producto, setProducto] = useState("");
  const [marca, setMarca] = useState("");
  const [presentacion, setPresentacion] = useState("");
  const [especificacion, setEspecificacion] = useState("");
  const [ubicacion, setUbicacion] = useState("Galpón");
  const [sinVencimiento, setSinVencimiento] = useState(false);
  const [observaciones, setObservaciones] = useState("");
  const [scannerAbierto, setScannerAbierto] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
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
    setAviso(null);
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
      setAviso({
        tipo: "error",
        texto: "No se pudo buscar el producto en Airtable.",
      });
    }
  }

  function manejarCambioCodigo(valor: string) {
    setCodigo(valor);
    setAviso(null);
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
    const valorFinal =
      campo === "vencimiento" ? formatearFechaInput(valor) : valor;

    setLotes((lotesActuales) =>
      lotesActuales.map((lote) =>
        lote.id === id
          ? {
              ...lote,
              [campo]: valorFinal,
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
      return "No hay código cargado. Escaneá o escribí un código antes de guardar.";
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
      if (!sinVencimiento) {
        if (!lote.vencimiento.trim()) {
          return "Completá el vencimiento o marcá Sin fecha de vencimiento.";
        }

        if (!convertirFechaParaApi(lote.vencimiento)) {
          return "La fecha debe tener formato DD-MM-AAAA.";
        }
      }

      if (!lote.cantidad || Number(lote.cantidad) <= 0) {
        return "La cantidad debe ser mayor a cero.";
      }
    }

    return "";
  }

  function prepararSiguienteCarga() {
    setCodigo("");
    limpiarDatosProducto();
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

    setTimeout(() => {
      codigoInputRef.current?.focus();
    }, 100);
  }

  async function guardarMovimiento() {
    const error = validarFormulario();

    if (error) {
      setAviso({
        tipo: "error",
        texto: error,
      });
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

    const payload = {
      ...movimiento,
      lotes: lotes.map((lote) => ({
        ...lote,
        vencimiento: sinVencimiento
          ? ""
          : convertirFechaParaApi(lote.vencimiento),
      })),
    };

    try {
      setGuardando(true);
      setAviso({
        tipo: "info",
        texto: "Guardando...",
      });

      const response = await fetch("/api/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as RespuestaGuardarStockApi;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo guardar el inventario");
      }

      setUltimoMovimiento(movimiento);
      prepararSiguienteCarga();

      setAviso({
        tipo: "exito",
        texto: `Guardado OK. Registros creados: ${
          data.cantidadRegistros || lotes.length
        }.`,
      });

      console.log("Inventario guardado:", payload);
    } catch (error) {
      console.error("Error guardando inventario:", error);
      setAviso({
        tipo: "error",
        texto: "No se pudo guardar el inventario en Airtable.",
      });
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
    setAviso(null);
    setUltimoMovimiento(null);

    setTimeout(() => {
      codigoInputRef.current?.focus();
    }, 100);
  }

  return (
    <main className="app">
      <section className="app-container">
        <header className="app-header">
          <div className="brand-row">
            <img
              src={logoOptima}
              alt="Logo OPTIMA"
              className="brand-logo-image"
            />

            <div className="brand-text">
              <h1>OPTIMA</h1>
            </div>
          </div>
        </header>

        <section className="form-card">
          <div className="module-label">INVENTARIO</div>

          <div className="location-summary">
            <div className="location-current-card">
              <span>Ubicación actual</span>
              <strong>{ubicacion}</strong>
            </div>

            <div className="field-group compact-field">
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
          </div>

          <div className="field-group">
            <label htmlFor="codigo">Código</label>

            <div className="barcode-row">
              <input
                ref={codigoInputRef}
                id="codigo"
                value={codigo}
                onChange={(event) => manejarCambioCodigo(event.target.value)}
                onBlur={manejarBlurCodigo}
                onKeyDown={manejarEnterCodigo}
                placeholder="Escaneá o escribí el código"
                inputMode="numeric"
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
            <div className="product-status product-status-info">
              Buscando producto...
            </div>
          )}

          {estadoProducto === "existente" && (
            <div className="field-group">
              <label htmlFor="nombre">Nombre</label>
              <input id="nombre" value={nombre} readOnly />
            </div>
          )}

          {estadoProducto === "nuevo" && (
            <div className="product-data-section">
              <div className="product-new-box">
                <strong>Producto nuevo</strong>
                <span>Completá los datos para crearlo.</span>
              </div>

              <div className="product-grid">
                <div className="field-group">
                  <label htmlFor="producto">Producto</label>
                  <input
                    id="producto"
                    value={producto}
                    onChange={(event) => setProducto(event.target.value)}
                    placeholder="Ej: Leche"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="marca">Marca</label>
                  <input
                    id="marca"
                    value={marca}
                    onChange={(event) => setMarca(event.target.value)}
                    placeholder="Ej: La Serenísima"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="presentacion">Presentación</label>
                  <input
                    id="presentacion"
                    value={presentacion}
                    onChange={(event) => setPresentacion(event.target.value)}
                    placeholder="Ej: 1L"
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="especificacion">Especificación</label>
                  <input
                    id="especificacion"
                    value={especificacion}
                    onChange={(event) =>
                      setEspecificacion(event.target.value)
                    }
                    placeholder="Ej: Entera / Sin TACC"
                  />
                </div>
              </div>

              {nombre && (
                <div className="nombre-preview">
                  <span>Nombre master</span>
                  <strong>{nombre}</strong>
                </div>
              )}
            </div>
          )}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={sinVencimiento}
              onChange={(event) => manejarSinVencimiento(event.target.checked)}
            />
            Sin fecha de vencimiento
          </label>

          <section className="lotes-section">
            <div className="section-title-row compact-title-row">
              <h2>Vencimientos</h2>

              {!sinVencimiento && (
                <button
                  className="small-add-button"
                  type="button"
                  onClick={agregarLote}
                >
                  + Otro
                </button>
              )}
            </div>

            {lotes.map((lote, index) => (
              <article className="lote-card" key={lote.id}>
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

                <div
                  className={`lote-inline-grid ${
                    sinVencimiento ? "solo-cantidad" : ""
                  }`}
                >
                  {!sinVencimiento && (
                    <div className="field-group no-margin">
                      <label htmlFor={`vencimiento-${lote.id}`}>
                        Vencimiento
                      </label>
                      <input
                        id={`vencimiento-${lote.id}`}
                        type="text"
                        value={lote.vencimiento}
                        onChange={(event) =>
                          actualizarLote(
                            lote.id,
                            "vencimiento",
                            event.target.value
                          )
                        }
                        placeholder="DD-MM-AAAA"
                        inputMode="numeric"
                        maxLength={10}
                      />
                    </div>
                  )}

                  <div className="field-group no-margin">
                    <label htmlFor={`cantidad-${lote.id}`}>Cantidad</label>
                    <input
                      id={`cantidad-${lote.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={lote.cantidad}
                      onChange={(event) =>
                        actualizarLote(lote.id, "cantidad", event.target.value)
                      }
                      placeholder="Ej: 12"
                    />
                  </div>
                </div>
              </article>
            ))}
          </section>

          <div className="field-group">
            <label htmlFor="observaciones">Observaciones</label>
            <input
              id="observaciones"
              type="text"
              value={observaciones}
              onChange={(event) => setObservaciones(event.target.value)}
              placeholder="Opcional"
            />
          </div>

          {aviso && (
            <div className={`message message-${aviso.tipo}`}>
              {aviso.texto}
            </div>
          )}

          <div className="actions-row">
            <button
              className="primary-button"
              type="button"
              onClick={guardarMovimiento}
              disabled={guardando}
            >
              {guardando ? "Guardando..." : "Guardar"}
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
            <div className="result-title-row">
              <div>
                <span>Última carga</span>
                <h2>{ultimoMovimiento.nombre}</h2>
              </div>

              <strong className="result-badge">
                {ultimoMovimiento.productoNuevo ? "Nuevo" : "Existente"}
              </strong>
            </div>

            <div className="result-grid">
              <p>
                <strong>Código:</strong> {ultimoMovimiento.codigo}
              </p>

              <p>
                <strong>Ubicación:</strong> {ultimoMovimiento.ubicacion}
              </p>

              <p>
                <strong>Vencimiento:</strong>{" "}
                {ultimoMovimiento.sinVencimiento
                  ? "Sin vencimiento"
                  : "Con vencimiento"}
              </p>
            </div>

            <ul className="result-lotes-list">
              {ultimoMovimiento.lotes.map((lote) => (
                <li key={lote.id}>
                  <span>
                    {ultimoMovimiento.sinVencimiento
                      ? "Sin vencimiento"
                      : lote.vencimiento}
                  </span>
                  <strong>{lote.cantidad} unidades</strong>
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
