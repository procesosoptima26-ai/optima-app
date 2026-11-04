import { useEffect, useMemo, useState } from "react";

type Usuario = {
  id: string;
  usuario: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  modulos: string[];
  sucursales: string[];
  sucursalesNoVisibles: number;
};

export default function ListadoUsuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [consulta, setConsulta] = useState("");
  const [version, setVersion] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError("");
    void fetch("/api/usuarios/listar", {
      credentials: "same-origin", cache: "no-store", signal: controller.signal,
    }).then(async (r) => {
      const d = await r.json() as { ok: boolean; usuarios?: Usuario[]; error?: string };
      if (!r.ok || !d.ok || !Array.isArray(d.usuarios)) throw new Error(d.error || "No se pudo consultar el listado");
      if (!controller.signal.aborted) setUsuarios(d.usuarios);
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) {
        setUsuarios([]);
        setError(e instanceof Error ? e.message : "No se pudo consultar el listado");
      }
    }).finally(() => { if (!controller.signal.aborted) setCargando(false); });
    return () => controller.abort();
  }, [version]);

  const visibles = useMemo(() => {
    const filtro = consulta.trim().toLocaleLowerCase("es");
    return filtro ? usuarios.filter((u) =>
      [u.usuario, u.nombre, u.email].some((v) => v.toLocaleLowerCase("es").includes(filtro))) : usuarios;
  }, [usuarios, consulta]);

  return (
    <section style={{ marginTop: 24, padding: 20, border: "1px solid #ddd", borderRadius: 12 }}>
      <h3>Usuarios de mi empresa</h3>
      <p style={{ color: "#475569" }}>Consulta de usuarios y accesos. No se realizan modificaciones desde este listado.</p>
      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ flex: "1 1 220px" }}>Buscar por usuario, nombre o correo
          <input type="search" value={consulta} onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar empleado..." style={{ display: "block", width: "100%", marginTop: 6 }} />
        </label>
        <button type="button" onClick={() => setVersion((n) => n + 1)} disabled={cargando}
          style={{ padding: "10px 14px" }}>{cargando ? "Consultando..." : "Actualizar listado"}</button>
      </div>
      {error && <p role="alert" style={{ color: "#a00" }}>{error}</p>}
      {!error && <p role="status" style={{ color: "#475569", fontSize: 14 }}>
        {cargando ? "Consultando usuarios..." : `${visibles.length} usuario(s) visible(s)`}
      </p>}
      {!cargando && !error && (visibles.length === 0 ? (
        <p>No hay usuarios que coincidan con la búsqueda.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", minWidth: 700 }}>
            <thead><tr>
              {['Usuario', 'Nombre', 'Correo', 'Rol', 'Estado', 'Sucursales', 'Módulos'].map((h) =>
                <th key={h} scope="col" style={{ borderBottom: "2px solid #cbd5e1", padding: 9 }}>{h}</th>)}
            </tr></thead>
            <tbody>{visibles.map((u) => <tr key={u.id}>
              <td style={{ padding: 9, borderBottom: "1px solid #e2e8f0" }}>{u.usuario || "—"}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #e2e8f0" }}>{u.nombre || "—"}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #e2e8f0" }}>{u.email || "—"}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #e2e8f0" }}>{u.rol}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #e2e8f0" }}>{u.activo ? "Activo" : "Inactivo"}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #e2e8f0" }}>
                {u.sucursales.join(", ") || "—"}
                {u.sucursalesNoVisibles > 0 ? ` (+${u.sucursalesNoVisibles} fuera de tu alcance)` : ""}
              </td>
              <td style={{ padding: 9, borderBottom: "1px solid #e2e8f0" }}>{u.modulos.join(", ") || "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
