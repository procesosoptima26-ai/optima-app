import { useMemo, useState } from "react";
import "./CuentasCorrientesMock.css";

type EstadoCliente = "DEBE" | "AL DIA" | "A FAVOR";
type MedioPago = "EFECTIVO" | "TRANSFERENCIA" | "ECHEQ" | "";
type TipoMovimiento = "REMITO EMITIDO" | "PAGO RECIBIDO";

type Cliente = {
  id: string;
  nombre: string;
  telefono?: string;
  direccion?: string;
  saldo: number;
};

type Movimiento = {
  id: string;
  clienteId: string;
  fecha: string;
  tipo: TipoMovimiento;
  comprobante: string;
  medioPago: MedioPago;
  datosPago: string;
  importe: number;
  observacion: string;
  responsable: string;
};

const clientesIniciales: Cliente[] = [
  {
    id: "cli-1",
    nombre: "Autoservicio San Martín",
    telefono: "3794 555 123",
    direccion: "Av. San Martín 1250",
    saldo: 40000,
  },
  {
    id: "cli-2",
    nombre: "Despensa Norte",
    telefono: "3794 222 456",
    direccion: "Barrio Norte",
    saldo: 125000,
  },
  {
    id: "cli-3",
    nombre: "Kiosco Marta",
    telefono: "3794 888 777",
    direccion: "Rioja 399",
    saldo: 0,
  },
  {
    id: "cli-4",
    nombre: "Mercado Don Luis",
    telefono: "3794 333 999",
    direccion: "Belgrano 450",
    saldo: -15000,
  },
];

const movimientosIniciales: Movimiento[] = [
  {
    id: "mov-1",
    clienteId: "cli-1",
    fecha: "08/07/2026",
    tipo: "REMITO EMITIDO",
    comprobante: "Remito N° 0001",
    medioPago: "",
    datosPago: "",
    importe: 120000,
    observacion: "30 maples de huevos",
    responsable: "Juan",
  },
  {
    id: "mov-2",
    clienteId: "cli-1",
    fecha: "09/07/2026",
    tipo: "PAGO RECIBIDO",
    comprobante: "Recibo N° 001",
    medioPago: "EFECTIVO",
    datosPago: "Pago efectivo parcial",
    importe: 30000,
    observacion: "",
    responsable: "Juan",
  },
  {
    id: "mov-3",
    clienteId: "cli-1",
    fecha: "10/07/2026",
    tipo: "PAGO RECIBIDO",
    comprobante: "Recibo N° 002",
    medioPago: "ECHEQ",
    datosPago: "Echeq N° 456 - vence 20/07",
    importe: 50000,
    observacion: "",
    responsable: "Juan",
  },
  {
    id: "mov-4",
    clienteId: "cli-2",
    fecha: "10/07/2026",
    tipo: "REMITO EMITIDO",
    comprobante: "Remito N° 0008",
    medioPago: "",
    datosPago: "",
    importe: 125000,
    observacion: "Entrega semanal",
    responsable: "Juan",
  },
];

