import { useEffect, useMemo, useState } from "react";
import { tienePermiso } from "../../config/permisos";
import "./CuentasCorrientes.css";

type RolUsuario = "USUARIO" | "ADMIN" | string;
type MedioPago = "EFECTIVO" | "TRANSFERENCIA" | "ECHEQ" | "";
type Mensaje = { tipo: "info" | "exito" | "error"; texto: string } | null;

type UsuarioSesion = {
  usuario: string;
  nombre: string;
  empresa: string;
  rol: RolUsuario;
  sucursal: string;
  modulos: string[];
};

function formatearPesos(valor: number) {
  return valor.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function obtenerFechaHoyInput() {
  return new Date().toISOString().slice(0, 10);
}

function formatearFechaParaMostrar(fecha: string) {
  if (!fecha) return "Sin fecha";

  const match = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  return fecha;
}

function abrirVentanaImpresion(html: string) {
  const ventana = window.open("", "_blank", "width=900,height=700");

  if (!ventana) {
    throw new Error("No se pudo abrir la ventana para exportar.");
  }

  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();
  ventana.focus();

  window.setTimeout(() => {
    ventana.print();
  }, 350);
}

function construirHtmlExportacion(params: {
  titulo: string;
  subtitulo: string;
  saldoActual: number;
  movimientos: Array<{
    fecha: string;
    titulo: string;
    detalle: string;
    observacion: string;
    responsable: string;
    importeFirmado: number;
  }>;
}) {
  const totalPositivos = params.movimientos
    .filter((movimiento) => movimiento.importeFirmado > 0)
    .reduce((total, movimiento) => total + movimiento.importeFirmado, 0);

  const totalNegativos = params.movimientos
    .filter((movimiento) => movimiento.importeFirmado < 0)
    .reduce((total, movimiento) => total + Math.abs(movimiento.importeFirmado), 0);

  const filas = params.movimientos
    .map(
      (movimiento) => `
        <tr>
          <td>${movimiento.fecha || "-"}</td>
          <td>${movimiento.titulo || "-"}</td>
          <td>${movimiento.detalle || "-"}</td>
          <td>${movimiento.observacion || "-"}</td>
          <td>${movimiento.responsable || "-"}</td>
          <td style="text-align:right;">${
            movimiento.importeFirmado > 0 ? "+" : "-"
          }${formatearPesos(Math.abs(movimiento.importeFirmado))}</td>
        </tr>
      `
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>${params.titulo}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 32px;
            color: #0f172a;
          }
          h1 {
            margin: 0 0 6px;
            color: #083f88;
            font-size: 28px;
          }
          p {
            margin: 0 0 12px;
          }
          .meta {
            margin-bottom: 18px;
            color: #475569;
          }
          .summary {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin: 18px 0 24px;
          }
          .box {
            border: 1px solid #cbd5e1;
            border-radius: 12px;
            padding: 12px;
          }
          .box strong {
            display: block;
            margin-top: 8px;
            color: #083f88;
            font-size: 20px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            border: 1px solid #cbd5e1;
            padding: 10px;
            font-size: 13px;
            vertical-align: top;
          }
          th {
            background: #eff6ff;
            color: #083f88;
            text-align: left;
          }
        </style>
      </head>
      <body>
        <h1>OPTIMA</h1>
        <p class="meta">${params.subtitulo}</p>

        <div class="summary">
          <div class="box">
            <span>Saldo actual</span>
            <strong>${formatearPesos(params.saldoActual)}</strong>
          </div>
          <div class="box">
            <span>Total cargos</span>
            <strong>${formatearPesos(totalPositivos)}</strong>
          </div>
          <div class="box">
            <span>Total pagos</span>
            <strong>${formatearPesos(totalNegativos)}</strong>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Comprobante</th>
              <th>Detalle</th>
              <th>Observación</th>
              <th>Responsable</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            ${filas || '<tr><td colspan="6">Sin movimientos para exportar.</td></tr>'}
          </tbody>
        </table>
      </body>
    </html>
  `;
}


type EstadoProveedor = "DEBE" | "AL DIA" | "A FAVOR" | string;
type TipoMovimiento = "COMPRA RECIBIDA" | "PAGO REALIZADO";
type Vista = "lista" | "detalle" | "formulario" | "nuevoProveedor";

type Proveedor = {
  id: string;
  proveedor: string;
  telefono: string;
  cuit: string;
  direccion: string;
  observaciones: string;
  saldoActual: number;
  estado: EstadoProveedor;
};

type Movimiento = {
  id: string;
  proveedorIds: string[];
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

type RespuestaProveedores = {
  ok?: boolean;
  proveedores?: Proveedor[];
  proveedor?: Proveedor;
  error?: string;
};

type RespuestaMovimientos = {
  ok?: boolean;
  movimientos?: Movimiento[];
  movimiento?: Movimiento;
  error?: string;
};

type Props = {
  usuario: UsuarioSesion;
};

function obtenerEstadoDesdeSaldo(saldo: number): EstadoProveedor {
  if (saldo > 0) return "DEBE";
  if (saldo < 0) return "A FAVOR";
  return "AL DIA";
}

function obtenerTextoSaldo(saldo: number) {
  if (saldo > 0) return `Debe ${formatearPesos(saldo)}`;
  if (saldo < 0) return `A favor ${formatearPesos(Math.abs(saldo))}`;
  return "Al día";
}

function obtenerClaseEstado(estado: EstadoProveedor) {
  return estado.toLowerCase().replaceAll(" ", "-");
}

export default function CuentasCorrientesProveedores({ usuario }: Props) {
  const puedeEditarGuardado = tienePermiso(
    usuario.rol,
    "cuentasCorrientes.editarGuardado"
  );
  const puedeExportar = tienePermiso(
    usuario.rol,
    "cuentasCorrientes.exportar"
  );

  const [vista, setVista] = useState<Vista>("lista");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [proveedorSeleccionadoId, setProveedorSeleccionadoId] = useState<string | null>(null);
  const [movimientoEditandoId, setMovimientoEditandoId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [cargandoProveedores, setCargandoProveedores] = useState(false);
  const [cargandoMovimientos, setCargandoMovimientos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [tipoFormulario, setTipoFormulario] = useState<TipoMovimiento>("COMPRA RECIBIDA");

  const [nuevoProveedor, setNuevoProveedor] = useState({
    proveedor: "",
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

  const proveedorSeleccionado = proveedores.find(
    (proveedor) => proveedor.id === proveedorSeleccionadoId
  );

  const proveedoresFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    if (!texto) return proveedores;

    return proveedores.filter((proveedor) =>
      proveedor.proveedor.toLowerCase().includes(texto)
    );
  }, [proveedores, busqueda]);

  const totalAPagar = useMemo(() => {
    return proveedores.reduce((total, proveedor) => {
      return proveedor.saldoActual > 0 ? total + proveedor.saldoActual : total;
    }, 0);
  }, [proveedores]);

  useEffect(() => {
    cargarProveedores();
  }, []);

  async function cargarProveedores() {
    try {
      setCargandoProveedores(true);
      setMensaje(null);

      const response = await fetch("/api/proveedores");
      const data = (await response.json()) as RespuestaProveedores;

      if (!response.ok || !data.ok || !data.proveedores) {
        throw new Error(data.error || "No se pudieron cargar los proveedores");
      }

      setProveedores(data.proveedores);
    } catch (error) {
      console.error("Error cargando proveedores:", error);
      setMensaje({
        tipo: "error",
        texto: "No se pudieron cargar los proveedores.",
      });
    } finally {
      setCargandoProveedores(false);
    }
  }

  async function cargarMovimientos(proveedorId: string) {
    try {
      setCargandoMovimientos(true);
      setMensaje(null);

      const response = await fetch(
        `/api/movimientos-proveedores?proveedorId=${encodeURIComponent(proveedorId)}`
      );
      const data = (await response.json()) as RespuestaMovimientos;

      if (!response.ok || !data.ok || !data.movimientos) {
        throw new Error(data.error || "No se pudieron cargar los movimientos");
      }

      setMovimientos(data.movimientos);
    } catch (error) {
      console.error("Error cargando movimientos de proveedores:", error);
      setMensaje({
        tipo: "error",
        texto: "No se pudo cargar el historial del proveedor.",
      });
    } finally {
      setCargandoMovimientos(false);
    }
  }

  async function abrirDetalle(proveedorId: string) {
    setProveedorSeleccionadoId(proveedorId);
    setMovimientoEditandoId(null);
    setVista("detalle");
    await cargarMovimientos(proveedorId);
  }

  function volverALista() {
    setVista("lista");
    setProveedorSeleccionadoId(null);
    setMovimientoEditandoId(null);
    setMovimientos([]);
    setMensaje(null);
    cargarProveedores();
  }

  function abrirFormulario(tipo: TipoMovimiento) {
    setMovimientoEditandoId(null);
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

  function editarMovimiento(movimiento: Movimiento) {
    if (!puedeEditarGuardado) return;

    setMovimientoEditandoId(movimiento.id);
    setTipoFormulario(movimiento.tipoMovimiento);
    setFormMovimiento({
      fecha: movimiento.fecha.includes("/") ? movimiento.fecha.split("/").reverse().join("-") : movimiento.fecha,
      comprobante: movimiento.comprobante,
      medioPago: movimiento.medioPago || "",
      datosPago: movimiento.datosPago,
      importe: String(movimiento.importe),
      observacion: movimiento.observacion,
      responsable: movimiento.responsable,
    });
    setMensaje({
      tipo: "info",
      texto: "Editando movimiento guardado.",
    });
    setVista("formulario");
  }

  async function guardarNuevoProveedor() {
    if (!nuevoProveedor.proveedor.trim()) {
      setMensaje({ tipo: "error", texto: "El nombre del proveedor es obligatorio." });
      return;
    }

    try {
      setGuardando(true);
      setMensaje({ tipo: "info", texto: "Guardando proveedor..." });

      const response = await fetch("/api/proveedores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(nuevoProveedor),
      });

      const data = (await response.json()) as RespuestaProveedores;

      if (!response.ok || !data.ok || !data.proveedor) {
        throw new Error(data.error || "No se pudo crear el proveedor");
      }

      setProveedores((actuales) => [data.proveedor as Proveedor, ...actuales]);
      setNuevoProveedor({
        proveedor: "",
        telefono: "",
        cuit: "",
        direccion: "",
        observaciones: "",
      });
      setProveedorSeleccionadoId(data.proveedor.id);
      setMovimientos([]);
      setVista("detalle");
      setMensaje({ tipo: "exito", texto: "Proveedor creado correctamente." });
    } catch (error) {
      console.error("Error guardando proveedor:", error);
      setMensaje({ tipo: "error", texto: "No se pudo guardar el proveedor." });
    } finally {
      setGuardando(false);
    }
  }

  async function guardarMovimiento() {
    if (!proveedorSeleccionadoId) return;

    const importeNumerico = Number(formMovimiento.importe);

    if (!formMovimiento.fecha || !importeNumerico || importeNumerico <= 0) {
      setMensaje({
        tipo: "error",
        texto: "Completá fecha e importe mayor a cero.",
      });
      return;
    }

    if (tipoFormulario === "PAGO REALIZADO" && !formMovimiento.medioPago) {
      setMensaje({ tipo: "error", texto: "Seleccioná el medio de pago." });
      return;
    }

    try {
      setGuardando(true);
      setMensaje({
        tipo: "info",
        texto: movimientoEditandoId
          ? "Actualizando movimiento..."
          : tipoFormulario === "COMPRA RECIBIDA"
          ? "Guardando compra..."
          : "Guardando pago...",
      });

      const response = await fetch("/api/movimientos-proveedores", {
        method: movimientoEditandoId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          movimientoEditandoId
            ? {
                id: movimientoEditandoId,
                fecha: formMovimiento.fecha,
                comprobante: formMovimiento.comprobante,
                medioPago: tipoFormulario === "PAGO REALIZADO" ? formMovimiento.medioPago : "",
                datosPago: tipoFormulario === "PAGO REALIZADO" ? formMovimiento.datosPago : "",
                importe: importeNumerico,
                observacion: formMovimiento.observacion,
                responsable: formMovimiento.responsable,
              }
            : {
                proveedorId: proveedorSeleccionadoId,
                fecha: formMovimiento.fecha,
                tipoMovimiento: tipoFormulario,
                comprobante: formMovimiento.comprobante,
                medioPago: tipoFormulario === "PAGO REALIZADO" ? formMovimiento.medioPago : "",
                datosPago: tipoFormulario === "PAGO REALIZADO" ? formMovimiento.datosPago : "",
                importe: importeNumerico,
                observacion: formMovimiento.observacion,
                responsable: formMovimiento.responsable,
              }
        ),
      });

      const data = (await response.json()) as RespuestaMovimientos;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo guardar el movimiento");
      }

      await cargarMovimientos(proveedorSeleccionadoId);
      await cargarProveedores();
      setMovimientoEditandoId(null);
      setVista("detalle");

      setMensaje({
        tipo: "exito",
        texto: movimientoEditandoId
          ? "Movimiento actualizado correctamente."
          : tipoFormulario === "COMPRA RECIBIDA"
          ? "Compra guardada correctamente."
          : "Pago guardado correctamente.",
      });
    } catch (error) {
      console.error("Error guardando movimiento:", error);
      setMensaje({
        tipo: "error",
        texto: movimientoEditandoId
          ? "No se pudo actualizar el movimiento."
          : tipoFormulario === "COMPRA RECIBIDA"
          ? "No se pudo guardar la compra."
          : "No se pudo guardar el pago.",
      });
    } finally {
      setGuardando(false);
    }
  }

  function exportarHistorial() {
    if (!puedeExportar || !proveedorSeleccionado) return;

    try {
      const html = construirHtmlExportacion({
        titulo: `Cuenta corriente - ${proveedorSeleccionado.proveedor}`,
        subtitulo: `Proveedor: ${proveedorSeleccionado.proveedor} · Exportado desde OPTIMA`,
        saldoActual: proveedorSeleccionado.saldoActual,
        movimientos: movimientos.map((movimiento) => {
          const esPago = movimiento.tipoMovimiento === "PAGO REALIZADO";

          return {
            fecha: formatearFechaParaMostrar(movimiento.fecha),
            titulo:
              movimiento.comprobante || (esPago ? "Pago realizado" : "Compra recibida"),
            detalle: esPago
              ? `Pago realizado${movimiento.medioPago ? ` · ${movimiento.medioPago}` : ""}${
                  movimiento.datosPago ? ` · ${movimiento.datosPago}` : ""
                }`
              : "Compra recibida",
            observacion: movimiento.observacion,
            responsable: movimiento.responsable,
            importeFirmado: movimiento.importeFirmado,
          };
        }),
      });

      abrirVentanaImpresion(html);
    } catch (error) {
      console.error("Error exportando historial:", error);
      setMensaje({
        tipo: "error",
        texto: "No se pudo exportar el historial.",
      });
    }
  }

  return (
    <section className="cc-module">
      <div className="cc-module-title-row">
        <div>
          <p className="module-label cc-module-label">MÓDULO</p>
          <h2>Cuenta Corriente Proveedores</h2>
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
            <span>Total a pagar</span>
            <strong>{formatearPesos(totalAPagar)}</strong>
            <p>Proveedores con saldo activo.</p>
          </section>

          <div className="cc-list-actions">
            <input
              className="cc-search-input"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              placeholder="Buscar proveedor..."
            />

            <button className="cc-primary-button" type="button" onClick={() => setVista("nuevoProveedor")}>
              + Nuevo proveedor
            </button>
          </div>

          {cargandoProveedores ? (
            <div className="cc-empty-card">Cargando proveedores...</div>
          ) : proveedoresFiltrados.length === 0 ? (
            <div className="cc-empty-card">No hay proveedores para mostrar.</div>
          ) : (
            <div className="cc-client-list">
              {proveedoresFiltrados.map((proveedor) => {
                const estado = proveedor.estado || obtenerEstadoDesdeSaldo(proveedor.saldoActual);

                return (
                  <button
                    key={proveedor.id}
                    className="cc-client-card"
                    type="button"
                    onClick={() => abrirDetalle(proveedor.id)}
                  >
                    <div>
                      <h3>{proveedor.proveedor}</h3>
                      <p>{proveedor.telefono || "Sin teléfono cargado"}</p>
                    </div>

                    <strong className={`cc-status-pill cc-status-${obtenerClaseEstado(estado)}`}>
                      {obtenerTextoSaldo(proveedor.saldoActual)}
                    </strong>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {vista === "nuevoProveedor" && (
        <section className="cc-card cc-form-card">
          <h3>Nuevo proveedor</h3>
          <p>Cargá el nombre y, si tenés, los datos de contacto.</p>

          <label>
            Nombre del proveedor *
            <input
              value={nuevoProveedor.proveedor}
              onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, proveedor: event.target.value })}
              placeholder="Ej: Distribuidora Norte"
            />
          </label>

          <label>
            Teléfono
            <input
              value={nuevoProveedor.telefono}
              onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, telefono: event.target.value })}
              placeholder="Ej: 3794 222 456"
            />
          </label>

          <label>
            CUIT
            <input
              value={nuevoProveedor.cuit}
              onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, cuit: event.target.value })}
              placeholder="Opcional"
            />
          </label>

          <label>
            Dirección
            <input
              value={nuevoProveedor.direccion}
              onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, direccion: event.target.value })}
              placeholder="Ej: Barrio Norte"
            />
          </label>

          <label>
            Observaciones
            <textarea
              value={nuevoProveedor.observaciones}
              onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, observaciones: event.target.value })}
              placeholder="Opcional"
            />
          </label>

          <button className="cc-primary-button cc-full-button" type="button" onClick={guardarNuevoProveedor} disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar proveedor"}
          </button>
        </section>
      )}

      {vista === "detalle" && proveedorSeleccionado && (
        <div className="cc-stack">
          <section className="cc-card cc-detail-card">
            <span>Proveedor</span>
            <h3>{proveedorSeleccionado.proveedor}</h3>

            <div className="cc-balance-box">
              <span>Saldo actual</span>
              <strong>{formatearPesos(proveedorSeleccionado.saldoActual)}</strong>
              <p>{obtenerTextoSaldo(proveedorSeleccionado.saldoActual)}</p>
            </div>

            <div className="cc-info-list">
              <p><strong>Teléfono:</strong> {proveedorSeleccionado.telefono || "Sin cargar"}</p>
              <p><strong>Dirección:</strong> {proveedorSeleccionado.direccion || "Sin cargar"}</p>
              {proveedorSeleccionado.cuit && <p><strong>CUIT:</strong> {proveedorSeleccionado.cuit}</p>}
            </div>

            <div className="cc-action-grid">
              <button className="cc-primary-button" type="button" onClick={() => abrirFormulario("COMPRA RECIBIDA")}>
                Registrar compra
              </button>

              <button className="cc-green-button" type="button" onClick={() => abrirFormulario("PAGO REALIZADO")}>
                Registrar pago
              </button>

              {puedeExportar && (
                <button className="cc-soft-button" type="button" onClick={exportarHistorial}>
                  Exportar historial
                </button>
              )}
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
                const esPago = movimiento.tipoMovimiento === "PAGO REALIZADO";

                return (
                  <article key={movimiento.id} className="cc-movement-card">
                    <div>
                      <span>{formatearFechaParaMostrar(movimiento.fecha)}</span>
                      <h4>{movimiento.comprobante || (esPago ? "Pago realizado" : "Compra recibida")}</h4>
                      <p>{esPago ? `Pago realizado${movimiento.medioPago ? ` · ${movimiento.medioPago}` : ""}` : "Compra recibida"}</p>
                      {movimiento.datosPago && <p>{movimiento.datosPago}</p>}
                      {movimiento.observacion && <p>{movimiento.observacion}</p>}
                      {movimiento.responsable && <p>Responsable: {movimiento.responsable}</p>}
                    </div>

                    <div>
                      <strong className={esPago ? "cc-amount-negative" : "cc-amount-positive"}>
                        {movimiento.importeFirmado > 0 ? "+" : "-"}
                        {formatearPesos(Math.abs(movimiento.importeFirmado))}
                      </strong>

                      {puedeEditarGuardado && (
                        <button
                          className="cc-soft-button"
                          type="button"
                          onClick={() => editarMovimiento(movimiento)}
                          style={{ marginTop: "10px" }}
                        >
                          Editar
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </div>
      )}

      {vista === "formulario" && proveedorSeleccionado && (
        <section className="cc-card cc-form-card">
          <p>Proveedor: {proveedorSeleccionado.proveedor}</p>
          <h3>
            {movimientoEditandoId
              ? "Editar movimiento"
              : tipoFormulario === "COMPRA RECIBIDA"
              ? "Registrar compra"
              : "Registrar pago"}
          </h3>

          <label>
            Fecha *
            <input
              type="date"
              value={formMovimiento.fecha}
              onChange={(event) => setFormMovimiento({ ...formMovimiento, fecha: event.target.value })}
            />
          </label>

          {tipoFormulario === "PAGO REALIZADO" && (
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
              placeholder={tipoFormulario === "COMPRA RECIBIDA" ? "Ej: Factura N° 0008" : "Ej: Recibo N° 001"}
            />
          </label>

          {tipoFormulario === "PAGO REALIZADO" && (
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
              placeholder={tipoFormulario === "COMPRA RECIBIDA" ? "Ej: Compra semanal" : "Ej: Pago parcial"}
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
            {guardando
              ? movimientoEditandoId
                ? "Actualizando..."
                : "Guardando..."
              : movimientoEditandoId
              ? "Actualizar movimiento"
              : tipoFormulario === "COMPRA RECIBIDA"
              ? "Guardar compra"
              : "Guardar pago"}
          </button>
        </section>
      )}
    </section>
  );
}