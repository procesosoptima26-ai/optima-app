import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import BarcodeScanner from "./components/BarcodeScanner";
import CuentasCorrientesMock from "./modules/cuentasCorrientes/CuentasCorrientes";
import logoOptima from "./assets/logo-optima.png";
import optimaHomeImage from "./assets/optima-home.png";
import optimaHomeDesktopImage from "./assets/optima-home-desktop.png";
import "./App.css";

type ProductoApi = {
  id: string;
  codigo: string;
  nombre: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
};

type RespuestaProductoApi = {
  encontrado: boolean;
  producto: ProductoApi | null;
  error?: string;
};

type LoteGuardadoApi = {
  id?: number;
  recordId: string;
};

type RespuestaGuardarStockApi = {
  ok: boolean;
  cantidadRegistros?: number;
  registros?: string[];
  lotes?: LoteGuardadoApi[];
  registrosEliminados?: string[];
  error?: string;
};

type UsuarioSesion = {
  usuario: string;
  nombre: string;
  empresa: string;
  rol: string;
  modulos: string[];
};

type RespuestaLoginApi = {
  ok: boolean;
  usuario?: UsuarioSesion;
  error?: string;
};

type Lote = {
  id: number;
  vencimiento: string;
  cantidad: string;
  recordId?: string;
};

type EstadoProducto = "sin_codigo" | "buscando" | "existente" | "nuevo" | "error";

type Aviso = {
  tipo: "info" | "exito" | "error";
  texto: string;
};

type MovimientoGuardado = {
  codigo: string;
  producto: string;
  marca: string;
  presentacion: string;
  especificacion: string;
  nombre: string;
  sucursal: string;
  ubicacion: string;
  sinVencimiento: boolean;
  productoNuevo: boolean;
  observaciones: string;
  lotes: Lote[];
};

type VistaActiva =
  | "inicio"
  | "login"
  | "inventario"
  | "movimientos"
  | "cuentasCorrientes"
  | "automatizaciones"
  | "reportes"
  | "ajustes"
  | "usuario";

type MenuIconKey =
  | "login"
  | "inventario"
  | "movimientos"
  | "cuentasCorrientes"
  | "automatizaciones"
  | "reportes"
  | "ajustes"
  | "usuario";

type ModuloVista = Exclude<VistaActiva, "inicio">;

type ItemMenu = {
  id: ModuloVista;
  etiqueta: string;
  icono: MenuIconKey;
};

const sucursales = ["Bella Vista", "Goya"];
const ubicaciones = ["Galpón", "Góndola", "Depósito", "Cámara"];

const STORAGE_USUARIO_KEY = "optima_usuario_sesion_v1";

const itemsMenu: ItemMenu[] = [
  {
    id: "login",
    etiqueta: "LOGIN",
    icono: "login",
  },
  {
    id: "inventario",
    etiqueta: "INVENTARIO",
    icono: "inventario",
  },
  {
    id: "movimientos",
    etiqueta: "MOVIMIENTOS",
    icono: "movimientos",
  },
  {
    id: "cuentasCorrientes",
    etiqueta: "CUENTAS CORRIENTES",
    icono: "cuentasCorrientes",
  },
  {
    id: "automatizaciones",
    etiqueta: "AUTOMATIZACIONES",
    icono: "automatizaciones",
  },
  {
    id: "reportes",
    etiqueta: "REPORTES",
    icono: "reportes",
  },
  {
    id: "ajustes",
    etiqueta: "AJUSTES",
    icono: "ajustes",
  },
  {
    id: "usuario",
    etiqueta: "USUARIO",
    icono: "usuario",
  },
];

const moduloPorVista: Record<ModuloVista, string> = {
  login: "LOGIN",
  inventario: "INVENTARIO",
  movimientos: "MOVIMIENTOS",
  cuentasCorrientes: "CUENTAS_CORRIENTES",
  automatizaciones: "AUTOMATIZACIONES",
  reportes: "REPORTES",
  ajustes: "AJUSTES",
  usuario: "USUARIO",
};

function armarNombre(
  producto: string,
  marca: string,
  especificacion: string,
  presentacion: string
) {
  return [producto, marca, especificacion, presentacion]
    .map((valor) => valor.trim())
    .filter(Boolean)
    .join(" ");
}

function completarConCero(valor: number) {
  return String(valor).padStart(2, "0");
}

function esFechaValida(dia: number, mes: number, anio: number) {
  const fecha = new Date(anio, mes - 1, dia);

  return (
    fecha.getFullYear() === anio &&
    fecha.getMonth() === mes - 1 &&
    fecha.getDate() === dia
  );
}

function interpretarFechaFlexible(fechaTexto: string) {
  const valor = fechaTexto.trim();

  if (!valor) return null;

  const match = valor.match(
    /^(\d{1,2})([-/])(\d{1,2})(?:\2(\d{2}|\d{4}))?$/
  );

  if (!match) return null;

  const dia = Number(match[1]);
  const mes = Number(match[3]);
  const anioTexto = match[4];

  const anio = anioTexto
    ? anioTexto.length === 2
      ? 2000 + Number(anioTexto)
      : Number(anioTexto)
    : new Date().getFullYear();

  if (!esFechaValida(dia, mes, anio)) return null;

  const diaFormateado = completarConCero(dia);
  const mesFormateado = completarConCero(mes);

  return {
    display: `${diaFormateado}/${mesFormateado}/${anio}`,
    api: `${anio}-${mesFormateado}-${diaFormateado}`,
  };
}

