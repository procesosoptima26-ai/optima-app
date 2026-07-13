import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import BarcodeScanner from "../../components/BarcodeScanner";
import "./Movimientos.css";

type UsuarioSesion = {
  usuario: string;
  nombre: string;
  empresa: string;
  rol: string;
  sucursal: string;
  modulos: string[];
};

type Props = {
  usuario: UsuarioSesion;
};

type ModoMovimiento = "recepcion" | "reposicion" | "individual";

type Producto = {
  id: string;
  codigo: string;
  codigoNormalizado: string;
  nombre: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
};

type Ubicacion = {
  id: string;
  nombre: string;
  sucursal: string;
  tipoUbicacion: string;
  activa: boolean;
};

type LoteStock = {
  id: string;
  productoId: string;
  ubicacionId: string;
  ubicacionNombre: string;
  vencimiento: string | null;
  cantidad: number;
};

type RespuestaProducto = {
  ok?: boolean;
  encontrado?: boolean;
  producto?: Producto | null;
  error?: string;
};

type RespuestaUbicaciones = {
  ok?: boolean;
  sucursal?: string;
  ubicaciones?: Ubicacion[];
  error?: string;
};

type RespuestaStock = {
  ok?: boolean;
  cantidadTotal?: number;
  cantidadVencimientoSeleccionado?: number;
  loteSeleccionado?: LoteStock | null;
  loteAnterior?: LoteStock | null;
  vencimientoMasProximo?: LoteStock | null;
  alertaFefo?: boolean;
  lotes?: LoteStock[];
  error?: string;
};

type MovimientoPendiente = {
  idLocal: number;
  productoId: string;
  codigo: string;
  nombreProducto: string;
  tipoMovimiento: string;
  motivo: string;
  ubicacionOrigenId: string;
  ubicacionOrigenNombre: string;
  ubicacionDestinoId: string;
  ubicacionDestinoNombre: string;
  vencimiento: string | null;
  cantidad: number;
  observacion: string;
  alerta?: string;
};

type MovimientoProcesado = {
  id: string;
  fechaHora: string;
  nombreProducto: string;
  tipoMovimiento: string;
  motivo: string;
  vencimiento: string | null;
  cantidad: number;
  responsable: string;
  observacion: string;
  procesado: boolean;
  errorMotor: string;
};

type RespuestaMovimientos = {
  ok?: boolean;
  cantidad?: number;
  ids?: string[];
  movimientos?: MovimientoProcesado[];
  error?: string;
};

type Aviso = {
  tipo: "info" | "exito" | "error" | "alerta";
  texto: string;
};

const motivosIngreso = [
  "COMPRA",
  "DEVOLUCIÓN",
  "OTRO INGRESO",
];

const motivosEgreso = [
  "VENTA",
  "ROTURA EN GÓNDOLA",
  "ROTURA EN DEPÓSITO",
  "MAL ESTADO EN GÓNDOLA",
  "MAL ESTADO EN DEPÓSITO",
  "VENCIMIENTO EN GÓNDOLA",
  "VENCIMIENTO EN DEPÓSITO",
  "OTRO EGRESO",
];

const tiposIndividuales = [
  "INGRESO",
  "EGRESO",
  "AJUSTE +",
  "AJUSTE -",
];

function fechaHoy() {
  return new Date().toISOString().slice(0, 10);
}

function formatearFecha(fecha: string | null) {
  if (!fecha) return "Sin vencimiento";

  const partes = fecha.split("-");

  if (partes.length !== 3) return fecha;

  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function esperar(milisegundos: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milisegundos);
  });
}

