import { useEffect, useState } from "react";

type Evento = {
  id: string; operacionId: string; fechaHoraUtc: string; actor: string;
  accion: string; modulo: string; recursoTipo: string; recursoId: string;
  resultado: string; origen: string; motivo: string; detalle: string;
  anterior: Record<string, unknown> | null; nuevo: Record<string, unknown> | null;
};

export default function HistorialAuditoria({ onCerrar }: { onCerrar: () => void }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function cargar(siguiente: string | null, signal?: AbortSignal) {
    setCargando(true); setError("");
    try {
      const ruta = "/api/usuarios/historial_auditoria" + (siguiente ? `?cursor=${encodeURIComponent(siguiente)}` : "");
      const r = await fetch(ruta, { method: "GET", credentials: "same-origin", cache: "no-store", signal });
      const d = await r.json() as { ok: boolean; eventos?: Evento[]; siguienteCursor?: string | null; error?: string };
      if (!r.ok || !d.ok || !Array.isArray(d.eventos)) throw new Error(d.error || "No se pudo consultar la auditoría");
      if (signal?.aborted) return;
      setEventos(actuales => siguiente ? [...actuales, ...d.eventos!] : d.eventos!);
      setCursor(d.siguienteCursor ?? null);
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : "No se pudo consultar el historial");
    } finally {
      if (!signal?.aborted) setCargando(false);
    }
  }
  useEffect(() => {
    const c = new AbortController();
    void cargar(null, c.signal);
    return () => c.abort();
  }, []);

  return <section style={{ padding: 16, border: "1px solid #cbd5e1", borderRadius: 10, marginTop: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <h4 style={{ marginTop: 0 }}>Historial de auditoría de mi empresa</h4>
      <button type="button" onClick={onCerrar}>Cerrar historial</button>
    </div>
    <p style={{ fontSize: 13, color: "#475569" }}>Consulta únicamente de lectura. Los cambios de estado y accesos deben tener auditoría habilitada para registrar nuevos eventos.</p>
    {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    {cargando && <p role="status">Consultando auditoría...</p>}
    {!cargando && !error && eventos.length === 0 && <p>Todavía no hay eventos registrados para esta empresa.</p>}
    {eventos.length > 0 && <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
      <thead><tr>{["Fecha (UTC)", "Actor", "Acción", "Registro", "Resultado", "Origen", "Motivo", "Detalles"].map(h =>
        <th key={h} scope="col" style={{ borderBottom: "1px solid #94a3b8", textAlign: "left", padding: 7 }}>{h}</th>)}</tr></thead>
      <tbody>{eventos.map(e => <tr key={e.id}>
        <td style={{ padding: 7 }}>{new Date(e.fechaHoraUtc).toLocaleString("es-AR", { timeZone: "UTC" })}</td>
        <td style={{ padding: 7 }}>{e.actor}</td>
        <td style={{ padding: 7 }}>{e.accion}</td>
        <td style={{ padding: 7 }}>{e.recursoTipo} · {e.recursoId}</td>
        <td style={{ padding: 7 }}>{e.resultado}</td>
        <td style={{ padding: 7 }}>{e.origen}</td>
        <td style={{ padding: 7 }}>{e.motivo}</td>
        <td style={{ padding: 7 }}><details><summary>Ver cambio</summary>
          <p>Operación: {e.operacionId}</p>
          <p>Estado anterior</p><pre style={{ whiteSpace: "pre-wrap" }}>{e.anterior ? JSON.stringify(e.anterior, null, 2) : "Sin datos"}</pre>
          <p>Estado posterior</p><pre style={{ whiteSpace: "pre-wrap" }}>{e.nuevo ? JSON.stringify(e.nuevo, null, 2) : "Sin datos"}</pre>
          {e.detalle && <p>Código técnico: {e.detalle}</p>}
        </details></td>
      </tr>)}</tbody>
    </table></div>}
    {cursor && <button type="button" disabled={cargando} onClick={() => void cargar(cursor)}
      style={{ marginTop: 12 }}>{cargando ? "Consultando..." : "Ver más eventos"}</button>}
  </section>;
}