function normalizarFechaParaMostrar(fechaTexto: string) {
  return interpretarFechaFlexible(fechaTexto)?.display || "";
}

function convertirFechaParaApi(fechaTexto: string) {
  return interpretarFechaFlexible(fechaTexto)?.api || "";
}

function IconLogin() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="11" width="17" height="9" rx="2.4" />
      <path d="M7.5 11V8.8a4.5 4.5 0 0 1 9 0V11" />
      <circle cx="12" cy="15.5" r="1.1" />
    </svg>
  );
}

function IconInventory() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 4.8 6.8 12 10.6l7.2-3.8L12 3Z" />
      <path d="M4.8 6.8V17.2L12 21l7.2-3.8V6.8" />
      <path d="M12 10.6V21" />
    </svg>
  );
}

function IconMovements() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 7h11" />
      <path d="M15 4l3 3-3 3" />
      <path d="M17 17H6" />
      <path d="M9 14l-3 3 3 3" />
    </svg>
  );
}

function IconAccounts() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6.5h16" />
      <path d="M4 12h16" />
      <path d="M4 17.5h10" />
      <circle cx="18" cy="17.5" r="2" />
      <path d="M18 15.5v4" />
      <path d="M16 17.5h4" />
    </svg>
  );
}

function IconAutomation() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="7" width="10" height="10" rx="2.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4" />
      <path d="M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M18.9 5.1l-1.7 1.7M6.8 17.2l-1.7 1.7" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}

function IconReports() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20V10" />
      <path d="M10 20V6" />
      <path d="M16 20V13" />
      <path d="M22 20H2" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6Z" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function renderIcon(icono: MenuIconKey) {
  switch (icono) {
    case "login":
      return <IconLogin />;
    case "inventario":
      return <IconInventory />;
    case "movimientos":
      return <IconMovements />;
    case "cuentasCorrientes":
      return <IconAccounts />;
    case "automatizaciones":
      return <IconAutomation />;
    case "reportes":
      return <IconReports />;
    case "ajustes":
      return <IconSettings />;
    case "usuario":
      return <IconUser />;
    default:
      return <IconAutomation />;
  }
}

