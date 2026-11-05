import { useEffect, useState } from "react";

type Empresa = Readonly<{
  id: string;
  nombre: string;
  clave: string;
  activa: boolean;
  modulosHabilitados: string[];
  requiereRevision: boolean;
}>;
type Respuesta = { ok?: boolean; error?: string; empresas?: Empresa[] };

/** 11C.2: vista informativa para una cuenta de plataforma. No escribe. */
export default function ConsultaPlataforma() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [actualizar, setActualizar] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError("");
    void (async () => {
      try {
        const r = await fetch("/api/plataforma", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        const datos = await r.json() as Respuesta;
        if (!r.ok || !datos.ok || !Array.isArray(datos.empresas))
          throw new Error(datos.error || "No se pudo consultar el catálogo de empresas");
        if (!controller.signal.aborted) setEmpresas(datos.empresas);
      } catch (e) {
        if (!controller.signal.aborted) { setEmpresas([]); setError(e instanceof Error ? e.message : "Error de consulta"); }
      } finally {
        if (!controller.signal.aborted) setCargando(false);
      }
    })();
    return () => controller.abort();
  }, [actualizar]);
  return (
    <section className="user-modules-box" aria-labelledby="plataforma-optima-titulo">
      <h3 id="plataforma-optima-titulo">Administración de plataforma OPTIMA</h3>
      <p>Catálogo de empresas. Consulta informativa; no permite contratar, activar ni suspender módulos.</p>
      <button className="secondary-button" type="button" disabled={cargando}
        onClick={() => setActualizar(valor => valor + 1)}>Actualizar empresas</button>
      {cargando && <p role="status">Consultando empresas...</p>}
      {error && <p role="alert">{error}</p>}
      {!cargando && !error && <>
        <p><strong>Empresas registradas:</strong> {empresas.length}</p>
        <ul>{empresas.map(empresa => <li key={empresa.id}>
          <strong>{empresa.nombre}</strong> ({empresa.clave}) — {empresa.activa ? "Activa" : "Inactiva"}
          <div><small>Módulos técnicos: {empresa.requiereRevision ? "Requieren revisión" :
            empresa.modulosHabilitados.length ? empresa.modulosHabilitados.join(", ").replaceAll("_", " ") : "Ninguno"}</small></div>
        </li>)}</ul>
        <small>Los módulos habilitados no certifican contratos comerciales. La edición se incorporará en el Paso 11C.3.</small>
      </>}
    </section>
  );
}
