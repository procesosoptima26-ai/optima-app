import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  agruparVentas,
  leerArchivoVentas,
  type ErrorLinea,
  type VentaAgrupada,
} from "./lector-ventas-archivo";

/**
 * Ventas por archivo (Etapa 1).
 * Para qué sirve: subir el archivo de ventas del día, revisar qué se puede
 * cargar y qué no, y cargarlo con un solo botón. El stock lo descuenta el
 * motor de siempre (FEFO); acá solo se crean los movimientos de venta.
 */

type UsuarioVentas = {
  nombre: string;
  sucursal: string;
  sucursalId?: string;
};

type UbicacionVenta = {
  id: string;
  nombre: string;
  tipoUbicacion: string;
};

type VentaLista = {
  codigo: string;
  productoId: string;
  nombre: string;
  cantidad: number;
  stock: number;
};

type VentaConProblema = {
  codigo: string;
  nombre: string;
  cantidad: number;
  motivo:
    | "NO_RECONOCIDO"
    | "OTRA_EMPRESA"
    | "SIN_STOCK"
    | "STOCK_INSUFICIENTE"
    | "YA_CARGADO";
  detalle: string;
  stock?: number;
  faltante?: number;
};

type Plan = {
  listas: VentaLista[];
  problemas: VentaConProblema[];
  totales: {
    productos: number;
    listas: number;
    noReconocidas: number;
    sinStockOInsuficiente: number;
    yaCargadas: number;
    unidadesListas: number;
  };
};

type ResultadoMotor = {
  total: number;
  procesadas: number;
  pendientes: number;
  conError: Array<{ nombre: string; cantidad: number; error: string }>;
};

type RespuestaServidor = {
  ok?: boolean;
  error?: string;
  plan?: Plan;
  resultado?: ResultadoMotor;
  cantidad?: number;
  ubicaciones?: UbicacionVenta[];
};

const PRODUCTOS_POR_TANDA = 40;

const TITULOS_PROBLEMA: Record<VentaConProblema["motivo"], string> = {
  NO_RECONOCIDO: "No reconocidos (el código no existe en el catálogo; podés crearlos acá, pero hasta cargarles stock en Recepción no se podrá descontar la venta)",
  OTRA_EMPRESA: "Catálogo compartido (necesitan vinculación autorizada)",
  SIN_STOCK: "Sin stock en la ubicación de venta (se cargan con error para que las revises)",
  STOCK_INSUFICIENTE: "Stock insuficiente (se cargan con error para que las revises; no se descuenta nada)",
  YA_CARGADO: "Ya cargados desde este archivo",
};