function App() {
  const codigoInputRef = useRef<HTMLInputElement | null>(null);

  const [vistaActiva, setVistaActiva] = useState<VistaActiva>("inicio");
  const [menuAbierto, setMenuAbierto] = useState(false);

  const [sesionCargada, setSesionCargada] = useState(false);
  const [usuarioSesion, setUsuarioSesion] = useState<UsuarioSesion | null>(null);
  const [loginUsuario, setLoginUsuario] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginCargando, setLoginCargando] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [codigo, setCodigo] = useState("");
  const [producto, setProducto] = useState("");
  const [marca, setMarca] = useState("");
  const [presentacion, setPresentacion] = useState("");
  const [especificacion, setEspecificacion] = useState("");
  const [sucursal, setSucursal] = useState("Bella Vista");
  const [ubicacion, setUbicacion] = useState("Galpón");
  const [sinVencimiento, setSinVencimiento] = useState(false);
  const [observaciones, setObservaciones] = useState("");
  const [scannerAbierto, setScannerAbierto] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [registrosEliminadosEdicion, setRegistrosEliminadosEdicion] = useState<
    string[]
  >([]);
  const [mostrarConfirmacionLimpiar, setMostrarConfirmacionLimpiar] =
    useState(false);
  const [estadoProducto, setEstadoProducto] =
    useState<EstadoProducto>("sin_codigo");
  const [ultimoMovimiento, setUltimoMovimiento] =
    useState<MovimientoGuardado | null>(null);

  const [lotes, setLotes] = useState<Lote[]>([
    {
      id: Date.now(),
      vencimiento: "",
      cantidad: "",
    },
  ]);

  useEffect(() => {
    const usuarioGuardado = localStorage.getItem(STORAGE_USUARIO_KEY);

    if (usuarioGuardado) {
      try {
        const usuarioParseado = JSON.parse(usuarioGuardado) as UsuarioSesion;
        setUsuarioSesion(usuarioParseado);
        setVistaActiva("inicio");
      } catch (error) {
        console.error("No se pudo leer la sesión guardada:", error);
        localStorage.removeItem(STORAGE_USUARIO_KEY);
        setVistaActiva("login");
      }
    } else {
      setVistaActiva("login");
    }

    setSesionCargada(true);
  }, []);

  const itemsMenuVisibles = useMemo(() => {
    if (!usuarioSesion) return [];

    return itemsMenu.filter((item) => {
      if (item.id === "login") return false;
      if (item.id === "usuario") return true;

      const moduloRequerido = moduloPorVista[item.id];

      return usuarioSesion.modulos.includes(moduloRequerido);
    });
  }, [usuarioSesion]);

  const nombre = useMemo(() => {
    return armarNombre(producto, marca, especificacion, presentacion);
  }, [producto, marca, especificacion, presentacion]);

  function usuarioPuedeVer(vista: VistaActiva) {
    if (vista === "inicio") return Boolean(usuarioSesion);
    if (vista === "login") return !usuarioSesion;
    if (!usuarioSesion) return false;
    if (vista === "usuario") return true;

    const moduloRequerido = moduloPorVista[vista];

    return usuarioSesion.modulos.includes(moduloRequerido);
  }

  async function iniciarSesion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const usuario = loginUsuario.trim();
    const password = loginPassword.trim();

    if (!usuario || !password) {
      setLoginError("Completá usuario y contraseña.");
      return;
    }

    try {
      setLoginCargando(true);
      setLoginError("");

      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          usuario,
          password,
        }),
      });

      const data = (await response.json()) as RespuestaLoginApi;

      if (!response.ok || !data.ok || !data.usuario) {
        throw new Error(data.error || "No se pudo iniciar sesión.");
      }

      localStorage.setItem(STORAGE_USUARIO_KEY, JSON.stringify(data.usuario));
      setUsuarioSesion(data.usuario);
      setLoginUsuario("");
      setLoginPassword("");
      setVistaActiva("inicio");
      setMenuAbierto(false);
    } catch (error) {
      console.error("Error iniciando sesión:", error);
      setLoginError(
        error instanceof Error
          ? error.message
          : "No se pudo iniciar sesión. Revisá los datos."
      );
    } finally {
      setLoginCargando(false);
    }
  }

  function cerrarSesion() {
    localStorage.removeItem(STORAGE_USUARIO_KEY);
    setUsuarioSesion(null);
    setVistaActiva("login");
    setMenuAbierto(false);
    setAviso(null);
    setUltimoMovimiento(null);
  }

  function cargarProductoEncontrado(productoApi: ProductoApi) {
    setProducto(productoApi.producto);
    setMarca(productoApi.marca);
    setPresentacion(productoApi.presentacion);
    setEspecificacion(productoApi.especificacion);
  }

  function limpiarDatosProducto() {
    setProducto("");
    setMarca("");
    setPresentacion("");
    setEspecificacion("");
  }

  async function buscarProductoEnAirtable(codigoIngresado: string) {
    const codigoLimpio = codigoIngresado.trim();

    setCodigo(codigoLimpio);
    setAviso(null);
    setUltimoMovimiento(null);
    setModoEdicion(false);
    setRegistrosEliminadosEdicion([]);

    if (!codigoLimpio) {
      limpiarDatosProducto();
      setEstadoProducto("sin_codigo");
      return;
    }

    setEstadoProducto("buscando");
    limpiarDatosProducto();

    try {
      const response = await fetch(
        `/api/productos?codigo=${encodeURIComponent(codigoLimpio)}`
      );

      const data = (await response.json()) as RespuestaProductoApi;

      if (!response.ok) {
        throw new Error(data.error || "Error buscando producto");
      }

      if (data.encontrado && data.producto) {
        cargarProductoEncontrado(data.producto);
        setEstadoProducto("existente");
        return;
      }

      setEstadoProducto("nuevo");
    } catch (error) {
      console.error("Error buscando producto:", error);
      limpiarDatosProducto();
      setEstadoProducto("error");
      setAviso({
        tipo: "error",
        texto: "No se pudo buscar el producto en Airtable.",
      });
    }
  }

  function manejarCambioCodigo(valor: string) {
    if (modoEdicion) return;

    setCodigo(valor);
    setAviso(null);
    setUltimoMovimiento(null);

    if (!valor.trim()) {
      limpiarDatosProducto();
      setEstadoProducto("sin_codigo");
    }
  }

  function manejarBlurCodigo() {
    if (modoEdicion) return;
    if (!codigo.trim()) return;
    buscarProductoEnAirtable(codigo);
  }

  function manejarEnterCodigo(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      buscarProductoEnAirtable(codigo);
    }
  }

  function agregarLote() {
    setLotes((lotesActuales) => [
      ...lotesActuales,
      {
        id: Date.now(),
        vencimiento: "",
        cantidad: "",
      },
    ]);
  }

  function eliminarLote(id: number) {
    setLotes((lotesActuales) => {
      if (lotesActuales.length === 1) return lotesActuales;

      const loteAEliminar = lotesActuales.find((lote) => lote.id === id);

      if (modoEdicion && loteAEliminar?.recordId) {
        setRegistrosEliminadosEdicion((registrosActuales) => [
          ...registrosActuales,
          loteAEliminar.recordId as string,
        ]);
      }

      return lotesActuales.filter((lote) => lote.id !== id);
    });
  }

  function actualizarLote(id: number, campo: keyof Lote, valor: string) {
    setLotes((lotesActuales) =>
      lotesActuales.map((lote) =>
        lote.id === id
          ? {
              ...lote,
              [campo]: valor,
            }
          : lote
      )
    );
  }

  function normalizarVencimientoLote(id: number) {
    if (sinVencimiento) return;

    setLotes((lotesActuales) =>
      lotesActuales.map((lote) => {
        if (lote.id !== id) return lote;

        const fechaNormalizada = normalizarFechaParaMostrar(lote.vencimiento);

        if (!fechaNormalizada) return lote;

        return {
          ...lote,
          vencimiento: fechaNormalizada,
        };
      })
    );
  }

  function manejarSinVencimiento(valor: boolean) {
    setSinVencimiento(valor);

    if (valor) {
      if (modoEdicion) {
        setRegistrosEliminadosEdicion((registrosActuales) => [
          ...registrosActuales,
          ...lotes
            .map((lote) => lote.recordId)
            .filter((recordId): recordId is string => Boolean(recordId)),
        ]);
      }

      setLotes([
        {
          id: Date.now(),
          vencimiento: "",
          cantidad: "",
        },
      ]);
    }
  }

  function obtenerLotesNormalizados() {
    return lotes.map((lote) => {
      if (sinVencimiento) {
        return {
          ...lote,
          vencimiento: "",
        };
      }

      const fechaNormalizada = normalizarFechaParaMostrar(lote.vencimiento);

      return {
        ...lote,
        vencimiento: fechaNormalizada || lote.vencimiento.trim(),
      };
    });
  }

  function validarFormulario() {
    if (!sucursal.trim()) {
      return "La sucursal es obligatoria.";
    }

    if (!ubicacion.trim()) {
      return "La ubicación es obligatoria.";
    }

    if (!codigo.trim()) {
      return "No hay código cargado. Escaneá o escribí un código antes de guardar.";
    }

    if (estadoProducto === "buscando") {
      return "Esperá a que termine la búsqueda del producto.";
    }

    if (!producto.trim()) {
      return "El campo Producto es obligatorio.";
    }

    if (!modoEdicion && estadoProducto === "nuevo" && !marca.trim()) {
      return "El campo Marca es obligatorio para productos nuevos.";
    }

    if (!modoEdicion && estadoProducto === "nuevo" && !presentacion.trim()) {
      return "El campo Presentación es obligatorio para productos nuevos.";
    }

    for (const lote of lotes) {
      if (!sinVencimiento) {
        if (!lote.vencimiento.trim()) {
          return "Completá el vencimiento o marcá Sin fecha de vencimiento.";
        }

        if (!convertirFechaParaApi(lote.vencimiento)) {
          return "La fecha debe ser válida. Ej: 5/5/27 o 05/05/2027.";
        }
      }

      if (!lote.cantidad || Number(lote.cantidad) <= 0) {
        return "La cantidad debe ser mayor a cero.";
      }
    }

    return "";
  }

  function formularioTieneDatosCargados() {
    const tieneCodigo = Boolean(codigo.trim());
    const tieneDatosProducto =
      Boolean(producto.trim()) ||
      Boolean(marca.trim()) ||
      Boolean(presentacion.trim()) ||
      Boolean(especificacion.trim());
    const tieneObservaciones = Boolean(observaciones.trim());
    const tieneLotes = lotes.some(
      (lote) => Boolean(lote.vencimiento.trim()) || Boolean(lote.cantidad.trim())
    );

    return (
      tieneCodigo ||
      tieneDatosProducto ||
      tieneObservaciones ||
      tieneLotes ||
      sinVencimiento ||
      modoEdicion ||
      estadoProducto === "nuevo" ||
      estadoProducto === "existente"
    );
  }

  function prepararSiguienteCarga() {
    setCodigo("");
    limpiarDatosProducto();
    setSinVencimiento(false);
    setObservaciones("");
    setEstadoProducto("sin_codigo");
    setModoEdicion(false);
    setRegistrosEliminadosEdicion([]);
    setLotes([
      {
        id: Date.now(),
        vencimiento: "",
        cantidad: "",
      },
    ]);

    setTimeout(() => {
      codigoInputRef.current?.focus();
    }, 100);
  }

  function obtenerLotesConRecordIds(
    lotesMovimiento: Lote[],
    data: RespuestaGuardarStockApi
  ) {
    if (data.lotes && data.lotes.length > 0) {
      return lotesMovimiento.map((lote) => {
        const loteGuardado = data.lotes?.find(
          (loteApi) => loteApi.id === lote.id
        );

        return {
          ...lote,
          recordId: loteGuardado?.recordId || lote.recordId,
        };
      });
    }

    return lotesMovimiento.map((lote, index) => ({
      ...lote,
      recordId: data.registros?.[index] || lote.recordId,
    }));
  }

  async function guardarMovimiento() {
    const error = validarFormulario();

    if (error) {
      setAviso({
        tipo: "error",
        texto: error,
      });
      return;
    }

    const lotesNormalizados = obtenerLotesNormalizados();
    const productoNuevoMovimiento = modoEdicion
      ? Boolean(ultimoMovimiento?.productoNuevo)
      : estadoProducto === "nuevo";

    const movimiento: MovimientoGuardado = {
      codigo: codigo.trim(),
      producto: producto.trim(),
      marca: marca.trim(),
      presentacion: presentacion.trim(),
      especificacion: especificacion.trim(),
      nombre,
      sucursal,
      ubicacion,
      sinVencimiento,
      productoNuevo: productoNuevoMovimiento,
      observaciones: observaciones.trim(),
      lotes: lotesNormalizados,
    };

    const payload = {
      ...movimiento,
      productoNuevo: modoEdicion ? false : estadoProducto === "nuevo",
      registrosEliminados: modoEdicion ? registrosEliminadosEdicion : [],
      lotes: lotesNormalizados.map((lote) => ({
        id: lote.id,
        recordId: lote.recordId,
        vencimiento: sinVencimiento
          ? ""
          : convertirFechaParaApi(lote.vencimiento),
        cantidad: lote.cantidad,
      })),
    };

    try {
      setGuardando(true);
      setAviso({
        tipo: "info",
        texto: modoEdicion ? "Actualizando carga..." : "Guardando...",
      });

      const response = await fetch("/api/stock", {
        method: modoEdicion ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as RespuestaGuardarStockApi;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "No se pudo guardar el inventario");
      }

      const lotesConRecordIds = obtenerLotesConRecordIds(
        movimiento.lotes,
        data
      );

      setUltimoMovimiento({
        ...movimiento,
        lotes: lotesConRecordIds,
      });

      prepararSiguienteCarga();

      setAviso({
        tipo: "exito",
        texto: modoEdicion
          ? "Carga actualizada OK."
          : `Guardado OK. Registros creados: ${
              data.cantidadRegistros || lotes.length
            }.`,
      });

      console.log("Inventario guardado:", payload);
    } catch (error) {
      console.error("Error guardando inventario:", error);
      setAviso({
        tipo: "error",
        texto: modoEdicion
          ? "No se pudo actualizar la carga en Airtable."
          : "No se pudo guardar el inventario en Airtable.",
      });
    } finally {
      setGuardando(false);
    }
  }

  function editarUltimaCarga() {
    if (!ultimoMovimiento) return;

    setCodigo(ultimoMovimiento.codigo);
    setProducto(ultimoMovimiento.producto);
    setMarca(ultimoMovimiento.marca);
    setPresentacion(ultimoMovimiento.presentacion);
    setEspecificacion(ultimoMovimiento.especificacion);
    setSucursal(ultimoMovimiento.sucursal);
    setUbicacion(ultimoMovimiento.ubicacion);
    setSinVencimiento(ultimoMovimiento.sinVencimiento);
    setObservaciones(ultimoMovimiento.observaciones);
    setLotes(
      ultimoMovimiento.lotes.map((lote) => ({
        ...lote,
        id: Date.now() + Math.floor(Math.random() * 100000),
      }))
    );
    setEstadoProducto("existente");
    setModoEdicion(true);
    setRegistrosEliminadosEdicion([]);
    setAviso({
      tipo: "info",
      texto: "Editando última carga. Corregí los datos y tocá Actualizar carga.",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function ejecutarLimpiezaFormulario() {
    setCodigo("");
    limpiarDatosProducto();
    setSinVencimiento(false);
    setObservaciones("");
    setEstadoProducto("sin_codigo");
    setModoEdicion(false);
    setRegistrosEliminadosEdicion([]);
    setLotes([
      {
        id: Date.now(),
        vencimiento: "",
        cantidad: "",
      },
    ]);
    setAviso(null);
    setUltimoMovimiento(null);
    setMostrarConfirmacionLimpiar(false);

    setTimeout(() => {
      codigoInputRef.current?.focus();
    }, 100);
  }

  function manejarClickLimpiar() {
    if (formularioTieneDatosCargados()) {
      setMostrarConfirmacionLimpiar(true);
      return;
    }

    ejecutarLimpiezaFormulario();
  }

  function cambiarVista(nuevaVista: VistaActiva) {
    if (!usuarioSesion && nuevaVista !== "login") {
      setVistaActiva("login");
      setMenuAbierto(false);
      return;
    }

    if (usuarioSesion && !usuarioPuedeVer(nuevaVista)) {
      setVistaActiva("inicio");
      setMenuAbierto(false);
      return;
    }

    setVistaActiva(nuevaVista);
    setMenuAbierto(false);
  }

  function abrirMenu() {
    setMenuAbierto(true);
  }

  function obtenerItemMenuActual() {
    return itemsMenu.find((item) => item.id === vistaActiva);
  }

  function renderLogin() {
    return (
      <section className="login-screen">
        <div className="login-card">
          <img src={logoOptima} alt="Logo OPTIMA" className="login-logo" />

          <p className="login-kicker">OPTIMA</p>
          <h1>Iniciar sesión</h1>
          <p className="login-subtitle">Ingresá con tu usuario para usar la app.</p>

          <form className="login-form" onSubmit={iniciarSesion}>
            <div className="field-group">
              <label htmlFor="login-usuario">Usuario</label>
              <input
                id="login-usuario"
                type="text"
                value={loginUsuario}
                onChange={(event) => setLoginUsuario(event.target.value)}
                placeholder="Ej: TEST"
                autoComplete="username"
                disabled={loginCargando}
              />
            </div>

            <div className="field-group">
              <label htmlFor="login-password">Contraseña</label>
              <input
                id="login-password"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Contraseña"
                autoComplete="current-password"
                disabled={loginCargando}
              />
            </div>

            {loginError && (
              <div className="message message-error">{loginError}</div>
            )}

            <button
              className="primary-button login-submit-button"
              type="submit"
              disabled={loginCargando}
            >
              {loginCargando ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        </div>
      </section>
    );
  }

  function renderUsuario() {
    if (!usuarioSesion) return renderLogin();

    return (
      <section className="user-card">
        <div className="user-card-header">
          <div>
            <p className="user-kicker">USUARIO</p>
            <h2>{usuarioSesion.nombre}</h2>
          </div>

          <span className="user-role-badge">{usuarioSesion.rol}</span>
        </div>

        <div className="user-info-grid">
          <p>
            <strong>Usuario:</strong> {usuarioSesion.usuario}
          </p>
          <p>
            <strong>Empresa:</strong> {usuarioSesion.empresa}
          </p>
        </div>

        <div className="user-modules-box">
          <span>Módulos activos</span>

          <div className="user-modules-list">
            {usuarioSesion.modulos.map((modulo) => (
              <strong key={modulo}>{modulo.replaceAll("_", " ")}</strong>
            ))}
          </div>
        </div>

        <button className="secondary-button logout-button" type="button" onClick={cerrarSesion}>
          Cerrar sesión
        </button>
      </section>
    );
  }

  function renderInicio() {
    return (
      <section className="home-screen">
        <div className="home-brand-card">
          <picture>
            <source
              media="(min-width: 900px)"
              srcSet={optimaHomeDesktopImage}
            />

            <img
              src={optimaHomeImage}
              alt="OPTIMA - Optimizamos hoy, impulsamos el mañana"
              className="home-brand-image"
            />
          </picture>
        </div>
      </section>
    );
  }

  function renderModuloEnDesarrollo() {
    const itemActual = obtenerItemMenuActual();

    return (
      <section className="coming-soon-card">
        <div className="coming-soon-icon">
          {itemActual ? renderIcon(itemActual.icono) : <IconAutomation />}
        </div>

        <p className="coming-soon-label">{itemActual?.etiqueta ?? "MÓDULO"}</p>

        <h2>Este módulo ya está en desarrollo.</h2>

        <p className="coming-soon-message">
          Optimizamos hoy, impulsamos el mañana.
        </p>

        <button
          className="coming-soon-button"
          type="button"
          onClick={abrirMenu}
        >
          Ir al menú
        </button>
      </section>
    );
  }

  function renderInventario() {
    return (
      <>
        <section className="form-card">
          <div className="module-label">
            {modoEdicion ? "INVENTARIO · EDITANDO ÚLTIMA CARGA" : "INVENTARIO"}
          </div>

          <div className="selection-section">
            <div className="current-summary-grid">
              <div className="current-summary-row">
                <span className="current-summary-label">Sucursal actual</span>
                <strong className="current-summary-value">
                  {sucursal.toUpperCase()}
                </strong>
              </div>

              <div className="current-summary-row">
                <span className="current-summary-label">Ubicación actual</span>
                <strong className="current-summary-value">
                  {ubicacion.toUpperCase()}
                </strong>
              </div>
            </div>

            <div className="selector-grid">
              <div className="field-group compact-field">
                <label htmlFor="sucursal">Sucursal</label>
                <select
                  id="sucursal"
                  value={sucursal}
                  onChange={(event) => setSucursal(event.target.value)}
                  disabled={guardando}
                >
                  {sucursales.map((sucursalDisponible) => (
                    <option key={sucursalDisponible} value={sucursalDisponible}>
                      {sucursalDisponible}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-group compact-field">
                <label htmlFor="ubicacion">Ubicación</label>
                <select
                  id="ubicacion"
                  value={ubicacion}
                  onChange={(event) => setUbicacion(event.target.value)}
                  disabled={guardando}
                >
                  {ubicaciones.map((ubicacionDisponible) => (
                    <option
                      key={ubicacionDisponible}
                      value={ubicacionDisponible}
                    >
                      {ubicacionDisponible}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="codigo">Código</label>

            <div className="barcode-row">
              <input
                ref={codigoInputRef}
                id="codigo"
                value={codigo}
                onChange={(event) => manejarCambioCodigo(event.target.value)}
                onBlur={manejarBlurCodigo}
                onKeyDown={manejarEnterCodigo}
                placeholder="Escaneá o escribí el código"
                inputMode="numeric"
                disabled={modoEdicion || guardando}
              />

              <button
                className="camera-button"
                type="button"
                onClick={() => setScannerAbierto(true)}
                aria-label="Abrir cámara"
                disabled={modoEdicion || guardando}
              >
                📷
              </button>
            </div>
          </div>

          {estadoProducto === "buscando" && (
            <div className="product-status product-status-info">
              Buscando producto...
            </div>
          )}

          {estadoProducto === "existente" && (
            <div className="product-found-box">
              <div className="product-found-icon">✓</div>

              <div>
                <span>{modoEdicion ? "Editando producto" : "Producto encontrado"}</span>
                <strong>{nombre}</strong>
              </div>
            </div>
          )}

          {estadoProducto === "nuevo" && (
            <div className="product-data-section">
              <div className="product-new-box">
                <strong>Producto nuevo</strong>
                <span>Completá los datos para crearlo.</span>
              </div>

              <div className="product-grid">
                <div className="field-group">
                  <label htmlFor="producto">Producto</label>
                  <input
                    id="producto"
                    value={producto}
                    onChange={(event) => setProducto(event.target.value)}
                    placeholder="Ej: Leche"
                    disabled={guardando}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="marca">Marca</label>
                  <input
                    id="marca"
                    value={marca}
                    onChange={(event) => setMarca(event.target.value)}
                    placeholder="Ej: La Serenísima"
                    disabled={guardando}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="presentacion">Presentación</label>
                  <input
                    id="presentacion"
                    value={presentacion}
                    onChange={(event) => setPresentacion(event.target.value)}
                    placeholder="Ej: 1L"
                    disabled={guardando}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="especificacion">Especificación</label>
                  <input
                    id="especificacion"
                    value={especificacion}
                    onChange={(event) =>
                      setEspecificacion(event.target.value)
                    }
                    placeholder="Ej: Entera / Sin TACC"
                    disabled={guardando}
                  />
                </div>
              </div>

              {nombre && (
                <div className="nombre-preview">
                  <span>Nombre master</span>
                  <strong>{nombre}</strong>
                </div>
              )}
            </div>
          )}

          <section className="lotes-section">
            <div className="section-title-row compact-title-row">
              <h2>Vencimientos</h2>

              <div className="lote-actions-inline">
                <button
                  className={`sin-vencimiento-button ${
                    sinVencimiento ? "sin-vencimiento-activo" : ""
                  }`}
                  type="button"
                  onClick={() => manejarSinVencimiento(!sinVencimiento)}
                  disabled={guardando}
                >
                  {sinVencimiento ? "Sin vencimiento ✓" : "Sin vencimiento"}
                </button>

                {!sinVencimiento && (
                  <button
                    className="small-add-button"
                    type="button"
                    onClick={agregarLote}
                    disabled={guardando}
                  >
                    + Otro
                  </button>
                )}
              </div>
            </div>

            {lotes.map((lote, index) => (
              <article className="lote-card" key={lote.id}>
                <div className="lote-title-row">
                  <strong>Lote {index + 1}</strong>

                  {lotes.length > 1 && (
                    <button
                      className="delete-button"
                      type="button"
                      onClick={() => eliminarLote(lote.id)}
                      disabled={guardando}
                    >
                      Eliminar
                    </button>
                  )}
                </div>

                <div
                  className={`lote-inline-grid ${
                    sinVencimiento ? "solo-cantidad" : ""
                  }`}
                >
                  {!sinVencimiento && (
                    <div className="field-group no-margin">
                      <label htmlFor={`vencimiento-${lote.id}`}>
                        Vencimiento
                      </label>
                      <input
                        id={`vencimiento-${lote.id}`}
                        type="text"
                        value={lote.vencimiento}
                        onChange={(event) =>
                          actualizarLote(
                            lote.id,
                            "vencimiento",
                            event.target.value
                          )
                        }
                        onBlur={() => normalizarVencimientoLote(lote.id)}
                        placeholder="D/M/AA"
                        inputMode="text"
                        maxLength={10}
                        disabled={guardando}
                      />
                    </div>
                  )}

                  <div className="field-group no-margin">
                    <label htmlFor={`cantidad-${lote.id}`}>Cantidad</label>
                    <input
                      id={`cantidad-${lote.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={lote.cantidad}
                      onChange={(event) =>
                        actualizarLote(lote.id, "cantidad", event.target.value)
                      }
                      placeholder="Ej: 12"
                      disabled={guardando}
                    />
                  </div>
                </div>
              </article>
            ))}
          </section>

          <div className="field-group">
            <label htmlFor="observaciones">Observaciones</label>
            <input
              id="observaciones"
              type="text"
              value={observaciones}
              onChange={(event) => setObservaciones(event.target.value)}
              placeholder="Opcional"
              disabled={guardando}
            />
          </div>

          {aviso && (
            <div className={`message message-${aviso.tipo}`}>
              {aviso.texto}
            </div>
          )}

          <div className="actions-row">
            <button
              className="primary-button"
              type="button"
              onClick={guardarMovimiento}
              disabled={guardando}
            >
              {guardando
                ? modoEdicion
                  ? "Actualizando..."
                  : "Guardando..."
                : modoEdicion
                ? "Actualizar carga"
                : "Guardar"}
            </button>

            <button
              className="secondary-button"
              type="button"
              onClick={manejarClickLimpiar}
              disabled={guardando}
            >
              {modoEdicion ? "Cancelar edición" : "Limpiar"}
            </button>
          </div>
        </section>

        {ultimoMovimiento && (
          <section className="result-card">
            <div className="result-title-row">
              <div>
                <span>Última carga</span>
                <h2>{ultimoMovimiento.nombre}</h2>
              </div>
<div className="result-actions-top">
  <button
    className="correct-load-button"
    type="button"
    onClick={editarUltimaCarga}
    disabled={guardando || modoEdicion}
  >
    Corregir carga
  </button>

  <strong className="result-badge">
    {ultimoMovimiento.productoNuevo ? "Nuevo" : "Existente"}
  </strong>
</div>
            </div>

            <div className="result-grid">
              <p>
                <strong>Sucursal:</strong> {ultimoMovimiento.sucursal}
              </p>

              <p>
                <strong>Ubicación:</strong> {ultimoMovimiento.ubicacion}
              </p>

              <p>
                <strong>Código:</strong> {ultimoMovimiento.codigo}
              </p>

              <p>
                <strong>Vencimiento:</strong>{" "}
                {ultimoMovimiento.sinVencimiento
                  ? "Sin vencimiento"
                  : "Con vencimiento"}
              </p>
            </div>

            <ul className="result-lotes-list">
              {ultimoMovimiento.lotes.map((lote) => (
                <li key={lote.id}>
                  <span>
                    {ultimoMovimiento.sinVencimiento
                      ? "Sin vencimiento"
                      : lote.vencimiento}
                  </span>
                  <strong>{lote.cantidad} unidades</strong>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  function renderContenido() {
    if (!sesionCargada) {
      return (
        <section className="login-screen">
          <div className="login-card">
            <p className="login-kicker">OPTIMA</p>
            <h1>Cargando...</h1>
          </div>
        </section>
      );
    }

    if (!usuarioSesion) {
      return renderLogin();
    }

    if (vistaActiva === "inicio") {
      return renderInicio();
    }

    if (!usuarioPuedeVer(vistaActiva)) {
      return renderInicio();
    }

    if (vistaActiva === "inventario") {
      return renderInventario();
    }

    if (vistaActiva === "cuentasCorrientes") {
      return <CuentasCorrientesMock />;
    }

    if (vistaActiva === "usuario") {
      return renderUsuario();
    }

    return renderModuloEnDesarrollo();
  }

  return (
    <main
      className={`app ${
        usuarioSesion && vistaActiva === "inicio" ? "app-home" : ""
      } ${!usuarioSesion ? "app-login-page" : ""}`}
    >
      {usuarioSesion && (
        <button
          className="menu-toggle-button"
          type="button"
          onClick={abrirMenu}
          aria-label="Abrir menú"
        >
          Menú
        </button>
      )}

      {usuarioSesion && menuAbierto && (
        <div className="menu-overlay" onClick={() => setMenuAbierto(false)}>
          <aside
            className="side-menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="side-menu-header-button"
              type="button"
              onClick={() => cambiarVista("inicio")}
            >
              <img
                src={logoOptima}
                alt="Logo OPTIMA"
                className="side-menu-logo"
              />

              <div className="side-menu-brand-text">
                <strong>OPTIMA</strong>
              </div>
            </button>

            <nav className="side-menu-nav" aria-label="Menú principal">
              {itemsMenuVisibles.map((item) => (
                <button
                  key={item.id}
                  className={`side-menu-item ${
                    vistaActiva === item.id ? "side-menu-item-active" : ""
                  }`}
                  type="button"
                  onClick={() => cambiarVista(item.id)}
                >
                  <span className="side-menu-icon">
                    {renderIcon(item.icono)}
                  </span>

                  <strong>{item.etiqueta}</strong>
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <section className="app-container">
        {usuarioSesion && vistaActiva !== "inicio" && (
          <header className="app-header">
            <div className="brand-row">
              <img
                src={logoOptima}
                alt="Logo OPTIMA"
                className="brand-logo-image"
              />

              <div className="brand-text">
                <h1>OPTIMA</h1>
              </div>
            </div>
          </header>
        )}

        {renderContenido()}
      </section>

      {scannerAbierto && (
        <BarcodeScanner
          onScanSuccess={(codigoEscaneado) => {
            buscarProductoEnAirtable(codigoEscaneado);
            setScannerAbierto(false);
          }}
          onClose={() => setScannerAbierto(false)}
        />
      )}

      {mostrarConfirmacionLimpiar && (
        <div className="confirm-overlay">
          <div className="confirm-card">
            <h2>¿Querés borrar los datos cargados?</h2>
            <p>
              Se limpiará el producto, código, vencimientos, cantidades y
              observaciones.
            </p>

            <div className="confirm-actions">
              <button
                className="confirm-cancel-button"
                type="button"
                onClick={() => setMostrarConfirmacionLimpiar(false)}
              >
                Cancelar
              </button>

              <button
                className="confirm-clear-button"
                type="button"
                onClick={ejecutarLimpiezaFormulario}
              >
                Limpiar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
