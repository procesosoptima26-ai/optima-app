import { useEffect, useMemo, useState } from "react";
import "./CuentasCorrientes.css";

type EstadoCliente = "DEBE" | "AL DIA" | "A FAVOR" | string;
type MedioPago = "EFECTIVO" | "TRANSFERENCIA" | "ECHEQ" | "";
type TipoMovimiento = "REMITO EMITIDO" | "PAGO RECIBIDO";
type Vista = "lista" | "detalle" | "formulario" | "nuevoCliente";

type Cliente = {
  id: string;
  cliente: string;
  telefono: string;
  cuit: string;
  direccion: string;
  observaciones: string;
  saldoActual: number;
  estado: EstadoCliente;
};

type Movimiento = {
  id: string;
  clienteIds: string[];
  fecha: string;
  tipoMovimiento: TipoMovimiento;
  medioPago: MedioPago;
  comprobante: string;
  datosPago: string;
  importe: number;
  importeFirmado: number;
  observacion: string;
  responsable: string;
};

type RespuestaClientes = {
  ok?: boolean;
  clientes?: Cliente[];
  cliente?: Cliente;
  error?: string;
};

type RespuestaMovimientos = {
  ok?: boolean;
  movimientos?: Movimiento[];
  movimiento?: Movimiento;
  error?: string;
};

