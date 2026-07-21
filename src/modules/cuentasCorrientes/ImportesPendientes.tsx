import { useEffect, useMemo, useState } from "react";
import { tienePermiso } from "../../config/permisos";
import "./CuentasCorrientes.css";

type UsuarioSesion = {
  usuario: string;
  nombre: string;
  empresa: string;
  rol: string;
  sucursal: string;
  modulos: string[];
};

type Cliente = {
  id: string;
  cliente: string;
  telefono: string;
  cuit: string;
  direccion: string;
  observaciones: string;
  saldoActual: number;
  estado: string;
};

type MovimientoPendiente = {
  id: string;
  clienteIds: string[];
  fecha: string;
  tipoMovimiento: "REMITO EMITIDO";
  comprobante: string;
  medioPago: "";
  datosPago: string;
  importe: number;
  importeFirmado: number;
  observacion: string;
  responsable: string;
};

type ItemPendiente = {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  costoUnitario: number;
  totalItem: number;
  orden: number;
  observaciones: string;
};

type DetallePendiente = {
  remitoId: string;
  movimientoId: string;
  numero: number;
  comprobante: string;
  importe: number;
  items: ItemPendiente[];
};

type RespuestaClientes = {
  ok?: boolean;
  clientes?: Cliente[];
  error?: string;
};

type RespuestaMovimientos = {
  ok?: boolean;
  movimientos?: MovimientoPendiente[];
  error?: string;
};

type RespuestaDetalle = {
  ok?: boolean;
  detalle?: DetallePendiente;
  error?: string;
};

type Props = {
  usuario: UsuarioSesion;
};

type Mensaje =
  | {
      tipo: "info" | "exito" | "error";
      texto: string;
    }
  | null;

