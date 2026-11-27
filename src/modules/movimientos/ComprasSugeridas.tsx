import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  agruparPedido,
  filtrarCompras,
  pedidoACsv,
  proveedoresDisponibles,
  textoAviso,
  textoDiasAlcanza,
  type ItemCompra,
} from "./compras";

/**
 * Compras sugeridas (solo administradores, solo lectura).
 * Para qué sirve: ver qué conviene comprar en la sucursal, ordenado por urgencia,
 * filtrar por proveedor para armar cada pedido y bajarlo a Excel. Calcula con las
 * ventas de los últimos 60 días, el stock actual y el pack de compra de cada producto.
 * No modifica nada: solo consulta.
 */

type UsuarioCompras = { nombre: string; sucursal: string; sucursalId?: string };

type Resumen = {
  productosEvaluados: number;
  productosFueraDeLista: number;
  excluidos: number;
  conSugerencia: number;
};

type Respuesta = {
  ok?: boolean;
  error?: string;
  preparando?: boolean;
  diasListos?: number;
  diasTotal?: number;
  hoy?: string;
  hayPacks?: boolean;
  resumen?: Resumen;
  items?: ItemCompra[];
};

const ESPERA_ENTRE_CONSULTAS_MS = 2000;

function formatear(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace(".", ",");
}

