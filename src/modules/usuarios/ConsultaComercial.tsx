import { useState, type ChangeEvent } from "react";

type Empresa = Readonly<{ id: string; nombre: string; esPlataforma: boolean }>;
type Servicio =
  | Readonly<{ modalidad: "MODULO_PRINCIPAL"; modulo: string; nivel: string }>
  | Readonly<{ modalidad: "SUBMODULO_INDEPENDIENTE"; submodulo: string; nivel: string }>;
type Respuesta = Readonly<{
  ok: boolean; error?: string; estado?: "SIN_CONTRATO" | "NO_VIGENTE" | "VIGENTE";
  soloConsulta?: boolean; accesoOperativoHabilitado?: false;
  empresa?: { id: string; nombre: string };
  contrato?: null | { idContrato: string; idVersion: string; version: number;
    vigenteDesde: string; vigenteHasta: string | null; servicios: Servicio[] };
}>;

/** Solo para administración de plataforma OPTIMA. Nunca decide permisos de navegación. */
export default function ConsultaComercial({ empresas }: { empresas: readonly Empresa[] }) {
  const [empresaId, setEmpresaId] = useState("");
  const [cargando, setCargando] = useState(false);
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const clientes = empresas.filter(e => !e.esPlataforma);

  async function consultar() {
    if (!empresaId || cargando) return;
    const seleccion = empresaId;
    setCargando(true); setRespuesta(null); setError("");
    try {
      const r = await fetch(`/api/usuarios/consulta_comercial?empresaId=${encodeURIComponent(seleccion)}`, {
        method: "GET", credentials: "same-origin", cache: "no-store",
      });
      const d = await r.json() as Respuesta;
      if (!r.ok || !d.ok || d.soloConsulta !== true || d.accesoOperativoHabilitado !== false ||
          d.empresa?.id !== seleccion) {
        throw new Error(d.error || "No se pudo comprobar la contratación");
      }
      if (seleccion === empresaId) setRespuesta(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar la contratación");
    } finally {
      setCargando(false);
    }
  }

  const contrato = respuesta?.estado === "VIGENTE" ? respuesta.contrato : null;
  return <section className="field-group" aria-label="Consulta comercial OPTIMA"
    style={{ display: "grid", gap: 10, marginTop: 20 }}>
    <h4>Contrataciones comerciales — Solo lectura</h4>
    <p>Esta consulta no modifica contratos ni habilitaciones técnicas.</p>
    <label>Empresa cliente
      <select value={empresaId} disabled={cargando}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => { setEmpresaId(e.target.value); setRespuesta(null); setError(""); }}>
        <option value="">Seleccioná una empresa</option>
        {clientes.map(e => <option value={e.id} key={e.id}>{e.nombre}</option>)}
      </select>
    </label>
    <button className="secondary-button" type="button" disabled={!empresaId || cargando}
      onClick={() => { void consultar(); }}>
      {cargando ? "Consultando..." : "Consultar contratación"}
    </button>
    {error && <p role="alert">{error}</p>}
    {respuesta?.estado === "SIN_CONTRATO" &&
      <p role="status">Esta empresa todavía no tiene una contratación comercial registrada.</p>}
    {respuesta?.estado === "NO_VIGENTE" &&
      <p role="status">La empresa no tiene una versión comercial vigente.</p>}
    {contrato && <div>
      <p><strong>Contrato:</strong> {contrato.idContrato} · Versión {contrato.version}</p>
      <p><small>Desde: {contrato.vigenteDesde} · Hasta: {contrato.vigenteHasta || "Sin fecha de cierre"}</small></p>
      <ul>{contrato.servicios.map((s, i) => <li key={`${s.modalidad}-${i}`}>
        {s.modalidad === "MODULO_PRINCIPAL" ? s.modulo.replaceAll("_", " ") : s.submodulo.replaceAll("_", " ")}
        {" — "}{s.nivel}{s.modalidad === "SUBMODULO_INDEPENDIENTE" ? " (independiente)" : ""}
      </li>)}</ul>
    </div>}
    <small>Los datos comerciales mostrados no conceden acceso operativo ni alteran los permisos actuales.</small>
  </section>;
}
