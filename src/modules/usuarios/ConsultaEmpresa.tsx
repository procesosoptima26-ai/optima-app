import { useEffect, useState } from "react";

type FichaModulo = Readonly<{
  id: string;
  nombre: string;
  descripcion: string;
  habilitadoEnEmpresa: boolean;
}>;
type RespuestaEmpresa = {
  ok?: boolean;
  error?: string;
  empresa?: {
    id: string;
    clave: string;
    activa: boolean;
    coreIncluido: boolean;
    modulosContratados: string[];
  };
  modulosUsuario?: string[];
  catalogoModulos?: FichaModulo[];
};

/** Vista informativa 11C.1: no incorpora botones ni llamadas de escritura. */
export default function ConsultaEmpresa({ nombreEmpresa }: { nombreEmpresa: string }) {
  const [respuesta, setRespuesta] = useState<RespuestaEmpresa | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [recargar, setRecargar] = useState(0);

  useEffect(() => {
    const controlador = new AbortController();
    setCargando(true);
    setError("");
    void (async () => {
      try {
        const r = await fetch("/api/empresa", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controlador.signal,
        });
        const datos = await r.json() as RespuestaEmpresa;
        if (!r.ok || !datos.ok || !datos.empresa || !Array.isArray(datos.catalogoModulos)) {
          throw new Error(datos.error || "No se pudo consultar la empresa y los módulos");
        }
        if (!controlador.signal.aborted) setRespuesta(datos);
      } catch (e) {
        if (!controlador.signal.aborted) {
          setRespuesta(null);
          setError(e instanceof Error ? e.message : "No se pudo consultar la empresa");
        }
      } finally {
        if (!controlador.signal.aborted) setCargando(false);
      }
    })();
    return () => controlador.abort();
  }, [recargar]);

  return (
    <section className="user-modules-box" aria-labelledby="optima-empresa-modulos">
      <h3 id="optima-empresa-modulos">Mi empresa y servicios OPTIMA</h3>
      <p>Consulta informativa de habilitaciones técnicas. No modifica contratos ni permisos.</p>
      <button className="secondary-button" type="button" disabled={cargando}
        onClick={() => setRecargar(valor => valor + 1)}>Actualizar consulta</button>
      {cargando && <p role="status">Consultando configuración de la empresa...</p>}
      {error && <p role="alert">{error}</p>}
      {!cargando && !error && respuesta?.empresa && (
        <>
          <p><strong>Empresa:</strong> {nombreEmpresa} ({respuesta.empresa.clave})</p>
          <p><strong>Estado:</strong> {respuesta.empresa.activa ? "Activa" : "Inactiva"}</p>
          <p><strong>Core:</strong> incluido siempre, sin contratación independiente.</p>
          <p><strong>Módulos habilitados en la empresa:</strong> {respuesta.empresa.modulosContratados.length}</p>
          <ul>
            {respuesta.catalogoModulos?.map(modulo => (
              <li key={modulo.id}>
                <strong>{modulo.nombre}</strong> — {modulo.habilitadoEnEmpresa ? "Habilitado en la empresa" : "No habilitado"}
                <div><small>{modulo.descripcion}</small></div>
              </li>
            ))}
          </ul>
          <p><strong>Módulos habilitados para tu usuario:</strong>{" "}
            {respuesta.modulosUsuario?.length ? respuesta.modulosUsuario.join(", ").replaceAll("_", " ") : "Ninguno"}
          </p>
          <small>La selección en Airtable no acredita una contratación comercial ni confirma que cada módulo esté terminado. La gestión de contratos y habilitaciones se construirá en el 11C.3.</small>
        </>
      )}
    </section>
  );
}
