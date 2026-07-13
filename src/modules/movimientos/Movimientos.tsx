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

const tiposAjustes = ["INGRESO", "EGRESO", "AJUSTE +", "AJUSTE -"];

const motivosAjustes = [
  "TRANSFERENCIA",
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
      error: "Usá día/mes o día/mes/año.",
    };
  }

  const dia = Number(partes[0]);
  const mes = Number(partes[1]);

  let anio = new Date().getFullYear();

  if (partes.length === 3) {
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
  const [cargandoLotes, setCargandoLotes] = useState(false);

  const [distribuciones, setDistribuciones] = useState<
    DistribucionRecepcion[]
  >([crearDistribucion()]);

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
    return distribuciones.reduce((total, distribucion) => {
      const cantidadNumerica = Number(distribucion.cantidad);

      return Number.isFinite(cantidadNumerica)
        ? total + cantidadNumerica
        : total;
    }, 0);
  }, [distribuciones]);

  const esTransferencia =
    modo === "individual" &&
    motivoIndividual === "TRANSFERENCIA";

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
  }, [modo, tipoIndividual, motivoIndividual, esTransferencia]);

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
    setProducto(null);
    setCodigo("");
    setCantidad("");
    setObservacion("");
    setSinVencimiento(false);
    setVencimientoTexto("");
    setAviso(null);
    setLotesDisponibles([]);
    setLoteSeleccionadoId("");

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
      setDistribuciones([
        crearDistribucion(ubicacionPreferida?.id || ""),
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
    }
  }, [motivoIndividual]);

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

  async function registrarErrorStock(
    tipoError: "STOCK INSUFICIENTE" | "SIN STOCK" | "ERROR FEFO",
    detalle: string,
    cantidadSolicitada: number,
    cantidadDisponible: number,
    vencimiento: string | null
  ) {
    if (!producto || !ubicacionOrigenId) return;

    try {
      await fetch("/api/errores-movimientos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          usuario: usuario.nombre,
          sucursal: usuario.sucursal,
          productoId: producto.id,
          codigo: producto.codigo,
          ubicacionId: ubicacionOrigenId,
          vencimiento,
          cantidadSolicitada,
          cantidadDisponible,
          tipoError,
          detalle,
        }),
      });
    } catch (error) {
      console.error("No se pudo registrar la alerta:", error);
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
      setLotesDisponibles([]);
      setLoteSeleccionadoId("");

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

  function agregarDistribucion() {
    const ubicacionesUsadas = new Set(
      distribuciones
        .map((distribucion) => distribucion.ubicacionId)
        .filter(Boolean)
    );

    const siguienteUbicacion = ubicaciones.find(
      (ubicacion) => !ubicacionesUsadas.has(ubicacion.id)
    );

    if (!siguienteUbicacion) {
      setAviso({
        tipo: "alerta",
        texto: "Ya agregaste todas las ubicaciones disponibles.",
      });
      return;
    }

    setDistribuciones((actuales) => [
      ...actuales,
      crearDistribucion(siguienteUbicacion.id),
    ]);
  }

  function actualizarDistribucion(
    idLocal: number,
    campo: "ubicacionId" | "cantidad",
    valor: string
  ) {
    setDistribuciones((actuales) =>
      actuales.map((distribucion) =>
        distribucion.idLocal === idLocal
          ? { ...distribucion, [campo]: valor }
          : distribucion
      )
    );
  }

  function quitarDistribucion(idLocal: number) {
    setDistribuciones((actuales) => {
      if (actuales.length === 1) {
        return [
          {
            ...actuales[0],
            ubicacionId: "",
            cantidad: "",
          },
        ];
      }

      return actuales.filter(
        (distribucion) => distribucion.idLocal !== idLocal
      );
    });
  }

  function obtenerVencimientoActual() {
    if (necesitaLoteExistente) {
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

  async function validarFormularioActual() {
    if (!producto) {
      return "Escaneá o buscá un producto.";
    }

    const vencimientoActual = obtenerVencimientoActual();

    if (vencimientoActual.error) {
      return vencimientoActual.error;
    }

    if (modo === "recepcion") {
      const distribucionesValidas = distribuciones.filter(
        (distribucion) =>
          distribucion.ubicacionId &&
          Number(distribucion.cantidad) > 0
      );

      if (distribucionesValidas.length === 0) {
        return "Cargá al menos una ubicación con cantidad mayor a cero.";
      }

      if (distribucionesValidas.length !== distribuciones.length) {
        return "Completá ubicación y cantidad en todas las filas.";
      }

      const idsUbicaciones = distribucionesValidas.map(
        (distribucion) => distribucion.ubicacionId
      );

      if (new Set(idsUbicaciones).size !== idsUbicaciones.length) {
        return "No podés repetir la misma ubicación.";
      }

      return "";
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
      ubicacionOrigenId === ubicacionDestinoId
    ) {
      return "El origen y el destino no pueden ser iguales.";
    }

    const cantidadNumero = Number(cantidad);

    if (!Number.isFinite(cantidadNumero) || cantidadNumero <= 0) {
      return "La cantidad debe ser mayor que cero.";
    }

    if (
      necesitaLoteExistente &&
      lotesDisponibles.length === 0
    ) {
      await registrarErrorStock(
        "SIN STOCK",
        "No hay lotes con stock disponible en la ubicación seleccionada.",
        cantidadNumero,
        0,
        null
      );

      return "No hay stock disponible para este producto en el origen.";
    }

    if (
      necesitaLoteExistente &&
      loteSeleccionado &&
      cantidadNumero > loteSeleccionado.cantidad
    ) {
      const detalle =
        `Stock insuficiente. Disponible: ${loteSeleccionado.cantidad}. ` +
        `Solicitado: ${cantidadNumero}.`;

      await registrarErrorStock(
        "STOCK INSUFICIENTE",
        detalle,
        cantidadNumero,
        loteSeleccionado.cantidad,
        loteSeleccionado.vencimiento
      );

      return (
        `${detalle} Revisá la fecha o la cantidad.`
      );
    }

    if (
      necesitaLoteExistente &&
      loteSeleccionado &&
      lotesDisponibles[0] &&
      loteSeleccionado.id !== lotesDisponibles[0].id
    ) {
      const recomendado = lotesDisponibles[0];

      const detalle =
        `Se intentó seleccionar ${formatearFecha(
          loteSeleccionado.vencimiento
        )} cuando FEFO recomienda ${formatearFecha(
          recomendado.vencimiento
        )}.`;

      await registrarErrorStock(
        "ERROR FEFO",
        detalle,
        cantidadNumero,
        recomendado.cantidad,
        loteSeleccionado.vencimiento
      );

      return (
        `FEFO: primero debe utilizarse el lote ${formatearFecha(
          recomendado.vencimiento
        )}, con ${recomendado.cantidad} unidades disponibles.`
      );
    }

    return "";
  }

  async function agregarALista() {
    const errorFormulario = await validarFormularioActual();

    if (errorFormulario) {
      setAviso({
        tipo: "error",
        texto: errorFormulario,
      });
      return;
    }

    const vencimientoActual = obtenerVencimientoActual();

    if (modo === "recepcion") {
      const grupoRecepcionId =
        Date.now() + Math.floor(Math.random() * 10000);

      const nuevosMovimientos = distribuciones.map(
        (distribucion, index): MovimientoPendiente => {
          const ubicacion = ubicaciones.find(
            (item) => item.id === distribucion.ubicacionId
          );

          return {
            idLocal:
              grupoRecepcionId +
              index +
              Math.floor(Math.random() * 1000),
            grupoRecepcionId,
            productoId: producto!.id,
            codigo: producto!.codigo,
            nombreProducto: producto!.nombre,
            tipoMovimiento: "INGRESO",
            motivo: "COMPRA",
            ubicacionOrigenId: "",
            ubicacionOrigenNombre: "",
            ubicacionDestinoId: distribucion.ubicacionId,
            ubicacionDestinoNombre: ubicacion?.nombre || "",
            vencimiento: vencimientoActual.fecha,
            cantidad: Number(distribucion.cantidad),
            observacion: observacion.trim(),
          };
        }
      );

      setLista((actual) => [...actual, ...nuevosMovimientos]);

      setAviso({
        tipo: "exito",
        texto:
          `${producto!.nombre} agregado. ` +
          `Total recibido: ${totalDistribucion} unidades.`,
      });

      limpiarProductoActual();
      return;
    }

    const movimiento: MovimientoPendiente = {
      idLocal: Date.now() + Math.floor(Math.random() * 10000),
      productoId: producto!.id,
      codigo: producto!.codigo,
      nombreProducto: producto!.nombre,
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
      cantidad: Number(cantidad),
      observacion: observacion.trim(),
    };

    setLista((actual) => [...actual, movimiento]);

    setAviso({
      tipo: "exito",
      texto: "Producto agregado a la carga.",
    });

    limpiarProductoActual();
  }

  function limpiarProductoActual() {
    setCodigo("");
    setProducto(null);
    setCantidad("");
    setObservacion("");
    setSinVencimiento(false);
    setVencimientoTexto("");
    setLotesDisponibles([]);
    setLoteSeleccionadoId("");

    if (modo === "recepcion") {
      const ubicacionPreferida =
        ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "GALPÓN"
        ) ||
        ubicaciones.find(
          (ubicacion) => ubicacion.tipoUbicacion === "DEPÓSITO"
        ) ||
        ubicaciones[0];

      setDistribuciones([
        crearDistribucion(ubicacionPreferida?.id || ""),
      ]);
    }

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
                disabled={guardando || esTransferencia}
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
                setLotesDisponibles([]);
                setLoteSeleccionadoId("");
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

        {necesitaFechaManual && (
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
                  placeholder="Ej: 25/9, 1-10-26 o 01/10/2026"
                  inputMode="numeric"
                  disabled={guardando}
                />
                <small className="mov-field-help">
                  Si no escribís el año, se completa con el actual.
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
                      <strong>
                        {formatearFecha(lote.vencimiento)}
                      </strong>
                      <span>{lote.cantidad} unidades disponibles</span>
                    </div>

                    {index === 0 && (
                      <small>Recomendado FEFO</small>
                    )}
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        {modo === "recepcion" ? (
          <section className="mov-distribution-section">
            <div className="mov-distribution-title-row">
              <strong>Distribución</strong>

              <button
                type="button"
                className="mov-add-location-button"
                onClick={agregarDistribucion}
                disabled={
                  guardando ||
                  distribuciones.length >= ubicaciones.length
                }
              >
                + Agregar ubicación
              </button>
            </div>

            <div className="mov-distribution-list">
              {distribuciones.map((distribucion) => {
                const ubicacionesUsadas = new Set(
                  distribuciones
                    .filter(
                      (item) =>
                        item.idLocal !== distribucion.idLocal
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
                          distribucion.idLocal,
                          "ubicacionId",
                          event.target.value
                        )
                      }
                      disabled={cargandoUbicaciones || guardando}
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
                        quitarDistribucion(distribucion.idLocal)
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

            <div className="mov-distribution-total">
              <span>Total recibido</span>
              <strong>{totalDistribucion} unidades</strong>
            </div>
          </section>
        ) : (
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
        )}

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
          disabled={guardando || buscandoProducto || cargandoLotes}
        >
          {modo === "recepcion"
            ? "+ Agregar producto a la recepción"
            : "+ Agregar producto a la carga"}
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
                <div className="mov-list-number">{index + 1}</div>

                <div className="mov-list-content">
                  <strong>{item.nombreProducto}</strong>

                  <span>
                    {item.tipoMovimiento} · {item.motivo}
                  </span>

                  {item.ubicacionOrigenNombre && (
                    <p>Origen: {item.ubicacionOrigenNombre}</p>
                  )}

                  {item.ubicacionDestinoNombre && (
                    <p>Destino: {item.ubicacionDestinoNombre}</p>
                  )}

                  <p>
                    {formatearFecha(item.vencimiento)} ·{" "}
                    {item.cantidad} unidades
                  </p>
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
