import { useEffect, useState, type FormEvent } from "react";

type Empleado = { id: string; usuario: string; activo: boolean; version: string };

export default function GestionEstado({ id, onCerrar, onGuardado }: {
  id: string; onCerrar: () => void; onGuardado: () => void;
}) {
  const [empleado, setEmpleado] = useState<Empleado | null>(null);
  const [habilitado, setHabilitado] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    setCargando(true); setError(""); setMensaje(""); setEmpleado(null);
    const consultar = async () => {
      const [e, h] = await Promise.all([
        fetch(`/api/usuarios/detalle?id=${encodeURIComponent(id)}`,
          { credentials: "same-origin", cache: "no-store", signal: ctrl.signal }),
        fetch("/api/usuarios/estado", { credentials: "same-origin", cache: "no-store", signal: ctrl.signal }),
      ]);
      const datos = await e.json() as { ok: boolean; empleado?: Empleado; error?: string };
      const permiso = await h.json() as { ok: boolean; habilitado?: boolean; error?: string };
      if (!e.ok || !datos.ok || !datos.empleado) throw new Error(datos.error || "No se pudo consultar la cuenta");
      if (!h.ok || !permiso.ok) throw new Error(permiso.error || "No se pudo comprobar la habilitación");
      if (!ctrl.signal.aborted) { setEmpleado(datos.empleado); setHabilitado(permiso.habilitado === true); }
    };
    void consultar().catch((err: unknown) => {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : "Error consultando estado");
    }).finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [id]);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!empleado || !habilitado || !confirmado || motivo.trim().length < 10) return;
    setGuardando(true); setError(""); setMensaje("");
    try {
      const r = await fetch("/api/usuarios/estado", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: empleado.id, version: empleado.version,
          activo: !empleado.activo, motivo: motivo.trim() }),
      });
      const datos = await r.json() as { ok: boolean; empleado?: Empleado; error?: string };
      if (!r.ok || !datos.ok || !datos.empleado)
        throw new Error(datos.error || "No se confirmó el cambio. Revisá el estado antes de reintentar.");
      setEmpleado(datos.empleado); setMensaje("Estado confirmado; se cerraron las sesiones anteriores");
      setConfirmado(false); setMotivo("");
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar el cambio");
    } finally { setGuardando(false); }
  }

  return <section style={{ padding: 14, border: "1px solid #94a3b8", borderRadius: 10, marginTop: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
      <h4 style={{ margin: 0 }}>Estado de cuenta: {empleado?.usuario || "Empleado"}</h4>
      <button type="button" disabled={guardando} onClick={onCerrar}>Cerrar</button>
    </div>
    {cargando && <p role="status">Comprobando cuenta...</p>}
    {error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}
    {!cargando && empleado && !habilitado && <p role="status" style={{ color: "#475569" }}>
      Activación y desactivación protegidas hasta completar la validación de auditoría global.
      No se modificó ninguna cuenta.
    </p>}
    {!cargando && empleado && habilitado && <form onSubmit={guardar} style={{ display: "grid", gap: 12, marginTop: 12 }}>
      <p>Cuenta actual: <strong>{empleado.activo ? "activa" : "inactiva"}</strong>. La operación
      {empleado.activo ? " desactivará el acceso del empleado" : " reactivará una cuenta previamente habilitada"}.
      No modifica su empresa, rol, sucursales ni permisos.</p>
      <label>Motivo obligatorio (mínimo 10 caracteres)
        <textarea value={motivo} onChange={e => setMotivo(e.target.value)}
          maxLength={500} rows={2} disabled={guardando} style={{ display: "block", width: "100%" }} />
      </label>
      <label><input type="checkbox" checked={confirmado} disabled={guardando}
        onChange={e => setConfirmado(e.target.checked)} /> Confirmo que revisé esta cuenta y el cambio solicitado</label>
      <button type="submit" disabled={guardando || !confirmado || motivo.trim().length < 10}>
        {guardando ? "Confirmando..." : empleado.activo ? "Desactivar empleado" : "Reactivar empleado"}
      </button>
    </form>}
    {mensaje && <p role="status" style={{ color: "#166534" }}>{mensaje}</p>}
  </section>;
}
