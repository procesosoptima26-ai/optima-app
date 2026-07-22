import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
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

type EstadoCliente = "DEBE" | "AL DIA" | "A FAVOR" | string;
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

type ItemRemitoFormulario = {
  idLocal: string;
  descripcion: string;
  cantidad: string;
  unidad: string;
  costoUnitario: string;
  observaciones: string;
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

type RespuestaNumeroRemito = {
  ok?: boolean;
  siguienteNumero?: number;
  comprobante?: string;
  error?: string;
};

type ItemRemitoGuardado = {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  costoUnitario: number;
  totalItem: number;
  orden: number;
  observaciones: string;
};

type DetalleRemito = {
  remitoId: string;
  movimientoId: string;
  numero: number;
  comprobante: string;
  fecha: string;
  clienteIds: string[];
  importe: number;
  observaciones: string;
  responsable: string;
  items: ItemRemitoGuardado[];
};

type RespuestaCrearRemito = {
  ok?: boolean;
  remito?: {
    id: string;
    numero: number;
    comprobante: string;
    movimientoCcId: string;
  };
  error?: string;
};

type RespuestaDetalleRemito = {
  ok?: boolean;
  detalle?: DetalleRemito;
  error?: string;
};

type Props = {
  usuario: UsuarioSesion;
};

const UNIDADES_REMITO = [
  "UNIDAD",
  "CAJÓN",
  "MAPLE",
  "CAJA",
  "PACK",
  "KILO",
  "GRAMO",
  "LITRO",
  "OTRO",
];

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

function crearItemVacio(): ItemRemitoFormulario {
  return {
    idLocal: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    descripcion: "",
    cantidad: "",
    unidad: "UNIDAD",
    costoUnitario: "",
    observaciones: "",
  };
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

function crearPdfRemito(params: {
  emisor: string;
  cliente: Cliente;
  detalle: DetalleRemito;
}) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const margen = 15;
  let y = 18;

  pdf.setTextColor(8, 63, 136);
  pdf.setFontSize(20);
  pdf.setFont("helvetica", "bold");
  pdf.text(params.emisor || "Empresa", margen, y);

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(71, 85, 105);
  pdf.text("Generado por OPTIMA", margen, y + 6);

  pdf.setTextColor(8, 63, 136);
  pdf.setFontSize(13);
  pdf.setFont("helvetica", "bold");
  pdf.text(params.detalle.comprobante, 195, y, {
    align: "right",
  });

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(71, 85, 105);
  pdf.text(
    `Fecha: ${formatearFechaParaMostrar(
      params.detalle.fecha
    )}`,
    195,
    y + 6,
    { align: "right" }
  );

  y += 15;
  pdf.setDrawColor(8, 63, 136);
  pdf.line(margen, y, 195, y);
  y += 10;

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margen, y, 180, 27, 3, 3, "F");
  pdf.setTextColor(8, 63, 136);
  pdf.setFontSize(12);
  pdf.setFont("helvetica", "bold");
  pdf.text("Cliente", margen + 4, y + 7);

  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(10);
  pdf.text(params.cliente.cliente, margen + 4, y + 14);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  const datosCliente = [
    params.cliente.cuit
      ? `CUIT: ${params.cliente.cuit}`
      : "",
    params.cliente.direccion
      ? `Direccion: ${params.cliente.direccion}`
      : "",
    params.cliente.telefono
      ? `Telefono: ${params.cliente.telefono}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");

  if (datosCliente) {
    pdf.text(datosCliente, margen + 4, y + 21, {
      maxWidth: 172,
    });
  }

  y += 36;

  const columnas = {
    descripcion: margen,
    cantidad: 112,
    unidad: 132,
    unitario: 154,
    total: 195,
  };

  pdf.setFillColor(239, 246, 255);
  pdf.rect(margen, y, 180, 9, "F");
  pdf.setTextColor(8, 63, 136);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("Descripcion", columnas.descripcion + 2, y + 6);
  pdf.text("Cant.", columnas.cantidad, y + 6, {
    align: "right",
  });
  pdf.text("Unidad", columnas.unidad, y + 6, {
    align: "right",
  });
  pdf.text("C. unitario", columnas.unitario, y + 6, {
    align: "right",
  });
  pdf.text("Total", columnas.total, y + 6, {
    align: "right",
  });
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
      formatearPesos(item.costoUnitario),
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
  pdf.text("Total del remito", 190, y + 6, {
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

  y += 27;
  pdf.setTextColor(71, 85, 105);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");

  if (params.detalle.observaciones) {
    pdf.text(
      `Observaciones: ${params.detalle.observaciones}`,
      margen,
      y,
      { maxWidth: 180 }
    );
    y += 8;
  }

  if (params.detalle.responsable) {
    pdf.text(
      `Responsable: ${params.detalle.responsable}`,
      margen,
      y
    );
  }

  return pdf;
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

export default function CuentasCorrientes({ usuario }: Props) {
  const puedeEditarGuardado = tienePermiso(
    usuario.rol,
    "cuentasCorrientes.editarGuardado"
  );
  const puedeExportar = tienePermiso(
    usuario.rol,
    "cuentasCorrientes.exportar"
  );

  const [vista, setVista] = useState<Vista>("lista");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [clienteSeleccionadoId, setClienteSeleccionadoId] = useState<string | null>(null);
  const [movimientoEditandoId, setMovimientoEditandoId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [cargandoMovimientos, setCargandoMovimientos] = useState(false);
  const [cargandoNumeroRemito, setCargandoNumeroRemito] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [tipoFormulario, setTipoFormulario] = useState<TipoMovimiento>("REMITO EMITIDO");
  const [numeroRemitoAutomatico, setNumeroRemitoAutomatico] = useState("");
  const [descargandoRemitoId, setDescargandoRemitoId] = useState<string | null>(null);
  const [ultimoRemitoMovimientoId, setUltimoRemitoMovimientoId] = useState<string | null>(null);
  const [ultimoRemitoComprobante, setUltimoRemitoComprobante] = useState("");

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

  const [itemsRemito, setItemsRemito] = useState<ItemRemitoFormulario[]>([
    crearItemVacio(),
  ]);

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

  const totalRemito = useMemo(() => {
    return itemsRemito.reduce((total, item) => {
      const cantidad = Number(item.cantidad);
      const costoUnitario = Number(item.costoUnitario);

      if (Number.isNaN(cantidad) || Number.isNaN(costoUnitario)) {
        return total;
      }

      return total + cantidad * costoUnitario;
    }, 0);
  }, [itemsRemito]);

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

  async function cargarSiguienteNumeroRemito() {
    try {
      setCargandoNumeroRemito(true);
      setNumeroRemitoAutomatico("");

      const response = await fetch("/api/movimientos-cc?accion=siguiente-remito");
      const data = (await response.json()) as RespuestaNumeroRemito;

      if (!response.ok || !data.ok || !data.comprobante) {
        throw new Error(data.error || "No se pudo obtener el próximo número");
      }

      setNumeroRemitoAutomatico(data.comprobante);
    } catch (error) {
      console.error("Error obteniendo número de remito:", error);
      setMensaje({
        tipo: "error",
        texto: "No se pudo obtener el número automático del remito.",
      });
    } finally {
      setCargandoNumeroRemito(false);
    }
  }

  async function abrirDetalle(clienteId: string) {
    setClienteSeleccionadoId(clienteId);
    setMovimientoEditandoId(null);
    setVista("detalle");
    await cargarMovimientos(clienteId);
  }

  function volverALista() {
    setVista("lista");
    setClienteSeleccionadoId(null);
    setMovimientoEditandoId(null);
    setMovimientos([]);
    setUltimoRemitoMovimientoId(null);
    setUltimoRemitoComprobante("");
    setMensaje(null);
    cargarClientes();
  }

  async function abrirFormulario(tipo: TipoMovimiento) {
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
    setItemsRemito([crearItemVacio()]);
    setNumeroRemitoAutomatico("");
    setMensaje(null);
    setVista("formulario");

    if (tipo === "REMITO EMITIDO") {
      await cargarSiguienteNumeroRemito();
    }
  }

  function editarMovimiento(movimiento: Movimiento) {
    if (!puedeEditarGuardado) return;

    setMovimientoEditandoId(movimiento.id);
    setTipoFormulario(movimiento.tipoMovimiento);
    setFormMovimiento({
      fecha: movimiento.fecha.includes("/")
        ? movimiento.fecha.split("/").reverse().join("-")
        : movimiento.fecha,
      comprobante: movimiento.comprobante,
      medioPago: movimiento.medioPago || "",
      datosPago: movimiento.datosPago,
      importe: String(movimiento.importe),
      observacion: movimiento.observacion,
      responsable: movimiento.responsable,
    });
    setNumeroRemitoAutomatico(movimiento.comprobante);
    setItemsRemito([crearItemVacio()]);
    setMensaje({
      tipo: "info",
      texto:
        movimiento.tipoMovimiento === "REMITO EMITIDO"
          ? "Editando los datos generales del remito. Los ítems existentes no se modifican desde esta pantalla."
          : "Editando movimiento guardado.",
    });
    setVista("formulario");
  }

  function agregarItemRemito() {
    setItemsRemito((actuales) => [...actuales, crearItemVacio()]);
  }

  function quitarItemRemito(idLocal: string) {
    setItemsRemito((actuales) => {
      if (actuales.length === 1) {
        return actuales;
      }

      return actuales.filter((item) => item.idLocal !== idLocal);
    });
  }

  function actualizarItemRemito(
    idLocal: string,
    campo: keyof Omit<ItemRemitoFormulario, "idLocal">,
    valor: string
  ) {
    setItemsRemito((actuales) =>
      actuales.map((item) =>
        item.idLocal === idLocal ? { ...item, [campo]: valor } : item
      )
    );
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

  function validarItemsRemito() {
    if (itemsRemito.length === 0) {
      return "Agregá al menos un ítem al remito.";
    }

    for (let index = 0; index < itemsRemito.length; index += 1) {
      const item = itemsRemito[index];
      const cantidad = Number(item.cantidad);

      if (!item.descripcion.trim()) {
        return `Completá la descripción del ítem ${index + 1}.`;
      }

      if (
        item.cantidad.trim() === "" ||
        Number.isNaN(cantidad) ||
        cantidad <= 0
      ) {
        return `La cantidad del ítem ${index + 1} debe ser mayor a cero.`;
      }

      if (!item.unidad.trim()) {
        return `Seleccioná la unidad del ítem ${index + 1}.`;
      }

      const costoUnitario = Number(item.costoUnitario);

      if (
        item.costoUnitario.trim() === "" ||
        Number.isNaN(costoUnitario) ||
        costoUnitario < 0
      ) {
        return `El costo unitario del ítem ${index + 1} debe ser cero o mayor.`;
      }
    }

    return "";
  }

  async function guardarMovimiento() {
    if (!clienteSeleccionadoId) return;

    const esNuevoRemito =
      tipoFormulario === "REMITO EMITIDO" && !movimientoEditandoId;
    const importeTexto = esNuevoRemito
      ? String(totalRemito)
      : formMovimiento.importe.trim();
    const importeNumerico = Number(importeTexto);

    if (!formMovimiento.fecha) {
      setMensaje({
        tipo: "error",
        texto: "Completá la fecha.",
      });
      return;
    }

    if (
      importeTexto === "" ||
      Number.isNaN(importeNumerico) ||
      importeNumerico < 0
    ) {
      setMensaje({
        tipo: "error",
        texto: "El importe debe ser cero o mayor.",
      });
      return;
    }

    if (tipoFormulario === "PAGO RECIBIDO" && importeNumerico <= 0) {
      setMensaje({
        tipo: "error",
        texto: "El pago debe tener un importe mayor a cero.",
      });
      return;
    }

    if (tipoFormulario === "PAGO RECIBIDO" && !formMovimiento.medioPago) {
      setMensaje({ tipo: "error", texto: "Seleccioná el medio de pago." });
      return;
    }

    if (
      tipoFormulario === "REMITO EMITIDO" &&
      !movimientoEditandoId
    ) {
      const errorItems = validarItemsRemito();

      if (errorItems) {
        setMensaje({ tipo: "error", texto: errorItems });
        return;
      }
    }

    try {
      setGuardando(true);
      setMensaje({
        tipo: "info",
        texto: movimientoEditandoId
          ? "Actualizando movimiento..."
          : tipoFormulario === "REMITO EMITIDO"
          ? "Guardando remito e ítems..."
          : "Guardando pago...",
      });

      const endpoint = "/api/movimientos-cc";

      const body = esNuevoRemito
        ? {
            accion: "crear-remito",
            clienteId: clienteSeleccionadoId,
            fecha: formMovimiento.fecha,
            observaciones: formMovimiento.observacion,
            responsable: formMovimiento.responsable,
            items: itemsRemito.map((item) => ({
              descripcion: item.descripcion,
              cantidad: Number(item.cantidad),
              unidad: item.unidad,
              costoUnitario: Number(item.costoUnitario),
              observaciones: item.observaciones,
            })),
          }
        : movimientoEditandoId
        ? {
            id: movimientoEditandoId,
            fecha: formMovimiento.fecha,
            comprobante: formMovimiento.comprobante,
            medioPago:
              tipoFormulario === "PAGO RECIBIDO"
                ? formMovimiento.medioPago
                : "",
            datosPago:
              tipoFormulario === "PAGO RECIBIDO"
                ? formMovimiento.datosPago
                : "",
            importe: importeNumerico,
            observacion: formMovimiento.observacion,
            responsable: formMovimiento.responsable,
          }
        : {
            clienteId: clienteSeleccionadoId,
            fecha: formMovimiento.fecha,
            tipoMovimiento: tipoFormulario,
            comprobante: formMovimiento.comprobante,
            medioPago:
              tipoFormulario === "PAGO RECIBIDO"
                ? formMovimiento.medioPago
                : "",
            datosPago:
              tipoFormulario === "PAGO RECIBIDO"
                ? formMovimiento.datosPago
                : "",
            importe: importeNumerico,
            observacion: formMovimiento.observacion,
            responsable: formMovimiento.responsable,
          };

      const response = await fetch(endpoint, {
        method: movimientoEditandoId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = esNuevoRemito
        ? ((await response.json()) as RespuestaCrearRemito)
        : ((await response.json()) as RespuestaMovimientos);

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo guardar el movimiento");
      }

      await cargarMovimientos(clienteSeleccionadoId);
      await cargarClientes();

      if (
        esNuevoRemito &&
        "remito" in data &&
        data.remito?.movimientoCcId
      ) {
        setUltimoRemitoMovimientoId(
          data.remito.movimientoCcId
        );
        setUltimoRemitoComprobante(
          data.remito.comprobante
        );
      }

      setMovimientoEditandoId(null);
      setVista("detalle");

      setMensaje({
        tipo: "exito",
        texto: movimientoEditandoId
          ? "Movimiento actualizado correctamente."
          : tipoFormulario === "REMITO EMITIDO"
          ? "Remito e ítems guardados correctamente."
          : "Pago guardado correctamente.",
      });
    } catch (error) {
      console.error("Error guardando movimiento:", error);

      setMensaje({
        tipo: "error",
        texto:
          error instanceof Error && error.message
            ? error.message
            : movimientoEditandoId
            ? "No se pudo actualizar el movimiento."
            : tipoFormulario === "REMITO EMITIDO"
            ? "No se pudo guardar el remito."
            : "No se pudo guardar el pago.",
      });
    } finally {
      setGuardando(false);
    }
  }

  async function obtenerDetalleRemito(
    movimientoId: string
  ) {
    const response = await fetch(
      `/api/movimientos-cc?accion=detalle-remito&movimientoId=${encodeURIComponent(
        movimientoId
      )}`
    );
    const data =
      (await response.json()) as RespuestaDetalleRemito;

    if (!response.ok || !data.ok || !data.detalle) {
      throw new Error(
        data.error || "No se pudo obtener el remito."
      );
    }

    return data.detalle;
  }

  async function procesarPdfRemito(
    movimientoId: string,
    comprobante: string,
    accion: "compartir" | "descargar"
  ) {
    if (!clienteSeleccionado) return;

    try {
      setDescargandoRemitoId(movimientoId);
      setMensaje(null);

      const detalle = await obtenerDetalleRemito(movimientoId);
      const pdf = crearPdfRemito({
        emisor: usuario.empresa || usuario.nombre,
        cliente: clienteSeleccionado,
        detalle,
      });

      const nombreBase = normalizarNombreArchivo(
        comprobante || detalle.comprobante || "Remito"
      );
      const nombreArchivo = `${nombreBase || "Remito"}.pdf`;

      if (accion === "compartir") {
        const compartido = await compartirArchivoPdf(
          pdf.output("blob"),
          nombreArchivo,
          detalle.comprobante || "Remito"
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

      console.error("Error procesando remito:", error);
      setMensaje({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudo generar el remito.",
      });
    } finally {
      setDescargandoRemitoId(null);
    }
  }

  function exportarHistorial() {
    if (!puedeExportar || !clienteSeleccionado) return;

    try {
      const html = construirHtmlExportacion({
        titulo: `Cuenta corriente - ${clienteSeleccionado.cliente}`,
        subtitulo: `Cliente: ${clienteSeleccionado.cliente} · Exportado desde OPTIMA`,
        saldoActual: clienteSeleccionado.saldoActual,
        movimientos: movimientos.map((movimiento) => {
          const esPago = movimiento.tipoMovimiento === "PAGO RECIBIDO";

          return {
            fecha: formatearFechaParaMostrar(movimiento.fecha),
            titulo:
              movimiento.comprobante ||
              (esPago ? "Pago recibido" : "Remito emitido"),
            detalle: esPago
              ? `Pago recibido${
                  movimiento.medioPago ? ` · ${movimiento.medioPago}` : ""
                }${movimiento.datosPago ? ` · ${movimiento.datosPago}` : ""}`
              : "Remito emitido",
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
          <h2>Cuentas Corrientes</h2>
        </div>

        {vista !== "lista" && (
          <button className="cc-soft-button" type="button" onClick={volverALista}>
            Volver
          </button>
        )}
      </div>

      {mensaje && (
        <div className={`message message-${mensaje.tipo}`}>{mensaje.texto}</div>
      )}

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

            <button
              className="cc-primary-button"
              type="button"
              onClick={() => setVista("nuevoCliente")}
            >
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
                const estado =
                  cliente.estado ||
                  obtenerEstadoDesdeSaldo(cliente.saldoActual);

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

                    <strong
                      className={`cc-status-pill cc-status-${obtenerClaseEstado(
                        estado
                      )}`}
                    >
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
              onChange={(event) =>
                setNuevoCliente({
                  ...nuevoCliente,
                  cliente: event.target.value,
                })
              }
              placeholder="Ej: Despensa Norte"
            />
          </label>

          <label>
            Teléfono
            <input
              value={nuevoCliente.telefono}
              onChange={(event) =>
                setNuevoCliente({
                  ...nuevoCliente,
                  telefono: event.target.value,
                })
              }
              placeholder="Ej: 3794 222 456"
            />
          </label>

          <label>
            CUIT
            <input
              value={nuevoCliente.cuit}
              onChange={(event) =>
                setNuevoCliente({
                  ...nuevoCliente,
                  cuit: event.target.value,
                })
              }
              placeholder="Opcional"
            />
          </label>

          <label>
            Dirección
            <input
              value={nuevoCliente.direccion}
              onChange={(event) =>
                setNuevoCliente({
                  ...nuevoCliente,
                  direccion: event.target.value,
                })
              }
              placeholder="Ej: Barrio Norte"
            />
          </label>

          <label>
            Observaciones
            <textarea
              value={nuevoCliente.observaciones}
              onChange={(event) =>
                setNuevoCliente({
                  ...nuevoCliente,
                  observaciones: event.target.value,
                })
              }
              placeholder="Opcional"
            />
          </label>

          <button
            className="cc-primary-button cc-full-button"
            type="button"
            onClick={guardarNuevoCliente}
            disabled={guardando}
          >
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
              <strong>
                {formatearPesos(clienteSeleccionado.saldoActual)}
              </strong>
              <p>{obtenerTextoSaldo(clienteSeleccionado.saldoActual)}</p>
            </div>

            <div className="cc-info-list">
              <p>
                <strong>Teléfono:</strong>{" "}
                {clienteSeleccionado.telefono || "Sin cargar"}
              </p>
              <p>
                <strong>Dirección:</strong>{" "}
                {clienteSeleccionado.direccion || "Sin cargar"}
              </p>
              {clienteSeleccionado.cuit && (
                <p>
                  <strong>CUIT:</strong> {clienteSeleccionado.cuit}
                </p>
              )}
            </div>

            <div className="cc-action-grid">
              <button
                className="cc-primary-button"
                type="button"
                onClick={() => abrirFormulario("REMITO EMITIDO")}
              >
                Registrar remito
              </button>

              <button
                className="cc-green-button"
                type="button"
                onClick={() => abrirFormulario("PAGO RECIBIDO")}
              >
                Registrar pago
              </button>

              {puedeExportar && (
                <button
                  className="cc-soft-button"
                  type="button"
                  onClick={exportarHistorial}
                >
                  Exportar historial
                </button>
              )}
            </div>
          </section>

          {ultimoRemitoMovimientoId && (
            <section className="cc-card">
              <h3 style={{ margin: 0, color: "var(--optima-blue)" }}>
                Remito guardado
              </h3>
              <p style={{ margin: "8px 0 14px", color: "var(--optima-muted)" }}>
                {ultimoRemitoComprobante}
              </p>
              <button
                className="cc-primary-button"
                type="button"
                onClick={() =>
                  procesarPdfRemito(
                    ultimoRemitoMovimientoId,
                    ultimoRemitoComprobante,
                    "compartir"
                  )
                }
                disabled={
                  descargandoRemitoId ===
                  ultimoRemitoMovimientoId
                }
              >
                {descargandoRemitoId ===
                ultimoRemitoMovimientoId
                  ? "Preparando PDF..."
                  : "Compartir PDF"}
              </button>

              <button
                className="cc-soft-button cc-full-button"
                type="button"
                onClick={() =>
                  procesarPdfRemito(
                    ultimoRemitoMovimientoId,
                    ultimoRemitoComprobante,
                    "descargar"
                  )
                }
                disabled={
                  descargandoRemitoId ===
                  ultimoRemitoMovimientoId
                }
              >
                Descargar PDF
              </button>
            </section>
          )}

          <section className="cc-history-section">
            <h3>Historial</h3>

            {cargandoMovimientos ? (
              <div className="cc-empty-card">Cargando historial...</div>
            ) : movimientos.length === 0 ? (
              <div className="cc-empty-card">
                Todavía no hay movimientos cargados.
              </div>
            ) : (
              movimientos.map((movimiento) => {
                const esPago =
                  movimiento.tipoMovimiento === "PAGO RECIBIDO";

                return (
                  <article
                    key={movimiento.id}
                    className="cc-movement-card"
                  >
                    <div>
                      <span>
                        {formatearFechaParaMostrar(movimiento.fecha)}
                      </span>
                      <h4>
                        {movimiento.comprobante ||
                          (esPago
                            ? "Pago recibido"
                            : "Remito emitido")}
                      </h4>
                      <p>
                        {esPago
                          ? `Pago recibido${
                              movimiento.medioPago
                                ? ` · ${movimiento.medioPago}`
                                : ""
                            }`
                          : "Remito emitido"}
                      </p>
                      {movimiento.datosPago && (
                        <p>{movimiento.datosPago}</p>
                      )}
                      {movimiento.observacion && (
                        <p>{movimiento.observacion}</p>
                      )}
                      {movimiento.responsable && (
                        <p>
                          Responsable: {movimiento.responsable}
                        </p>
                      )}
                    </div>

                    <div>
                      <strong
                        className={
                          esPago
                            ? "cc-amount-negative"
                            : "cc-amount-positive"
                        }
                      >
                        {!esPago && movimiento.importe === 0
                          ? "Importe pendiente"
                          : `${
                              movimiento.importeFirmado > 0
                                ? "+"
                                : "-"
                            }${formatearPesos(
                              Math.abs(
                                movimiento.importeFirmado
                              )
                            )}`}
                      </strong>

                      {!esPago && (
                        <div className="cc-document-actions">
                          <button
                            className="cc-primary-button"
                            type="button"
                            onClick={() =>
                              procesarPdfRemito(
                                movimiento.id,
                                movimiento.comprobante,
                                "compartir"
                              )
                            }
                            disabled={
                              descargandoRemitoId === movimiento.id
                            }
                          >
                            {descargandoRemitoId === movimiento.id
                              ? "Preparando PDF..."
                              : "Compartir PDF"}
                          </button>

                          <button
                            className="cc-soft-button"
                            type="button"
                            onClick={() =>
                              procesarPdfRemito(
                                movimiento.id,
                                movimiento.comprobante,
                                "descargar"
                              )
                            }
                            disabled={
                              descargandoRemitoId === movimiento.id
                            }
                          >
                            Descargar PDF
                          </button>
                        </div>
                      )}

                      {puedeEditarGuardado && (
                        <button
                          className="cc-soft-button"
                          type="button"
                          onClick={() =>
                            editarMovimiento(movimiento)
                          }
                          style={{ marginTop: "10px", width: "100%" }}
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

      {vista === "formulario" && clienteSeleccionado && (
        <section className="cc-card cc-form-card">
          <p>Cliente: {clienteSeleccionado.cliente}</p>
          <h3>
            {movimientoEditandoId
              ? "Editar movimiento"
              : tipoFormulario === "REMITO EMITIDO"
              ? "Registrar remito"
              : "Registrar pago"}
          </h3>

          {tipoFormulario === "REMITO EMITIDO" &&
            !movimientoEditandoId && (
              <div className="cc-remito-number-card">
                <span>Número automático</span>
                <strong>
                  {cargandoNumeroRemito
                    ? "Consultando..."
                    : numeroRemitoAutomatico ||
                      "No disponible"}
                </strong>
                <p>
                  El número definitivo se confirma al guardar.
                </p>
              </div>
            )}

          <label>
            Fecha *
            <input
              type="date"
              value={formMovimiento.fecha}
              onChange={(event) =>
                setFormMovimiento({
                  ...formMovimiento,
                  fecha: event.target.value,
                })
              }
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
                <option value="TRANSFERENCIA">
                  Transferencia
                </option>
                <option value="ECHEQ">Echeq</option>
              </select>
            </label>
          )}

          {tipoFormulario === "PAGO RECIBIDO" && (
            <label>
              Comprobante
              <input
                value={formMovimiento.comprobante}
                onChange={(event) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    comprobante: event.target.value,
                  })
                }
                placeholder="Ej: Recibo N° 001"
              />
            </label>
          )}

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
                placeholder="Ej: Echeq N° 456 vence 20/07 o transferencia operación 123"
              />
            </label>
          )}

          {tipoFormulario !== "REMITO EMITIDO" || movimientoEditandoId ? (
            <label>
              Importe *
              <input
                type="number"
                min="0"
                step="0.01"
                value={formMovimiento.importe}
                onChange={(event) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    importe: event.target.value,
                  })
                }
                placeholder="Puede ser 0"
              />
            </label>
          ) : null}

          {tipoFormulario === "REMITO EMITIDO" &&
            !movimientoEditandoId && (
              <section className="cc-items-section">
                <div className="cc-items-title-row">
                  <div>
                    <span>Detalle del remito</span>
                    <h4>Ítems</h4>
                  </div>

                  <button
                    className="cc-add-item-button"
                    type="button"
                    onClick={agregarItemRemito}
                  >
                    + Agregar ítem
                  </button>
                </div>

                <div className="cc-items-list">
                  {itemsRemito.map((item, index) => (
                    <article
                      key={item.idLocal}
                      className="cc-item-card"
                    >
                      <div className="cc-item-header">
                        <strong>Ítem {index + 1}</strong>

                        {itemsRemito.length > 1 && (
                          <button
                            type="button"
                            className="cc-remove-item-button"
                            onClick={() =>
                              quitarItemRemito(item.idLocal)
                            }
                          >
                            Quitar
                          </button>
                        )}
                      </div>

                      <label>
                        Descripción *
                        <input
                          value={item.descripcion}
                          onChange={(event) =>
                            actualizarItemRemito(
                              item.idLocal,
                              "descripcion",
                              event.target.value
                            )
                          }
                          placeholder="Ej: Cajones de huevo"
                        />
                      </label>

                      <div className="cc-item-grid">
                        <label>
                          Cantidad *
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={item.cantidad}
                            onChange={(event) =>
                              actualizarItemRemito(
                                item.idLocal,
                                "cantidad",
                                event.target.value
                              )
                            }
                            placeholder="Ej: 30"
                          />
                        </label>

                        <label>
                          Unidad *
                          <select
                            value={item.unidad}
                            onChange={(event) =>
                              actualizarItemRemito(
                                item.idLocal,
                                "unidad",
                                event.target.value
                              )
                            }
                          >
                            {UNIDADES_REMITO.map((unidad) => (
                              <option key={unidad} value={unidad}>
                                {unidad}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="cc-item-price-grid">
                        <label>
                          Costo unitario *
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.costoUnitario}
                            onChange={(event) =>
                              actualizarItemRemito(
                                item.idLocal,
                                "costoUnitario",
                                event.target.value
                              )
                            }
                            placeholder="Puede ser 0"
                          />
                        </label>

                        <div className="cc-item-total-box">
                          <span>Total del ítem</span>
                          <strong>
                            {formatearPesos(
                              (Number(item.cantidad) || 0) *
                                (Number(item.costoUnitario) || 0)
                            )}
                          </strong>
                        </div>
                      </div>

                      <label>
                        Observación del ítem
                        <input
                          value={item.observaciones}
                          onChange={(event) =>
                            actualizarItemRemito(
                              item.idLocal,
                              "observaciones",
                              event.target.value
                            )
                          }
                          placeholder="Opcional"
                        />
                      </label>
                    </article>
                  ))}
                </div>

                <div className="cc-remito-total-box">
                  <span>Total general del remito</span>
                  <strong>{formatearPesos(totalRemito)}</strong>
                  <p>Se calcula automáticamente con todos los ítems.</p>
                </div>
              </section>
            )}

          <label>
            Observación general
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
                  ? "Ej: Entrega semanal"
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

          <button
            className="cc-primary-button cc-full-button"
            type="button"
            onClick={guardarMovimiento}
            disabled={
              guardando ||
              (tipoFormulario === "REMITO EMITIDO" &&
                !movimientoEditandoId &&
                cargandoNumeroRemito)
            }
          >
            {guardando
              ? movimientoEditandoId
                ? "Actualizando..."
                : "Guardando..."
              : movimientoEditandoId
              ? "Actualizar movimiento"
              : tipoFormulario === "REMITO EMITIDO"
              ? "Guardar remito"
              : "Guardar pago"}
          </button>
        </section>
      )}
    </section>
  );
}