function formatearPesos(valor: number) {
  return valor.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatearFecha(fecha: string) {
  if (!fecha) return "Sin fecha";

  const match = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (match) return fecha;

  const iso = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  return fecha;
}

export default function ImportesPendientes({ usuario }: Props) {
  const puedeEditar = tienePermiso(
    usuario.rol,
    "cuentasCorrientes.editarGuardado"
  );

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [pendientes, setPendientes] = useState<MovimientoPendiente[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(false);
  const [cargandoDetalleId, setCargandoDetalleId] = useState<string | null>(null);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<DetallePendiente | null>(null);
  const [costos, setCostos] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<Mensaje>(null);

  const clientesPorId = useMemo(() => {
    return new Map(clientes.map((cliente) => [cliente.id, cliente]));
  }, [clientes]);

  const pendientesFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    if (!texto) return pendientes;

    return pendientes.filter((movimiento) => {
      const cliente = movimiento.clienteIds
        .map((id) => clientesPorId.get(id)?.cliente || "")
        .join(" ");

      return [
        cliente,
        movimiento.comprobante,
        movimiento.observacion,
        movimiento.responsable,
      ]
        .join(" ")
        .toLowerCase()
        .includes(texto);
    });
  }, [busqueda, clientesPorId, pendientes]);

  const totalCalculado = useMemo(() => {
    if (!detalle) return 0;

    return Math.round(
      detalle.items.reduce((total, item) => {
        const costo = Number(costos[item.id] || 0);
        return total + item.cantidad * (Number.isFinite(costo) ? costo : 0);
      }, 0) * 100
    ) / 100;
  }, [costos, detalle]);

  const todosLosCostosCompletos = useMemo(() => {
    if (!detalle || detalle.items.length === 0) return false;

    return detalle.items.every((item) => {
      const valor = costos[item.id];
      const numero = Number(valor);
      return valor?.trim() !== "" && Number.isFinite(numero) && numero > 0;
    });
  }, [costos, detalle]);

  useEffect(() => {
    cargarDatos();
  }, []);

  async function cargarDatos() {
    try {
      setCargando(true);
      setMensaje(null);

      const [respuestaClientes, respuestaPendientes] = await Promise.all([
        fetch("/api/clientes"),
        fetch("/api/movimientos-cc?pendientes=true"),
      ]);

      const dataClientes = (await respuestaClientes.json()) as RespuestaClientes;
      const dataPendientes =
        (await respuestaPendientes.json()) as RespuestaMovimientos;

      if (!respuestaClientes.ok || !dataClientes.ok || !dataClientes.clientes) {
        throw new Error(dataClientes.error || "No se pudieron cargar los clientes");
      }

      if (
        !respuestaPendientes.ok ||
        !dataPendientes.ok ||
        !dataPendientes.movimientos
      ) {
        throw new Error(
          dataPendientes.error || "No se pudieron cargar los importes pendientes"
        );
      }

      setClientes(dataClientes.clientes);
      setPendientes(dataPendientes.movimientos);
    } catch (error) {
      console.error("Error cargando importes pendientes:", error);
      setMensaje({
        tipo: "error",
        texto: "No se pudieron cargar los importes pendientes.",
      });
    } finally {
      setCargando(false);
    }
  }

  async function comenzarEdicion(movimiento: MovimientoPendiente) {
    if (!puedeEditar) return;

    try {
      setCargandoDetalleId(movimiento.id);
      setMensaje({ tipo: "info", texto: "Cargando ítems del remito..." });

      const response = await fetch(
        `/api/movimientos-cc?accion=detalle-remito-pendiente&movimientoId=${encodeURIComponent(
          movimiento.id
        )}`
      );

      const data = (await response.json()) as RespuestaDetalle;

      if (!response.ok || !data.ok || !data.detalle) {
        throw new Error(data.error || "No se pudo cargar el remito");
      }

      const costosIniciales = Object.fromEntries(
        data.detalle.items.map((item) => [
          item.id,
          item.costoUnitario > 0 ? String(item.costoUnitario) : "",
        ])
      );

      setEditandoId(movimiento.id);
      setDetalle(data.detalle);
      setCostos(costosIniciales);
      setMensaje(null);
    } catch (error) {
      console.error("Error cargando detalle del remito:", error);
      setMensaje({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudo cargar el detalle del remito.",
      });
    } finally {
      setCargandoDetalleId(null);
    }
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setDetalle(null);
    setCostos({});
    setMensaje(null);
  }

  async function confirmarImporte(movimiento: MovimientoPendiente) {
    if (!puedeEditar || !detalle) return;

    if (!todosLosCostosCompletos) {
      setMensaje({
        tipo: "error",
        texto: "Completá el costo unitario de todos los ítems.",
      });
      return;
    }

    try {
      setGuardandoId(movimiento.id);
      setMensaje({
        tipo: "info",
        texto: "Actualizando ítems e importe del remito...",
      });

      const response = await fetch("/api/movimientos-cc", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accion: "completar-remito-pendiente",
          movimientoId: movimiento.id,
          items: detalle.items.map((item) => ({
            id: item.id,
            costoUnitario: Number(costos[item.id]),
          })),
        }),
      });

      const data = (await response.json()) as RespuestaDetalle;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo completar el remito");
      }

      setPendientes((actuales) =>
        actuales.filter((item) => item.id !== movimiento.id)
      );
      setEditandoId(null);
      setDetalle(null);
      setCostos({});
      setMensaje({
        tipo: "exito",
        texto: `Importe confirmado: ${formatearPesos(totalCalculado)}.`,
      });
    } catch (error) {
      console.error("Error completando importe:", error);
      setMensaje({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudo completar el importe.",
      });
    } finally {
      setGuardandoId(null);
    }
  }

  if (!puedeEditar) {
    return (
      <section className="cc-module">
        <div className="cc-empty-card">
          No tenés permiso para ver importes pendientes.
        </div>
      </section>
    );
  }

  return (
    <section className="cc-module">
      <div className="cc-module-title-row">
        <div>
          <p className="module-label cc-module-label">CUENTA CORRIENTE</p>
          <h2>Importes pendientes</h2>
        </div>

        <button
          className="cc-soft-button"
          type="button"
          onClick={cargarDatos}
          disabled={cargando}
        >
          {cargando ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {mensaje && (
        <div className={`message message-${mensaje.tipo}`}>{mensaje.texto}</div>
      )}

      <div className="cc-stack">
        <section className="cc-total-card">
          <span>Remitos pendientes</span>
          <strong>{pendientes.length}</strong>
          <p>Completá los costos unitarios y OPTIMA calculará el total.</p>
        </section>

        <input
          className="cc-search-input"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
          placeholder="Buscar cliente, comprobante o responsable..."
        />

        {cargando ? (
          <div className="cc-empty-card">Cargando importes pendientes...</div>
        ) : pendientesFiltrados.length === 0 ? (
          <div className="cc-empty-card">
            No hay importes pendientes para completar.
          </div>
        ) : (
          <div className="cc-client-list">
            {pendientesFiltrados.map((movimiento) => {
              const cliente = movimiento.clienteIds
                .map((id) => clientesPorId.get(id)?.cliente)
                .filter(Boolean)
                .join(", ");

              const estaEditando = editandoId === movimiento.id;
              const estaGuardando = guardandoId === movimiento.id;
              const estaCargandoDetalle =
                cargandoDetalleId === movimiento.id;

              return (
                <article
                  key={movimiento.id}
                  className="cc-movement-card cc-pending-card"
                >
                  <div className="cc-pending-main">
                    <span>{formatearFecha(movimiento.fecha)}</span>
                    <h4>{cliente || "Cliente sin identificar"}</h4>
                    <p>{movimiento.comprobante || "Remito sin número"}</p>

                    {movimiento.observacion && (
                      <p>{movimiento.observacion}</p>
                    )}

                    {movimiento.responsable && (
                      <p>Responsable: {movimiento.responsable}</p>
                    )}
                  </div>

                  {!estaEditando ? (
                    <div className="cc-pending-actions">
                      <strong className="cc-amount-positive">
                        Importe pendiente
                      </strong>

                      <button
                        className="cc-primary-button"
                        type="button"
                        onClick={() => comenzarEdicion(movimiento)}
                        disabled={estaCargandoDetalle}
                      >
                        {estaCargandoDetalle
                          ? "Cargando..."
                          : "Completar precios"}
                      </button>
                    </div>
                  ) : (
                    <section className="cc-pending-editor">
                      <div className="cc-pending-items">
                        {detalle?.items.map((item, index) => {
                          const costo = Number(costos[item.id] || 0);
                          const totalItem =
                            Math.round(item.cantidad * costo * 100) / 100;

                          return (
                            <article
                              key={item.id}
                              className="cc-pending-item"
                            >
                              <div className="cc-pending-item-title">
                                <strong>
                                  {index + 1}. {item.descripcion}
                                </strong>
                                <span>
                                  {item.cantidad} {item.unidad}
                                </span>
                              </div>

                              <label>
                                Costo unitario *
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={costos[item.id] || ""}
                                  onChange={(event) =>
                                    setCostos((actuales) => ({
                                      ...actuales,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="Ej: 4500"
                                  disabled={estaGuardando}
                                />
                              </label>

                              <div className="cc-pending-item-total">
                                <span>Total del ítem</span>
                                <strong>{formatearPesos(totalItem)}</strong>
                              </div>
                            </article>
                          );
                        })}
                      </div>

                      <div className="cc-pending-total">
                        <span>Total del remito</span>
                        <strong>{formatearPesos(totalCalculado)}</strong>
                      </div>

                      <div className="cc-pending-editor-actions">
                        <button
                          className="cc-primary-button"
                          type="button"
                          onClick={() => confirmarImporte(movimiento)}
                          disabled={
                            estaGuardando || !todosLosCostosCompletos
                          }
                        >
                          {estaGuardando
                            ? "Confirmando..."
                            : "Confirmar importe"}
                        </button>

                        <button
                          className="cc-soft-button"
                          type="button"
                          onClick={cancelarEdicion}
                          disabled={estaGuardando}
                        >
                          Cancelar
                        </button>
                      </div>
                    </section>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

