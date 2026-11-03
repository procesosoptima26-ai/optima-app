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
      setSucursales([]); setPredeterminada(""); setModulos(["CORE"]); setPermisos([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error enviando invitación");
    } finally { setCargando(false); }
  }

  return (
    <section style={{ marginTop: 24, padding: 20, border: "1px solid #ddd", borderRadius: 12 }}>
      <h3>Invitar a un empleado</h3>
      <p>La cuenta se activará cuando el empleado establezca su contraseña desde el correo.</p>
      {error && <p role="alert" style={{ color: "#a00" }}>{error}</p>}
      {mensaje && <p role="status" style={{ color: "#136a3b" }}>{mensaje}</p>}
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
            <legend>Módulos</legend>
            {opciones.modulos.map((m) => <label key={m.id} style={{ display: "block" }}>
              <input type="checkbox" checked={modulos.includes(m.id)} disabled={m.id === "CORE"}
                onChange={() => {
                  const nuevos = modulos.includes(m.id) ? modulos.filter((v) => v !== m.id) : [...modulos, m.id];
                  setModulos(nuevos);
                  setPermisos(permisos.filter((p) => opciones.permisos.some((o) =>
                    o.id === p && nuevos.includes(moduloDelCampo[o.campo]))));
                }} /> {m.opcionAirtable.replaceAll("_", " ")}
            </label>)}
          </fieldset>
          <fieldset>
            <legend>Permisos por módulo</legend>
            {opciones.permisos.filter((p) => {
              const modulo = moduloDelCampo[p.campo];
              return modulo && modulos.includes(modulo);
            }).map((p) => <label key={p.id} style={{ display: "block" }}>
              <input type="checkbox" checked={permisos.includes(p.id)}
                onChange={() => alternar(p.id, permisos, setPermisos)} />
              {p.campo.replace("PERMISOS_", "")} — {p.opcionAirtable.replaceAll("_", " ")}
            </label>)}
          </fieldset>
          <button type="submit" disabled={cargando || !sucursales.length || !predeterminada}>
            {cargando ? "Enviando..." : "Enviar invitación"}
          </button>
        </form>
      )}
    </section>
  );
}