function formatearPesos(valor: number) {
  return valor.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function obtenerEstado(saldo: number): EstadoCliente {
  if (saldo > 0) return "DEBE";
  if (saldo < 0) return "A FAVOR";
  return "AL DIA";
}

function obtenerTextoSaldo(saldo: number) {
  if (saldo > 0) return `Debe ${formatearPesos(saldo)}`;
  if (saldo < 0) return `A favor ${formatearPesos(Math.abs(saldo))}`;
  return "Al día";
}

export default function CuentasCorrientesMock() {
  const [clientes, setClientes] = useState<Cliente[]>(clientesIniciales);
  const [movimientos, setMovimientos] = useState<Movimiento[]>(movimientosIniciales);

  const [vista, setVista] = useState<"lista" | "detalle" | "formulario" | "nuevoCliente">("lista");
  const [clienteSeleccionadoId, setClienteSeleccionadoId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const [tipoFormulario, setTipoFormulario] = useState<TipoMovimiento>("REMITO EMITIDO");

  const [nuevoCliente, setNuevoCliente] = useState({
    nombre: "",
    telefono: "",
    direccion: "",
  });

  const [formMovimiento, setFormMovimiento] = useState({
    fecha: "",
    comprobante: "",
    medioPago: "" as MedioPago,
    datosPago: "",
    importe: "",
    observacion: "",
    responsable: "",
  });

  const clientesFiltrados = useMemo(() => {
    return clientes.filter((cliente) =>
      cliente.nombre.toLowerCase().includes(busqueda.toLowerCase())
    );
  }, [clientes, busqueda]);

  const clienteSeleccionado = clientes.find(
    (cliente) => cliente.id === clienteSeleccionadoId
  );

  const movimientosDelCliente = movimientos.filter(
    (movimiento) => movimiento.clienteId === clienteSeleccionadoId
  );

  function abrirDetalle(clienteId: string) {
    setClienteSeleccionadoId(clienteId);
    setVista("detalle");
  }

  function volverALista() {
    setVista("lista");
    setClienteSeleccionadoId(null);
  }

  function abrirFormulario(tipo: TipoMovimiento) {
    setTipoFormulario(tipo);
    setFormMovimiento({
      fecha: new Date().toLocaleDateString("es-AR"),
      comprobante: "",
      medioPago: "",
      datosPago: "",
      importe: "",
      observacion: "",
      responsable: "",
    });
    setVista("formulario");
  }

  function guardarMovimiento() {
    if (!clienteSeleccionadoId) return;

    const importeNumerico = Number(formMovimiento.importe);

    if (!formMovimiento.fecha || !formMovimiento.comprobante || !importeNumerico) {
      alert("Completá fecha, comprobante e importe.");
      return;
    }

    if (tipoFormulario === "PAGO RECIBIDO" && !formMovimiento.medioPago) {
      alert("Seleccioná el medio de pago.");
      return;
    }

    const nuevoMovimiento: Movimiento = {
      id: `mov-${Date.now()}`,
      clienteId: clienteSeleccionadoId,
      fecha: formMovimiento.fecha,
      tipo: tipoFormulario,
      comprobante: formMovimiento.comprobante,
      medioPago: tipoFormulario === "PAGO RECIBIDO" ? formMovimiento.medioPago : "",
      datosPago: tipoFormulario === "PAGO RECIBIDO" ? formMovimiento.datosPago : "",
      importe: importeNumerico,
      observacion: formMovimiento.observacion,
      responsable: formMovimiento.responsable,
    };

    setMovimientos((actuales) => [nuevoMovimiento, ...actuales]);

    setClientes((actuales) =>
      actuales.map((cliente) => {
        if (cliente.id !== clienteSeleccionadoId) return cliente;

        const nuevoSaldo =
          tipoFormulario === "REMITO EMITIDO"
            ? cliente.saldo + importeNumerico
            : cliente.saldo - importeNumerico;

        return {
          ...cliente,
          saldo: nuevoSaldo,
        };
      })
    );

    setVista("detalle");
  }

  function guardarNuevoCliente() {
    if (!nuevoCliente.nombre.trim()) {
      alert("El nombre del cliente es obligatorio.");
      return;
    }

    const clienteCreado: Cliente = {
      id: `cli-${Date.now()}`,
      nombre: nuevoCliente.nombre.trim(),
      telefono: nuevoCliente.telefono.trim(),
      direccion: nuevoCliente.direccion.trim(),
      saldo: 0,
    };

    setClientes((actuales) => [clienteCreado, ...actuales]);
    setNuevoCliente({
      nombre: "",
      telefono: "",
      direccion: "",
    });

    setClienteSeleccionadoId(clienteCreado.id);
    setVista("detalle");
  }

  return (
    <div className="cc-module">
      <header className="cc-module-header">
        <div>
          <p className="cc-kicker">MÓDULO</p>
          <h2>Cuentas Corrientes</h2>
        </div>

        {vista !== "lista" && (
          <button className="cc-back-button" type="button" onClick={vista === "detalle" ? volverALista : () => setVista(clienteSeleccionado ? "detalle" : "lista")}>
            Volver
          </button>
        )}
      </header>

      {vista === "lista" && (
        <section className="cc-content">
          <article className="cc-summary-card">
            <p className="cc-summary-label">Total a cobrar</p>
            <strong>
              {formatearPesos(
                clientes.reduce((total, cliente) => {
                  return cliente.saldo > 0 ? total + cliente.saldo : total;
                }, 0)
              )}
            </strong>
            <span>Suma de clientes con deuda activa.</span>
          </article>

          <div className="cc-actions-row">
            <input
              className="cc-search"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              placeholder="Buscar cliente..."
            />

            <button
              className="cc-primary-button"
              type="button"
              onClick={() => setVista("nuevoCliente")}
            >
              + Nuevo cliente
            </button>
          </div>

          <div className="cc-client-list">
            {clientesFiltrados.map((cliente) => {
              const estado = obtenerEstado(cliente.saldo);
              const claseEstado = estado.toLowerCase().replaceAll(" ", "-");

              return (
                <button
                  key={cliente.id}
                  className="cc-client-card"
                  type="button"
                  onClick={() => abrirDetalle(cliente.id)}
                >
                  <div>
                    <h3>{cliente.nombre}</h3>
                    <p>{cliente.telefono || "Sin teléfono cargado"}</p>
                  </div>

                  <span className={`cc-status cc-status-${claseEstado}`}>
                    {obtenerTextoSaldo(cliente.saldo)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {vista === "nuevoCliente" && (
        <section className="cc-content">
          <article className="cc-form-card">
            <h2>Nuevo cliente</h2>
            <p className="cc-form-help">
              Cargá lo mínimo necesario. Después se puede completar el resto.
            </p>

            <label>
              Nombre del cliente *
              <input
                value={nuevoCliente.nombre}
                onChange={(event) =>
                  setNuevoCliente({ ...nuevoCliente, nombre: event.target.value })
                }
                placeholder="Ej: Autoservicio San Martín"
              />
            </label>

            <label>
              Teléfono
              <input
                value={nuevoCliente.telefono}
                onChange={(event) =>
                  setNuevoCliente({ ...nuevoCliente, telefono: event.target.value })
                }
                placeholder="Ej: 3794 555 123"
              />
            </label>

            <label>
              Dirección
              <input
                value={nuevoCliente.direccion}
                onChange={(event) =>
                  setNuevoCliente({ ...nuevoCliente, direccion: event.target.value })
                }
                placeholder="Ej: Av. San Martín 1250"
              />
            </label>

            <button className="cc-primary-button cc-full-button" type="button" onClick={guardarNuevoCliente}>
              Guardar cliente
            </button>
          </article>
        </section>
      )}

      {vista === "detalle" && clienteSeleccionado && (
        <section className="cc-content">
          <article className="cc-detail-card">
            <p className="cc-detail-label">Cliente</p>
            <h2>{clienteSeleccionado.nombre}</h2>

            <div className="cc-balance-box">
              <p>Saldo actual</p>
              <strong>{formatearPesos(clienteSeleccionado.saldo)}</strong>
              <span>{obtenerTextoSaldo(clienteSeleccionado.saldo)}</span>
            </div>

            <div className="cc-client-info">
              <p>
                <strong>Teléfono:</strong>{" "}
                {clienteSeleccionado.telefono || "Sin cargar"}
              </p>
              <p>
                <strong>Dirección:</strong>{" "}
                {clienteSeleccionado.direccion || "Sin cargar"}
              </p>
            </div>

            <div className="cc-two-buttons">
              <button
                className="cc-primary-button"
                type="button"
                onClick={() => abrirFormulario("REMITO EMITIDO")}
              >
                Registrar remito
              </button>

              <button
                className="cc-secondary-button"
                type="button"
                onClick={() => abrirFormulario("PAGO RECIBIDO")}
              >
                Registrar pago
              </button>
            </div>
          </article>

          <div className="cc-history">
            <h2>Historial</h2>

            {movimientosDelCliente.length === 0 ? (
              <p className="cc-empty">Todavía no hay movimientos cargados.</p>
            ) : (
              movimientosDelCliente.map((movimiento) => {
                const esPago = movimiento.tipo === "PAGO RECIBIDO";
                const importeFirmado = esPago ? -movimiento.importe : movimiento.importe;

                return (
                  <article key={movimiento.id} className="cc-movement-card">
                    <div>
                      <p className="cc-movement-date">{movimiento.fecha}</p>
                      <h3>{movimiento.comprobante}</h3>
                      <p>
                        {esPago
                          ? `Pago recibido${
                              movimiento.medioPago ? ` - ${movimiento.medioPago}` : ""
                            }`
                          : "Remito emitido"}
                      </p>

                      {movimiento.datosPago && <p>{movimiento.datosPago}</p>}
                      {movimiento.observacion && <p>{movimiento.observacion}</p>}
                    </div>

                    <strong className={esPago ? "cc-negative" : "cc-positive"}>
                      {importeFirmado > 0 ? "+" : "-"}
                      {formatearPesos(Math.abs(importeFirmado))}
                    </strong>
                  </article>
                );
              })
            )}
          </div>
        </section>
      )}

      {vista === "formulario" && clienteSeleccionado && (
        <section className="cc-content">
          <article className="cc-form-card">
            <p className="cc-form-help">Cliente: {clienteSeleccionado.nombre}</p>
            <h2>
              {tipoFormulario === "REMITO EMITIDO"
                ? "Registrar remito"
                : "Registrar pago"}
            </h2>

            <label>
              Fecha *
              <input
                value={formMovimiento.fecha}
                onChange={(event) =>
                  setFormMovimiento({ ...formMovimiento, fecha: event.target.value })
                }
                placeholder="DD/MM/AAAA"
              />
            </label>

            {tipoFormulario === "PAGO RECIBIDO" && (
              <label>
                Medio de pago *
                <select
                  value={formMovimiento.medioPago}
                  onChange={(event) =>
                    setFormMovimiento({
                      ...formMovimiento,
                      medioPago: event.target.value as MedioPago,
                    })
                  }
                >
                  <option value="">Seleccionar</option>
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="TRANSFERENCIA">Transferencia</option>
                  <option value="ECHEQ">Echeq</option>
                </select>
              </label>
            )}

            <label>
              Comprobante *
              <input
                value={formMovimiento.comprobante}
                onChange={(event) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    comprobante: event.target.value,
                  })
                }
                placeholder={
                  tipoFormulario === "REMITO EMITIDO"
                    ? "Ej: Remito N° 0001"
                    : "Ej: Recibo N° 001"
                }
              />
            </label>

            {tipoFormulario === "PAGO RECIBIDO" && (
              <label>
                Datos del pago
                <textarea
                  value={formMovimiento.datosPago}
                  onChange={(event) =>
                    setFormMovimiento({
                      ...formMovimiento,
                      datosPago: event.target.value,
                    })
                  }
                  placeholder="Ej: Echeq N° 456 vence 20/07, transferencia Banco Galicia operación 123..."
                />
              </label>
            )}

            <label>
              Importe *
              <input
                value={formMovimiento.importe}
                onChange={(event) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    importe: event.target.value,
                  })
                }
                type="number"
                placeholder="Ej: 50000"
              />
            </label>

            <label>
              Observación
              <textarea
                value={formMovimiento.observacion}
                onChange={(event) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    observacion: event.target.value,
                  })
                }
                placeholder={
                  tipoFormulario === "REMITO EMITIDO"
                    ? "Ej: 30 maples de huevos"
                    : "Ej: Pago parcial"
                }
              />
            </label>

            <label>
              Responsable
              <input
                value={formMovimiento.responsable}
                onChange={(event) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    responsable: event.target.value,
                  })
                }
                placeholder="Ej: Juan"
              />
            </label>

            <button className="cc-primary-button cc-full-button" type="button" onClick={guardarMovimiento}>
              {tipoFormulario === "REMITO EMITIDO"
                ? "Guardar remito"
                : "Guardar pago"}
            </button>
          </article>
        </section>
      )}
    </div>
  );
}