async function pedir(
  url: string,
  cuerpo?: unknown,
): Promise<RespuestaServidor> {
  const respuesta = await fetch(url, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let datos: RespuestaServidor = {};
  try {
    datos = (await respuesta.json()) as RespuestaServidor;
  } catch {
    // La respuesta no era JSON: se informa más abajo con un mensaje claro.
  }
  if (!respuesta.ok || datos.ok === false) {
    throw new Error(datos.error || "No se pudo completar la operación.");
  }
  return datos;
}

function esperar(milisegundos: number) {
  return new Promise((resolver) => setTimeout(resolver, milisegundos));
}

export default function VentasArchivo({ usuario }: { usuario: UsuarioVentas }) {
  const sucursal = usuario.sucursalId || usuario.sucursal;

  const [ubicaciones, setUbicaciones] = useState<UbicacionVenta[]>([]);
  const [ubicacionId, setUbicacionId] = useState("");
  const [nombreCarga, setNombreCarga] = useState("");
  const [lineas, setLineas] = useState<VentaAgrupada[]>([]);
  const [erroresArchivo, setErroresArchivo] = useState<ErrorLinea[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [resultado, setResultado] = useState<ResultadoMotor | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [progreso, setProgreso] = useState("");
  const entradaArchivo = useRef<HTMLInputElement | null>(null);
  // Etapa 2: crear desde la lista un producto que el catálogo no conoce.
  const [creando, setCreando] = useState<string | null>(null);
  const [formNombre, setFormNombre] = useState("");
  const [formMarca, setFormMarca] = useState("");
  const [formPresentacion, setFormPresentacion] = useState("");
  const [mensajeProducto, setMensajeProducto] = useState("");

  useEffect(() => {
    let activo = true;
    pedir(`/api/ubicaciones?sucursal=${encodeURIComponent(sucursal)}`)
      .then((datos) => {
        if (!activo) return;
        const lista = datos.ubicaciones ?? [];
        setUbicaciones(lista);
        const gondola = lista.find((u) => u.tipoUbicacion.includes("GÓNDOLA") ||
          u.tipoUbicacion.includes("GONDOLA"));
        if (gondola) setUbicacionId(gondola.id);
      })
      .catch((e: unknown) => {
        if (activo) setError(e instanceof Error ? e.message : "No se pudieron cargar las ubicaciones.");
      });
    return () => {
      activo = false;
    };
  }, [sucursal]);

  const problemasPorMotivo = useMemo(() => {
    const grupos = new Map<VentaConProblema["motivo"], VentaConProblema[]>();
    for (const p of plan?.problemas ?? []) {
      grupos.set(p.motivo, [...(grupos.get(p.motivo) ?? []), p]);
    }
    return grupos;
  }, [plan]);

  function cuerpoBase() {
    return {
      sucursal,
      ubicacionId,
      nombreArchivo: nombreCarga.trim(),
      responsable: usuario.nombre,
    };
  }

  async function alElegirArchivo(evento: ChangeEvent<HTMLInputElement>) {
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    setError("");
    setPlan(null);
    setResultado(null);
    setProgreso("");
    setOcupado("Leyendo el archivo...");
    try {
      const lectura = await leerArchivoVentas(await archivo.arrayBuffer(), archivo.name);
      setErroresArchivo(lectura.errores);
      setLineas(agruparVentas(lectura.lineas));
      setNombreCarga(archivo.name);
      if (lectura.lineas.length === 0) {
        setError("El archivo no tiene ventas válidas para cargar.");
      }
    } catch (e) {
      setLineas([]);
      setErroresArchivo([]);
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally {
      setOcupado("");
    }
  }

  async function verVistaPrevia() {
    setError("");
    setResultado(null);
    setOcupado("Revisando productos y stock...");
    try {
      const datos = await pedir("/api/movimientos?accion=ventas_vista_previa", {
        ...cuerpoBase(),
        lineas: lineas.map((l) => ({ codigo: l.codigo, producto: l.producto, cantidad: l.cantidad })),
      });
      if (!datos.plan) throw new Error("El servidor no devolvió la vista previa.");
      setPlan(datos.plan);
      // Si este archivo ya se había cargado (otra sesión, otra pestaña), se muestra cómo va.
      await consultarResultado();
    } catch (e) {
      setPlan(null);
      setError(e instanceof Error ? e.message : "No se pudo preparar la vista previa.");
    } finally {
      setOcupado("");
    }
  }

  function abrirCreacion(p: VentaConProblema) {
    setCreando(p.codigo);
    setFormNombre(p.nombre || "");
    setFormMarca("");
    setFormPresentacion("");
    setMensajeProducto("");
  }

  async function guardarProductoNuevo(codigo: string) {
    const nombre = formNombre.trim();
    if (!nombre) {
      setMensajeProducto("Escribí el nombre del producto.");
      return;
    }
    setMensajeProducto("");
    setOcupado("Creando el producto...");
    try {
      await pedir("/api/productos-movimientos", {
        codigo,
        producto: nombre,
        marca: formMarca.trim(),
        presentacion: formPresentacion.trim(),
      });
    } catch (e) {
      setMensajeProducto(e instanceof Error ? e.message : "No se pudo crear el producto.");
      setOcupado("");
      return;
    }
    setCreando(null);
    // Vuelve a revisar el archivo: el producto nuevo ya no figura como desconocido.
    await verVistaPrevia();
  }

  async function cargarVentas() {
    if (!plan || (plan.listas.length === 0 && paraRevision.length === 0)) return;
    setError("");
    setOcupado("Cargando ventas...");
    try {
      const codigosListos = new Set([
        ...plan.listas.map((v) => v.codigo),
        ...paraRevision.map((p) => p.codigo),
      ]);
      const aCargar = lineas.filter((l) => codigosListos.has(l.codigo));
      let cargadas = 0;
      for (let i = 0; i < aCargar.length; i += PRODUCTOS_POR_TANDA) {
        const tanda = aCargar.slice(i, i + PRODUCTOS_POR_TANDA);
        setProgreso(`Cargando ${Math.min(i + PRODUCTOS_POR_TANDA, aCargar.length)} de ${aCargar.length} productos...`);
        const datos = await pedir("/api/movimientos?accion=ventas_confirmar", {
          ...cuerpoBase(),
          lineas: tanda.map((l) => ({ codigo: l.codigo, producto: l.producto, cantidad: l.cantidad })),
        });
        cargadas += datos.cantidad ?? 0;
      }
      setProgreso(`Se cargaron ${cargadas} ventas. Esperando al motor de stock...`);
      await seguirMotor(cargadas);
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "No se pudieron cargar las ventas.") +
          " Revisá el resultado antes de volver a intentar: lo que ya se cargó no se repite.",
      );
      await consultarResultado();
    } finally {
      setOcupado("");
    }
  }

  async function consultarResultado(): Promise<ResultadoMotor | null> {
    try {
      const datos = await pedir("/api/movimientos?accion=ventas_resultado", cuerpoBase());
      if (datos.resultado) setResultado(datos.resultado);
      return datos.resultado ?? null;
    } catch {
      return null;
    }
  }

  async function seguirMotor(esperadas: number) {
    for (let intento = 0; intento < 20; intento++) {
      const r = await consultarResultado();
      if (r && r.total >= esperadas && r.pendientes === 0) break;
      await esperar(3000);
    }
    setProgreso("");
  }

  function empezarDeNuevo() {
    setLineas([]);
    setErroresArchivo([]);
    setPlan(null);
    setResultado(null);
    setError("");
    setProgreso("");
    setNombreCarga("");
    if (entradaArchivo.current) entradaArchivo.current.value = "";
  }

  // Sin stock o con stock insuficiente: se cargan igual; el motor las deja con error para revisar.
  const paraRevision = (plan?.problemas ?? []).filter(
    (p) => p.motivo === "SIN_STOCK" || p.motivo === "STOCK_INSUFICIENTE",
  );

  // Mientras el motor siga procesando, se vuelve a consultar solo cada 5 segundos.
  const hayPendientes = (resultado?.pendientes ?? 0) > 0;
  useEffect(() => {
    if (!hayPendientes || ocupado) return;
    let activo = true;
    const temporizador = setTimeout(async () => {
      try {
        const datos = await pedir("/api/movimientos?accion=ventas_resultado", {
          sucursal,
          ubicacionId,
          nombreArchivo: nombreCarga.trim(),
          responsable: usuario.nombre,
        });
        if (activo && datos.resultado) setResultado(datos.resultado);
      } catch {
        // Si falla una consulta, se reintenta sola en la próxima vuelta.
        if (activo) setResultado((actual) => (actual ? { ...actual } : actual));
      }
    }, 5000);
    return () => {
      activo = false;
      clearTimeout(temporizador);
    };
  }, [hayPendientes, ocupado, resultado, sucursal, ubicacionId, nombreCarga, usuario.nombre]);

  const hayArchivo = lineas.length > 0;
  const bloqueado = Boolean(ocupado);

  return (
    <section className="mov-card mov-stock-card">
      <div className="mov-stock-header">
        <div>
          <span>VENTAS</span>
          <h3>Ventas</h3>
          <p>Cargá las ventas del día de {usuario.sucursal} desde el archivo de tu sistema de ventas.</p>
        </div>
        {(hayArchivo || resultado) && (
          <button type="button" className="mov-refresh-button" onClick={empezarDeNuevo} disabled={bloqueado}>
            Empezar de nuevo
          </button>
        )}
      </div>

      <div className="mov-stock-filters">
        <label className="mov-field">
          Archivo de ventas (.xlsx o .csv)
          <input
            ref={entradaArchivo}
            type="file"
            accept=".xlsx,.csv"
            onChange={alElegirArchivo}
            disabled={bloqueado}
          />
        </label>

        <label className="mov-field">
          Descontar de
          <select value={ubicacionId} onChange={(e: ChangeEvent<HTMLSelectElement>) => { setUbicacionId(e.target.value); setPlan(null); }} disabled={bloqueado}>
            <option value="">Elegí la ubicación</option>
            {ubicaciones.map((u) => (
              <option key={u.id} value={u.id}>{u.nombre}</option>
            ))}
          </select>
        </label>
      </div>

      {hayArchivo && (
        <label className="mov-field">
          Nombre de esta carga (con la fecha, para saber hasta dónde descontaste)
          <input
            value={nombreCarga}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setNombreCarga(e.target.value); setPlan(null); }}
            maxLength={200}
            disabled={bloqueado}
          />
        </label>
      )}

      {ocupado && <div className="mov-empty">{ocupado}</div>}
      {progreso && <div className="mov-product-searching">{progreso}</div>}
      {error && <div className="mov-empty" role="alert">{error}</div>}

      {hayArchivo && (
        <div className="mov-stock-summary">
          <div><span>Líneas del archivo</span><strong>{lineas.reduce((a, l) => a + l.lineas, 0)}</strong></div>
          <div><span>Productos distintos</span><strong>{lineas.length}</strong></div>
          <div><span>Líneas con error</span><strong>{erroresArchivo.length}</strong></div>
        </div>
      )}

      {erroresArchivo.length > 0 && (
        <details>
          <summary>Filas del archivo que no se pueden leer ({erroresArchivo.length})</summary>
          <ul>
            {erroresArchivo.slice(0, 50).map((e) => (
              <li key={e.fila}>Fila {e.fila}: {e.motivo}</li>
            ))}
          </ul>
        </details>
      )}

      {hayArchivo && !plan && (
        <button
          type="button"
          className="mov-refresh-button"
          onClick={verVistaPrevia}
          disabled={bloqueado || !ubicacionId || !nombreCarga.trim()}
        >
          Ver vista previa (no carga nada todavía)
        </button>
      )}

      {plan && (
        <>
          <div className="mov-stock-summary">
            <div><span>Listas para cargar</span><strong>{plan.totales.listas}</strong></div>
            <div><span>Unidades a descontar</span><strong>{plan.totales.unidadesListas}</strong></div>
            <div><span>Para revisar</span><strong>{plan.problemas.length}</strong></div>
          </div>

          {plan.listas.length > 0 && (
            <details>
              <summary>Ventas listas para cargar ({plan.listas.length})</summary>
              <ul>
                {plan.listas.map((v) => (
                  <li key={v.codigo}>{v.nombre || v.codigo} — {v.cantidad} (stock {v.stock})</li>
                ))}
              </ul>
            </details>
          )}

          {[...problemasPorMotivo.entries()].map(([motivo, items]) => (
            <details key={motivo} open={motivo !== "YA_CARGADO"}>
              <summary>{TITULOS_PROBLEMA[motivo]} ({items.length})</summary>
              <ul>
                {items.map((p) => (
                  <li key={p.codigo}>
                    {p.codigo} — {p.nombre || "Sin nombre"} — {p.cantidad}
                    {p.detalle ? ` · ${p.detalle}` : ""}
                    {motivo === "NO_RECONOCIDO" && creando !== p.codigo && (
                      <>
                        {" "}
                        <button type="button" className="mov-refresh-button" onClick={() => abrirCreacion(p)} disabled={bloqueado}>
                          Crear producto
                        </button>
                      </>
                    )}
                    {motivo === "NO_RECONOCIDO" && creando === p.codigo && (
                      <div className="mov-stock-filters">
                        <label className="mov-field">
                          Nombre del producto
                          <input
                            value={formNombre}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormNombre(e.target.value)}
                            maxLength={200}
                            disabled={bloqueado}
                          />
                        </label>
                        <label className="mov-field">
                          Marca (opcional)
                          <input
                            value={formMarca}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormMarca(e.target.value)}
                            maxLength={100}
                            disabled={bloqueado}
                          />
                        </label>
                        <label className="mov-field">
                          Presentación (opcional)
                          <input
                            value={formPresentacion}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFormPresentacion(e.target.value)}
                            maxLength={100}
                            disabled={bloqueado}
                          />
                        </label>
                        {mensajeProducto && <div className="mov-empty" role="alert">{mensajeProducto}</div>}
                        <button type="button" className="mov-refresh-button" onClick={() => void guardarProductoNuevo(p.codigo)} disabled={bloqueado}>
                          Guardar producto
                        </button>{" "}
                        <button type="button" className="mov-refresh-button" onClick={() => setCreando(null)} disabled={bloqueado}>
                          Cancelar
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))}

          {plan.listas.length > 0 || paraRevision.length > 0 ? (
            <button type="button" className="mov-refresh-button" onClick={cargarVentas} disabled={bloqueado}>
              Cargar {plan.listas.length} ventas ({plan.totales.unidadesListas} unidades)
              {paraRevision.length > 0 ? ` y ${paraRevision.length} para revisar (con error)` : ""}
            </button>
          ) : (
            <div className="mov-empty">No hay ventas para cargar con este archivo.</div>
          )}
        </>
      )}

      {resultado && resultado.total > 0 && (
        <>
          <div className="mov-stock-summary">
            <div><span>Procesadas por el motor</span><strong>{resultado.procesadas}</strong></div>
            <div><span>Pendientes</span><strong>{resultado.pendientes}</strong></div>
            <div><span>Con error</span><strong>{resultado.conError.length}</strong></div>
          </div>
          <button type="button" className="mov-refresh-button" onClick={() => void consultarResultado()} disabled={bloqueado}>
            Actualizar
          </button>
          {resultado.pendientes > 0 && (
            <div className="mov-empty">El motor sigue procesando; esta pantalla se actualiza sola cada pocos segundos.</div>
          )}
        </>
      )}

      {resultado && resultado.conError.length > 0 && (
        <details open>
          <summary>Ventas que el motor no pudo procesar ({resultado.conError.length})</summary>
          <ul>
            {resultado.conError.map((e, i) => (
              <li key={`${e.nombre}-${i}`}>{e.nombre || "Producto"} — {e.cantidad}: {e.error}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
