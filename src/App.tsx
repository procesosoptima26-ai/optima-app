import { useState } from "react";
import "./App.css";

type Lote = {
  id: number;
  vencimiento: string;
  cantidad: string;
};

type Producto = {
  id: number;
  codigo: string;
  nombre: string;
  ubicacion: string;
  sinVencimiento: boolean;
  lotes: Lote[];
};

function App() {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [ubicacion, setUbicacion] = useState("Galpón");
  const [sinVencimiento, setSinVencimiento] = useState(false);
  const [lotes, setLotes] = useState<Lote[]>([
    { id: Date.now(), vencimiento: "", cantidad: "" },
  ]);
  const [productos, setProductos] = useState<Producto[]>([]);

  function formatearFecha(fecha: string) {
    if (!fecha) return "";

    const [anio, mes, dia] = fecha.split("-");
    return `${dia}/${mes}/${anio.slice(2)}`;
  }

  function abrirCamara() {
    alert("Próximo paso: acá vamos a abrir la cámara para escanear.");
  }

  function agregarLote() {
    setLotes([
      ...lotes,
      { id: Date.now(), vencimiento: "", cantidad: "" },
    ]);
  }

  function actualizarLote(
    id: number,
    campo: "vencimiento" | "cantidad",
    valor: string
  ) {
    setLotes(
      lotes.map((lote) =>
        lote.id === id ? { ...lote, [campo]: valor } : lote
      )
    );
  }

  function eliminarLote(id: number) {
    if (lotes.length === 1) {
      alert("Tiene que quedar al menos un lote");
      return;
    }

    setLotes(lotes.filter((lote) => lote.id !== id));
  }

  function guardarProducto() {
    if (!codigo || !nombre || !ubicacion) {
      alert("Completá código, nombre y ubicación");
      return;
    }

    if (sinVencimiento) {
      if (!lotes[0].cantidad) {
        alert("Completá la cantidad");
        return;
      }
    } else {
      const hayLoteIncompleto = lotes.some(
        (lote) => !lote.vencimiento || !lote.cantidad
      );

      if (hayLoteIncompleto) {
        alert("Completá fecha de vencimiento y cantidad en todos los lotes");
        return;
      }
    }

    const nuevoProducto: Producto = {
      id: Date.now(),
      codigo,
      nombre,
      ubicacion,
      sinVencimiento,
      lotes: sinVencimiento
        ? [{ id: Date.now(), vencimiento: "", cantidad: lotes[0].cantidad }]
        : lotes,
    };

    setProductos([nuevoProducto, ...productos]);

    setCodigo("");
    setNombre("");
    setUbicacion("Galpón");
    setSinVencimiento(false);
    setLotes([{ id: Date.now(), vencimiento: "", cantidad: "" }]);
  }

  return (
    <div className="app">
      <div className="header">
        <h1>📦 OPTIMA Inventario</h1>
        <p>Control de stock, ubicaciones y vencimientos</p>
      </div>

      <div className="card">
        <div className="form">
          <div className="codigo-row">
            <input
              type="text"
              placeholder="Código"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
            />

            <button type="button" className="camera-button" onClick={abrirCamara}>
              📷
            </button>
          </div>

          <input
            type="text"
            placeholder="Producto"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />

          <select
            value={ubicacion}
            onChange={(e) => setUbicacion(e.target.value)}
          >
            <option>Galpón</option>
            <option>Góndola</option>
          </select>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={sinVencimiento}
              onChange={(e) => setSinVencimiento(e.target.checked)}
            />
            Sin fecha de vencimiento
          </label>

          <h3>Lotes</h3>

          {lotes.map((lote) => (
            <div className="lote" key={lote.id}>
              {!sinVencimiento && (
                <input
                  type="date"
                  value={lote.vencimiento}
                  onChange={(e) =>
                    actualizarLote(lote.id, "vencimiento", e.target.value)
                  }
                />
              )}

              <input
                type="number"
                placeholder="Unidades"
                value={lote.cantidad}
                onChange={(e) =>
                  actualizarLote(lote.id, "cantidad", e.target.value)
                }
              />

              {!sinVencimiento && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => eliminarLote(lote.id)}
                >
                  -
                </button>
              )}
            </div>
          ))}

          {!sinVencimiento && (
            <button type="button" className="secondary" onClick={agregarLote}>
              + Agregar vencimiento
            </button>
          )}

          <button onClick={guardarProducto}>Guardar</button>
        </div>
      </div>

      <div className="card">
        <h2>Productos cargados</h2>

        <div className="list">
          {productos.length === 0 ? (
            <p>Todavía no cargaste productos.</p>
          ) : (
            productos.map((producto) => (
              <div className="item" key={producto.id}>
                <strong>📦 {producto.nombre}</strong>
                <span className="codigo">cod. {producto.codigo}</span>
                <span>📍 {producto.ubicacion}</span>

                <div className="lotes-lista">
                  {producto.lotes.map((lote) => (
                    <div className="lote-resumen" key={lote.id}>
                      {producto.sinVencimiento ? (
                        <>
                          <span>Sin vencimiento</span>
                          <strong>{lote.cantidad} u.</strong>
                        </>
                      ) : (
                        <>
                          <span>{formatearFecha(lote.vencimiento)}</span>
                          <strong>{lote.cantidad} u.</strong>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default App;                                                                   