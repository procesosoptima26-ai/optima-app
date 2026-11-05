import { useEffect, useState } from "react";

type Sucursal = {
  id: string; nombre: string; activa: boolean;
  autorizada: boolean; usuariosAsignados: number; ubicaciones: number;
};
type Respuesta = { ok?: boolean; sucursales?: Sucursal[]; error?: string };

export default function GestionSucursales() {
  const [lista, setLista] = useState<Sucursal[]>([]);
  const [nombre, setNombre] = useState("");
  const [editando, setEditando] = useState("");
  const [nombreEditado, setNombreEditado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  async function consultar() {
    const respuesta = await fetch("/api/sucursales", { credentials: "same-origin", cache: "no-store" });
    const datos = await respuesta.json() as Respuesta;
    if (!respuesta.ok || !datos.ok || !Array.isArray(datos.sucursales))
      throw new Error(datos.error || "No se pudieron consultar las sucursales");
    setLista(datos.sucursales);
  }

  useEffect(() => {
    let vigente = true;
    void consultar().catch((e: unknown) => {
      if (vigente) setError(e instanceof Error ? e.message : "No se pudo cargar");
    }).finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, []);

  async function operar(metodo: "POST" | "PATCH" | "DELETE", datos: Record<string, unknown>) {
    setOcupado(true); setError(""); setMensaje("");
    try {
      const respuesta = await fetch("/api/sucursales", {
        method: metodo, credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
      const resultado = await respuesta.json() as Respuesta;
      if (!respuesta.ok || !resultado.ok) throw new Error(resultado.error || "No se pudo guardar");
      await consultar();
      setNombre(""); setEditando(""); setNombreEditado("");
      setMensaje("Operación realizada correctamente");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de gestión");
    } finally { setOcupado(false); }
  }

  return (
    <section style={{ border: "1px solid #94a3b8", borderRadius: 10, padding: 16, marginTop: 18 }}>
      <h3>Gestión de sucursales</h3>
      <p style={{ fontSize: 13, color: "#475569" }}>
        Cada sucursal conserva su identificador al cambiar de nombre.
        No se pueden desactivar sucursales con usuarios o ubicaciones vinculadas.
      </p>
      {cargando && <p>Cargando sucursales...</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <input aria-label="Nueva sucursal" placeholder="Nombre de nueva sucursal" value={nombre}
          disabled={ocupado || cargando} maxLength={80} onChange={e => setNombre(e.target.value)} />
        <button type="button" disabled={ocupado || cargando || nombre.trim().length < 2}
          onClick={() => { void operar("POST", { accion: "crear", nombre }); }}>Crear sucursal</button>
      </div>
      {lista.map(s => (
        <div key={s.id} style={{ borderTop: "1px solid #e2e8f0", padding: "12px 0" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <strong>{s.nombre}</strong>
            <span>{s.activa ? "Activa" : "Inactiva"}</span>
            <small>{s.usuariosAsignados} usuarios · {s.ubicaciones} ubicaciones</small>
          </div>
          {editando === s.id ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <input aria-label="Nuevo nombre de la sucursal" value={nombreEditado} maxLength={80}
                disabled={ocupado} onChange={e => setNombreEditado(e.target.value)} />
              <button type="button" disabled={ocupado || nombreEditado.trim().length < 2}
                onClick={() => { void operar("PATCH", { accion: "renombrar", id: s.id, nombre: nombreEditado }); }}>Guardar nombre</button>
              <button type="button" disabled={ocupado} onClick={() => setEditando("")}>Cancelar</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <button type="button" disabled={ocupado || !s.activa}
                onClick={() => { setEditando(s.id); setNombreEditado(s.nombre); }}>Editar nombre</button>
              <button type="button" disabled={ocupado || !s.activa || s.usuariosAsignados > 0 || s.ubicaciones > 0 || lista.filter(x => x.activa).length <= 1}
                title={s.usuariosAsignados > 0 || s.ubicaciones > 0 ? "Tiene usuarios o ubicaciones vinculadas" : "Desactivar sucursal"}
                onClick={() => {
                  if (window.confirm(`¿Desactivar la sucursal ${s.nombre}?`))
                    void operar("DELETE", { accion: "desactivar", id: s.id });
                }}>Desactivar</button>
            </div>
          )}
        </div>
      ))}
      {error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}
      {mensaje && <p role="status" style={{ color: "#166534" }}>{mensaje}</p>}
    </section>
  );
}
