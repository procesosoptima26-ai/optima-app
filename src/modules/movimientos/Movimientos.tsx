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
  creado?: boolean;
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
  lotes?: LoteStock[];
  error?: string;
};

type MovimientoPendiente = {
  idLocal: number;
  grupoRecepcionId?: number;
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
  ids?: string[];
  movimientos?: MovimientoProcesado[];
  error?: string;
};

type Aviso = {
  tipo: "info" | "exito" | "error" | "alerta";
  texto: string;
};

type DistribucionRecepcion = {
  idLocal: number;
  ubicacionId: string;
  cantidad: string;
};

type LoteRecepcion = {
  idLocal: number;
  sinVencimiento: boolean;
  vencimientoTexto: string;
  distribuciones: DistribucionRecepcion[];
};

type NuevoProducto = {
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
};

const tiposAjustes = ["INGRESO", "EGRESO", "AJUSTE +", "AJUSTE -"];

const motivosAjustes = [
  "TRANSFERENCIA",
  "VUELVE A DEPÓSITO",
  "DEVOLUCIÓN",
  "ROTURA",
  "MAL ESTADO",
  "VENCIDO",
  "VENTA",
];

const origenesReposicionPermitidos = new Set([
  "GALPÓN",
  "DEPÓSITO",
  "CÁMARA",
]);

function crearDistribucion(ubicacionId = ""): DistribucionRecepcion {
  return {
    idLocal: Date.now() + Math.floor(Math.random() * 100000),
    ubicacionId,
    cantidad: "",
  };
}

function crearLoteRecepcion(ubicacionId = ""): LoteRecepcion {
  return {
    idLocal: Date.now() + Math.floor(Math.random() * 100000),
    sinVencimiento: false,
    vencimientoTexto: "",
    distribuciones: [crearDistribucion(ubicacionId)],
  };
}

