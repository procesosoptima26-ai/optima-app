import { useEffect, useMemo, useState } from "react";
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

function escaparHtml(valor: string) {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function abrirVentanaImpresion(html: string) {
  const ventana = window.open("", "_blank", "width=900,height=700");
  if (!ventana) throw new Error("El navegador bloqueó la ventana del comprobante.");
  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();
  ventana.focus();
  window.setTimeout(() => ventana.print(), 350);
}

function construirComprobantePago(params: {
  empresa: string;
  proveedor: Proveedor;
  movimiento: Movimiento;
  saldoAnterior: number;
  saldoPosterior: number;
}) {
  return `<!DOCTYPE html>
  <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Comprobante de pago</title>
      <style>
        body{margin:0;padding:32px;font-family:Arial,sans-serif;color:#0f172a}.sheet{max-width:780px;margin:0 auto;border:1px solid #cbd5e1;border-radius:18px;padding:28px}.header{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #083f88;padding-bottom:18px}h1{margin:0;color:#083f88;font-size:28px}h2{margin:6px 0 0;color:#334155;font-size:18px}.number{text-align:right;color:#475569}.box{margin-top:18px;padding:16px;border-radius:14px;background:#f8fafc}.box p{margin:7px 0}.amount{margin-top:18px;padding:18px;border-radius:14px;background:#083f88;color:white;text-align:center}.amount span{display:block;opacity:.85}.amount strong{display:block;margin-top:5px;font-size:34px}.summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.summary div{border:1px solid #cbd5e1;border-radius:12px;padding:14px}.summary strong{display:block;margin-top:5px;color:#083f88;font-size:20px}.signature{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:70px}.signature div{border-top:1px solid #64748b;padding-top:8px;text-align:center;color:#475569;font-size:13px}@media print{body{padding:0}.sheet{border:none}}
      </style>
    </head>
    <body>
      <main class="sheet">
        <header class="header">
          <div><h1>OPTIMA</h1><h2>${escaparHtml(params.empresa || "Empresa")}</h2></div>
          <div class="number"><strong>COMPROBANTE DE PAGO</strong><br />${escaparHtml(params.movimiento.comprobante || "Sin número")}</div>
        </header>
        <section class="box">
          <p><strong>Proveedor:</strong> ${escaparHtml(params.proveedor.proveedor)}</p>
          ${params.proveedor.cuit ? `<p><strong>CUIT:</strong> ${escaparHtml(params.proveedor.cuit)}</p>` : ""}
          <p><strong>Fecha:</strong> ${escaparHtml(formatearFecha(params.movimiento.fecha))}</p>
          <p><strong>Medio de pago:</strong> ${escaparHtml(params.movimiento.medioPago)}</p>
          ${params.movimiento.datosPago ? `<p><strong>Datos:</strong> ${escaparHtml(params.movimiento.datosPago)}</p>` : ""}
        </section>
        <section class="amount"><span>Importe pagado</span><strong>${formatearPesos(params.movimiento.importe)}</strong></section>
        <section class="summary">
          <div><span>Saldo anterior</span><strong>${formatearPesos(params.saldoAnterior)}</strong></div>
          <div><span>Saldo restante</span><strong>${formatearPesos(params.saldoPosterior)}</strong></div>
        </section>
        ${params.movimiento.observacion ? `<section class="box"><strong>Observaciones:</strong> ${escaparHtml(params.movimiento.observacion)}</section>` : ""}
        ${params.movimiento.responsable ? `<section class="box"><strong>Responsable:</strong> ${escaparHtml(params.movimiento.responsable)}</section>` : ""}
        <div class="signature"><div>Firma del pagador</div><div>Firma y aclaración del proveedor</div></div>
      </main>
    </body>
  </html>`;
}


function construirResumenCuenta(params: {
  empresa: string;
  proveedor: Proveedor;
  etiquetaPeriodo: string;
  saldoInicial: number;
  totalCompras: number;
  totalPagos: number;
  saldoFinal: number;
  movimientos: Movimiento[];
}) {
  const filas = [...params.movimientos]
    .sort(
      (a, b) =>
        convertirFechaMovimiento(a.fecha).getTime() -
        convertirFechaMovimiento(b.fecha).getTime()
    )
    .map((movimiento) => {
      const esPago =
        movimiento.tipoMovimiento === "PAGO REALIZADO";

      return `
        <tr>
          <td>${escaparHtml(formatearFecha(movimiento.fecha))}</td>
          <td>${escaparHtml(
            esPago ? "Pago realizado" : "Compra recibida"
          )}</td>
          <td>${escaparHtml(movimiento.comprobante || "-")}</td>
          <td style="text-align:right;">${
            esPago ? "-" : formatearPesos(movimiento.importe)
          }</td>
          <td style="text-align:right;">${
            esPago ? formatearPesos(movimiento.importe) : "-"
          }</td>
          <td>${escaparHtml(
            esPago
              ? [movimiento.medioPago, movimiento.datosPago]
                  .filter(Boolean)
                  .join(" · ")
              : movimiento.observacion || "-"
          )}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>Resumen de cuenta</title>
        <style>
          body { margin:0; padding:32px; font-family:Arial,sans-serif; color:#0f172a; }
          .sheet { max-width:960px; margin:0 auto; }
          .header { display:flex; justify-content:space-between; gap:24px; padding-bottom:18px; border-bottom:2px solid #083f88; }
          .brand { color:#083f88; font-size:28px; font-weight:800; }
          .meta { margin-top:6px; color:#475569; }
          .period { text-align:right; color:#475569; }
          .provider { margin-top:20px; padding:16px; border-radius:14px; background:#f8fafc; }
          .provider h2 { margin:0 0 8px; color:#083f88; }
          .provider p { margin:5px 0; }
          .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:20px 0; }
          .box { padding:14px; border:1px solid #cbd5e1; border-radius:12px; }
          .box span { display:block; color:#64748b; font-size:12px; }
          .box strong { display:block; margin-top:6px; color:#083f88; font-size:19px; }
          table { width:100%; border-collapse:collapse; }
          th,td { border:1px solid #cbd5e1; padding:9px; font-size:12px; vertical-align:top; }
          th { background:#eff6ff; color:#083f88; text-align:left; }
          .final { margin-top:18px; padding:18px; border-radius:14px; background:#083f88; color:#fff; text-align:right; }
          .final span { display:block; opacity:.85; }
          .final strong { display:block; margin-top:4px; font-size:30px; }
          @media print { body { padding:0; } }
        </style>
      </head>
      <body>
        <main class="sheet">
          <header class="header">
            <div>
              <div class="brand">OPTIMA</div>
              <div class="meta">${escaparHtml(params.empresa || "Empresa")}</div>
            </div>
            <div class="period">
              <strong>RESUMEN DE CUENTA</strong><br />
              ${escaparHtml(params.etiquetaPeriodo)}
            </div>
          </header>

          <section class="provider">
            <h2>${escaparHtml(params.proveedor.proveedor)}</h2>
            ${params.proveedor.cuit ? `<p><strong>CUIT:</strong> ${escaparHtml(params.proveedor.cuit)}</p>` : ""}
            ${params.proveedor.direccion ? `<p><strong>Dirección:</strong> ${escaparHtml(params.proveedor.direccion)}</p>` : ""}
            ${params.proveedor.telefono ? `<p><strong>Teléfono:</strong> ${escaparHtml(params.proveedor.telefono)}</p>` : ""}
          </section>

          <section class="summary">
            <div class="box"><span>Saldo inicial</span><strong>${formatearPesos(params.saldoInicial)}</strong></div>
            <div class="box"><span>Compras</span><strong>${formatearPesos(params.totalCompras)}</strong></div>
            <div class="box"><span>Pagos</span><strong>${formatearPesos(params.totalPagos)}</strong></div>
            <div class="box"><span>Saldo final</span><strong>${formatearPesos(params.saldoFinal)}</strong></div>
          </section>

          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Movimiento</th>
                <th>Comprobante</th>
                <th>Compra</th>
                <th>Pago</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              ${filas || '<tr><td colspan="6">Sin movimientos en el período seleccionado.</td></tr>'}
            </tbody>
          </table>

          <section class="final">
            <span>Saldo pendiente</span>
            <strong>${formatearPesos(params.saldoFinal)}</strong>
          </section>
        </main>
      </body>
    </html>
  `;
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

  function descargarComprobantePago(movimiento: Movimiento) {
    if (!proveedor) return;
    const saldos = calcularSaldosPago(movimiento.id);
    abrirVentanaImpresion(
      construirComprobantePago({
        empresa: usuario.empresa || usuario.nombre,
        proveedor,
        movimiento,
        saldoAnterior: saldos.anterior,
        saldoPosterior: saldos.posterior,
      })
    );
  }

  function descargarResumenCuenta() {
    if (!proveedor) return;

    try {
      abrirVentanaImpresion(
        construirResumenCuenta({
          empresa: usuario.empresa || usuario.nombre,
          proveedor,
          etiquetaPeriodo,
          saldoInicial: resumenHistorial.saldoInicial,
          totalCompras: resumenHistorial.totalCompras,
          totalPagos: resumenHistorial.totalPagos,
          saldoFinal: resumenHistorial.saldoFinal,
          movimientos: resumenHistorial.movimientos,
        })
      );
    } catch (error) {
      setMensaje({
        tipo: "error",
        texto:
          error instanceof Error
            ? error.message
            : "No se pudo descargar el resumen.",
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
                if (pago) descargarComprobantePago(pago);
              }}>Descargar comprobante</button>
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
                onClick={descargarResumenCuenta}
                disabled={resumenHistorial.movimientos.length === 0}
              >
                Descargar resumen
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
                        <button className="cc-primary-button" type="button" onClick={() => descargarComprobantePago(movimiento)}>Comprobante</button>
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
