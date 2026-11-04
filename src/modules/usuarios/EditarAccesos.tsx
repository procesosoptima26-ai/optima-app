import { useEffect, useMemo, useState, type FormEvent } from "react";

type Opcion = { id: string; opcionAirtable: string };
type Sucursal = { id: string; nombre: string };
type Permiso = { id: string; campo: string; opcionAirtable: string };
type Opciones = { modulos: Opcion[]; sucursales: Sucursal[]; permisos: Permiso[] };
type Empleado = {
  id: string; usuario: string; nombre: string; activo: boolean;
  sucursalIds: string[]; sucursalPredeterminadaId: string;
  modulos: string[]; permisos: string[]; version: string;
};

const moduloPorCampo: Record<string, string> = {
  PERMISOS_INVENTARIO: "INVENTARIO",
  PERMISOS_MOVIMIENTOS: "MOVIMIENTOS",
  PERMISOS_ADMINISTRACION: "ADMINISTRACION",
  PERMISOS_FACTURACION: "FACTURACION",
  PERMISOS_REPORTES: "REPORTES",
  PERMISOS_AJUSTES: "CONFIGURACION",
  PERMISOS_USUARIOS: "CORE",
};

export default function EditarAccesos({ id, onCerrar, onGuardado }: {
  id: string; onCerrar: () => void; onGuardado: () => void;
}) {
  const [empleado, setEmpleado] = useState<Empleado | null>(null);
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [sucursales, setSucursales] = useState<string[]>([]);
  const [predeterminada, setPredeterminada] = useState("");
  const [modulos, setModulos] = useState<string[]>([]);
  const [permisos, setPermisos] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    const controlador = new AbortController();
    setCargando(true); setError(""); setMensaje(""); setEmpleado(null); setOpciones(null);
    void fetch("/api/usuarios/detalle?id=" + encodeURIComponent(id), {
      credentials: "same-origin", cache: "no-store", signal: controlador.signal,
    }).then(async r => {
      const d = await r.json() as { ok: boolean; empleado?: Empleado; opciones?: Opciones; error?: string };
      if (!r.ok || !d.ok || !d.empleado || !d.opciones)
        throw new Error(d.error || "No se pudo consultar al empleado");
      if (!controlador.signal.aborted) {
        setEmpleado(d.empleado); setOpciones(d.opciones);
        setSucursales(d.empleado.sucursalIds); setPredeterminada(d.empleado.sucursalPredeterminadaId);
        setModulos(d.empleado.modulos); setPermisos(d.empleado.permisos);
      }
    }).catch((e: unknown) => {
      if (!controlador.signal.aborted) setError(e instanceof Error ? e.message : "Error consultando empleado");
    }).finally(() => { if (!controlador.signal.aborted) setCargando(false); });
    return () => controlador.abort();
  }, [id]);

  const permisosFueraDeModulo = useMemo(() => permisos.filter(p =>
    opciones?.permisos.some(op => op.id === p && !modulos.includes(moduloPorCampo[op.campo]))
  ), [permisos, opciones, modulos]);
  const errorCliente = !sucursales.length ? "Seleccioná una sucursal autorizada"
    : !sucursales.includes(predeterminada) ? "Seleccioná la sucursal predeterminada"
    : !modulos.includes("CORE") ? "El módulo Usuario es obligatorio"
    : permisosFueraDeModulo.length ? "Hay permisos de módulos no habilitados. Revisalos antes de guardar."
    : "";

  function alternar(item: string, lista: string[], set: (v: string[]) => void) {
    set(lista.includes(item) ? lista.filter(x => x !== item) : [...lista, item]);
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!empleado || !opciones || errorCliente) return;
    setGuardando(true); setError(""); setMensaje("");
    try {
      const r = await fetch("/api/usuarios/editar", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: empleado.id, version: empleado.version,
          sucursalIds: sucursales, sucursalPredeterminadaId: predeterminada,
          modulos, permisos,
        }),
      });
      const d = await r.json() as { ok: boolean; error?: string; empleado?: Empleado };
      if (!r.ok || !d.ok || !d.empleado) throw new Error(d.error || "No se pudo guardar");
      setEmpleado(d.empleado); setSucursales(d.empleado.sucursalIds);
      setPredeterminada(d.empleado.sucursalPredeterminadaId);
      setModulos(d.empleado.modulos); setPermisos(d.empleado.permisos);
      setMensaje("Accesos actualizados correctamente");
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando accesos");
    } finally { setGuardando(false); }
  }

  return (
    <section style={{ border: "1px solid #94a3b8", padding: 14, borderRadius: 10, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 8 }}>
        <h4 style={{ marginTop: 0 }}>Editar accesos: {empleado?.usuario || "Empleado"}</h4>
        <button type="button" onClick={onCerrar} disabled={guardando}>Cerrar</button>
      </div>
      {cargando && <p role="status">Consultando permisos del empleado...</p>}
      {!cargando && error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}
      {empleado && opciones && <form onSubmit={guardar} style={{ display: "grid", gap: 14 }}>
        <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
          Se modificarán solo sucursales, módulos y permisos. La identidad, la empresa y el rol no cambian.
        </p>
        <fieldset disabled={guardando}>
          <legend>Sucursales autorizadas</legend>
          {opciones.sucursales.map(s =>
            <label key={s.id} style={{ display: "block", margin: "6px 0" }}>
              <input type="checkbox" checked={sucursales.includes(s.id)}
                onChange={() => {
                  const nueva = sucursales.includes(s.id) ? sucursales.filter(x => x !== s.id) : [...sucursales, s.id];
                  setSucursales(nueva);
                  if (!nueva.includes(predeterminada)) setPredeterminada("");
                }} /> {s.nombre}
            </label>
          )}
        </fieldset>
        <label>Sucursal predeterminada
          <select required value={predeterminada} disabled={guardando} onChange={e => setPredeterminada(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 5 }}>
            <option value="">Seleccionar...</option>
            {opciones.sucursales.filter(s => sucursales.includes(s.id)).map(s =>
              <option key={s.id} value={s.id}>{s.nombre}</option>
            )}
          </select>
        </label>
        <fieldset disabled={guardando}>
          <legend>Módulos y permisos</legend>
          {opciones.modulos.map(m => {
            const marcado = modulos.includes(m.id);
            const delModulo = opciones.permisos.filter(p => moduloPorCampo[p.campo] === m.id);
            return <div key={m.id} style={{ borderBottom: "1px solid #e2e8f0", padding: "8px 0" }}>
              <label style={{ fontWeight: 650 }}>
                <input type="checkbox" checked={marcado} disabled={m.id === "CORE"}
                  onChange={() => alternar(m.id, modulos, setModulos)} /> {m.opcionAirtable.replaceAll("_", " ")}
              </label>
              {marcado && delModulo.length > 0 && <div style={{ padding: "6px 0 0 22px" }}>
                {delModulo.map(p => <label key={p.id} style={{ display: "block", fontSize: 13, padding: "3px 0" }}>
                  <input type="checkbox" checked={permisos.includes(p.id)}
                    onChange={() => alternar(p.id, permisos, setPermisos)} /> {p.opcionAirtable.replaceAll("_", " ")}
                </label>)}
              </div>}
            </div>;
          })}
        </fieldset>
        {permisosFueraDeModulo.length > 0 && <button type="button" disabled={guardando}
          onClick={() => setPermisos(actual => actual.filter(p =>
            !opciones.permisos.some(op => op.id === p && !modulos.includes(moduloPorCampo[op.campo]))))}>
          Quitar permisos de módulos deshabilitados ({permisosFueraDeModulo.length})
        </button>}
        {errorCliente && <p role="alert" style={{ color: "#991b1b", fontSize: 13, margin: 0 }}>{errorCliente}</p>}
        {error && <p role="alert" style={{ color: "#991b1b", fontSize: 13, margin: 0 }}>{error}</p>}
        {mensaje && <p role="status" style={{ color: "#166534", margin: 0 }}>{mensaje}</p>}
        <button type="submit" disabled={guardando || Boolean(errorCliente)}>
          {guardando ? "Guardando..." : "Guardar cambios"}
        </button>
      </form>}
    </section>
  );
}
