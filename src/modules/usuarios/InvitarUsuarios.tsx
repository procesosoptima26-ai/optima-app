import { useEffect, useState, type FormEvent } from "react";

type Opciones = {
  modulos: { id: string; opcionAirtable: string }[];
  sucursales: { id: string; nombre: string }[];
  permisos: { id: string; campo: string; opcionAirtable: string }[];
};

const moduloDelCampo: Record<string, string> = {
  PERMISOS_INVENTARIO: "INVENTARIO",
  PERMISOS_MOVIMIENTOS: "MOVIMIENTOS",
  PERMISOS_ADMINISTRACION: "ADMINISTRACION",
  PERMISOS_FACTURACION: "FACTURACION",
  PERMISOS_REPORTES: "REPORTES",
  PERMISOS_AJUSTES: "CONFIGURACION",
  PERMISOS_USUARIOS: "CORE",
};

export default function InvitarUsuarios() {
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [usuario, setUsuario] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [sucursales, setSucursales] = useState<string[]>([]);
  const [predeterminada, setPredeterminada] = useState("");
  const [modulos, setModulos] = useState<string[]>(["CORE"]);
  const [permisos, setPermisos] = useState<string[]>([]);
  const [moduloAbierto, setModuloAbierto] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void fetch("/api/usuarios/opciones", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => {
        const data = await r.json() as { ok: boolean; opciones?: Opciones; error?: string };
        if (!r.ok || !data.ok || !data.opciones) throw new Error(data.error || "No se pudieron obtener los permisos");
        return data.opciones;
      })
      .then((v) => { if (vivo) setOpciones(v); })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : "Error consultando permisos"); });
    return () => { vivo = false; };
  }, []);

  function alternar(valor: string, actual: string[], actualizar: (valores: string[]) => void) {
    actualizar(actual.includes(valor) ? actual.filter((x) => x !== valor) : [...actual, valor]);
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!opciones) return;
    setMensaje(""); setError(""); setCargando(true);
    try {
      const r = await fetch("/api/usuarios/invitar", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, nombre, email, sucursalIds: sucursales,
          sucursalPredeterminadaId: predeterminada, modulos, permisos }),
      });
      const data = await r.json() as { ok: boolean; error?: string; mensaje?: string };
      if (!r.ok || !data.ok) throw new Error(data.error || "No se pudo invitar");
      setMensaje(data.mensaje ?? "Invitación enviada");
      setUsuario(""); setNombre(""); setEmail("");
      setSucursales([]); setPredeterminada(""); setModulos(["CORE"]); setPermisos([]); setModuloAbierto(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error enviando invitación");
    } finally { setCargando(false); }
  }

  return (
    <section style={{ marginTop: 24, padding: 20, border: "1px solid #ddd", borderRadius: 12 }}>
      <h3>Invitar a un empleado</h3>
      <p>La cuenta se activará cuando el empleado establezca su contraseña desde el correo.</p>
      {!opciones && error && <p role="alert" style={{ color: "#a00" }}>{error}</p>}
      {!opciones ? <p>Consultando permisos...</p> : (
        <form onSubmit={enviar} style={{ display: "grid", gap: 15 }}>
          <label>Nombre completo
            <input required maxLength={100} value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label>Usuario (único en OPTIMA)
            <input required pattern="[A-Za-z0-9._-]{3,40}" value={usuario} onChange={(e) => setUsuario(e.target.value.toUpperCase())} />
          </label>
          <label>Correo electrónico
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <fieldset>
            <legend>Sucursales autorizadas</legend>
            {opciones.sucursales.map((s) => <label key={s.id} style={{ display: "block" }}>
              <input type="checkbox" checked={sucursales.includes(s.id)}
                onChange={() => {
                  alternar(s.id, sucursales, setSucursales);
                  if (predeterminada === s.id) setPredeterminada("");
                }} /> {s.nombre}
            </label>)}
          </fieldset>
          <label>Sucursal predeterminada
            <select required value={predeterminada} onChange={(e) => setPredeterminada(e.target.value)}>
              <option value="">Seleccionar...</option>
              {opciones.sucursales.filter((s) => sucursales.includes(s.id)).map((s) =>
                <option value={s.id} key={s.id}>{s.nombre}</option>)}
            </select>
          </label>
          <fieldset>
            <legend>Módulos y permisos</legend>
            <p style={{ margin: "2px 0 12px", fontSize: 14, color: "#4b5563" }}>
              Seleccioná los módulos y configurá los permisos debajo de cada uno.
              Podés abrir un módulo a la vez; los permisos seleccionados se conservan.
            </p>
            {opciones.modulos.map((m) => {
              const seleccionado = modulos.includes(m.id);
              const desplegado = seleccionado && moduloAbierto === m.id;
              const permisosDelModulo = opciones.permisos.filter((p) => moduloDelCampo[p.campo] === m.id);
              const cantidadElegida = permisosDelModulo.filter((p) => permisos.includes(p.id)).length;
              const nombreModulo = m.opcionAirtable.replaceAll("_", " ");
              return (
                <div key={m.id} style={{ borderBottom: "1px solid #e5e7eb", padding: "9px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: m.id === "CORE" ? "default" : "pointer" }}>
                      <input type="checkbox" checked={seleccionado} disabled={m.id === "CORE"}
                        onChange={() => {
                          const nuevos = seleccionado ? modulos.filter((v) => v !== m.id) : [...modulos, m.id];
                          setModulos(nuevos);
                          setPermisos((actuales) => actuales.filter((p) => opciones.permisos.some((o) =>
                            o.id === p && nuevos.includes(moduloDelCampo[o.campo]))));
                          setModuloAbierto(seleccionado ? null : m.id);
                        }} />
                      <span style={{ fontWeight: seleccionado ? 600 : 400 }}>{nombreModulo}</span>
                    </label>
                    {seleccionado && (
                      <button type="button" aria-expanded={desplegado}
                        aria-controls={`optima-permisos-${m.id}`}
                        onClick={() => setModuloAbierto(desplegado ? null : m.id)}
                        style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 7,
                          padding: "5px 10px", color: "#1e293b", cursor: "pointer", fontSize: 13 }}>
                        {desplegado ? "Ocultar permisos" : "Ver permisos"}{cantidadElegida ? ` (${cantidadElegida})` : ""}
                      </button>
                    )}
                  </div>
                  {desplegado && (
                    <div id={`optima-permisos-${m.id}`} role="group"
                      aria-label={`Permisos de ${nombreModulo}`}
                      style={{ margin: "10px 0 2px 26px", padding: "10px 14px", background: "#f8fafc",
                        border: "1px solid #e2e8f0", borderRadius: 8 }}>
                      {permisosDelModulo.length ? permisosDelModulo.map((p) => (
                        <label key={p.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "7px 0" }}>
                          <input type="checkbox" checked={permisos.includes(p.id)}
                            onChange={() => alternar(p.id, permisos, setPermisos)} />
                          <span>{p.opcionAirtable.replaceAll("_", " ")}</span>
                        </label>
                      )) : (
                        <p style={{ margin: 0, fontSize: 14, color: "#64748b" }}>
                          Este módulo no tiene permisos individuales configurables.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
          <button type="submit" disabled={cargando || !sucursales.length || !predeterminada}>
            {cargando ? "Enviando..." : "Enviar invitación"}
          </button>
          {error && (
            <p role="alert" style={{ padding: 12, margin: 0, borderRadius: 8, background: "#fff1f2", color: "#a00" }}>
              {error}
            </p>
          )}
          {mensaje && (
            <p role="status" style={{ padding: 12, margin: 0, borderRadius: 8, background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#136a3b", fontWeight: 600 }}>
              {mensaje}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
