import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { tienePermiso } from "../../config/permisos";
import "./CuentasCorrientes.css";

type RolUsuario = "USUARIO" | "ADMIN" | string;
type MedioPago = "EFECTIVO" | "TRANSFERENCIA" | "ECHEQ" | "";
type TipoMovimiento = "COMPRA RECIBIDA" | "PAGO REALIZADO";
type Vista = "lista" | "detalle" | "formulario" | "nuevoProveedor";
type FiltroHistorial = "ultimos30" | "mesActual" | "todo";
type Mensaje = { tipo: "info" | "exito" | "error"; texto: string } | null;

type UsuarioSesion = {
  usuario: string;
  nombre: string;
  empresa: string;
  rol: RolUsuario;
  sucursal: string;
  modulos: string[];
};

type Proveedor = {
  id: string;
  proveedor: string;
  telefono: string;
  cuit: string;
  direccion: string;
  observaciones: string;
  saldoActual: number;
  estado: string;
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

type ItemCompraFormulario = {
  idLocal: string;
  id?: string;
  descripcion: string;
  cantidad: string;
  unidad: string;
  precioUnitario: string;
  observaciones: string;
};

type DetalleCompra = {
  compraId: string;
  movimientoId: string;
  fecha: string;
  proveedorIds: string[];
  comprobante: string;
  importe: number;
  observaciones: string;
  responsable: string;
  items: Array<{
    id: string;
    descripcion: string;
    cantidad: number;
    unidad: string;
    precioUnitario: number;
    totalItem: number;
    orden: number;
    observaciones: string;
  }>;
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
  detalle?: DetalleCompra;
  error?: string;
};

type Props = { usuario: UsuarioSesion };

const UNIDADES = ["UNIDAD", "CAJÓN", "MAPLE", "CAJA", "PACK", "KILO", "GRAMO", "LITRO", "OTRO"];

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

function fechaParaInput(fecha: string) {
  return fecha.includes("/") ? fecha.split("/").reverse().join("-") : fecha;
}

function formatearFecha(fecha: string) {
  if (!fecha) return "Sin fecha";
  const match = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : fecha;
}

function convertirFechaMovimiento(fecha: string) {
  if (!fecha) return new Date(0);

  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [anio, mes, dia] = fecha.split("-").map(Number);
    return new Date(anio, mes - 1, dia);
  }

  const [dia, mes, anio] = fecha.split("/").map(Number);

  if (!dia || !mes || !anio) return new Date(0);

  return new Date(anio, mes - 1, dia);
}

function obtenerInicioFiltro(filtro: FiltroHistorial) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  if (filtro === "ultimos30") {
    const inicio = new Date(hoy);
    inicio.setDate(inicio.getDate() - 29);
    return inicio;
  }

  if (filtro === "mesActual") {
    return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  }

  return null;
}

function crearItemVacio(): ItemCompraFormulario {
  return {
    idLocal: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    descripcion: "",
    cantidad: "",
    unidad: "UNIDAD",
    precioUnitario: "",
    observaciones: "",
  };
}

function normalizarNombreArchivo(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function compartirArchivoPdf(
  blob: Blob,
  nombreArchivo: string,
  titulo: string
) {
  const archivo = new File([blob], nombreArchivo, {
    type: "application/pdf",
  });

  const navegador = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  if (
    navigator.share &&
    navegador.canShare?.({ files: [archivo] })
  ) {
    await navigator.share({
      title: titulo,
      text: titulo,
      files: [archivo],
    });
    return true;
  }

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);

  return false;
}

function crearPdfComprobantePago(params: {
  empresa: string;
  proveedor: Proveedor;
  movimiento: Movimiento;
  saldoAnterior: number;
  saldoPosterior: number;
}) {
  const pdf = new jsPDF();
  const margen = 16;
  let y = 18;

  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text("OPTIMA", margen, y);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(71, 85, 105);
  pdf.text(params.empresa || "Empresa", margen, y + 6);

  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("COMPROBANTE DE PAGO", 194, y, {
    align: "right",
  });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(71, 85, 105);
  pdf.text(
    params.movimiento.comprobante || "Sin numero",
    194,
    y + 6,
    { align: "right" }
  );

  y += 15;
  pdf.setDrawColor(8, 63, 136);
  pdf.line(margen, y, 194, y);
  y += 10;

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margen, y, 178, 42, 3, 3, "F");
  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "bold");
  pdf.text(`Proveedor: ${params.proveedor.proveedor}`, margen + 4, y + 8);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(
    `Fecha: ${formatearFecha(params.movimiento.fecha)}`,
    margen + 4,
    y + 16
  );
  pdf.text(
    `Medio de pago: ${params.movimiento.medioPago}`,
    margen + 4,
    y + 24
  );

  if (params.movimiento.datosPago) {
    pdf.text(
      `Datos: ${params.movimiento.datosPago}`,
      margen + 4,
      y + 32,
      { maxWidth: 168 }
    );
  }

  y += 52;
  pdf.setFillColor(8, 63, 136);
  pdf.roundedRect(margen, y, 178, 24, 3, 3, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(10);
  pdf.text("Importe pagado", 105, y + 8, {
    align: "center",
  });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text(
    formatearPesos(params.movimiento.importe),
    105,
    y + 18,
    { align: "center" }
  );

  y += 34;
  pdf.setTextColor(71, 85, 105);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("Saldo anterior", margen, y);
  pdf.text("Saldo restante", 110, y);

  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(formatearPesos(params.saldoAnterior), margen, y + 8);
  pdf.text(formatearPesos(params.saldoPosterior), 110, y + 8);

  y += 22;
  pdf.setTextColor(71, 85, 105);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);

  if (params.movimiento.observacion) {
    pdf.text(
      `Observaciones: ${params.movimiento.observacion}`,
      margen,
      y,
      { maxWidth: 178 }
    );
    y += 9;
  }

  if (params.movimiento.responsable) {
    pdf.text(
      `Responsable: ${params.movimiento.responsable}`,
      margen,
      y
    );
  }

  return pdf;
}