function formatearPesos(valor: number) {
  return valor.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function obtenerEstadoDesdeSaldo(saldo: number): EstadoCliente {
  if (saldo > 0) return "DEBE";
  if (saldo < 0) return "A FAVOR";
  return "AL DIA";
}

function obtenerTextoSaldo(saldo: number) {
  if (saldo > 0) return `Debe ${formatearPesos(saldo)}`;
  if (saldo < 0) return `A favor ${formatearPesos(Math.abs(saldo))}`;
  return "Al día";
}

function obtenerClaseEstado(estado: EstadoCliente) {
  return estado.toLowerCase().replaceAll(" ", "-");
}

function obtenerFechaHoyInput() {
  return new Date().toISOString().slice(0, 10);
}

function formatearFechaParaMostrar(fecha: string) {
  if (!fecha) return "Sin fecha";

  const partes = fecha.split("-");

  if (partes.length === 3) {
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }

  return fecha;
}

export default function CuentasCorrientes() {
  const [vista, setVista] = useState<Vista>("lista");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [clienteSeleccionadoId, setClienteSeleccionadoId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [cargandoMovimientos, setCargandoMovimientos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "info" | "exito" | "error"; texto: string } | null>(null);
  const [tipoFormulario, setTipoFormulario] = useState<TipoMovimiento>("REMITO EMITIDO");

  const [nuevoCliente, setNuevoCliente] = useState({
    cliente: "",
    telefono: "",
    cuit: "",
    direccion: "",
    observaciones: "",
  });

  const [formMovimiento, setFormMovimiento] = useState({
    fecha: obtenerFechaHoyInput(),
    comprobante: "",
    medioPago: "" as MedioPago,
    datosPago: "",
    importe: "",
    observacion: "",
    responsable: "",
  });

  const clienteSeleccionado = clientes.find(
    (cliente) => cliente.id === clienteSeleccionadoId
  );

  const clientesFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    if (!texto) return clientes;

    return clientes.filter((cliente) =>
      cliente.cliente.toLowerCase().includes(texto)
    );
  }, [clientes, busqueda]);

  const totalACobrar = useMemo(() => {
    return clientes.reduce((total, cliente) => {
      return cliente.saldoActual > 0 ? total + cliente.saldoActual : total;
    }, 0);
  }, [clientes]);

  useEffect(() => {
    cargarClientes();
  }, []);

  async function cargarClientes() {
    try {
      setCargandoClientes(true);
      setMensaje(null);

      const response = await fetch("/api/clientes");
      const data = (await response.json()) as RespuestaClientes;

      if (!response.ok || !data.ok || !data.clientes) {
        throw new Error(data.error || "No se pudieron cargar los clientes");
      }

      setClientes(data.clientes);
    } catch (error) {
      console.error("Error cargando clientes:", error);
      setMensaje({
        tipo: "error",
        texto: "No se pudieron cargar los clientes.",
      });
    } finally {
      setCargandoClientes(false);
    }
  }

  async function cargarMovimientos(clienteId: string) {
    try {
      setCargandoMovimientos(true);
      setMensaje(null);

      const response = await fetch(
        `/api/movimientos-cc?clienteId=${encodeURIComponent(clienteId)}`
      );
      const data = (await response.json()) as RespuestaMovimientos;

      if (!response.ok || !data.ok || !data.movimientos) {
        throw new Error(data.error || "No se pudieron cargar los movimientos");
      }

      setMovimientos(data.movimientos);
    } catch (error) {
      console.error("Error cargando movimientos:", error);
      setMensaje({
        tipo: "error",
        texto: "No se pudo cargar el historial del cliente.",
      });
    } finally {
      setCargandoMovimientos(false);
    }
  }

  async function abrirDetalle(clienteId: string) {
    setClienteSeleccionadoId(clienteId);
    setVista("detalle");
    await cargarMovimientos(clienteId);
  }

  function volverALista() {
    setVista("lista");
    setClienteSeleccionadoId(null);
    setMovimientos([]);
    setMensaje(null);
    cargarClientes();
  }

  function abrirFormulario(tipo: TipoMovimiento) {
    setTipoFormulario(tipo);
    setFormMovimiento({
      fecha: obtenerFechaHoyInput(),
      comprobante: "",
      medioPago: "",
      datosPago: "",
      importe: "",
      observacion: "",
      responsable: "",
    });
    setMensaje(null);
    setVista("formulario");
  }

  async function guardarNuevoCliente() {
    if (!nuevoCliente.cliente.trim()) {
      setMensaje({ tipo: "error", texto: "El nombre del cliente es obligatorio." });
      return;
    }

    try {
      setGuardando(true);
      setMensaje({ tipo: "info", texto: "Guardando cliente..." });

      const response = await fetch("/api/clientes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nuevoCliente),
      });

      const data = (await response.json()) as RespuestaClientes;

      if (!response.ok || !data.ok || !data.cliente) {
        throw new Error(data.error || "No se pudo crear el cliente");
      }

      setClientes((actuales) => [data.cliente as Cliente, ...actuales]);
      setNuevoCliente({
        cliente: "",
        telefono: "",
        cuit: "",
        direccion: "",
        observaciones: "",
      });
      setClienteSeleccionadoId(data.cliente.id);
      setMovimientos([]);
      setVista("detalle");
      setMensaje({ tipo: "exito", texto: "Cliente creado correctamente." });
    } catch (error) {
      console.error("Error guardando cliente:", error);
      setMensaje({ tipo: "error", texto: "No se pudo guardar el cliente." });
    } finally {
      setGuardando(false);
    }
  }

  async function guardarMovimiento() {
    if (!clienteSeleccionadoId) return;

    const importeNumerico = Number(formMovimiento.importe);

    if (!formMovimiento.fecha || !importeNumerico || importeNumerico <= 0) {
      setMensaje({
        tipo: "error",
        texto: "Completá fecha e importe mayor a cero.",
      });
      return;
    }

    if (tipoFormulario === "PAGO RECIBIDO" && !formMovimiento.medioPago) {
      setMensaje({ tipo: "error", texto: "Seleccioná el medio de pago." });
      return;
    }

    try {
      setGuardando(true);
      setMensaje({
        tipo: "info",
        texto: tipoFormulario === "REMITO EMITIDO" ? "Guardando remito..." : "Guardando pago...",
      });

      const response = await fetch("/api/movimientos-cc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clienteId: clienteSeleccionadoId,
          fecha: formMovimiento.fecha,
          tipoMovimiento: tipoFormulario,
          comprobante: formMovimiento.comprobante,
          medioPago: tipoFormulario === "PAGO RECIBIDO" ? formMovimiento.medioPago : "",
          datosPago: tipoFormulario === "PAGO RECIBIDO" ? formMovimiento.datosPago : "",
          importe: importeNumerico,
          observacion: formMovimiento.observacion,
          responsable: formMovimiento.responsable,
        }),
      });

      const data = (await response.json()) as RespuestaMovimientos;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo guardar el movimiento");
      }

      const deltaSaldo =
        tipoFormulario === "REMITO EMITIDO" ? importeNumerico : -importeNumerico;

      setClientes((actuales) =>
        actuales.map((cliente) =>
          cliente.id === clienteSeleccionadoId
            ? {
                ...cliente,
                saldoActual: cliente.saldoActual + deltaSaldo,
                estado: obtenerEstadoDesdeSaldo(cliente.saldoActual + deltaSaldo),
              }
            : cliente
        )
      );

      await cargarMovimientos(clienteSeleccionadoId);
      setVista("detalle");

      window.setTimeout(() => {
        cargarClientes();
      }, 900);

      setMensaje({
        tipo: "exito",
        texto: tipoFormulario === "REMITO EMITIDO" ? "Remito guardado correctamente." : "Pago guardado correctamente.",
      });
    } catch (error) {
      console.error("Error guardando movimiento:", error);
      setMensaje({
        tipo: "error",
        texto: tipoFormulario === "REMITO EMITIDO" ? "No se pudo guardar el remito." : "No se pudo guardar el pago.",
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="cc-module">
      <div className="cc-module-title-row">
        <div>
          <p className="module-label cc-module-label">MÓDULO</p>
          <h2>Cuentas Corrientes</h2>
        </div>

        {vista !== "lista" && (
          <button className="cc-soft-button" type="button" onClick={volverALista}>
            Volver
          </button>
        )}
      </div>

      {mensaje && <div className={`message message-${mensaje.tipo}`}>{mensaje.texto}</div>}

      {vista === "lista" && (
        <div className="cc-stack">
          <section className="cc-total-card">
            <span>Total a cobrar</span>
            <strong>{formatearPesos(totalACobrar)}</strong>
            <p>Clientes con deuda activa.</p>
          </section>

          <div className="cc-list-actions">
            <input
              className="cc-search-input"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              placeholder="Buscar cliente..."
            />

            <button className="cc-primary-button" type="button" onClick={() => setVista("nuevoCliente")}>
              + Nuevo cliente
            </button>
          </div>

          {cargandoClientes ? (
            <div className="cc-empty-card">Cargando clientes...</div>
          ) : clientesFiltrados.length === 0 ? (
            <div className="cc-empty-card">No hay clientes para mostrar.</div>
          ) : (
            <div className="cc-client-list">
              {clientesFiltrados.map((cliente) => {
                const estado = cliente.estado || obtenerEstadoDesdeSaldo(cliente.saldoActual);

                return (
                  <button
                    key={cliente.id}
                    className="cc-client-card"
                    type="button"
                    onClick={() => abrirDetalle(cliente.id)}
                  >
                    <div>
                      <h3>{cliente.cliente}</h3>
                      <p>{cliente.telefono || "Sin teléfono cargado"}</p>
                    </div>

                    <strong className={`cc-status-pill cc-status-${obtenerClaseEstado(estado)}`}>
                      {obtenerTextoSaldo(cliente.saldoActual)}
                    </strong>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {vista === "nuevoCliente" && (
        <section className="cc-card cc-form-card">
          <h3>Nuevo cliente</h3>
          <p>Cargá el nombre y, si tenés, los datos de contacto.</p>

          <label>
            Nombre del cliente *
            <input
              value={nuevoCliente.cliente}
              onChange={(event) => setNuevoCliente({ ...nuevoCliente, cliente: event.target.value })}
              placeholder="Ej: Despensa Norte"
            />
          </label>

          <label>
            Teléfono
            <input
              value={nuevoCliente.telefono}
              onChange={(event) => setNuevoCliente({ ...nuevoCliente, telefono: event.target.value })}
              placeholder="Ej: 3794 222 456"
            />
          </label>

          <label>
            CUIT
            <input
              value={nuevoCliente.cuit}
              onChange={(event) => setNuevoCliente({ ...nuevoCliente, cuit: event.target.value })}
              placeholder="Opcional"
            />
          </label>

          <label>
            Dirección
            <input
              value={nuevoCliente.direccion}
              onChange={(event) => setNuevoCliente({ ...nuevoCliente, direccion: event.target.value })}
              placeholder="Ej: Barrio Norte"
            />
          </label>

          <label>
            Observaciones
            <textarea
              value={nuevoCliente.observaciones}
              onChange={(event) => setNuevoCliente({ ...nuevoCliente, observaciones: event.target.value })}
              placeholder="Opcional"
            />
          </label>

          <button className="cc-primary-button cc-full-button" type="button" onClick={guardarNuevoCliente} disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar cliente"}
          </button>
        </section>
      )}

      {vista === "detalle" && clienteSeleccionado && (
        <div className="cc-stack">
          <section className="cc-card cc-detail-card">
            <span>Cliente</span>
            <h3>{clienteSeleccionado.cliente}</h3>

            <div className="cc-balance-box">
              <span>Saldo actual</span>
              <strong>{formatearPesos(clienteSeleccionado.saldoActual)}</strong>
              <p>{obtenerTextoSaldo(clienteSeleccionado.saldoActual)}</p>
            </div>

            <div className="cc-info-list">
              <p><strong>Teléfono:</strong> {clienteSeleccionado.telefono || "Sin cargar"}</p>
              <p><strong>Dirección:</strong> {clienteSeleccionado.direccion || "Sin cargar"}</p>
              {clienteSeleccionado.cuit && <p><strong>CUIT:</strong> {clienteSeleccionado.cuit}</p>}
            </div>

            <div className="cc-action-grid">
              <button className="cc-primary-button" type="button" onClick={() => abrirFormulario("REMITO EMITIDO")}>
                Registrar remito
              </button>

              <button className="cc-green-button" type="button" onClick={() => abrirFormulario("PAGO RECIBIDO")}>
                Registrar pago
              </button>
            </div>
          </section>

          <section className="cc-history-section">
            <h3>Historial</h3>

            {cargandoMovimientos ? (
              <div className="cc-empty-card">Cargando historial...</div>
            ) : movimientos.length === 0 ? (
              <div className="cc-empty-card">Todavía no hay movimientos cargados.</div>
            ) : (
              movimientos.map((movimiento) => {
                const esPago = movimiento.tipoMovimiento === "PAGO RECIBIDO";

                return (
                  <article key={movimiento.id} className="cc-movement-card">
                    <div>
                      <span>{formatearFechaParaMostrar(movimiento.fecha)}</span>
                      <h4>{movimiento.comprobante || (esPago ? "Pago recibido" : "Remito emitido")}</h4>
                      <p>{esPago ? `Pago recibido${movimiento.medioPago ? ` · ${movimiento.medioPago}` : ""}` : "Remito emitido"}</p>
                      {movimiento.datosPago && <p>{movimiento.datosPago}</p>}
                      {movimiento.observacion && <p>{movimiento.observacion}</p>}
                      {movimiento.responsable && <p>Responsable: {movimiento.responsable}</p>}
                    </div>

                    <strong className={esPago ? "cc-amount-negative" : "cc-amount-positive"}>
                      {movimiento.importeFirmado > 0 ? "+" : "-"}
                      {formatearPesos(Math.abs(movimiento.importeFirmado))}
                    </strong>
                  </article>
                );
              })
            )}
          </section>
        </div>
      )}

      {vista === "formulario" && clienteSeleccionado && (
        <section className="cc-card cc-form-card">
          <p>Cliente: {clienteSeleccionado.cliente}</p>
          <h3>{tipoFormulario === "REMITO EMITIDO" ? "Registrar remito" : "Registrar pago"}</h3>

          <label>
            Fecha *
            <input
              type="date"
              value={formMovimiento.fecha}
              onChange={(event) => setFormMovimiento({ ...formMovimiento, fecha: event.target.value })}
            />
          </label>

          {tipoFormulario === "PAGO RECIBIDO" && (
            <label>
              Medio de pago *
              <select
                value={formMovimiento.medioPago}
                onChange={(event) => setFormMovimiento({ ...formMovimiento, medioPago: event.target.value as MedioPago })}
              >
                <option value="">Seleccionar</option>
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
                <option value="ECHEQ">Echeq</option>
              </select>
            </label>
          )}

          <label>
            Comprobante
            <input
              value={formMovimiento.comprobante}
              onChange={(event) => setFormMovimiento({ ...formMovimiento, comprobante: event.target.value })}
              placeholder={tipoFormulario === "REMITO EMITIDO" ? "Ej: Remito N° 0008" : "Ej: Recibo N° 001"}
            />
          </label>

          {tipoFormulario === "PAGO RECIBIDO" && (
            <label>
              Datos del pago
              <textarea
                value={formMovimiento.datosPago}
                onChange={(event) => setFormMovimiento({ ...formMovimiento, datosPago: event.target.value })}
                placeholder="Ej: Echeq N° 456 vence 20/07 o transferencia operación 123"
              />
            </label>
          )}

          <label>
            Importe *
            <input
              type="number"
              min="0"
              step="0.01"
              value={formMovimiento.importe}
              onChange={(event) => setFormMovimiento({ ...formMovimiento, importe: event.target.value })}
              placeholder="Ej: 125000"
            />
          </label>

          <label>
            Observación
            <textarea
              value={formMovimiento.observacion}
              onChange={(event) => setFormMovimiento({ ...formMovimiento, observacion: event.target.value })}
              placeholder={tipoFormulario === "REMITO EMITIDO" ? "Ej: Entrega semanal" : "Ej: Pago parcial"}
            />
          </label>

          <label>
            Responsable
            <input
              value={formMovimiento.responsable}
              onChange={(event) => setFormMovimiento({ ...formMovimiento, responsable: event.target.value })}
              placeholder="Ej: Juan"
            />
          </label>

          <button className="cc-primary-button cc-full-button" type="button" onClick={guardarMovimiento} disabled={guardando}>
            {guardando ? "Guardando..." : tipoFormulario === "REMITO EMITIDO" ? "Guardar remito" : "Guardar pago"}
          </button>
        </section>
      )}
    </section>
  );
}

