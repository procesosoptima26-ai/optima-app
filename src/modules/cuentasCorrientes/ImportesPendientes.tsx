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

type Props = {
  usuario: UsuarioSesion;
};

type Mensaje =
  | {
      tipo: "info" | "exito" | "error";
      texto: string;
    }
  | null;

function formatearFecha(fecha: string) {
  if (!fecha) return "Sin fecha";

  const match = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (match) {
    return fecha;
  }

  const iso = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  return fecha;
}

function convertirFechaParaInput(fecha: string) {
  if (!fecha) return new Date().toISOString().slice(0, 10);

  const match = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
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
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [importe, setImporte] = useState("");
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

  function comenzarEdicion(movimiento: MovimientoPendiente) {
    if (!puedeEditar) return;

    setEditandoId(movimiento.id);
    setImporte("");
    setMensaje(null);
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setImporte("");
  }

  async function completarImporte(movimiento: MovimientoPendiente) {
    if (!puedeEditar) return;

    const importeNumerico = Number(importe);

    if (!importe.trim() || Number.isNaN(importeNumerico) || importeNumerico <= 0) {
      setMensaje({
        tipo: "error",
        texto: "Ingresá un importe mayor a cero.",
      });
      return;
    }

    try {
      setGuardandoId(movimiento.id);
      setMensaje({
        tipo: "info",
        texto: "Actualizando importe...",
      });

      const response = await fetch("/api/movimientos-cc", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: movimiento.id,
          fecha: convertirFechaParaInput(movimiento.fecha),
          comprobante: movimiento.comprobante,
          medioPago: "",
          datosPago: "",
          importe: importeNumerico,
          observacion: movimiento.observacion,
          responsable: movimiento.responsable,
        }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo actualizar el importe");
      }

      setPendientes((actuales) =>
        actuales.filter((item) => item.id !== movimiento.id)
      );
      setEditandoId(null);
      setImporte("");
      setMensaje({
        tipo: "exito",
        texto: "Importe completado correctamente.",
      });
    } catch (error) {
      console.error("Error completando importe:", error);
      setMensaje({
        tipo: "error",
        texto: "No se pudo completar el importe.",
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
          <p>Movimientos cargados sin importe.</p>
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

              return (
                <article key={movimiento.id} className="cc-movement-card">
                  <div>
                    <span>{formatearFecha(movimiento.fecha)}</span>
                    <h4>{cliente || "Cliente sin identificar"}</h4>
                    <p>
                      {movimiento.comprobante || "Remito sin número"}
                    </p>
                    {movimiento.observacion && (
                      <p>{movimiento.observacion}</p>
                    )}
                    {movimiento.responsable && (
                      <p>Responsable: {movimiento.responsable}</p>
                    )}
                  </div>

                  <div>
                    <strong className="cc-amount-positive">
                      Importe pendiente
                    </strong>

                    {!estaEditando ? (
                      <button
                        className="cc-primary-button"
                        type="button"
                        onClick={() => comenzarEdicion(movimiento)}
                        style={{ marginTop: "10px" }}
                      >
                        Completar importe
                      </button>
                    ) : (
                      <div style={{ marginTop: "10px" }}>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={importe}
                          onChange={(event) => setImporte(event.target.value)}
                          placeholder="Ej: 125000"
                          autoFocus
                          disabled={estaGuardando}
                        />

                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            marginTop: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            className="cc-primary-button"
                            type="button"
                            onClick={() => completarImporte(movimiento)}
                            disabled={estaGuardando}
                          >
                            {estaGuardando ? "Guardando..." : "Guardar"}
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
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