function crearPdfCompra(params: {
  empresa: string;
  proveedor: Proveedor;
  detalle: DetalleCompra;
}) {
  const pdf = new jsPDF();
  const margen = 15;
  let y = 18;

  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text("OPTIMA", margen, y);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(71, 85, 105);
  pdf.text(params.empresa || "Empresa", margen, y + 6);

  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("COMPRA RECIBIDA", 195, y, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(71, 85, 105);
  pdf.text(
    params.detalle.comprobante || "Sin comprobante",
    195,
    y + 6,
    { align: "right" }
  );

  y += 15;
  pdf.setDrawColor(8, 63, 136);
  pdf.line(margen, y, 195, y);
  y += 10;

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margen, y, 180, 28, 3, 3, "F");
  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("Proveedor", margen + 4, y + 7);

  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(10);
  pdf.text(params.proveedor.proveedor, margen + 4, y + 14);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(
    `Fecha: ${formatearFecha(params.detalle.fecha)}`,
    margen + 4,
    y + 21
  );

  y += 37;

  const columnas = {
    descripcion: margen,
    cantidad: 112,
    unidad: 132,
    unitario: 158,
    total: 195,
  };

  pdf.setFillColor(239, 246, 255);
  pdf.rect(margen, y, 180, 9, "F");
  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("Descripcion", columnas.descripcion + 2, y + 6);
  pdf.text("Cant.", columnas.cantidad, y + 6, { align: "right" });
  pdf.text("Unidad", columnas.unidad, y + 6, { align: "right" });
  pdf.text("Precio", columnas.unitario, y + 6, { align: "right" });
  pdf.text("Total", columnas.total, y + 6, { align: "right" });
  y += 10;

  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(15, 23, 42);

  for (const item of params.detalle.items) {
    if (y > 255) {
      pdf.addPage();
      y = 18;
    }

    const lineas = pdf.splitTextToSize(
      item.descripcion,
      80
    ) as string[];
    const alto = Math.max(8, lineas.length * 4 + 3);

    pdf.setDrawColor(203, 213, 225);
    pdf.rect(margen, y, 180, alto);
    pdf.setFontSize(8);
    pdf.text(lineas, columnas.descripcion + 2, y + 5);
    pdf.text(String(item.cantidad), columnas.cantidad, y + 5, {
      align: "right",
    });
    pdf.text(item.unidad, columnas.unidad, y + 5, {
      align: "right",
    });
    pdf.text(
      formatearPesos(item.precioUnitario),
      columnas.unitario,
      y + 5,
      { align: "right" }
    );
    pdf.text(
      formatearPesos(item.totalItem),
      columnas.total,
      y + 5,
      { align: "right" }
    );

    y += alto;
  }

  y += 8;
  pdf.setFillColor(8, 63, 136);
  pdf.roundedRect(115, y, 80, 18, 3, 3, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(9);
  pdf.text("Total de la compra", 190, y + 6, {
    align: "right",
  });
  pdf.setFontSize(15);
  pdf.setFont("helvetica", "bold");
  pdf.text(
    formatearPesos(params.detalle.importe),
    190,
    y + 14,
    { align: "right" }
  );

  return pdf;
}

function crearPdfResumenCuenta(params: {
  empresa: string;
  proveedor: Proveedor;
  etiquetaPeriodo: string;
  saldoInicial: number;
  totalCompras: number;
  totalPagos: number;
  saldoFinal: number;
  movimientos: Movimiento[];
}) {
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const margen = 14;
  let y = 16;

  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);
  pdf.text("OPTIMA", margen, y);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(71, 85, 105);
  pdf.text(params.empresa || "Empresa", margen, y + 6);

  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("RESUMEN DE CUENTA", 283, y, {
    align: "right",
  });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(71, 85, 105);
  pdf.text(params.etiquetaPeriodo, 283, y + 6, {
    align: "right",
  });

  y += 14;
  pdf.setDrawColor(8, 63, 136);
  pdf.line(margen, y, 283, y);
  y += 9;

  pdf.setTextColor(15, 23, 42);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text(params.proveedor.proveedor, margen, y);

  y += 10;
  const cajas = [
    ["Saldo inicial", params.saldoInicial],
    ["Compras", params.totalCompras],
    ["Pagos", params.totalPagos],
    ["Saldo final", params.saldoFinal],
  ] as const;

  cajas.forEach(([titulo, valor], index) => {
    const x = margen + index * 67;
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(x, y, 61, 20, 2, 2, "F");
    pdf.setTextColor(100, 116, 139);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(titulo, x + 3, y + 6);
    pdf.setTextColor(8, 63, 136);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(formatearPesos(valor), x + 3, y + 15);
  });

  y += 28;
  const columnas = {
    fecha: margen,
    movimiento: 42,
    comprobante: 92,
    compra: 185,
    pago: 225,
    detalle: 236,
  };

  pdf.setFillColor(239, 246, 255);
  pdf.rect(margen, y, 269, 9, "F");
  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("Fecha", columnas.fecha + 2, y + 6);
  pdf.text("Movimiento", columnas.movimiento, y + 6);
  pdf.text("Comprobante", columnas.comprobante, y + 6);
  pdf.text("Compra", columnas.compra, y + 6, { align: "right" });
  pdf.text("Pago", columnas.pago, y + 6, { align: "right" });
  pdf.text("Detalle", columnas.detalle, y + 6);
  y += 10;

  const cronologicos = [...params.movimientos].sort(
    (a, b) =>
      convertirFechaMovimiento(a.fecha).getTime() -
      convertirFechaMovimiento(b.fecha).getTime()
  );

  for (const movimiento of cronologicos) {
    if (y > 185) {
      pdf.addPage();
      y = 16;
    }

    const esPago =
      movimiento.tipoMovimiento === "PAGO REALIZADO";
    const detalle = esPago
      ? [movimiento.medioPago, movimiento.datosPago]
          .filter(Boolean)
          .join(" - ")
      : movimiento.observacion || "-";

    const lineasDetalle = pdf.splitTextToSize(
      detalle,
      45
    ) as string[];
    const alto = Math.max(8, lineasDetalle.length * 4 + 3);

    pdf.setDrawColor(203, 213, 225);
    pdf.rect(margen, y, 269, alto);
    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(formatearFecha(movimiento.fecha), columnas.fecha + 2, y + 5);
    pdf.text(
      esPago ? "Pago realizado" : "Compra recibida",
      columnas.movimiento,
      y + 5
    );
    pdf.text(
      movimiento.comprobante || "-",
      columnas.comprobante,
      y + 5,
      { maxWidth: 75 }
    );
    pdf.text(
      esPago ? "-" : formatearPesos(movimiento.importe),
      columnas.compra,
      y + 5,
      { align: "right" }
    );
    pdf.text(
      esPago ? formatearPesos(movimiento.importe) : "-",
      columnas.pago,
      y + 5,
      { align: "right" }
    );
    pdf.text(lineasDetalle, columnas.detalle, y + 5);

    y += alto;
  }

  y += 7;
  pdf.setFillColor(8, 63, 136);
  pdf.roundedRect(203, y, 80, 18, 3, 3, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(9);
  pdf.text("Saldo pendiente", 278, y + 6, {
    align: "right",
  });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text(formatearPesos(params.saldoFinal), 278, y + 14, {
    align: "right",
  });

  return pdf;
}

export default function CuentasCorrientesProveedores({ usuario }: Props) {
  const puedeEditar = tienePermiso(usuario.rol, "cuentasCorrientes.editarGuardado");
  const puedeExportar = tienePermiso(usuario.rol, "cuentasCorrientes.exportar");

  const [vista, setVista] = useState<Vista>("lista");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [movimientoEditandoId, setMovimientoEditandoId] = useState<string | null>(null);
  const [tipoFormulario, setTipoFormulario] = useState<TipoMovimiento>("COMPRA RECIBIDA");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [ultimoPagoId, setUltimoPagoId] = useState<string | null>(null);
  const [filtroHistorial, setFiltroHistorial] =
    useState<FiltroHistorial>("ultimos30");
  const [detalleCompraVisible, setDetalleCompraVisible] = useState<DetalleCompra | null>(null);
  const [cargandoDetalleCompraId, setCargandoDetalleCompraId] = useState<string | null>(null);

  const [nuevoProveedor, setNuevoProveedor] = useState({
    proveedor: "",
    telefono: "",
    cuit: "",
    direccion: "",
    observaciones: "",
  });

  const [form, setForm] = useState({
    fecha: obtenerFechaHoyInput(),
    comprobante: "",
    medioPago: "" as MedioPago,
    datosPago: "",
    importe: "",
    observacion: "",
    responsable: "",
  });

  const [items, setItems] = useState<ItemCompraFormulario[]>([crearItemVacio()]);

  const proveedor = proveedores.find((item) => item.id === proveedorId);

  const proveedoresFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return proveedores;
    return proveedores.filter((item) => item.proveedor.toLowerCase().includes(texto));
  }, [proveedores, busqueda]);

  const totalAPagar = useMemo(
    () => proveedores.reduce((total, item) => (item.saldoActual > 0 ? total + item.saldoActual : total), 0),
    [proveedores]
  );

  const totalCompra = useMemo(
    () => items.reduce((total, item) => total + (Number(item.cantidad) || 0) * (Number(item.precioUnitario) || 0), 0),
    [items]
  );

  const resumenHistorial = useMemo(() => {
    const inicio = obtenerInicioFiltro(filtroHistorial);

    const cronologicos = [...movimientos].sort(
      (a, b) =>
        convertirFechaMovimiento(a.fecha).getTime() -
        convertirFechaMovimiento(b.fecha).getTime()
    );

    const anteriores = inicio
      ? cronologicos.filter(
          (movimiento) =>
            convertirFechaMovimiento(movimiento.fecha) < inicio
        )
      : [];

    const filtrados = inicio
      ? cronologicos.filter(
          (movimiento) =>
            convertirFechaMovimiento(movimiento.fecha) >= inicio
        )
      : cronologicos;

    const saldoInicial = anteriores.reduce(
      (total, movimiento) =>
        total + movimiento.importeFirmado,
      0
    );

    const totalCompras = filtrados
      .filter(
        (movimiento) =>
          movimiento.tipoMovimiento === "COMPRA RECIBIDA"
      )
      .reduce(
        (total, movimiento) => total + movimiento.importe,
        0
      );

    const totalPagos = filtrados
      .filter(
        (movimiento) =>
          movimiento.tipoMovimiento === "PAGO REALIZADO"
      )
      .reduce(
        (total, movimiento) => total + movimiento.importe,
        0
      );

    return {
      movimientos: [...filtrados].reverse(),
      saldoInicial,
      totalCompras,
      totalPagos,
      saldoFinal: saldoInicial + totalCompras - totalPagos,
    };
  }, [movimientos, filtroHistorial]);

  const etiquetaPeriodo =
    filtroHistorial === "ultimos30"
      ? "Últimos 30 días"
      : filtroHistorial === "mesActual"
      ? "Mes actual"
      : "Todo el historial";

  useEffect(() => {
    cargarProveedores();
  }, []);

  async function cargarProveedores() {
    try {
      setCargando(true);
      const response = await fetch("/api/proveedores");
      const data = (await response.json()) as RespuestaProveedores;
      if (!response.ok || !data.ok || !data.proveedores) throw new Error(data.error || "No se pudieron cargar los proveedores.");
      setProveedores(data.proveedores);
    } catch (error) {
      setMensaje({ tipo: "error", texto: error instanceof Error ? error.message : "No se pudieron cargar los proveedores." });
    } finally {
      setCargando(false);
    }
  }

  async function cargarMovimientos(id: string) {
    try {
      setCargando(true);
      const response = await fetch(`/api/movimientos-proveedores?proveedorId=${encodeURIComponent(id)}`);
      const data = (await response.json()) as RespuestaMovimientos;
      if (!response.ok || !data.ok || !data.movimientos) throw new Error(data.error || "No se pudo cargar el historial.");
      setMovimientos(data.movimientos);
    } catch (error) {
      setMensaje({ tipo: "error", texto: error instanceof Error ? error.message : "No se pudo cargar el historial." });
    } finally {
      setCargando(false);
    }
  }

  async function abrirDetalle(id: string) {
    setProveedorId(id);
    setVista("detalle");
    setUltimoPagoId(null);
    await cargarMovimientos(id);
  }

  function volverALista() {
    setVista("lista");
    setProveedorId(null);
    setMovimientos([]);
    setMovimientoEditandoId(null);
    setUltimoPagoId(null);
    setMensaje(null);
    cargarProveedores();
  }

  function abrirFormulario(tipo: TipoMovimiento) {
    setTipoFormulario(tipo);
    setMovimientoEditandoId(null);
    setForm({
      fecha: obtenerFechaHoyInput(),
      comprobante: "",
      medioPago: "",
      datosPago: "",
      importe: "",
      observacion: "",
      responsable: "",
    });
    setItems([crearItemVacio()]);
    setMensaje(null);
    setVista("formulario");
  }

  async function editarMovimiento(movimiento: Movimiento) {
    if (!puedeEditar) return;

    setTipoFormulario(movimiento.tipoMovimiento);
    setMovimientoEditandoId(movimiento.id);

    if (movimiento.tipoMovimiento === "COMPRA RECIBIDA") {
      try {
        setCargando(true);
        const response = await fetch(`/api/movimientos-proveedores?accion=detalle-compra&movimientoId=${encodeURIComponent(movimiento.id)}`);
        const data = (await response.json()) as RespuestaMovimientos;
        if (!response.ok || !data.ok || !data.detalle) throw new Error(data.error || "No se pudo cargar la compra.");

        const detalle = data.detalle;
        setForm({
          fecha: fechaParaInput(detalle.fecha),
          comprobante: detalle.comprobante,
          medioPago: "",
          datosPago: "",
          importe: String(detalle.importe),
          observacion: detalle.observaciones,
          responsable: detalle.responsable,
        });
        setItems(
          detalle.items.map((item) => ({
            idLocal: item.id,
            id: item.id,
            descripcion: item.descripcion,
            cantidad: String(item.cantidad),
            unidad: item.unidad,
            precioUnitario: String(item.precioUnitario),
            observaciones: item.observaciones,
          }))
        );
      } catch (error) {
        setMensaje({ tipo: "error", texto: error instanceof Error ? error.message : "No se pudo cargar la compra." });
        return;
      } finally {
        setCargando(false);
      }
    } else {
      setForm({
        fecha: fechaParaInput(movimiento.fecha),
        comprobante: movimiento.comprobante,
        medioPago: movimiento.medioPago,
        datosPago: movimiento.datosPago,
        importe: String(movimiento.importe),
        observacion: movimiento.observacion,
        responsable: movimiento.responsable,
      });
    }

    setVista("formulario");
  }

  function actualizarItem(idLocal: string, campo: keyof Omit<ItemCompraFormulario, "idLocal" | "id">, valor: string) {
    setItems((actuales) => actuales.map((item) => (item.idLocal === idLocal ? { ...item, [campo]: valor } : item)));
  }

  function validarItems() {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item.descripcion.trim()) return `Completá la descripción del ítem ${index + 1}.`;
      if ((Number(item.cantidad) || 0) <= 0) return `La cantidad del ítem ${index + 1} debe ser mayor a cero.`;
      if (item.precioUnitario.trim() === "" || Number(item.precioUnitario) < 0) return `El precio del ítem ${index + 1} debe ser cero o mayor.`;
    }
    return "";
  }

  async function guardarNuevoProveedor() {
    if (!nuevoProveedor.proveedor.trim()) {
      setMensaje({ tipo: "error", texto: "El nombre del proveedor es obligatorio." });
      return;
    }

    try {
      setGuardando(true);
      const response = await fetch("/api/proveedores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevoProveedor),
      });
      const data = (await response.json()) as RespuestaProveedores;
      if (!response.ok || !data.ok || !data.proveedor) throw new Error(data.error || "No se pudo guardar el proveedor.");
      setProveedores((actuales) => [data.proveedor as Proveedor, ...actuales]);
      setProveedorId(data.proveedor.id);
      setMovimientos([]);
      setVista("detalle");
      setMensaje({ tipo: "exito", texto: "Proveedor creado correctamente." });
    } catch (error) {
      setMensaje({ tipo: "error", texto: error instanceof Error ? error.message : "No se pudo guardar el proveedor." });
    } finally {
      setGuardando(false);
    }
  }

  async function guardarMovimiento() {
    if (!proveedorId) return;

    const esCompra = tipoFormulario === "COMPRA RECIBIDA";
    const importe = esCompra ? totalCompra : Number(form.importe);

    if (!form.fecha) {
      setMensaje({ tipo: "error", texto: "Completá la fecha." });
      return;
    }

    if (esCompra) {
      const errorItems = validarItems();
      if (errorItems) {
        setMensaje({ tipo: "error", texto: errorItems });
        return;
      }
    } else {
      if (!importe || importe <= 0) {
        setMensaje({ tipo: "error", texto: "El importe debe ser mayor a cero." });
        return;
      }
      if (!form.medioPago) {
        setMensaje({ tipo: "error", texto: "Seleccioná el medio de pago." });
        return;
      }
    }

    try {
      setGuardando(true);
      setMensaje({
        tipo: "info",
        texto: movimientoEditandoId ? "Actualizando..." : esCompra ? "Guardando compra e ítems..." : "Guardando pago...",
      });

      const body = esCompra
        ? {
            accion: movimientoEditandoId ? "actualizar-compra" : "crear-compra",
            ...(movimientoEditandoId ? { movimientoId: movimientoEditandoId } : { proveedorId }),
            fecha: form.fecha,
            comprobante: form.comprobante,
            observaciones: form.observacion,
            responsable: form.responsable,
            items: items.map((item) => ({
              id: item.id,
              descripcion: item.descripcion,
              cantidad: Number(item.cantidad),
              unidad: item.unidad,
              precioUnitario: Number(item.precioUnitario),
              observaciones: item.observaciones,
            })),
          }
        : movimientoEditandoId
        ? {
            id: movimientoEditandoId,
            fecha: form.fecha,
            comprobante: form.comprobante,
            medioPago: form.medioPago,
            datosPago: form.datosPago,
            importe,
            observacion: form.observacion,
            responsable: form.responsable,
          }
        : {
            proveedorId,
            fecha: form.fecha,
            tipoMovimiento: "PAGO REALIZADO",
            comprobante: form.comprobante,
            medioPago: form.medioPago,
            datosPago: form.datosPago,
            importe,
            observacion: form.observacion,
            responsable: form.responsable,
          };

      const response = await fetch("/api/movimientos-proveedores", {
        method: movimientoEditandoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as RespuestaMovimientos;
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo guardar el movimiento.");

      const pagoCreado = !esCompra && !movimientoEditandoId ? data.movimiento?.id || null : null;
      await cargarMovimientos(proveedorId);
      await cargarProveedores();
      setMovimientoEditandoId(null);
      setUltimoPagoId(pagoCreado);
      setVista("detalle");
      setMensaje({
        tipo: "exito",
        texto: esCompra ? "Compra guardada y saldo recalculado." : "Pago guardado correctamente.",
      });
    } catch (error) {
      setMensaje({ tipo: "error", texto: error instanceof Error ? error.message : "No se pudo guardar el movimiento." });
    } finally {
      setGuardando(false);
    }
  }

  function calcularSaldosPago(movimientoId: string) {
    const ordenados = [...movimientos].sort((a, b) => {
      const convertir = (fecha: string) => {
        const [dia, mes, anio] = fecha.split("/");
        return new Date(Number(anio), Number(mes) - 1, Number(dia)).getTime();
      };
      return convertir(a.fecha) - convertir(b.fecha);
    });

    let saldo = 0;
    for (const movimiento of ordenados) {
      const anterior = saldo;
      saldo += movimiento.importeFirmado;
      if (movimiento.id === movimientoId) return { anterior, posterior: saldo };
    }
    return { anterior: 0, posterior: 0 };
  }

  async function procesarComprobantePago(
    movimiento: Movimiento,
    accion: "compartir" | "descargar"
  ) {
    if (!proveedor) return;

    try {
      const saldos = calcularSaldosPago(movimiento.id);
      const pdf = crearPdfComprobantePago({
        empresa: usuario.empresa || usuario.nombre,
        proveedor,
        movimiento,
        saldoAnterior: saldos.anterior,
        saldoPosterior: saldos.posterior,
      });

      const nombreBase = normalizarNombreArchivo(
        movimiento.comprobante ||
          `Pago_${proveedor.proveedor}_${movimiento.fecha}`
      );
      const nombreArchivo = `${nombreBase || "Comprobante_pago"}.pdf`;

      if (accion === "compartir") {
        const compartido = await compartirArchivoPdf(
          pdf.output("blob"),
          nombreArchivo,
          "Comprobante de pago"
        );

        if (!compartido) {
          setMensaje({
            tipo: "info",
            texto:
              "Este dispositivo no permite compartir archivos directamente. El PDF se descargó.",
          });
        }
      } else {
        pdf.save(nombreArchivo);
      }
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }

      setMensaje({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudo generar el comprobante.",
      });
    }
  }

  async function obtenerDetalleCompra(movimientoId: string) {
    const response = await fetch(
      `/api/movimientos-proveedores?accion=detalle-compra&movimientoId=${encodeURIComponent(movimientoId)}`
    );
    const data = (await response.json()) as RespuestaMovimientos;

    if (!response.ok || !data.ok || !data.detalle) {
      throw new Error(data.error || "No se pudo cargar el detalle de la compra.");
    }

    return data.detalle;
  }

  async function verDetalleCompra(movimientoId: string) {
    try {
      setCargandoDetalleCompraId(movimientoId);
      setMensaje(null);
      setDetalleCompraVisible(await obtenerDetalleCompra(movimientoId));
    } catch (error) {
      setMensaje({
        tipo: "error",
        texto: error instanceof Error ? error.message : "No se pudo cargar el detalle de la compra.",
      });
    } finally {
      setCargandoDetalleCompraId(null);
    }
  }

  async function procesarCompra(
    movimientoId: string,
    accion: "compartir" | "descargar"
  ) {
    if (!proveedor) return;

    try {
      setCargandoDetalleCompraId(movimientoId);

      const detalle =
        detalleCompraVisible?.movimientoId === movimientoId
          ? detalleCompraVisible
          : await obtenerDetalleCompra(movimientoId);

      const pdf = crearPdfCompra({
        empresa: usuario.empresa || usuario.nombre,
        proveedor,
        detalle,
      });

      const nombreBase = normalizarNombreArchivo(
        detalle.comprobante ||
          `Compra_${proveedor.proveedor}_${detalle.fecha}`
      );
      const nombreArchivo = `${nombreBase || "Compra"}.pdf`;

      if (accion === "compartir") {
        const compartido = await compartirArchivoPdf(
          pdf.output("blob"),
          nombreArchivo,
          detalle.comprobante || "Compra recibida"
        );

        if (!compartido) {
          setMensaje({
            tipo: "info",
            texto:
              "Este dispositivo no permite compartir archivos directamente. El PDF se descargó.",
          });
        }
      } else {
        pdf.save(nombreArchivo);
      }
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }

      setMensaje({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudo generar la compra.",
      });
    } finally {
      setCargandoDetalleCompraId(null);
    }
  }

  async function procesarResumenCuenta(
    accion: "compartir" | "descargar"
  ) {
    if (!proveedor) return;

    try {
      const pdf = crearPdfResumenCuenta({
        empresa: usuario.empresa || usuario.nombre,
        proveedor,
        etiquetaPeriodo,
        saldoInicial: resumenHistorial.saldoInicial,
        totalCompras: resumenHistorial.totalCompras,
        totalPagos: resumenHistorial.totalPagos,
        saldoFinal: resumenHistorial.saldoFinal,
        movimientos: resumenHistorial.movimientos,
      });

      const nombreBase = normalizarNombreArchivo(
        `Resumen_${proveedor.proveedor}_${etiquetaPeriodo}`
      );
      const nombreArchivo = `${nombreBase || "Resumen_cuenta"}.pdf`;

      if (accion === "compartir") {
        const compartido = await compartirArchivoPdf(
          pdf.output("blob"),
          nombreArchivo,
          `Resumen de cuenta - ${proveedor.proveedor}`
        );

        if (!compartido) {
          setMensaje({
            tipo: "info",
            texto:
              "Este dispositivo no permite compartir archivos directamente. El PDF se descargó.",
          });
        }
      } else {
        pdf.save(nombreArchivo);
      }
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }

      setMensaje({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudo generar el resumen.",
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
          <button className="cc-soft-button" type="button" onClick={volverALista}>Volver</button>
        )}
      </div>

      {mensaje && <div className={`message message-${mensaje.tipo}`}>{mensaje.texto}</div>}

      {vista === "lista" && (
        <div className="cc-stack">
          <section className="cc-total-card">
            <span>Total a pagar</span>
            <strong>{formatearPesos(totalAPagar)}</strong>
            <p>Proveedores con saldo pendiente.</p>
          </section>

          <div className="cc-list-actions">
            <input className="cc-search-input" value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Buscar proveedor..." />
            <button className="cc-primary-button" type="button" onClick={() => setVista("nuevoProveedor")}>+ Nuevo proveedor</button>
          </div>

          {cargando ? (
            <div className="cc-empty-card">Cargando...</div>
          ) : proveedoresFiltrados.length === 0 ? (
            <div className="cc-empty-card">No hay proveedores para mostrar.</div>
          ) : (
            <div className="cc-client-list">
              {proveedoresFiltrados.map((item) => (
                <button key={item.id} className="cc-client-card" type="button" onClick={() => abrirDetalle(item.id)}>
                  <div><h3>{item.proveedor}</h3><p>{item.telefono || "Sin teléfono cargado"}</p></div>
                  <strong className={`cc-status-pill ${item.saldoActual > 0 ? "cc-status-debe" : "cc-status-al-dia"}`}>
                    {item.saldoActual > 0 ? `Debe ${formatearPesos(item.saldoActual)}` : "Al día"}
                  </strong>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {vista === "nuevoProveedor" && (
        <section className="cc-card cc-form-card">
          <h3>Nuevo proveedor</h3>
          <label>Nombre del proveedor *<input value={nuevoProveedor.proveedor} onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, proveedor: event.target.value })} /></label>
          <label>Teléfono<input value={nuevoProveedor.telefono} onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, telefono: event.target.value })} /></label>
          <label>CUIT<input value={nuevoProveedor.cuit} onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, cuit: event.target.value })} /></label>
          <label>Dirección<input value={nuevoProveedor.direccion} onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, direccion: event.target.value })} /></label>
          <label>Observaciones<textarea value={nuevoProveedor.observaciones} onChange={(event) => setNuevoProveedor({ ...nuevoProveedor, observaciones: event.target.value })} /></label>
          <button className="cc-primary-button cc-full-button" type="button" onClick={guardarNuevoProveedor} disabled={guardando}>{guardando ? "Guardando..." : "Guardar proveedor"}</button>
        </section>
      )}

      {vista === "detalle" && proveedor && (
        <div className="cc-stack">
          <section className="cc-card cc-detail-card">
            <span>Proveedor</span>
            <h3>{proveedor.proveedor}</h3>
            <div className="cc-balance-box">
              <span>Saldo actual</span>
              <strong>{formatearPesos(proveedor.saldoActual)}</strong>
              <p>{proveedor.saldoActual > 0 ? "Saldo pendiente de pago" : "Al día"}</p>
            </div>
            <div className="cc-info-list">
              <p><strong>Teléfono:</strong> {proveedor.telefono || "Sin cargar"}</p>
              <p><strong>Dirección:</strong> {proveedor.direccion || "Sin cargar"}</p>
              {proveedor.cuit && <p><strong>CUIT:</strong> {proveedor.cuit}</p>}
            </div>
            <div className="cc-action-grid">
              <button className="cc-primary-button" type="button" onClick={() => abrirFormulario("COMPRA RECIBIDA")}>Registrar compra</button>
              <button className="cc-green-button" type="button" onClick={() => abrirFormulario("PAGO REALIZADO")}>Registrar pago</button>
            </div>
          </section>

          {ultimoPagoId && (
            <section className="cc-card cc-payment-success-card">
              <h3>Pago registrado</h3>
              <p>El comprobante ya está listo.</p>
              <button className="cc-primary-button" type="button" onClick={() => {
                const pago = movimientos.find((item) => item.id === ultimoPagoId);
                if (pago) procesarComprobantePago(pago, "compartir");
              }}>Compartir comprobante</button>

              <button
                className="cc-soft-button cc-full-button"
                type="button"
                onClick={() => {
                  const pago = movimientos.find(
                    (item) => item.id === ultimoPagoId
                  );
                  if (pago) {
                    procesarComprobantePago(pago, "descargar");
                  }
                }}
              >
                Descargar PDF
              </button>
            </section>
          )}

          {detalleCompraVisible && (
            <section className="cc-card cc-purchase-detail-card">
              <div className="cc-purchase-detail-header">
                <div>
                  <span>Detalle de compra</span>
                  <h3>{detalleCompraVisible.comprobante || "Compra recibida"}</h3>
                  <p>{formatearFecha(detalleCompraVisible.fecha)}</p>
                </div>
                <button className="cc-soft-button" type="button" onClick={() => setDetalleCompraVisible(null)}>
                  Cerrar
                </button>
              </div>

              <div className="cc-purchase-detail-items">
                {detalleCompraVisible.items.map((item) => (
                  <article className="cc-purchase-detail-item" key={item.id}>
                    <div>
                      <strong>{item.descripcion}</strong>
                      <p>
                        {item.cantidad} {item.unidad}
                        {item.observaciones ? ` · ${item.observaciones}` : ""}
                      </p>
                    </div>
                    <div>
                      <span>{formatearPesos(item.precioUnitario)} c/u</span>
                      <strong>{formatearPesos(item.totalItem)}</strong>
                    </div>
                  </article>
                ))}
              </div>

              <div className="cc-purchase-detail-total">
                <span>Total de la compra</span>
                <strong>{formatearPesos(detalleCompraVisible.importe)}</strong>
              </div>

              {detalleCompraVisible.observaciones && (
                <p className="cc-purchase-detail-note">
                  <strong>Observaciones:</strong> {detalleCompraVisible.observaciones}
                </p>
              )}

              {detalleCompraVisible.responsable && (
                <p className="cc-purchase-detail-note">
                  <strong>Responsable:</strong> {detalleCompraVisible.responsable}
                </p>
              )}

              <button
                className="cc-primary-button cc-full-button"
                type="button"
                onClick={() => procesarCompra(detalleCompraVisible.movimientoId, "compartir")}
                disabled={cargandoDetalleCompraId === detalleCompraVisible.movimientoId}
              >
                {cargandoDetalleCompraId === detalleCompraVisible.movimientoId
                  ? "Preparando PDF..."
                  : "Compartir compra"}
              </button>

              <button
                className="cc-soft-button cc-full-button"
                type="button"
                onClick={() =>
                  procesarCompra(
                    detalleCompraVisible.movimientoId,
                    "descargar"
                  )
                }
                disabled={
                  cargandoDetalleCompraId ===
                  detalleCompraVisible.movimientoId
                }
              >
                Descargar PDF
              </button>
            </section>
          )}

          <section className="cc-history-section">
            <div className="cc-history-header">
              <div>
                <h3>Historial</h3>
                <p>{etiquetaPeriodo}</p>
              </div>

              <button
                className="cc-primary-button"
                type="button"
                onClick={() => procesarResumenCuenta("compartir")}
                disabled={resumenHistorial.movimientos.length === 0}
              >
                Descargar resumen
              </button>

              <button
                className="cc-soft-button"
                type="button"
                onClick={() =>
                  procesarResumenCuenta("descargar")
                }
                disabled={
                  resumenHistorial.movimientos.length === 0
                }
              >
                Descargar PDF
              </button>
            </div>

            <div className="cc-history-filters">
              <button
                type="button"
                className={
                  filtroHistorial === "ultimos30"
                    ? "cc-history-filter active"
                    : "cc-history-filter"
                }
                onClick={() => setFiltroHistorial("ultimos30")}
              >
                Últimos 30 días
              </button>

              <button
                type="button"
                className={
                  filtroHistorial === "mesActual"
                    ? "cc-history-filter active"
                    : "cc-history-filter"
                }
                onClick={() => setFiltroHistorial("mesActual")}
              >
                Mes actual
              </button>

              <button
                type="button"
                className={
                  filtroHistorial === "todo"
                    ? "cc-history-filter active"
                    : "cc-history-filter"
                }
                onClick={() => setFiltroHistorial("todo")}
              >
                Todo
              </button>
            </div>

            <div className="cc-history-summary">
              <div>
                <span>Saldo inicial</span>
                <strong>{formatearPesos(resumenHistorial.saldoInicial)}</strong>
              </div>
              <div>
                <span>Compras</span>
                <strong>{formatearPesos(resumenHistorial.totalCompras)}</strong>
              </div>
              <div>
                <span>Pagos</span>
                <strong>{formatearPesos(resumenHistorial.totalPagos)}</strong>
              </div>
              <div>
                <span>Saldo final</span>
                <strong>{formatearPesos(resumenHistorial.saldoFinal)}</strong>
              </div>
            </div>

            {cargando ? (
              <div className="cc-empty-card">Cargando...</div>
            ) : resumenHistorial.movimientos.length === 0 ? (
              <div className="cc-empty-card">
                No hay movimientos en el período seleccionado.
              </div>
            ) : (
              resumenHistorial.movimientos.map((movimiento) => {
                const esPago = movimiento.tipoMovimiento === "PAGO REALIZADO";
                return (
                  <article key={movimiento.id} className="cc-movement-card">
                    <div>
                      <span>{formatearFecha(movimiento.fecha)}</span>
                      <h4>{movimiento.comprobante || (esPago ? "Pago realizado" : "Compra recibida")}</h4>
                      <p>{esPago ? `Pago · ${movimiento.medioPago}` : "Compra recibida"}</p>
                      {movimiento.datosPago && <p>{movimiento.datosPago}</p>}
                      {movimiento.observacion && <p>{movimiento.observacion}</p>}
                      {movimiento.responsable && <p>Responsable: {movimiento.responsable}</p>}
                    </div>
                    <div className="cc-movement-actions">
                      <strong className={esPago ? "cc-amount-negative" : "cc-amount-positive"}>
                        {movimiento.importeFirmado > 0 ? "+" : "-"}{formatearPesos(Math.abs(movimiento.importeFirmado))}
                      </strong>
                      {esPago && puedeExportar && (
                        <>
                          <button
                            className="cc-primary-button"
                            type="button"
                            onClick={() =>
                              procesarComprobantePago(
                                movimiento,
                                "compartir"
                              )
                            }
                          >
                            Compartir
                          </button>
                          <button
                            className="cc-soft-button"
                            type="button"
                            onClick={() =>
                              procesarComprobantePago(
                                movimiento,
                                "descargar"
                              )
                            }
                          >
                            Compartir PDF
                          </button>

                          <button
                            className="cc-soft-button"
                            type="button"
                            onClick={() =>
                              procesarCompra(
                                movimiento.id,
                                "descargar"
                              )
                            }
                            disabled={
                              cargandoDetalleCompraId === movimiento.id
                            }
                          >
                            Descargar PDF
                          </button>
                        </>
                      )}

                      {!esPago && (
                        <>
                          <button
                            className="cc-primary-button"
                            type="button"
                            onClick={() => verDetalleCompra(movimiento.id)}
                            disabled={cargandoDetalleCompraId === movimiento.id}
                          >
                            {cargandoDetalleCompraId === movimiento.id ? "Cargando..." : "Ver detalle"}
                          </button>
                          <button
                            className="cc-soft-button"
                            type="button"
                            onClick={() => procesarCompra(movimiento.id, "compartir")}
                            disabled={cargandoDetalleCompraId === movimiento.id}
                          >
                            Descargar PDF
                          </button>
                        </>
                      )}

                      {puedeEditar && (
                        <button className="cc-soft-button" type="button" onClick={() => editarMovimiento(movimiento)}>{esPago ? "Editar pago" : "Editar compra"}</button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </div>
      )}

      {vista === "formulario" && proveedor && (
        <section className="cc-card cc-form-card">
          <p>Proveedor: {proveedor.proveedor}</p>
          <h3>{movimientoEditandoId ? (tipoFormulario === "COMPRA RECIBIDA" ? "Editar compra" : "Editar pago") : tipoFormulario === "COMPRA RECIBIDA" ? "Registrar compra" : "Registrar pago"}</h3>

          <label>Fecha *<input type="date" value={form.fecha} onChange={(event) => setForm({ ...form, fecha: event.target.value })} /></label>
          <label>Comprobante<input value={form.comprobante} onChange={(event) => setForm({ ...form, comprobante: event.target.value })} placeholder={tipoFormulario === "COMPRA RECIBIDA" ? "Factura o remito" : "Recibo u operación"} /></label>

          {tipoFormulario === "COMPRA RECIBIDA" ? (
            <section className="cc-items-section">
              <div className="cc-items-title-row">
                <div><span>Detalle de compra</span><h4>Ítems</h4></div>
                <button className="cc-add-item-button" type="button" onClick={() => setItems((actuales) => [...actuales, crearItemVacio()])}>+ Agregar ítem</button>
              </div>

              <div className="cc-items-list">
                {items.map((item, index) => (
                  <article className="cc-item-card" key={item.idLocal}>
                    <div className="cc-item-header">
                      <strong>Ítem {index + 1}</strong>
                      {items.length > 1 && (
                        <button className="cc-remove-item-button" type="button" onClick={() => setItems((actuales) => actuales.filter((actual) => actual.idLocal !== item.idLocal))}>Quitar</button>
                      )}
                    </div>
                    <label>Descripción *<input value={item.descripcion} onChange={(event) => actualizarItem(item.idLocal, "descripcion", event.target.value)} /></label>
                    <div className="cc-item-grid">
                      <label>Cantidad *<input type="number" min="0.001" step="0.001" value={item.cantidad} onChange={(event) => actualizarItem(item.idLocal, "cantidad", event.target.value)} /></label>
                      <label>Unidad *<select value={item.unidad} onChange={(event) => actualizarItem(item.idLocal, "unidad", event.target.value)}>{UNIDADES.map((unidad) => <option key={unidad} value={unidad}>{unidad}</option>)}</select></label>
                    </div>
                    <div className="cc-item-price-grid">
                      <label>Precio unitario *<input type="number" min="0" step="0.01" value={item.precioUnitario} onChange={(event) => actualizarItem(item.idLocal, "precioUnitario", event.target.value)} /></label>
                      <div className="cc-item-total-box"><span>Total del ítem</span><strong>{formatearPesos((Number(item.cantidad) || 0) * (Number(item.precioUnitario) || 0))}</strong></div>
                    </div>
                    <label>Observación del ítem<input value={item.observaciones} onChange={(event) => actualizarItem(item.idLocal, "observaciones", event.target.value)} /></label>
                  </article>
                ))}
              </div>

              <div className="cc-remito-total-box">
                <span>Total general</span>
                <strong>{formatearPesos(totalCompra)}</strong>
                <p>Se recalcula automáticamente al cambiar cantidades o precios.</p>
              </div>
            </section>
          ) : (
            <>
              <label>Medio de pago *<select value={form.medioPago} onChange={(event) => setForm({ ...form, medioPago: event.target.value as MedioPago })}><option value="">Seleccionar</option><option value="EFECTIVO">Efectivo</option><option value="TRANSFERENCIA">Transferencia</option><option value="ECHEQ">Echeq</option></select></label>
              <label>Importe *<input type="number" min="0.01" step="0.01" value={form.importe} onChange={(event) => setForm({ ...form, importe: event.target.value })} /></label>
              <label>Datos del pago<textarea value={form.datosPago} onChange={(event) => setForm({ ...form, datosPago: event.target.value })} placeholder="Transferencia, número de eCheq, vencimiento..." /></label>
            </>
          )}

          <label>Observaciones<textarea value={form.observacion} onChange={(event) => setForm({ ...form, observacion: event.target.value })} /></label>
          <label>Responsable<input value={form.responsable} onChange={(event) => setForm({ ...form, responsable: event.target.value })} /></label>
          <button className="cc-primary-button cc-full-button" type="button" onClick={guardarMovimiento} disabled={guardando || cargando}>
            {guardando ? "Guardando..." : movimientoEditandoId ? "Guardar cambios" : tipoFormulario === "COMPRA RECIBIDA" ? "Guardar compra" : "Guardar pago"}
          </button>
        </section>
      )}
    </section>
  );
}
