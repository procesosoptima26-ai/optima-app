import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import {
  estadoDeMovimiento,
  fechaArgentina,
  filtrarHistorial,
  historialACsv,
  valoresDistintos,
  type EstadoMovimiento,
  type MovimientoHistorial,
} from "./historial";

/**
 * Historial de movimientos con filtros y descarga a Excel.
 * Solo lee (misma consulta del historial de la pantalla, con más registros y
 * con los nombres de ubicación); no modifica nada.
 */

type UsuarioHistorial = { nombre: string; sucursal: string; sucursalId?: string };
type Respuesta = { ok?: boolean; error?: string; movimientos?: MovimientoHistorial[] };

const MAXIMO = 300;

function formatearDia(dia: string): string {
  const [anio, mes, d] = dia.split("-");
  return d ? `${d}/${mes}/${anio}` : "";
}

export default function Historial({ usuario }: { usuario: UsuarioHistorial }) {
  const [movimientos, setMovimientos] = useState<MovimientoHistorial[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [tipo, setTipo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [estado, setEstado] = useState<EstadoMovimiento | "">("");
  const [texto, setTexto] = useState("");

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const respuesta = await fetch(
        `/api/movimientos?sucursal=${encodeURIComponent(usuario.sucursalId || usuario.sucursal)}&limite=${MAXIMO}&detalle=1`,
      );
      let datos: Respuesta = {};
      try {
        datos = (await respuesta.json()) as Respuesta;
      } catch {
        // Respuesta que no era JSON: se informa con el mensaje de abajo.
      }
      if (!respuesta.ok || datos.ok === false) {
        throw new Error(datos.error || "No se pudo cargar el historial.");
      }
      setMovimientos(datos.movimientos ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el historial.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
    // Se vuelve a cargar solo al cambiar de sucursal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.sucursalId, usuario.sucursal]);

  const tipos = useMemo(() => valoresDistintos(movimientos, "tipoMovimiento"), [movimientos]);
  const motivos = useMemo(() => valoresDistintos(movimientos, "motivo"), [movimientos]);
  const filtrados = useMemo(
    () => filtrarHistorial(movimientos, { desde, hasta, tipo, motivo, estado, texto }),
    [movimientos, desde, hasta, tipo, motivo, estado, texto],
  );

  function descargarCsv() {
    const blob = new Blob([historialACsv(filtrados)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `historial-${usuario.sucursal.replace(/\s+/g, "-").toLowerCase()}-${fechaArgentina(new Date().toISOString())}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  }

  function limpiar() {
    setDesde("");
    setHasta("");
    setTipo("");
    setMotivo("");
    setEstado("");
    setTexto("");
  }

  return (
    <section className="mov-card mov-stock-card">
      <div className="mov-stock-header">
        <div>
          <span>CONTROL</span>
          <h3>Historial de movimientos</h3>
          <p>Los últimos {MAXIMO} movimientos de {usuario.sucursal}. Filtrá y descargá lo que necesites.</p>
        </div>
        <button type="button" className="mov-refresh-button" onClick={() => void cargar()} disabled={cargando}>
          {cargando ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      <div className="mov-stock-filters">
        <label className="mov-field">
          Desde
          <input type="date" value={desde} onChange={(e: ChangeEvent<HTMLInputElement>) => setDesde(e.target.value)} />
        </label>
        <label className="mov-field">
          Hasta
          <input type="date" value={hasta} onChange={(e: ChangeEvent<HTMLInputElement>) => setHasta(e.target.value)} />
        </label>
        <label className="mov-field">
          Tipo
          <select value={tipo} onChange={(e: ChangeEvent<HTMLSelectElement>) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="mov-field">
          Motivo
          <select value={motivo} onChange={(e: ChangeEvent<HTMLSelectElement>) => setMotivo(e.target.value)}>
            <option value="">Todos</option>
            {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="mov-field">
          Estado
          <select value={estado} onChange={(e: ChangeEvent<HTMLSelectElement>) => setEstado(e.target.value as EstadoMovimiento | "")}>
            <option value="">Todos</option>
            <option value="OK">OK</option>
            <option value="ERROR">Con error</option>
            <option value="PENDIENTE">Pendiente</option>
          </select>
        </label>
        <label className="mov-field">
          Buscar producto, archivo o responsable
          <input value={texto} onChange={(e: ChangeEvent<HTMLInputElement>) => setTexto(e.target.value)} placeholder="Ej: yerba o ventas archivo" />
        </label>
      </div>

      {error && <div className="mov-empty" role="alert">{error}</div>}

      {!error && (
        <div className="mov-stock-summary">
          <div><span>Movimientos cargados</span><strong>{movimientos.length}</strong></div>
          <div><span>Con estos filtros</span><strong>{filtrados.length}</strong></div>
          <div><span>Con error del motor</span><strong>{filtrados.filter((m) => estadoDeMovimiento(m) === "ERROR").length}</strong></div>
        </div>
      )}

      {!error && !cargando && filtrados.length === 0 && (
        <div className="mov-empty">No hay movimientos con estos filtros.</div>
      )}

      <div className="mov-history">
        {filtrados.map((m) => {
          const est = estadoDeMovimiento(m);
          return (
            <article key={m.id} className="mov-history-item">
              <div>
                <strong>{m.nombreProducto || "Producto"}</strong>
                <span>{m.tipoMovimiento} · {m.motivo} · {m.cantidad} u.</span>
                <p>
                  {formatearDia(fechaArgentina(m.fechaHora))}
                  {m.ubicacionOrigenNombre ? ` · Desde ${m.ubicacionOrigenNombre}` : ""}
                  {m.ubicacionDestinoNombre ? ` · Hacia ${m.ubicacionDestinoNombre}` : ""}
                  {m.vencimiento ? ` · Vence ${formatearDia(m.vencimiento)}` : ""}
                </p>
                {m.observacion && <small>{m.observacion}</small>}
                {m.errorMotor && <small>{m.errorMotor}</small>}
              </div>
              <div className={est === "OK" ? "mov-status mov-status-ok" : est === "ERROR" ? "mov-status mov-status-error" : "mov-status mov-status-pending"}>
                {est}
              </div>
            </article>
          );
        })}
      </div>

      <div className="mov-header-actions">
        <button type="button" className="mov-refresh-button" onClick={limpiar}>Limpiar filtros</button>
        {filtrados.length > 0 && (
          <button type="button" className="mov-refresh-button" onClick={descargarCsv}>Descargar lista (Excel)</button>
        )}
      </div>
    </section>
  );
}