function formatearFecha(fecha: string | null) {
  if (!fecha) return "Sin vencimiento";

  const partes = fecha.split("-");
  if (partes.length !== 3) return fecha;

  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function normalizarFechaManual(valor: string): {
  fecha: string | null;
  error: string;
} {
  const limpio = valor.trim();

  if (!limpio) {
    return { fecha: null, error: "Ingresá una fecha." };
  }

  const partes = limpio.split(/[/-]/).map((parte) => parte.trim());

  if (partes.length !== 2 && partes.length !== 3) {
    return {
      fecha: null,
      error: "Usá día/mes, mes/año o día/mes/año.",
    };
  }

  const hoy = new Date();
  let dia: number;
  let mes: number;
  let anio: number;

  if (partes.length === 2) {
    const primero = Number(partes[0]);
    const segundo = Number(partes[1]);

    if (!Number.isInteger(primero) || !Number.isInteger(segundo)) {
      return { fecha: null, error: "La fecha no es válida." };
    }

    const segundoPareceAnio =
      (partes[1].length === 2 || partes[1].length === 4) &&
      segundo > 12;

    if (segundoPareceAnio) {
      mes = primero;
      anio = partes[1].length === 2 ? 2000 + segundo : segundo;
      dia = new Date(anio, mes, 0).getDate();
    } else {
      dia = primero;
      mes = segundo;
      anio = hoy.getFullYear();
    }
  } else {
    dia = Number(partes[0]);
    mes = Number(partes[1]);

    const anioIngresado = Number(partes[2]);

    if (!Number.isInteger(anioIngresado)) {
      return { fecha: null, error: "El año no es válido." };
    }

    anio =
      partes[2].length === 2
        ? 2000 + anioIngresado
        : anioIngresado;
  }

  if (
    !Number.isInteger(dia) ||
    !Number.isInteger(mes) ||
    !Number.isInteger(anio)
  ) {
    return { fecha: null, error: "La fecha no es válida." };
  }

  const fechaValidacion = new Date(anio, mes - 1, dia);

  const esValida =
    fechaValidacion.getFullYear() === anio &&
    fechaValidacion.getMonth() === mes - 1 &&
    fechaValidacion.getDate() === dia;

  if (!esValida) {
    return { fecha: null, error: "La fecha no existe." };
  }

  return {
    fecha: [
      String(anio).padStart(4, "0"),
      String(mes).padStart(2, "0"),
      String(dia).padStart(2, "0"),
    ].join("-"),
    error: "",
  };
}

function ordenarLotesFefo(lotes: LoteStock[]) {
  return [...lotes]
    .filter((lote) => lote.cantidad > 0)
    .sort((a, b) => {
      if (a.vencimiento === null && b.vencimiento === null) return 0;
      if (a.vencimiento === null) return 1;
      if (b.vencimiento === null) return -1;
      return a.vencimiento.localeCompare(b.vencimiento);
    });
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
  const [productoNoEncontrado, setProductoNoEncontrado] = useState(false);
  const [nuevoProducto, setNuevoProducto] = useState<NuevoProducto>({
    producto: "",
    marca: "",
    presentacion: "",
    especificacion: "",
  });
  const [creandoProducto, setCreandoProducto] = useState(false);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [scannerAbierto, setScannerAbierto] = useState(false);

  const [tipoIndividual, setTipoIndividual] = useState("EGRESO");
  const [motivoIndividual, setMotivoIndividual] = useState("VENTA");

  const [ubicacionOrigenId, setUbicacionOrigenId] = useState("");
  const [ubicacionDestinoId, setUbicacionDestinoId] = useState("");

  const [sinVencimiento, setSinVencimiento] = useState(false);
  const [vencimientoTexto, setVencimientoTexto] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [observacion, setObservacion] = useState("");

  const [lotesDisponibles, setLotesDisponibles] = useState<LoteStock[]>([]);
  const [loteSeleccionadoId, setLoteSeleccionadoId] = useState("");
  const [cantidadesPorLote, setCantidadesPorLote] = useState<
    Record<string, string>
  >({});
  const [cargandoLotes, setCargandoLotes] = useState(false);

  const [lotesRecepcion, setLotesRecepcion] = useState<
    LoteRecepcion[]
  >([crearLoteRecepcion()]);

  const [lista, setLista] = useState<MovimientoPendiente[]>([]);
  const [grupoRecepcionEditando, setGrupoRecepcionEditando] = useState<
    number | null
  >(null);
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

  const ubicacionesOrigenReposicion = useMemo(
    () =>
      ubicaciones.filter((ubicacion) =>
        origenesReposicionPermitidos.has(ubicacion.tipoUbicacion)
      ),
    [ubicaciones]
  );

  const ubicacionGondola = useMemo(
    () =>
      ubicaciones.find(
        (ubicacion) => ubicacion.tipoUbicacion === "GÓNDOLA"
      ) || null,
    [ubicaciones]
  );

  const totalDistribucion = useMemo(() => {
    return lotesRecepcion.reduce((totalGeneral, lote) => {
      const totalLote = lote.distribuciones.reduce(
        (subtotal, distribucion) => {
          const cantidadNumerica = Number(distribucion.cantidad);

          return Number.isFinite(cantidadNumerica)
            ? subtotal + cantidadNumerica
            : subtotal;
        },
        0
      );

      return totalGeneral + totalLote;
    }, 0);
  }, [lotesRecepcion]);

  const totalReposicion = useMemo(() => {
    return lotesDisponibles.reduce((total, lote) => {
      const valor = Number(cantidadesPorLote[lote.id] || 0);

      return Number.isFinite(valor) ? total + valor : total;
    }, 0);
  }, [lotesDisponibles, cantidadesPorLote]);

  const gruposCarga = useMemo(() => {
    const grupos = new Map<string, MovimientoPendiente[]>();

    lista.forEach((movimiento) => {
      const clave = movimiento.grupoRecepcionId
        ? `recepcion-${movimiento.grupoRecepcionId}`
        : `movimiento-${movimiento.idLocal}`;

      const movimientosDelGrupo = grupos.get(clave) || [];
      movimientosDelGrupo.push(movimiento);
      grupos.set(clave, movimientosDelGrupo);
    });

    return Array.from(grupos.entries()).map(([clave, movimientos]) => ({
      clave,
      movimientos,
    }));
  }, [lista]);

  const esTransferencia =
    modo === "individual" &&
    motivoIndividual === "TRANSFERENCIA";

  const esVuelveADeposito =
    modo === "individual" &&
    motivoIndividual === "VUELVE A DEPÓSITO";

  const esMovimientoNegativo =
    modo === "reposicion" ||
    esTransferencia ||
    (modo === "individual" &&
      (tipoIndividual === "EGRESO" ||
        tipoIndividual === "AJUSTE -"));

  const necesitaLoteExistente = esMovimientoNegativo;
  const necesitaFechaManual =
    modo === "recepcion" ||
    (modo === "individual" && !esMovimientoNegativo);

  const configuracionActual = useMemo(() => {
    if (modo === "recepcion") {
      return {
        tipoMovimiento: "INGRESO",
        motivo: "COMPRA",
        necesitaOrigen: false,
        necesitaDestino: false,
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

    if (esVuelveADeposito) {
      return {
        tipoMovimiento: "AJUSTE -",
        motivo: "VUELVE A DEPÓSITO",
        necesitaOrigen: true,
        necesitaDestino: true,
      };
    }

    return {
      tipoMovimiento: esTransferencia ? "EGRESO" : tipoIndividual,
      motivo: motivoIndividual,
      necesitaOrigen:
        esTransferencia ||
        tipoIndividual === "EGRESO" ||
        tipoIndividual === "AJUSTE -",
      necesitaDestino:
        !esTransferencia &&
        (tipoIndividual === "INGRESO" ||
          tipoIndividual === "AJUSTE +"),
    };
  }, [
    modo,
    tipoIndividual,
    motivoIndividual,
    esTransferencia,
    esVuelveADeposito,
  ]);

  const loteSeleccionado = useMemo(
    () =>
      lotesDisponibles.find(
        (lote) => lote.id === loteSeleccionadoId
      ) || null,
    [lotesDisponibles, loteSeleccionadoId]
  );

  useEffect(() => {
    cargarUbicaciones();
    cargarHistorial();
  }, [usuario.sucursal]);

  useEffect(() => {
    limpiarFormularioActual(false);

    if (modo === "recepcion") {
      const ubicacionPreferida =
        ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "GALPÓN"
        ) ||
        ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "DEPÓSITO"
        ) ||
        ubicaciones[0];

      setUbicacionOrigenId("");
      setUbicacionDestinoId("");
      setLotesRecepcion([
        crearLoteRecepcion(ubicacionPreferida?.id || ""),
      ]);
    }

    if (modo === "reposicion") {
      setUbicacionOrigenId(
        ubicacionesOrigenReposicion[0]?.id || ""
      );
      setUbicacionDestinoId(ubicacionGondola?.id || "");
    }

    if (modo === "individual") {
      setUbicacionOrigenId("");
      setUbicacionDestinoId("");
    }
  }, [
    modo,
    ubicaciones,
    ubicacionesOrigenReposicion,
    ubicacionGondola,
  ]);

  useEffect(() => {
    if (motivoIndividual === "TRANSFERENCIA") {
      setTipoIndividual("EGRESO");
      setUbicacionDestinoId("");
      return;
    }

    if (motivoIndividual === "VUELVE A DEPÓSITO") {
      setTipoIndividual("AJUSTE -");

      const gondola = ubicaciones.find(
        (ubicacion) => ubicacion.tipoUbicacion === "GÓNDOLA"
      );

      const destinoPreferido =
        ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "DEPÓSITO"
        ) ||
        ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "GALPÓN"
        ) ||
        ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "CÁMARA"
        );

      setUbicacionOrigenId(gondola?.id || "");
      setUbicacionDestinoId(destinoPreferido?.id || "");
    }
  }, [motivoIndividual, ubicaciones]);

  useEffect(() => {
    if (
      producto &&
      ubicacionOrigenId &&
      necesitaLoteExistente
    ) {
      cargarLotesDisponibles(producto.id, ubicacionOrigenId);
    } else {
      setLotesDisponibles([]);
      setLoteSeleccionadoId("");
      setCantidadesPorLote({});
    }
  }, [producto, ubicacionOrigenId, necesitaLoteExistente]);

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

  async function cargarLotesDisponibles(
    productoId: string,
    ubicacionId: string
  ) {
    try {
      setCargandoLotes(true);
      setLotesDisponibles([]);
      setLoteSeleccionadoId("");
      setCantidadesPorLote({});

      const params = new URLSearchParams({
        productoId,
        ubicacionId,
      });

      const response = await fetch(
        `/api/stock-lotes?${params.toString()}`
      );

      const data = (await response.json()) as RespuestaStock;

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || "No se pudieron consultar los lotes."
        );
      }

      const lotesOrdenados = ordenarLotesFefo(data.lotes || []);

      setLotesDisponibles(lotesOrdenados);

      if (lotesOrdenados.length > 0) {
        setLoteSeleccionadoId(lotesOrdenados[0].id);
      }
    } catch (error) {
      console.error("Error cargando lotes:", error);

      setAviso({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudieron consultar los lotes.",
      });
    } finally {
      setCargandoLotes(false);
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
      setProductoNoEncontrado(false);
      setLotesDisponibles([]);
      setLoteSeleccionadoId("");
      setCantidadesPorLote({});

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
        if (modo === "recepcion") {
          setProductoNoEncontrado(true);
          setAviso({
            tipo: "alerta",
            texto:
              "Producto no encontrado. Podés crearlo sin salir de la recepción.",
          });
        } else {
          setAviso({
            tipo: "error",
            texto:
              "El producto no existe. Debe crearse desde Recepción o Inventario.",
          });
        }

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

  async function crearProductoYContinuar() {
    if (!codigo.trim()) {
      setAviso({
        tipo: "error",
        texto: "Falta el código del producto.",
      });
      return;
    }

    if (!nuevoProducto.producto.trim()) {
      setAviso({
        tipo: "error",
        texto: "Ingresá el nombre del producto.",
      });
      return;
    }

    try {
      setCreandoProducto(true);

      const response = await fetch("/api/productos-movimientos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          codigo,
          ...nuevoProducto,
        }),
      });

      const data = (await response.json()) as RespuestaProducto;

      if (!response.ok || !data.ok || !data.producto) {
        throw new Error(
          data.error || "No se pudo crear el producto."
        );
      }

      setProducto(data.producto);
      setProductoNoEncontrado(false);
      setNuevoProducto({
        producto: "",
        marca: "",
        presentacion: "",
        especificacion: "",
      });

      setAviso({
        tipo: "exito",
        texto: "Producto creado. Ya podés continuar con la recepción.",
      });
    } catch (error) {
      setAviso({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudo crear el producto.",
      });
    } finally {
      setCreandoProducto(false);
    }
  }

  function manejarEnterCodigo(
    event: KeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Enter") {
      buscarProducto(codigo);
    }
  }

  function agregarLoteRecepcion() {
    const ubicacionPreferida =
      ubicaciones.find(
        (ubicacion) => ubicacion.tipoUbicacion === "GALPÓN"
      ) ||
      ubicaciones.find(
        (ubicacion) => ubicacion.tipoUbicacion === "DEPÓSITO"
      ) ||
      ubicaciones[0];

    setLotesRecepcion((actuales) => [
      ...actuales,
      crearLoteRecepcion(ubicacionPreferida?.id || ""),
    ]);
  }

  function actualizarLoteRecepcion(
    loteId: number,
    campo: "sinVencimiento" | "vencimientoTexto",
    valor: boolean | string
  ) {
    setLotesRecepcion((actuales) =>
      actuales.map((lote) =>
        lote.idLocal === loteId
          ? { ...lote, [campo]: valor }
          : lote
      )
    );
  }

  function quitarLoteRecepcion(loteId: number) {
    setLotesRecepcion((actuales) => {
      if (actuales.length === 1) {
        return actuales;
      }

      return actuales.filter((lote) => lote.idLocal !== loteId);
    });
  }

  function agregarDistribucion(loteId: number) {
    setLotesRecepcion((actuales) =>
      actuales.map((lote) => {
        if (lote.idLocal !== loteId) return lote;

        const ubicacionesUsadas = new Set(
          lote.distribuciones
            .map((distribucion) => distribucion.ubicacionId)
            .filter(Boolean)
        );

        const siguienteUbicacion = ubicaciones.find(
          (ubicacion) => !ubicacionesUsadas.has(ubicacion.id)
        );

        if (!siguienteUbicacion) {
          setAviso({
            tipo: "alerta",
            texto: "Ya agregaste todas las ubicaciones disponibles para este vencimiento.",
          });

          return lote;
        }

        return {
          ...lote,
          distribuciones: [
            ...lote.distribuciones,
            crearDistribucion(siguienteUbicacion.id),
          ],
        };
      })
    );
  }

  function actualizarDistribucion(
    loteId: number,
    distribucionId: number,
    campo: "ubicacionId" | "cantidad",
    valor: string
  ) {
    setLotesRecepcion((actuales) =>
      actuales.map((lote) =>
        lote.idLocal === loteId
          ? {
              ...lote,
              distribuciones: lote.distribuciones.map(
                (distribucion) =>
                  distribucion.idLocal === distribucionId
                    ? { ...distribucion, [campo]: valor }
                    : distribucion
              ),
            }
          : lote
      )
    );
  }

  function quitarDistribucion(
    loteId: number,
    distribucionId: number
  ) {
    setLotesRecepcion((actuales) =>
      actuales.map((lote) => {
        if (lote.idLocal !== loteId) return lote;

        if (lote.distribuciones.length === 1) {
          return {
            ...lote,
            distribuciones: [
              {
                ...lote.distribuciones[0],
                ubicacionId: "",
                cantidad: "",
              },
            ],
          };
        }

        return {
          ...lote,
          distribuciones: lote.distribuciones.filter(
            (distribucion) =>
              distribucion.idLocal !== distribucionId
          ),
        };
      })
    );
  }

  function obtenerVencimientoActual() {
    if (necesitaLoteExistente && modo !== "reposicion") {
      return {
        fecha: loteSeleccionado?.vencimiento ?? null,
        error: loteSeleccionado
          ? ""
          : "Seleccioná un lote disponible.",
      };
    }

    if (sinVencimiento) {
      return { fecha: null, error: "" };
    }

    return normalizarFechaManual(vencimientoTexto);
  }

  async function construirMovimientosActuales(): Promise<{
    movimientos: MovimientoPendiente[];
    error: string;
  }> {
    if (!producto) {
      return {
        movimientos: [],
        error: "Escaneá o buscá un producto.",
      };
    }

    if (modo === "recepcion") {
      if (lotesRecepcion.length === 0) {
        return {
          movimientos: [],
          error: "Agregá al menos un vencimiento.",
        };
      }

      const grupoRecepcionId =
        grupoRecepcionEditando ??
        Date.now() + Math.floor(Math.random() * 10000);

      const movimientosRecepcion: MovimientoPendiente[] = [];

      for (let indiceLote = 0; indiceLote < lotesRecepcion.length; indiceLote += 1) {
        const lote = lotesRecepcion[indiceLote];

        const vencimientoActual = lote.sinVencimiento
          ? { fecha: null, error: "" }
          : normalizarFechaManual(lote.vencimientoTexto);

        if (vencimientoActual.error) {
          return {
            movimientos: [],
            error: `Vencimiento ${indiceLote + 1}: ${vencimientoActual.error}`,
          };
        }

        const distribucionesValidas = lote.distribuciones.filter(
          (distribucion) =>
            distribucion.ubicacionId &&
            Number(distribucion.cantidad) > 0
        );

        if (distribucionesValidas.length === 0) {
          return {
            movimientos: [],
            error:
              `Vencimiento ${indiceLote + 1}: cargá al menos una ubicación con cantidad mayor a cero.`,
          };
        }

        if (
          distribucionesValidas.length !==
          lote.distribuciones.length
        ) {
          return {
            movimientos: [],
            error:
              `Vencimiento ${indiceLote + 1}: completá ubicación y cantidad en todas las filas.`,
          };
        }

        const idsUbicaciones = distribucionesValidas.map(
          (distribucion) => distribucion.ubicacionId
        );

        if (
          new Set(idsUbicaciones).size !==
          idsUbicaciones.length
        ) {
          return {
            movimientos: [],
            error:
              `Vencimiento ${indiceLote + 1}: no podés repetir la misma ubicación.`,
          };
        }

        lote.distribuciones.forEach((distribucion, indiceDistribucion) => {
          const ubicacion = ubicaciones.find(
            (item) => item.id === distribucion.ubicacionId
          );

          movimientosRecepcion.push({
            idLocal:
              grupoRecepcionId +
              indiceLote * 1000 +
              indiceDistribucion +
              Math.floor(Math.random() * 100),
            grupoRecepcionId,
            productoId: producto.id,
            codigo: producto.codigo,
            nombreProducto: producto.nombre,
            tipoMovimiento: "INGRESO",
            motivo: "COMPRA",
            ubicacionOrigenId: "",
            ubicacionOrigenNombre: "",
            ubicacionDestinoId: distribucion.ubicacionId,
            ubicacionDestinoNombre: ubicacion?.nombre || "",
            vencimiento: vencimientoActual.fecha,
            cantidad: Number(distribucion.cantidad),
            observacion: observacion.trim(),
          });
        });
      }

      return {
        error: "",
        movimientos: movimientosRecepcion,
      };
    }

    if (
      configuracionActual.necesitaOrigen &&
      !ubicacionOrigenId
    ) {
      return {
        movimientos: [],
        error: "Seleccioná la ubicación de origen.",
      };
    }

    if (
      configuracionActual.necesitaDestino &&
      !ubicacionDestinoId
    ) {
      return {
        movimientos: [],
        error: "Seleccioná la ubicación de destino.",
      };
    }

    if (
      ubicacionOrigenId &&
      ubicacionDestinoId &&
      ubicacionOrigenId === ubicacionDestinoId
    ) {
      return {
        movimientos: [],
        error: "El origen y el destino no pueden ser iguales.",
      };
    }

    if (modo === "reposicion") {
      const lotesUsados = lotesDisponibles
        .map((lote) => ({
          lote,
          cantidad: Number(cantidadesPorLote[lote.id] || 0),
        }))
        .filter((item) => item.cantidad > 0);

      if (lotesUsados.length === 0) {
        return {
          movimientos: [],
          error: "Ingresá una cantidad en al menos un lote.",
        };
      }

      for (const item of lotesUsados) {
        if (item.cantidad > item.lote.cantidad) {
          return {
            movimientos: [],
            error:
              `Stock insuficiente en ${formatearFecha(
                item.lote.vencimiento
              )}. Disponible: ${item.lote.cantidad}.`,
          };
        }
      }

      return {
        error: "",
        movimientos: lotesUsados.map((item, index) => ({
          idLocal:
            Date.now() +
            index +
            Math.floor(Math.random() * 10000),
          productoId: producto.id,
          codigo: producto.codigo,
          nombreProducto: producto.nombre,
          tipoMovimiento: "EGRESO",
          motivo: "REPOSICIÓN",
          ubicacionOrigenId,
          ubicacionOrigenNombre: ubicacionOrigen?.nombre || "",
          ubicacionDestinoId,
          ubicacionDestinoNombre: ubicacionDestino?.nombre || "",
          vencimiento: item.lote.vencimiento,
          cantidad: item.cantidad,
          observacion: observacion.trim(),
        })),
      };
    }

    const cantidadNumero = Number(cantidad);

    if (!Number.isFinite(cantidadNumero) || cantidadNumero <= 0) {
      return {
        movimientos: [],
        error: "La cantidad debe ser mayor que cero.",
      };
    }

    const vencimientoActual = obtenerVencimientoActual();

    if (vencimientoActual.error) {
      return { movimientos: [], error: vencimientoActual.error };
    }

    if (
      necesitaLoteExistente &&
      loteSeleccionado &&
      cantidadNumero > loteSeleccionado.cantidad
    ) {
      return {
        movimientos: [],
        error:
          `Stock insuficiente. Disponible: ${loteSeleccionado.cantidad}.`,
      };
    }

    return {
      error: "",
      movimientos: [
        {
          idLocal: Date.now() + Math.floor(Math.random() * 10000),
          productoId: producto.id,
          codigo: producto.codigo,
          nombreProducto: producto.nombre,
          tipoMovimiento: configuracionActual.tipoMovimiento,
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
          vencimiento: vencimientoActual.fecha,
          cantidad: cantidadNumero,
          observacion: observacion.trim(),
        },
      ],
    };
  }

  async function agregarALista() {
    const resultadoActual = await construirMovimientosActuales();

    if (resultadoActual.error) {
      setAviso({
        tipo: "error",
        texto: resultadoActual.error,
      });
      return;
    }

    if (modo === "recepcion" && grupoRecepcionEditando !== null) {
      const movimientosEditados = resultadoActual.movimientos.map(
        (movimiento, index) => ({
          ...movimiento,
          idLocal:
            grupoRecepcionEditando +
            index +
            Math.floor(Math.random() * 1000),
          grupoRecepcionId: grupoRecepcionEditando,
        })
      );

      setLista((actual) => [
        ...actual.filter(
          (movimiento) =>
            movimiento.grupoRecepcionId !== grupoRecepcionEditando
        ),
        ...movimientosEditados,
      ]);

      setAviso({
        tipo: "exito",
        texto: "Cambios guardados en la carga actual.",
      });
    } else {
      setLista((actual) => [
        ...actual,
        ...resultadoActual.movimientos,
      ]);

      setAviso({
        tipo: "exito",
        texto:
          modo === "reposicion"
            ? `${totalReposicion} unidades agregadas a la reposición.`
            : "Producto agregado a la carga.",
      });
    }

    limpiarFormularioActual(true);
  }

  function editarRecepcion(grupoRecepcionId: number) {
    const movimientos = lista.filter(
      (movimiento) =>
        movimiento.grupoRecepcionId === grupoRecepcionId
    );

    const primero = movimientos[0];

    if (!primero) return;

    setModo("recepcion");
    setGrupoRecepcionEditando(grupoRecepcionId);
    setCodigo(primero.codigo);
    setProducto({
      id: primero.productoId,
      codigo: primero.codigo,
      codigoNormalizado: primero.codigo.replace(/^0+(?=\d)/, ""),
      nombre: primero.nombreProducto,
      producto: primero.nombreProducto,
      marca: "",
      presentacion: "",
      especificacion: "",
    });
    setProductoNoEncontrado(false);
    setObservacion(primero.observacion);

    const lotesPorFecha = new Map<
      string,
      MovimientoPendiente[]
    >();

    movimientos.forEach((movimiento) => {
      const claveFecha =
        movimiento.vencimiento || "SIN VENCIMIENTO";
      const actuales = lotesPorFecha.get(claveFecha) || [];
      actuales.push(movimiento);
      lotesPorFecha.set(claveFecha, actuales);
    });

    setLotesRecepcion(
      Array.from(lotesPorFecha.entries()).map(
        ([claveFecha, movimientosFecha], indiceLote) => ({
          idLocal:
            Date.now() +
            indiceLote +
            Math.floor(Math.random() * 10000),
          sinVencimiento: claveFecha === "SIN VENCIMIENTO",
          vencimientoTexto:
            claveFecha === "SIN VENCIMIENTO"
              ? ""
              : formatearFecha(claveFecha),
          distribuciones: movimientosFecha.map(
            (movimiento, indiceDistribucion) => ({
              idLocal:
                Date.now() +
                indiceLote * 100 +
                indiceDistribucion +
                Math.floor(Math.random() * 10000),
              ubicacionId: movimiento.ubicacionDestinoId,
              cantidad: String(movimiento.cantidad),
            })
          ),
        })
      )
    );
    setAviso({
      tipo: "info",
      texto: "Estás editando un producto de la recepción.",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelarEdicion() {
    limpiarFormularioActual(true);
    setAviso({
      tipo: "info",
      texto: "Edición cancelada. La carga original no se modificó.",
    });
  }

  async function concluirYGuardar() {
    let movimientosFinales = [...lista];

    const hayProductoActual = Boolean(producto);

    if (hayProductoActual) {
      const resultadoActual = await construirMovimientosActuales();

      if (resultadoActual.error) {
        setAviso({
          tipo: "error",
          texto: resultadoActual.error,
        });
        return;
      }

      if (modo === "recepcion" && grupoRecepcionEditando !== null) {
        const movimientosEditados = resultadoActual.movimientos.map(
          (movimiento, index) => ({
            ...movimiento,
            idLocal:
              grupoRecepcionEditando +
              index +
              Math.floor(Math.random() * 1000),
            grupoRecepcionId: grupoRecepcionEditando,
          })
        );

        movimientosFinales = [
          ...movimientosFinales.filter(
            (movimiento) =>
              movimiento.grupoRecepcionId !== grupoRecepcionEditando
          ),
          ...movimientosEditados,
        ];
      } else {
        movimientosFinales = [
          ...movimientosFinales,
          ...resultadoActual.movimientos,
        ];
      }
    }

    if (movimientosFinales.length === 0) {
      setAviso({
        tipo: "error",
        texto: "No hay movimientos para guardar.",
      });
      return;
    }

    await guardarMovimientos(movimientosFinales);
  }

  function limpiarFormularioActual(enfocarCodigo: boolean) {
    setCodigo("");
    setProducto(null);
    setProductoNoEncontrado(false);
    setNuevoProducto({
      producto: "",
      marca: "",
      presentacion: "",
      especificacion: "",
    });
    setCantidad("");
    setObservacion("");
    setSinVencimiento(false);
    setVencimientoTexto("");
    setLotesDisponibles([]);
    setLoteSeleccionadoId("");
    setCantidadesPorLote({});
    setGrupoRecepcionEditando(null);
    setAviso(null);

    if (modo === "recepcion") {
      const ubicacionPreferida =
        ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "GALPÓN"
        ) ||
        ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "DEPÓSITO"
        ) ||
        ubicaciones[0];

      setLotesRecepcion([
        crearLoteRecepcion(ubicacionPreferida?.id || ""),
      ]);
    }

    if (enfocarCodigo) {
      window.setTimeout(() => {
        codigoInputRef.current?.focus();
      }, 100);
    }
  }

  function limpiarTodo() {
    const confirmar = window.confirm(
      "¿Querés borrar todos los datos y la carga actual?"
    );

    if (!confirmar) return;

    setLista([]);
    setResultado([]);
    limpiarFormularioActual(true);
  }

  function eliminarGrupoDeLista(movimientos: MovimientoPendiente[]) {
    const ids = new Set(
      movimientos.map((movimiento) => movimiento.idLocal)
    );

    setLista((actual) =>
      actual.filter((movimiento) => !ids.has(movimiento.idLocal))
    );

    if (
      grupoRecepcionEditando !== null &&
      movimientos.some(
        (movimiento) =>
          movimiento.grupoRecepcionId === grupoRecepcionEditando
      )
    ) {
      limpiarFormularioActual(false);
    }
  }

  async function consultarProcesamiento(ids: string[]) {
    let ultimaRespuesta: MovimientoProcesado[] = [];

    for (let intento = 0; intento < 12; intento += 1) {
      await esperar(1500);

      const response = await fetch(
        `/api/movimientos?ids=${encodeURIComponent(ids.join(","))}`
      );

      const data =
        (await response.json()) as RespuestaMovimientos;

      if (!response.ok || !data.ok) continue;

      ultimaRespuesta = data.movimientos || [];

      const terminados = ultimaRespuesta.filter(
        (movimiento) =>
          movimiento.procesado ||
          Boolean(movimiento.errorMotor)
      );

      if (terminados.length === ids.length) break;
    }

    return ultimaRespuesta;
  }

  async function guardarMovimientos(
    movimientosAGuardar: MovimientoPendiente[]
  ) {
    try {
      setGuardando(true);
      setResultado([]);

      setAviso({
        tipo: "info",
        texto: `Guardando ${movimientosAGuardar.length} movimientos...`,
      });

      const response = await fetch("/api/movimientos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sucursal: usuario.sucursal,
          movimientos: movimientosAGuardar.map((movimiento) => ({
            productoId: movimiento.productoId,
            tipoMovimiento: movimiento.tipoMovimiento,
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
        limpiarFormularioActual(false);
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
          <p className="module-label mov-module-label">MÓDULO</p>
          <h2>Movimientos</h2>
          <span>
            {usuario.sucursal} · {usuario.nombre}
          </span>
        </div>

        <div className="mov-header-actions">
          <button
            className="mov-clear-all-button"
            type="button"
            onClick={limpiarTodo}
            disabled={guardando}
          >
            Limpiar todo
          </button>

          <button
            className="mov-refresh-button"
            type="button"
            onClick={cargarHistorial}
            disabled={cargandoHistorial}
          >
            {cargandoHistorial ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
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
          Ajustes
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
                disabled={
                  guardando ||
                  esTransferencia ||
                  esVuelveADeposito
                }
              >
                {tiposAjustes.map((tipo) => (
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
                {motivosAjustes.map((motivo) => (
                  <option key={motivo} value={motivo}>
                    {motivo}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {modo !== "recepcion" && (
          <div className="mov-two-columns">
            {configuracionActual.necesitaOrigen && (
              <label className="mov-field">
                Ubicación origen
                <select
                  value={ubicacionOrigenId}
                  onChange={(event) =>
                    setUbicacionOrigenId(event.target.value)
                  }
                  disabled={cargandoUbicaciones || guardando}
                >
                  <option value="">Seleccionar</option>

                  {(modo === "reposicion"
                    ? ubicacionesOrigenReposicion
                    : ubicaciones
                  ).map((ubicacion) => (
                    <option key={ubicacion.id} value={ubicacion.id}>
                      {ubicacion.tipoUbicacion}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {configuracionActual.necesitaDestino && (
              <label className="mov-field">
                Ubicación destino
                {modo === "reposicion" ? (
                  <input
                    value="GÓNDOLA"
                    disabled
                    aria-label="Ubicación destino"
                  />
                ) : (
                  <select
                    value={ubicacionDestinoId}
                    onChange={(event) =>
                      setUbicacionDestinoId(event.target.value)
                    }
                    disabled={cargandoUbicaciones || guardando}
                  >
                    <option value="">Seleccionar</option>

                    {ubicaciones.map((ubicacion) => (
                      <option key={ubicacion.id} value={ubicacion.id}>
                        {ubicacion.tipoUbicacion}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}
          </div>
        )}

        <label className="mov-field">
          Código
          <div className="mov-code-row">
            <input
              ref={codigoInputRef}
              value={codigo}
              onChange={(event) => {
                setCodigo(event.target.value);
                setProducto(null);
                setProductoNoEncontrado(false);
                setLotesDisponibles([]);
                setLoteSeleccionadoId("");
                setCantidadesPorLote({});
              }}
              onBlur={() => {
                if (codigo.trim() && !producto && !productoNoEncontrado) {
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

        {productoNoEncontrado && modo === "recepcion" && (
          <section className="mov-new-product">
            <div className="mov-new-product-title">
              <strong>Producto nuevo</strong>
              <span>Se guardará en PRODUCTOS</span>
            </div>

            <label className="mov-field">
              Nombre del producto
              <input
                value={nuevoProducto.producto}
                onChange={(event) =>
                  setNuevoProducto((actual) => ({
                    ...actual,
                    producto: event.target.value,
                  }))
                }
                placeholder="Ej: Gaseosa cola 2,25 L"
              />
            </label>

            <div className="mov-two-columns">
              <label className="mov-field">
                Marca
                <input
                  value={nuevoProducto.marca}
                  onChange={(event) =>
                    setNuevoProducto((actual) => ({
                      ...actual,
                      marca: event.target.value,
                    }))
                  }
                  placeholder="Opcional"
                />
              </label>

              <label className="mov-field">
                Presentación
                <input
                  value={nuevoProducto.presentacion}
                  onChange={(event) =>
                    setNuevoProducto((actual) => ({
                      ...actual,
                      presentacion: event.target.value,
                    }))
                  }
                  placeholder="Opcional"
                />
              </label>
            </div>

            <label className="mov-field">
              Especificación
              <input
                value={nuevoProducto.especificacion}
                onChange={(event) =>
                  setNuevoProducto((actual) => ({
                    ...actual,
                    especificacion: event.target.value,
                  }))
                }
                placeholder="Opcional"
              />
            </label>

            <button
              type="button"
              className="mov-create-product-button"
              onClick={crearProductoYContinuar}
              disabled={creandoProducto}
            >
              {creandoProducto
                ? "Creando producto..."
                : "Crear producto y continuar"}
            </button>
          </section>
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

        {necesitaFechaManual && modo !== "recepcion" && (
          <>
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

            {!sinVencimiento && (
              <label className="mov-field mov-expiry-field">
                Fecha manual
                <input
                  type="text"
                  value={vencimientoTexto}
                  onChange={(event) =>
                    setVencimientoTexto(event.target.value)
                  }
                  placeholder="25/4, 4/27 o 25/4/27"
                  inputMode="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={guardando}
                />
                <small className="mov-field-help">
                  25/4 usa el año actual. 4/27 toma el último día de abril de 2027.
                </small>
              </label>
            )}
          </>
        )}

        {necesitaLoteExistente && producto && (
          <section className="mov-lots-section">
            <div className="mov-lots-title">
              <div>
                <strong>Lotes disponibles</strong>
                <span>Ordenados por vencimiento</span>
              </div>

              {cargandoLotes && <small>Consultando...</small>}
            </div>

            {!ubicacionOrigenId ? (
              <div className="mov-empty">
                Seleccioná una ubicación de origen.
              </div>
            ) : !cargandoLotes && lotesDisponibles.length === 0 ? (
              <div className="mov-message mov-message-error">
                No hay stock disponible para este producto en la
                ubicación seleccionada.
              </div>
            ) : modo === "reposicion" ? (
              <>
                <div className="mov-lots-list">
                  {lotesDisponibles.map((lote, index) => (
                    <div
                      key={lote.id}
                      className="mov-lot-quantity-row"
                    >
                      <div className="mov-lot-quantity-info">
                        <strong>{formatearFecha(lote.vencimiento)}</strong>
                        <span>{lote.cantidad} disponibles</span>
                        {index === 0 && (
                          <small>Recomendado FEFO</small>
                        )}
                      </div>

                      <input
                        type="number"
                        min="0"
                        max={lote.cantidad}
                        step="0.01"
                        value={cantidadesPorLote[lote.id] || ""}
                        onChange={(event) =>
                          setCantidadesPorLote((actual) => ({
                            ...actual,
                            [lote.id]: event.target.value,
                          }))
                        }
                        placeholder="Cant."
                        inputMode="decimal"
                        aria-label={`Cantidad del lote ${formatearFecha(
                          lote.vencimiento
                        )}`}
                      />
                    </div>
                  ))}
                </div>

                <div className="mov-distribution-total">
                  <span>Total a reponer</span>
                  <strong>{totalReposicion} unidades</strong>
                </div>
              </>
            ) : (
              <div className="mov-lots-list">
                {lotesDisponibles.map((lote, index) => (
                  <label
                    key={lote.id}
                    className={
                      loteSeleccionadoId === lote.id
                        ? "mov-lot-option mov-lot-option-active"
                        : "mov-lot-option"
                    }
                  >
                    <input
                      type="radio"
                      name="lote-stock"
                      value={lote.id}
                      checked={loteSeleccionadoId === lote.id}
                      onChange={() =>
                        setLoteSeleccionadoId(lote.id)
                      }
                      disabled={guardando}
                    />

                    <div>
                      <strong>{formatearFecha(lote.vencimiento)}</strong>
                      <span>{lote.cantidad} unidades disponibles</span>
                    </div>

                    {index === 0 && <small>Recomendado FEFO</small>}
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        {modo === "recepcion" ? (
          <section className="mov-reception-lots-section">
            <div className="mov-reception-lots-heading">
              <div>
                <strong>Vencimientos y cantidades</strong>
                <span>
                  Podés cargar varias fechas para el mismo producto.
                </span>
              </div>

              <button
                type="button"
                className="mov-add-expiry-button"
                onClick={agregarLoteRecepcion}
                disabled={guardando}
              >
                + Otro
              </button>
            </div>

            <div className="mov-reception-lots-list">
              {lotesRecepcion.map((lote, indiceLote) => (
                <article
                  key={lote.idLocal}
                  className="mov-reception-lot-card"
                >
                  <div className="mov-reception-lot-header">
                    <div>
                      <span>VENCIMIENTO</span>
                      <strong>{indiceLote + 1}</strong>
                    </div>

                    {lotesRecepcion.length > 1 && (
                      <button
                        type="button"
                        className="mov-remove-expiry-button"
                        onClick={() =>
                          quitarLoteRecepcion(lote.idLocal)
                        }
                        disabled={guardando}
                      >
                        Quitar
                      </button>
                    )}
                  </div>

                  <div className="mov-date-title-row">
                    <strong>Fecha</strong>

                    <button
                      type="button"
                      className={
                        lote.sinVencimiento
                          ? "mov-no-expiry mov-no-expiry-active"
                          : "mov-no-expiry"
                      }
                      onClick={() =>
                        actualizarLoteRecepcion(
                          lote.idLocal,
                          "sinVencimiento",
                          !lote.sinVencimiento
                        )
                      }
                      disabled={guardando}
                    >
                      {lote.sinVencimiento
                        ? "Sin vencimiento ✓"
                        : "Sin vencimiento"}
                    </button>
                  </div>

                  {!lote.sinVencimiento && (
                    <label className="mov-field mov-expiry-field">
                      Fecha manual
                      <input
                        type="text"
                        value={lote.vencimientoTexto}
                        onChange={(event) =>
                          actualizarLoteRecepcion(
                            lote.idLocal,
                            "vencimientoTexto",
                            event.target.value
                          )
                        }
                        placeholder="25/4, 4/27 o 25/4/27"
                        inputMode="text"
                        autoCapitalize="none"
                        autoCorrect="off"
                        disabled={guardando}
                      />
                    </label>
                  )}

                  <div className="mov-distribution-title-row">
                    <strong>Distribución</strong>

                    <button
                      type="button"
                      className="mov-add-location-button"
                      onClick={() =>
                        agregarDistribucion(lote.idLocal)
                      }
                      disabled={
                        guardando ||
                        lote.distribuciones.length >=
                          ubicaciones.length
                      }
                    >
                      + Ubicación
                    </button>
                  </div>

                  <div className="mov-distribution-list">
                    {lote.distribuciones.map((distribucion) => {
                      const ubicacionesUsadas = new Set(
                        lote.distribuciones
                          .filter(
                            (item) =>
                              item.idLocal !==
                              distribucion.idLocal
                          )
                          .map((item) => item.ubicacionId)
                          .filter(Boolean)
                      );

                      return (
                        <div
                          className="mov-distribution-row"
                          key={distribucion.idLocal}
                        >
                          <select
                            value={distribucion.ubicacionId}
                            onChange={(event) =>
                              actualizarDistribucion(
                                lote.idLocal,
                                distribucion.idLocal,
                                "ubicacionId",
                                event.target.value
                              )
                            }
                            disabled={
                              cargandoUbicaciones || guardando
                            }
                            aria-label="Ubicación destino"
                          >
                            <option value="">Ubicación</option>

                            {ubicaciones.map((ubicacion) => (
                              <option
                                key={ubicacion.id}
                                value={ubicacion.id}
                                disabled={ubicacionesUsadas.has(
                                  ubicacion.id
                                )}
                              >
                                {ubicacion.tipoUbicacion}
                              </option>
                            ))}
                          </select>

                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={distribucion.cantidad}
                            onChange={(event) =>
                              actualizarDistribucion(
                                lote.idLocal,
                                distribucion.idLocal,
                                "cantidad",
                                event.target.value
                              )
                            }
                            placeholder="Cant."
                            inputMode="decimal"
                            disabled={guardando}
                            aria-label="Cantidad"
                          />

                          <button
                            type="button"
                            className="mov-remove-location-button"
                            onClick={() =>
                              quitarDistribucion(
                                lote.idLocal,
                                distribucion.idLocal
                              )
                            }
                            disabled={guardando}
                            aria-label="Quitar ubicación"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>

            <div className="mov-distribution-total">
              <span>Total recibido</span>
              <strong>{totalDistribucion} unidades</strong>
            </div>
          </section>
        ) : modo !== "reposicion" ? (
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

            {loteSeleccionado && (
              <small className="mov-field-help">
                Disponible en este lote: {loteSeleccionado.cantidad}
              </small>
            )}
          </label>
        ) : null}

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

        <div className="mov-form-actions">
          <button
            type="button"
            className="mov-add-button"
            onClick={agregarALista}
            disabled={
              guardando ||
              buscandoProducto ||
              cargandoLotes ||
              creandoProducto
            }
          >
            {grupoRecepcionEditando !== null
              ? "Guardar cambios"
              : "+ Agregar otro producto"}
          </button>

          {grupoRecepcionEditando !== null && (
            <button
              type="button"
              className="mov-cancel-edit-button"
              onClick={cancelarEdicion}
              disabled={guardando}
            >
              Cancelar edición
            </button>
          )}

          <button
            type="button"
            className="mov-finish-button"
            onClick={concluirYGuardar}
            disabled={
              guardando ||
              buscandoProducto ||
              cargandoLotes ||
              creandoProducto
            }
          >
            Concluir y guardar carga
          </button>
        </div>

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
            {gruposCarga.map((grupo, index) => {
              const primero = grupo.movimientos[0];
              const totalGrupo = grupo.movimientos.reduce(
                (total, movimiento) => total + movimiento.cantidad,
                0
              );
              const esRecepcionAgrupada = Boolean(
                primero.grupoRecepcionId
              );

              return (
                <article
                  key={grupo.clave}
                  className="mov-list-item"
                >
                  <div className="mov-list-number">{index + 1}</div>

                  <div className="mov-list-content">
                    <strong>{primero.nombreProducto}</strong>

                    <span>
                      {primero.tipoMovimiento} · {primero.motivo}
                    </span>

                    {primero.ubicacionOrigenNombre && (
                      <p>Origen: {primero.ubicacionOrigenNombre}</p>
                    )}

                    {esRecepcionAgrupada ? (
                      <>
                        {grupo.movimientos.map((movimiento) => (
                          <p key={movimiento.idLocal}>
                            {formatearFecha(movimiento.vencimiento)} ·{" "}
                            {movimiento.ubicacionDestinoNombre}:{" "}
                            {movimiento.cantidad} unidades
                          </p>
                        ))}
                        <p>
                          Total del producto: {totalGrupo} unidades
                        </p>
                      </>
                    ) : (
                      <>
                        {primero.ubicacionDestinoNombre && (
                          <p>
                            Destino: {primero.ubicacionDestinoNombre}
                          </p>
                        )}
                        <p>
                          {formatearFecha(primero.vencimiento)} · {" "}
                          {primero.cantidad} unidades
                        </p>
                      </>
                    )}
                  </div>

                  <div className="mov-list-actions">
                    {esRecepcionAgrupada &&
                      primero.grupoRecepcionId && (
                        <button
                          type="button"
                          className="mov-edit-button"
                          onClick={() =>
                            editarRecepcion(
                              primero.grupoRecepcionId as number
                            )
                          }
                          disabled={guardando}
                        >
                          Editar
                        </button>
                      )}

                    <button
                      type="button"
                      className="mov-delete-button"
                      onClick={() =>
                        eliminarGrupoDeLista(grupo.movimientos)
                      }
                      disabled={guardando}
                    >
                      Quitar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
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
                    {movimiento.nombreProducto || "Producto"}
                  </strong>

                  <p>
                    {movimiento.motivo} ·{" "}
                    {movimiento.cantidad} unidades
                  </p>

                  {movimiento.errorMotor && (
                    <small>{movimiento.errorMotor}</small>
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
          <div className="mov-empty">Cargando historial...</div>
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
                    {movimiento.nombreProducto || "Producto"}
                  </strong>

                  <span>
                    {movimiento.tipoMovimiento} ·{" "}
                    {movimiento.motivo}
                  </span>

                  <p>
                    {formatearFecha(movimiento.vencimiento)} ·{" "}
                    {movimiento.cantidad} unidades
                  </p>

                  {movimiento.errorMotor && (
                    <small>{movimiento.errorMotor}</small>
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
