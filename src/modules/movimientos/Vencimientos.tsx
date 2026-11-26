import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import {
  calcularVencimientos,
  DIAS_AVISO_OPCIONES,
  hoyArgentina,
  vencimientosACsv,
  type ItemVencimiento,
  type LoteVencimiento,
} from "./vencimientos";

/**
 * Alerta de vencimientos.
 * Para qué sirve: ver de un vistazo qué mercadería ya venció o está por vencer
 * en la sucursal, ordenada por urgencia, sin revisar Airtable a mano. Solo lee
 * el stock (la misma consulta que usa la pantalla Stock); no modifica nada.
 */

type UsuarioVencimientos = {
  nombre: string;
  sucursal: string;
  sucursalId?: string;
};

type RespuestaLotes = {
  ok?: boolean;
  error?: string;
  lotes?: LoteVencimiento[];
};

function textoDias(dias: number): string {
  if (dias < -1) return `venció hace ${-dias} días`;
  if (dias === -1) return "venció ayer";
  if (dias === 0) return "vence hoy";
  if (dias === 1) return "vence mañana";
  return `vence en ${dias} días`;
}

function formatearFecha(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-");
  return `${dia}/${mes}/${anio}`;
}

export default function Vencimientos({ usuario }: { usuario: UsuarioVencimientos }) {
  const [lotes, setLotes] = useState<LoteVencimiento[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [diasAviso, setDiasAviso] = useState<number>(30);
  const [ubicacionId, setUbicacionId] = useState("");
  const [texto, setTexto] = useState("");
  const [hoy, setHoy] = useState(() => hoyArgentina());

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const respuesta = await fetch(
        `/api/stock-lotes?vista=general&sucursal=${encodeURIComponent(usuario.sucursalId || usuario.sucursal)}`,
      );
      let datos: RespuestaLotes = {};
      try {
        datos = (await respuesta.json()) as RespuestaLotes;
      } catch {
        // Respuesta que no era JSON: se informa con el mensaje de abajo.
      }
      if (!respuesta.ok || datos.ok === false) {
        throw new Error(datos.error || "No se pudo cargar el stock.");
      }
      setLotes(datos.lotes ?? []);
      setHoy(hoyArgentina());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el stock.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
    // Se vuelve a cargar solo al cambiar de sucursal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.sucursalId, usuario.sucursal]);

  const ubicaciones = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const lote of lotes) mapa.set(lote.ubicacionId, lote.ubicacionNombre);
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [lotes]);

  const resultado = useMemo(
    () => calcularVencimientos({ lotes, hoy, diasAviso, ubicacionId: ubicacionId || undefined, texto }),
    [lotes, hoy, diasAviso, ubicacionId, texto],
  );

  const vencidos = resultado.grupos.find((g) => g.nivel === "VENCIDO");
  const urgentes = resultado.grupos.find((g) => g.nivel === "VENCE_7");

  function descargarCsv() {
    const csv = vencimientosACsv(resultado.grupos);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `vencimientos-${usuario.sucursal.replace(/\s+/g, "-").toLowerCase()}-${hoy}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  }

  function fila(i: ItemVencimiento) {
    return (
      <li key={i.id}>
        <strong>{i.nombreProducto}</strong> ({i.codigo}) — {i.ubicacionNombre} — {formatearFecha(i.vencimiento)}{" "}
        ({textoDias(i.dias)}) — {i.cantidad} u.
      </li>
    );
  }

  return (
    <section className="mov-card mov-stock-card">
      <div className="mov-stock-header">
        <div>
          <span>CONTROL</span>
          <h3>Vencimientos</h3>
          <p>Mercadería vencida o por vencer en {usuario.sucursal}, de la más urgente a la menos urgente.</p>
        </div>
        <button type="button" className="mov-refresh-button" onClick={() => void cargar()} disabled={cargando}>
          {cargando ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      <div className="mov-stock-filters">
        <label className="mov-field">
          Mostrar lo que vence en los próximos
          <select
            value={diasAviso}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setDiasAviso(Number(e.target.value))}
          >
            {DIAS_AVISO_OPCIONES.map((d) => (
              <option key={d} value={d}>{d} días</option>
            ))}
          </select>
        </label>

        <label className="mov-field">
          Ubicación
          <select value={ubicacionId} onChange={(e: ChangeEvent<HTMLSelectElement>) => setUbicacionId(e.target.value)}>
            <option value="">Todas</option>
            {ubicaciones.map(([id, nombre]) => (
              <option key={id} value={id}>{nombre}</option>
            ))}
          </select>
        </label>

        <label className="mov-field">
          Buscar producto o código
          <input
            value={texto}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTexto(e.target.value)}
            placeholder="Ej: yerba o 7790..."
          />
        </label>
      </div>

      {error && <div className="mov-empty" role="alert">{error}</div>}

      {!error && (
        <div className="mov-stock-summary">
          <div><span>Lotes vencidos con stock</span><strong>{vencidos ? vencidos.items.length : 0}</strong></div>
          <div><span>Vencen en 7 días o menos</span><strong>{urgentes ? urgentes.items.length : 0}</strong></div>
          <div><span>Total de lotes a revisar</span><strong>{resultado.totalLotes}</strong></div>
        </div>
      )}

      {!error && !cargando && resultado.totalLotes === 0 && (
        <div className="mov-empty">
          No hay mercadería vencida ni por vencer en los próximos {diasAviso} días con estos filtros.
        </div>
      )}

      {resultado.grupos.map((grupo) => (
        <details key={grupo.nivel} open={grupo.nivel === "VENCIDO" || grupo.nivel === "VENCE_7" || grupo.nivel === "VENCE_15"}>
          <summary>
            {grupo.titulo} ({grupo.items.length} lotes, {grupo.unidades} u.)
          </summary>
          <ul>{grupo.items.map(fila)}</ul>
        </details>
      ))}

      {resultado.totalLotes > 0 && (
        <button type="button" className="mov-refresh-button" onClick={descargarCsv}>
          Descargar lista (Excel)
        </button>
      )}
    </section>
  );
}