export default function Movimientos({ usuario }: Props) {
  const codigoInputRef = useRef<HTMLInputElement | null>(null);

  const [modo, setModo] = useState<ModoMovimiento>("recepcion");
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [cargandoUbicaciones, setCargandoUbicaciones] = useState(false);

  const [codigo, setCodigo] = useState("");
  const [producto, setProducto] = useState<Producto | null>(null);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [scannerAbierto, setScannerAbierto] = useState(false);

  const [tipoIndividual, setTipoIndividual] = useState("EGRESO");
  const [motivoIndividual, setMotivoIndividual] = useState("VENTA");

  const [ubicacionOrigenId, setUbicacionOrigenId] = useState("");
  const [ubicacionDestinoId, setUbicacionDestinoId] = useState("");

  const [sinVencimiento, setSinVencimiento] = useState(false);
  const [vencimiento, setVencimiento] = useState(fechaHoy());
  const [cantidad, setCantidad] = useState("");
  const [observacion, setObservacion] = useState("");

  const [lista, setLista] = useState<MovimientoPendiente[]>([]);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [resultado, setResultado] = useState<MovimientoProcesado[]>([]);
  const [historial, setHistorial] = useState<MovimientoProcesado[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const ubicacionOrigen = useMemo(
    () =>
      ubicaciones.find(
        (ubicacion) => ubicacion.id === ubicacionOrigenId
      ) || null,
    [ubicaciones, ubicacionOrigenId]
  );

  const ubicacionDestino = useMemo(
    () =>
      ubicaciones.find(
        (ubicacion) => ubicacion.id === ubicacionDestinoId
      ) || null,
    [ubicaciones, ubicacionDestinoId]
  );

  const configuracionActual = useMemo(() => {
    if (modo === "recepcion") {
      return {
        tipoMovimiento: "INGRESO",
        motivo: "COMPRA",
        necesitaOrigen: false,
        necesitaDestino: true,
      };
    }

    if (modo === "reposicion") {
      return {
        tipoMovimiento: "EGRESO",
        motivo: "REPOSICIÓN",
        necesitaOrigen: true,
        necesitaDestino: true,
      };
    }

    return {
      tipoMovimiento: tipoIndividual,
      motivo: motivoIndividual,
      necesitaOrigen:
        tipoIndividual === "EGRESO" ||
        tipoIndividual === "AJUSTE -",
      necesitaDestino:
        tipoIndividual === "INGRESO" ||
        tipoIndividual === "AJUSTE +",
    };
  }, [modo, tipoIndividual, motivoIndividual]);

  const motivosIndividuales = useMemo(() => {
    if (
      tipoIndividual === "INGRESO" ||
      tipoIndividual === "AJUSTE +"
    ) {
      return motivosIngreso;
    }

    return motivosEgreso;
  }, [tipoIndividual]);

  useEffect(() => {
    cargarUbicaciones();
    cargarHistorial();
  }, [usuario.sucursal]);

  useEffect(() => {
    if (!motivosIndividuales.includes(motivoIndividual)) {
      setMotivoIndividual(motivosIndividuales[0]);
    }
  }, [motivosIndividuales, motivoIndividual]);

  useEffect(() => {
    setProducto(null);
    setCodigo("");
    setCantidad("");
    setObservacion("");
    setSinVencimiento(false);
    setVencimiento(fechaHoy());
    setAviso(null);

    if (modo === "recepcion") {
      setUbicacionOrigenId("");
    }

    if (modo === "individual") {
      setUbicacionOrigenId("");
      setUbicacionDestinoId("");
    }
  }, [modo]);

  async function cargarUbicaciones() {
    try {
      setCargandoUbicaciones(true);

      const response = await fetch(
        `/api/ubicaciones?sucursal=${encodeURIComponent(
          usuario.sucursal
        )}`
      );

      const data =
        (await response.json()) as RespuestaUbicaciones;

      if (!response.ok || !data.ok || !data.ubicaciones) {
        throw new Error(
          data.error || "No se pudieron cargar las ubicaciones"
        );
      }

      setUbicaciones(data.ubicaciones);

      const galponODeposito =
        data.ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "GALPÓN"
        ) ||
        data.ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "DEPÓSITO"
        );

      const gondola = data.ubicaciones.find(
        (ubicacion) => ubicacion.tipoUbicacion === "GÓNDOLA"
      );

      if (galponODeposito) {
        setUbicacionOrigenId(galponODeposito.id);
        setUbicacionDestinoId(galponODeposito.id);
      }

      if (modo === "reposicion" && gondola) {
        setUbicacionDestinoId(gondola.id);
      }
    } catch (error) {
      console.error("Error cargando ubicaciones:", error);

      setAviso({
        tipo: "error",
        texto: "No se pudieron cargar las ubicaciones de tu sucursal.",
      });
    } finally {
      setCargandoUbicaciones(false);
    }
  }

  async function cargarHistorial() {
    try {
      setCargandoHistorial(true);

      const response = await fetch(
        `/api/movimientos?sucursal=${encodeURIComponent(
          usuario.sucursal
        )}&limite=15`
      );

      const data =
        (await response.json()) as RespuestaMovimientos;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || "No se pudo cargar el historial"
        );
      }

      setHistorial(data.movimientos || []);
    } catch (error) {
      console.error("Error cargando historial:", error);
    } finally {
      setCargandoHistorial(false);
    }
  }

  async function buscarProducto(codigoIngresado: string) {
    const codigoLimpio = codigoIngresado.trim();

    if (!codigoLimpio) {
      setProducto(null);
      return;
    }

    try {
      setBuscandoProducto(true);
      setAviso(null);
      setProducto(null);

      const response = await fetch(
        `/api/productos-movimientos?codigo=${encodeURIComponent(
          codigoLimpio
        )}`
      );

      const data = (await response.json()) as RespuestaProducto;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || "No se pudo buscar el producto"
        );
      }

      if (!data.encontrado || !data.producto) {
        setAviso({
          tipo: "error",
          texto:
            "El producto no existe en PRODUCTOS. Primero debe cargarse desde Inventario.",
        });

        return;
      }

      setProducto(data.producto);
      setCodigo(codigoLimpio);

      setAviso({
        tipo: "exito",
        texto: "Producto encontrado.",
      });
    } catch (error) {
      console.error("Error buscando producto:", error);

      setAviso({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudo buscar el producto.",
      });
    } finally {
      setBuscandoProducto(false);
    }
  }

  function manejarEnterCodigo(
    event: KeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Enter") {
      buscarProducto(codigo);
    }
  }

  function validarFormularioActual() {
    if (!producto) {
      return "Escaneá o buscá un producto.";
    }

    if (
      configuracionActual.necesitaOrigen &&
      !ubicacionOrigenId
    ) {
      return "Seleccioná la ubicación de origen.";
    }

    if (
      configuracionActual.necesitaDestino &&
      !ubicacionDestinoId
    ) {
      return "Seleccioná la ubicación de destino.";
    }

    if (
      ubicacionOrigenId &&
      ubicacionDestinoId &&
      ubicacionOrigenId === ubicacionDestinoId &&
      modo === "reposicion"
    ) {
      return "El origen y el destino no pueden ser iguales.";
    }

    const cantidadNumero = Number(cantidad);

    if (!Number.isFinite(cantidadNumero) || cantidadNumero <= 0) {
      return "La cantidad debe ser mayor que cero.";
    }

    if (!sinVencimiento && !vencimiento) {
      return "Indicá el vencimiento o marcá Sin vencimiento.";
    }

    return "";
  }

  async function validarStockYFefo() {
    if (!producto || !ubicacionOrigenId) {
      return {
        error: "",
        alerta: "",
      };
    }

    if (
      modo !== "reposicion" &&
      configuracionActual.tipoMovimiento !== "EGRESO" &&
      configuracionActual.tipoMovimiento !== "AJUSTE -"
    ) {
      return {
        error: "",
        alerta: "",
      };
    }

    const fechaSeleccionada = sinVencimiento
      ? ""
      : vencimiento;

    const params = new URLSearchParams({
      productoId: producto.id,
      ubicacionId: ubicacionOrigenId,
    });

    if (fechaSeleccionada) {
      params.set("vencimiento", fechaSeleccionada);
    }

    const response = await fetch(
      `/api/stock-lotes?${params.toString()}`
    );

    const data = (await response.json()) as RespuestaStock;

    if (!response.ok || !data.ok) {
      return {
        error:
          data.error || "No se pudo consultar el stock disponible.",
        alerta: "",
      };
    }

    const lotes = data.lotes || [];

    const loteSeleccionado = sinVencimiento
      ? lotes.find((lote) => lote.vencimiento === null) || null
      : data.loteSeleccionado || null;

    const cantidadDisponible =
      loteSeleccionado?.cantidad || 0;

    if (Number(cantidad) > cantidadDisponible) {
      return {
        error:
          `Stock insuficiente. Disponible para ese lote: ` +
          `${cantidadDisponible}.`,
        alerta: "",
      };
    }

    if (data.alertaFefo && data.loteAnterior) {
      return {
        error: "",
        alerta:
          `FEFO: existe una fecha anterior: ` +
          `${formatearFecha(data.loteAnterior.vencimiento)} ` +
          `con ${data.loteAnterior.cantidad} unidades.`,
      };
    }

    return {
      error: "",
      alerta: "",
    };
  }

  async function agregarALista() {
    const errorFormulario = validarFormularioActual();

    if (errorFormulario) {
      setAviso({
        tipo: "error",
        texto: errorFormulario,
      });

      return;
    }

    setAviso({
      tipo: "info",
      texto: "Validando stock...",
    });

    const validacionStock = await validarStockYFefo();

    if (validacionStock.error) {
      setAviso({
        tipo: "error",
        texto: validacionStock.error,
      });

      return;
    }

    const movimiento: MovimientoPendiente = {
      idLocal: Date.now() + Math.floor(Math.random() * 10000),
      productoId: producto!.id,
      codigo: producto!.codigo,
      nombreProducto: producto!.nombre,
      tipoMovimiento:
        configuracionActual.tipoMovimiento,
      motivo: configuracionActual.motivo,
      ubicacionOrigenId:
        configuracionActual.necesitaOrigen
          ? ubicacionOrigenId
          : "",
      ubicacionOrigenNombre:
        configuracionActual.necesitaOrigen
          ? ubicacionOrigen?.nombre || ""
          : "",
      ubicacionDestinoId:
        configuracionActual.necesitaDestino
          ? ubicacionDestinoId
          : "",
      ubicacionDestinoNombre:
        configuracionActual.necesitaDestino
          ? ubicacionDestino?.nombre || ""
          : "",
      vencimiento: sinVencimiento ? null : vencimiento,
      cantidad: Number(cantidad),
      observacion: observacion.trim(),
      alerta: validacionStock.alerta,
    };

    setLista((actual) => [...actual, movimiento]);

    setAviso({
      tipo: validacionStock.alerta ? "alerta" : "exito",
      texto:
        validacionStock.alerta ||
        "Movimiento agregado a la lista.",
    });

    limpiarProductoActual();
  }

  function limpiarProductoActual() {
    setCodigo("");
    setProducto(null);
    setCantidad("");
    setObservacion("");
    setSinVencimiento(false);
    setVencimiento(fechaHoy());

    window.setTimeout(() => {
      codigoInputRef.current?.focus();
    }, 100);
  }

  function eliminarDeLista(idLocal: number) {
    setLista((actual) =>
      actual.filter((item) => item.idLocal !== idLocal)
    );
  }

  async function consultarProcesamiento(ids: string[]) {
    let ultimaRespuesta: MovimientoProcesado[] = [];

    for (let intento = 0; intento < 12; intento += 1) {
      await esperar(1500);

      const response = await fetch(
        `/api/movimientos?ids=${encodeURIComponent(
          ids.join(",")
        )}`
      );

      const data =
        (await response.json()) as RespuestaMovimientos;

      if (!response.ok || !data.ok) {
        continue;
      }

      ultimaRespuesta = data.movimientos || [];

      const terminados = ultimaRespuesta.filter(
        (movimiento) =>
          movimiento.procesado ||
          Boolean(movimiento.errorMotor)
      );

      if (terminados.length === ids.length) {
        break;
      }
    }

    return ultimaRespuesta;
  }

  async function guardarLista() {
    if (lista.length === 0) {
      setAviso({
        tipo: "error",
        texto: "No hay movimientos agregados.",
      });

      return;
    }

    try {
      setGuardando(true);
      setResultado([]);

      setAviso({
        tipo: "info",
        texto: `Guardando ${lista.length} movimientos...`,
      });

      const response = await fetch("/api/movimientos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sucursal: usuario.sucursal,
          movimientos: lista.map((movimiento) => ({
            productoId: movimiento.productoId,
            tipoMovimiento:
              movimiento.tipoMovimiento,
            motivo: movimiento.motivo,
            ubicacionOrigenId:
              movimiento.ubicacionOrigenId || undefined,
            ubicacionDestinoId:
              movimiento.ubicacionDestinoId || undefined,
            vencimiento: movimiento.vencimiento,
            cantidad: movimiento.cantidad,
            responsable: usuario.nombre,
            observacion: movimiento.observacion,
          })),
        }),
      });

      const data =
        (await response.json()) as RespuestaMovimientos;

      if (!response.ok || !data.ok || !data.ids) {
        throw new Error(
          data.error || "No se pudieron guardar los movimientos"
        );
      }

      setAviso({
        tipo: "info",
        texto:
          "Movimientos guardados. Esperando el procesamiento del motor...",
      });

      const estados = await consultarProcesamiento(data.ids);

      setResultado(estados);

      const procesados = estados.filter(
        (movimiento) => movimiento.procesado
      ).length;

      const errores = estados.filter(
        (movimiento) => Boolean(movimiento.errorMotor)
      ).length;

      const pendientes =
        data.ids.length - procesados - errores;

      if (errores > 0) {
        setAviso({
          tipo: "error",
          texto:
            `Procesados: ${procesados}. ` +
            `Con error: ${errores}. ` +
            `Pendientes: ${pendientes}.`,
        });
      } else if (pendientes > 0) {
        setAviso({
          tipo: "alerta",
          texto:
            `Procesados: ${procesados}. ` +
            `Todavía pendientes: ${pendientes}.`,
        });
      } else {
        setAviso({
          tipo: "exito",
          texto: `${procesados} movimientos procesados correctamente.`,
        });

        setLista([]);
      }

      await cargarHistorial();
    } catch (error) {
      console.error("Error guardando movimientos:", error);

      setAviso({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudieron guardar los movimientos.",
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="mov-module">
      <div className="mov-title-row">
        <div>
          <p className="module-label mov-module-label">
            MÓDULO
          </p>
          <h2>Movimientos</h2>
          <span>
            {usuario.sucursal} · {usuario.nombre}
          </span>
        </div>

        <button
          className="mov-refresh-button"
          type="button"
          onClick={cargarHistorial}
          disabled={cargandoHistorial}
        >
          {cargandoHistorial ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      <div className="mov-mode-grid">
        <button
          type="button"
          className={
            modo === "recepcion"
              ? "mov-mode-button mov-mode-active"
              : "mov-mode-button"
          }
          onClick={() => setModo("recepcion")}
        >
          Recepción
        </button>

        <button
          type="button"
          className={
            modo === "reposicion"
              ? "mov-mode-button mov-mode-active"
              : "mov-mode-button"
          }
          onClick={() => setModo("reposicion")}
        >
          Reposición
        </button>

        <button
          type="button"
          className={
            modo === "individual"
              ? "mov-mode-button mov-mode-active"
              : "mov-mode-button"
          }
          onClick={() => setModo("individual")}
        >
          Individual
        </button>
      </div>

      <section className="mov-card">
        <div className="mov-operation-summary">
          <span>Operación actual</span>
          <strong>
            {configuracionActual.tipoMovimiento} ·{" "}
            {configuracionActual.motivo}
          </strong>
        </div>

        {modo === "individual" && (
          <div className="mov-two-columns">
            <label className="mov-field">
              Tipo de movimiento
              <select
                value={tipoIndividual}
                onChange={(event) =>
                  setTipoIndividual(event.target.value)
                }
                disabled={guardando}
              >
                {tiposIndividuales.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {tipo}
                  </option>
                ))}
              </select>
            </label>

            <label className="mov-field">
              Motivo
              <select
                value={motivoIndividual}
                onChange={(event) =>
                  setMotivoIndividual(event.target.value)
                }
                disabled={guardando}
              >
                {motivosIndividuales.map((motivo) => (
                  <option key={motivo} value={motivo}>
                    {motivo}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="mov-two-columns">
          {configuracionActual.necesitaOrigen && (
            <label className="mov-field">
              Ubicación origen
              <select
                value={ubicacionOrigenId}
                onChange={(event) =>
                  setUbicacionOrigenId(event.target.value)
                }
                disabled={
                  cargandoUbicaciones || guardando
                }
              >
                <option value="">Seleccionar</option>

                {ubicaciones.map((ubicacion) => (
                  <option
                    key={ubicacion.id}
                    value={ubicacion.id}
                  >
                    {ubicacion.tipoUbicacion}
                  </option>
                ))}
              </select>
            </label>
          )}

          {configuracionActual.necesitaDestino && (
            <label className="mov-field">
              Ubicación destino
              <select
                value={ubicacionDestinoId}
                onChange={(event) =>
                  setUbicacionDestinoId(event.target.value)
                }
                disabled={
                  cargandoUbicaciones || guardando
                }
              >
                <option value="">Seleccionar</option>

                {ubicaciones.map((ubicacion) => (
                  <option
                    key={ubicacion.id}
                    value={ubicacion.id}
                  >
                    {ubicacion.tipoUbicacion}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <label className="mov-field">
          Código
          <div className="mov-code-row">
            <input
              ref={codigoInputRef}
              value={codigo}
              onChange={(event) => {
                setCodigo(event.target.value);
                setProducto(null);
              }}
              onBlur={() => {
                if (codigo.trim() && !producto) {
                  buscarProducto(codigo);
                }
              }}
              onKeyDown={manejarEnterCodigo}
              placeholder="Escaneá o escribí el código"
              inputMode="numeric"
              disabled={guardando || buscandoProducto}
            />

            <button
              type="button"
              className="mov-camera-button"
              onClick={() => setScannerAbierto(true)}
              disabled={guardando}
              aria-label="Abrir cámara"
            >
              📷
            </button>
          </div>
        </label>

        {buscandoProducto && (
          <div className="mov-product-searching">
            Buscando producto...
          </div>
        )}

        {producto && (
          <div className="mov-product-found">
            <div className="mov-product-check">✓</div>

            <div>
              <span>Producto encontrado</span>
              <strong>{producto.nombre}</strong>
              <small>Código: {producto.codigo}</small>
            </div>
          </div>
        )}

        <div className="mov-date-title-row">
          <strong>Vencimiento</strong>

          <button
            type="button"
            className={
              sinVencimiento
                ? "mov-no-expiry mov-no-expiry-active"
                : "mov-no-expiry"
            }
            onClick={() =>
              setSinVencimiento(!sinVencimiento)
            }
            disabled={guardando}
          >
            {sinVencimiento
              ? "Sin vencimiento ✓"
              : "Sin vencimiento"}
          </button>
        </div>

        <div
          className={
            sinVencimiento
              ? "mov-two-columns mov-only-quantity"
              : "mov-two-columns"
          }
        >
          {!sinVencimiento && (
            <label className="mov-field">
              Fecha
              <input
                type="date"
                value={vencimiento}
                onChange={(event) =>
                  setVencimiento(event.target.value)
                }
                disabled={guardando}
              />
            </label>
          )}

          <label className="mov-field">
            Cantidad
            <input
              type="number"
              min="0"
              step="0.01"
              value={cantidad}
              onChange={(event) =>
                setCantidad(event.target.value)
              }
              placeholder="Ej: 12"
              disabled={guardando}
            />
          </label>
        </div>

        <label className="mov-field">
          Observación
          <input
            type="text"
            value={observacion}
            onChange={(event) =>
              setObservacion(event.target.value)
            }
            placeholder="Opcional"
            disabled={guardando}
          />
        </label>

        <button
          type="button"
          className="mov-add-button"
          onClick={agregarALista}
          disabled={guardando || buscandoProducto}
        >
          + Agregar a la carga
        </button>

        {aviso && (
          <div
            className={`mov-message mov-message-${aviso.tipo}`}
          >
            {aviso.texto}
          </div>
        )}
      </section>

      <section className="mov-card">
        <div className="mov-section-header">
          <div>
            <span>Carga actual</span>
            <h3>{lista.length} movimientos</h3>
          </div>

          {lista.length > 0 && (
            <button
              type="button"
              className="mov-clear-list-button"
              onClick={() => setLista([])}
              disabled={guardando}
            >
              Vaciar
            </button>
          )}
        </div>

        {lista.length === 0 ? (
          <div className="mov-empty">
            Todavía no agregaste movimientos.
          </div>
        ) : (
          <div className="mov-list">
            {lista.map((item, index) => (
              <article
                key={item.idLocal}
                className="mov-list-item"
              >
                <div className="mov-list-number">
                  {index + 1}
                </div>

                <div className="mov-list-content">
                  <strong>{item.nombreProducto}</strong>

                  <span>
                    {item.tipoMovimiento} · {item.motivo}
                  </span>

                  {item.ubicacionOrigenNombre && (
                    <p>
                      Origen: {item.ubicacionOrigenNombre}
                    </p>
                  )}

                  {item.ubicacionDestinoNombre && (
                    <p>
                      Destino: {item.ubicacionDestinoNombre}
                    </p>
                  )}

                  <p>
                    {formatearFecha(item.vencimiento)} ·{" "}
                    {item.cantidad} unidades
                  </p>

                  {item.alerta && (
                    <div className="mov-inline-alert">
                      {item.alerta}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="mov-delete-button"
                  onClick={() =>
                    eliminarDeLista(item.idLocal)
                  }
                  disabled={guardando}
                >
                  Quitar
                </button>
              </article>
            ))}
          </div>
        )}

        <button
          type="button"
          className="mov-save-button"
          onClick={guardarLista}
          disabled={guardando || lista.length === 0}
        >
          {guardando
            ? "Procesando movimientos..."
            : `Guardar carga (${lista.length})`}
        </button>
      </section>

      {resultado.length > 0 && (
        <section className="mov-card">
          <div className="mov-section-header">
            <div>
              <span>Resultado</span>
              <h3>Procesamiento del motor</h3>
            </div>
          </div>

          <div className="mov-results">
            {resultado.map((movimiento) => (
              <article
                key={movimiento.id}
                className={
                  movimiento.procesado
                    ? "mov-result-item mov-result-ok"
                    : movimiento.errorMotor
                    ? "mov-result-item mov-result-error"
                    : "mov-result-item mov-result-pending"
                }
              >
                <div>
                  <strong>
                    {movimiento.nombreProducto ||
                      "Producto"}
                  </strong>

                  <p>
                    {movimiento.motivo} ·{" "}
                    {movimiento.cantidad} unidades
                  </p>

                  {movimiento.errorMotor && (
                    <small>
                      {movimiento.errorMotor}
                    </small>
                  )}
                </div>

                <span>
                  {movimiento.procesado
                    ? "Procesado"
                    : movimiento.errorMotor
                    ? "Error"
                    : "Pendiente"}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="mov-card">
        <div className="mov-section-header">
          <div>
            <span>Control</span>
            <h3>Movimientos recientes</h3>
          </div>
        </div>

        {cargandoHistorial ? (
          <div className="mov-empty">
            Cargando historial...
          </div>
        ) : historial.length === 0 ? (
          <div className="mov-empty">
            Todavía no hay movimientos registrados.
          </div>
        ) : (
          <div className="mov-history">
            {historial.map((movimiento) => (
              <article
                key={movimiento.id}
                className="mov-history-item"
              >
                <div>
                  <strong>
                    {movimiento.nombreProducto ||
                      "Producto"}
                  </strong>

                  <span>
                    {movimiento.tipoMovimiento} ·{" "}
                    {movimiento.motivo}
                  </span>

                  <p>
                    {formatearFecha(
                      movimiento.vencimiento
                    )}{" "}
                    · {movimiento.cantidad} unidades
                  </p>

                  {movimiento.errorMotor && (
                    <small>
                      {movimiento.errorMotor}
                    </small>
                  )}
                </div>

                <div
                  className={
                    movimiento.procesado
                      ? "mov-status mov-status-ok"
                      : movimiento.errorMotor
                      ? "mov-status mov-status-error"
                      : "mov-status mov-status-pending"
                  }
                >
                  {movimiento.procesado
                    ? "OK"
                    : movimiento.errorMotor
                    ? "ERROR"
                    : "PENDIENTE"}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {scannerAbierto && (
        <BarcodeScanner
          onScanSuccess={(codigoEscaneado) => {
            setCodigo(codigoEscaneado);
            buscarProducto(codigoEscaneado);
            setScannerAbierto(false);
          }}
          onClose={() => setScannerAbierto(false)}
        />
      )}
    </section>
  );
}