export default function ComprasSugeridas({ usuario }: { usuario: UsuarioCompras }) {
  const [items, setItems] = useState<ItemCompra[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [hoy, setHoy] = useState("");
  const [cargando, setCargando] = useState(false);
  const [progreso, setProgreso] = useState<{ listos: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [texto, setTexto] = useState("");
  const [soloAvisos, setSoloAvisos] = useState(false);
  // Cada carga tiene un número; si el usuario cambia de sucursal o sale, las respuestas viejas se descartan.
  const cargaActual = useRef(0);

  const cargar = useCallback(async () => {
    const numero = ++cargaActual.current;
    setCargando(true);
    setError("");
    setProgreso(null);
    try {
      for (let intento = 0; intento < 60; intento++) {
        const respuesta = await fetch(
          `/api/movimientos?accion=compras_sugeridas&sucursal=${encodeURIComponent(usuario.sucursalId || usuario.sucursal)}`,
        );
        if (numero !== cargaActual.current) return;
        let datos: Respuesta = {};
        try {
          datos = (await respuesta.json()) as Respuesta;
        } catch {
          // No era JSON: se informa con el mensaje de abajo.
        }
        if (!respuesta.ok || datos.ok === false) {
          throw new Error(datos.error || "No se pudieron calcular las compras sugeridas.");
        }
        if (datos.preparando) {
          setProgreso({ listos: datos.diasListos ?? 0, total: datos.diasTotal ?? 60 });
          await new Promise((r) => setTimeout(r, ESPERA_ENTRE_CONSULTAS_MS));
          if (numero !== cargaActual.current) return;
          continue;
        }
        setItems(datos.items ?? []);
        setResumen(datos.resumen ?? null);
        setHoy(datos.hoy ?? "");
        setProgreso(null);
        return;
      }
      throw new Error("Está tardando más de lo normal. Probá actualizar en un minuto.");
    } catch (e) {
      if (numero !== cargaActual.current) return;
      setError(e instanceof Error ? e.message : "No se pudieron calcular las compras sugeridas.");
      setProgreso(null);
    } finally {
      if (numero === cargaActual.current) setCargando(false);
    }
  }, [usuario.sucursalId, usuario.sucursal]);

  useEffect(() => {
    setItems([]);
    setResumen(null);
    setProveedor("");
    void cargar();
    return () => {
      cargaActual.current++;
    };
  }, [cargar]);

  const proveedores = useMemo(() => proveedoresDisponibles(items), [items]);
  const filtrados = useMemo(
    () => filtrarCompras(items, { proveedor, texto, soloConAvisos: soloAvisos }),
    [items, proveedor, texto, soloAvisos],
  );
  const grupos = useMemo(() => agruparPedido(filtrados, proveedor || undefined), [filtrados, proveedor]);

  function descargar() {
    const blob = new Blob([pedidoACsv(grupos)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    const quien = proveedor ? proveedor.replace(/\s+/g, "-").toLowerCase() : "todos";
    enlace.href = url;
    enlace.download = `compras-${usuario.sucursal.replace(/\s+/g, "-").toLowerCase()}-${quien}-${hoy || "hoy"}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mov-card mov-stock-card">
      <div className="mov-stock-header">
        <div>
          <span>COMPRAS</span>
          <h3>Compras sugeridas</h3>
          <p>
            Qué conviene comprar en {usuario.sucursal}, según las ventas de los últimos 60 días, el stock y el pack
            de cada producto. Es una sugerencia: la decisión es tuya.
          </p>
        </div>
        <button type="button" className="mov-refresh-button" onClick={() => void cargar()} disabled={cargando}>
          {cargando ? "Calculando..." : "Actualizar"}
        </button>
      </div>

      {progreso && (
        <div className="mov-empty" role="status">
          Preparando los datos de ventas ({progreso.listos} de {progreso.total} días). La primera vez tarda un
          poco; después es inmediato. No cierres esta pantalla.
        </div>
      )}

      {error && <div className="mov-empty" role="alert">{error}</div>}

      {!error && !progreso && resumen && (
        <>
          <div className="mov-stock-summary">
            <div><span>Para comprar</span><strong>{items.length}</strong></div>
            <div><span>Con estos filtros</span><strong>{filtrados.length}</strong></div>
            <div><span>Productos evaluados</span><strong>{resumen.productosEvaluados}</strong></div>
          </div>

          <div className="mov-stock-filters">
            <label className="mov-field">
              Proveedor
              <select value={proveedor} onChange={(e: ChangeEvent<HTMLSelectElement>) => setProveedor(e.target.value)}>
                <option value="">Todos</option>
                {proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="mov-field">
              Buscar producto o código
              <input value={texto} onChange={(e: ChangeEvent<HTMLInputElement>) => setTexto(e.target.value)} placeholder="Ej: queso o 1005" />
            </label>
            <label className="mov-field compras-check">
              <input type="checkbox" checked={soloAvisos} onChange={(e: ChangeEvent<HTMLInputElement>) => setSoloAvisos(e.target.checked)} />
              Solo los que tienen avisos
            </label>
          </div>

          {resumen.conSugerencia === 0 && <div className="mov-empty">Con los datos actuales no hay nada para comprar.</div>}
          {resumen.conSugerencia > 0 && filtrados.length === 0 && <div className="mov-empty">No hay productos con estos filtros.</div>}

          {grupos.map((g) => (
            <div key={g.proveedor} className="compras-grupo">
              <h4>{g.proveedor} <small>({g.items.length} productos · {formatear(g.unidades)} u.)</small></h4>
              <div className="mov-history">
                {g.items.map((i) => (
                  <article key={`${g.proveedor}-${i.productoId}`} className="mov-history-item">
                    <div>
                      <strong>{i.nombre}</strong>
                      <span>Código {i.codigo} · Pack {formatear(i.multiplo)} · Vende {formatear(i.ventaDiaria)} por día</span>
                      <p>Stock {formatear(i.stock)} u. ({textoDiasAlcanza(i)}) · Objetivo {formatear(i.objetivo)} u.</p>
                      {i.avisos.map((a) => <small key={a} className="compras-aviso">{textoAviso(a)}</small>)}
                    </div>
                    <div className="mov-status mov-status-pending compras-pedir">
                      Pedir<br /><strong>{formatear(i.sugerido)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}

          <div className="mov-header-actions">
            {grupos.length > 0 && (
              <button type="button" className="mov-refresh-button" onClick={descargar}>
                Descargar pedido (Excel)
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
