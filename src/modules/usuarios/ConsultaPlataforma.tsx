import { useEffect, useState } from "react";

type Empresa = Readonly<{
  id: string; nombre: string; clave: string; activa: boolean;
  modulosHabilitados: string[]; requiereRevision: boolean; version: string | null; esPlataforma: boolean;
}>;
type Respuesta = { ok?: boolean; error?: string; gestionHabilitada?: boolean;
  auditoriaDisponible?: boolean; conciliacionHabilitada?: boolean; empresas?: Empresa[] };
type Incidencia = { operacionId: string | null; causa: string };
type Diagnostico = { operacionId: string; empresaId: string; accion: string; modulo: string;
  estadoDetectado: "APLICADO" | "NO_APLICADO"; versionActual: string;
  estadoAnterior: string[]; estadoPropuesto: string[]; modulosActuales: string[] };
const MODULOS = ["INVENTARIO", "MOVIMIENTOS", "CUENTAS_CORRIENTES", "ADMINISTRACION",
  "FACTURACION", "REPORTES", "CONFIGURACION", "AUTOMATIZACIONES"] as const;
type Accion = "habilitar" | "suspender" | "reactivar";

/** 11C.3: configuración técnica. El servidor valida cada operación. */
export default function ConsultaPlataforma() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [gestionHabilitada, setGestionHabilitada] = useState(false);
  const [auditoriaDisponible, setAuditoriaDisponible] = useState(false);
  const [conciliacionHabilitada, setConciliacionHabilitada] = useState(false);
  const [empresaAuditoria, setEmpresaAuditoria] = useState("");
  const [incidencias, setIncidencias] = useState<Incidencia[] | null>(null);
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null);
  const [motivoConciliar, setMotivoConciliar] = useState("");
  const [auditoriaOcupada, setAuditoriaOcupada] = useState(false);
  const [auditoriaMensaje, setAuditoriaMensaje] = useState("");
  const [auditoriaError, setAuditoriaError] = useState("");
  const [empresaElegida, setEmpresaElegida] = useState("");
  const [modulo, setModulo] = useState<(typeof MODULOS)[number]>("INVENTARIO");
  const [accion, setAccion] = useState<Accion>("suspender");
  const [motivo, setMotivo] = useState("");
  const [actualizar, setActualizar] = useState(0);

  useEffect(() => {
    const controlador = new AbortController();
    setCargando(true); setError("");
    void (async () => {
      try {
        const r = await fetch("/api/plataforma", { credentials: "same-origin", cache: "no-store", signal: controlador.signal });
        const d = await r.json() as Respuesta;
        if (!r.ok || !d.ok || !Array.isArray(d.empresas))
          throw new Error(d.error || "No se pudo consultar empresas");
        if (!controlador.signal.aborted) {
          setEmpresas(d.empresas);
          setGestionHabilitada(d.gestionHabilitada === true);
          setAuditoriaDisponible(d.auditoriaDisponible === true);
          setConciliacionHabilitada(d.conciliacionHabilitada === true);
        }
      } catch (e) {
        if (!controlador.signal.aborted) { setEmpresas([]); setGestionHabilitada(false);
          setAuditoriaDisponible(false); setConciliacionHabilitada(false);
          setError(e instanceof Error ? e.message : "Error de consulta"); }
      } finally { if (!controlador.signal.aborted) setCargando(false); }
    })();
    return () => controlador.abort();
  }, [actualizar]);

  const elegida = empresas.find(e => e.id === empresaElegida);
  const yaHabilitado = elegida?.modulosHabilitados.includes(modulo) ?? false;
  const accionInvalida = accion === "suspender" ? !yaHabilitado : yaHabilitado;
  const listo = gestionHabilitada && !cargando && !ocupado && Boolean(elegida?.activa && elegida.version) &&
    !elegida?.requiereRevision && !accionInvalida && motivo.trim().length >= 10 && motivo.trim().length <= 500;

  async function guardar() {
    if (!listo || !elegida?.version) return;
    if (!window.confirm(`¿Confirmás ${accion} ${modulo.replaceAll("_", " ")} para ${elegida.nombre}?`)) return;
    setOcupado(true); setError(""); setMensaje("");
    try {
      const r = await fetch("/api/plataforma-modulos", { method: "PATCH", credentials: "same-origin",
        cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresaId: elegida.id, modulo, accion, version: elegida.version, motivo: motivo.trim() }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; mensaje?: string };
      if (!r.ok || !d.ok) throw new Error(d.error || "No se pudo guardar la habilitación");
      setMensaje(d.mensaje || "Cambio confirmado"); setMotivo(""); setActualizar(x => x + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Cambio no confirmado"); }
    finally { setOcupado(false); }
  }

  async function consultarAuditoria(empresaId: string) {
    if (!empresaId || !auditoriaDisponible) return;
    setAuditoriaOcupada(true); setAuditoriaError(""); setAuditoriaMensaje(""); setDiagnostico(null);
    try {
      const r = await fetch(`/api/plataforma-conciliacion?empresaId=${encodeURIComponent(empresaId)}`,
        { credentials: "same-origin", cache: "no-store" });
      const d = await r.json() as { ok?: boolean; error?: string; incidencias?: Incidencia[] };
      if (!r.ok || !d.ok || !Array.isArray(d.incidencias)) throw new Error(d.error || "Auditoría no disponible");
      setIncidencias(d.incidencias);
    } catch (e) { setIncidencias(null); setAuditoriaError(e instanceof Error ? e.message : "Error de consulta"); }
    finally { setAuditoriaOcupada(false); }
  }
  async function previsualizarIncidencia(operacionId: string) {
    setAuditoriaOcupada(true); setAuditoriaError(""); setAuditoriaMensaje(""); setDiagnostico(null);
    try {
      const qs = new URLSearchParams({ empresaId: empresaAuditoria, operacionId });
      const r = await fetch(`/api/plataforma-conciliacion?${qs.toString()}`,
        { credentials: "same-origin", cache: "no-store" });
      const d = await r.json() as { ok?: boolean; error?: string; diagnostico?: Diagnostico };
      if (!r.ok || !d.ok || !d.diagnostico) throw new Error(d.error || "No se pudo evaluar la incidencia");
      setDiagnostico(d.diagnostico); setMotivoConciliar("");
    } catch (e) { setAuditoriaError(e instanceof Error ? e.message : "No conciliable"); }
    finally { setAuditoriaOcupada(false); }
  }
  async function conciliarIncidencia() {
    if (!diagnostico || !conciliacionHabilitada || auditoriaOcupada ||
        motivoConciliar.trim().length < 10 || motivoConciliar.trim().length > 500) return;
    if (!window.confirm(`¿Confirmás registrar la conciliación de ${diagnostico.modulo} como ${diagnostico.estadoDetectado}? No se cambiarán módulos.`)) return;
    setAuditoriaOcupada(true); setAuditoriaError(""); setAuditoriaMensaje("");
    try {
      const r = await fetch("/api/plataforma-conciliacion", { method: "POST", credentials: "same-origin",
        cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresaId: diagnostico.empresaId, operacionId: diagnostico.operacionId,
          estadoDetectado: diagnostico.estadoDetectado, versionActual: diagnostico.versionActual,
          motivo: motivoConciliar.trim(), confirmacion: "CONCILIAR" }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; mensaje?: string };
      if (!r.ok || !d.ok) throw new Error(d.error || "Cierre no confirmado. No reintentes sin revisar");
      setDiagnostico(null); setMotivoConciliar("");
      // Nueva lectura opcional, sin repetir POST.
      await consultarAuditoria(diagnostico.empresaId);
      setAuditoriaMensaje(d.mensaje || "Conciliación confirmada");
    } catch (e) { setAuditoriaError(e instanceof Error ? e.message : "Conciliación no confirmada"); }
    finally { setAuditoriaOcupada(false); }
  }

  return <section className="user-modules-box" aria-labelledby="plataforma-optima-titulo">
    <h3 id="plataforma-optima-titulo">Administración de plataforma OPTIMA</h3>
    <p>Habilitaciones técnicas por empresa. No registra contratos comerciales ni elimina historiales.</p>
    <button className="secondary-button" type="button" disabled={cargando || ocupado}
      onClick={() => { setMensaje(""); setActualizar(x => x + 1); }}>Actualizar empresas</button>
    {cargando && <p role="status">Consultando empresas...</p>}
    {error && <p role="alert">{error}</p>}
    {mensaje && <p role="status">{mensaje}</p>}
    {!cargando && !error && <>
      <p><strong>Empresas registradas:</strong> {empresas.length}</p>
      <ul>{empresas.map(empresa => <li key={empresa.id}>
        <strong>{empresa.nombre}</strong> ({empresa.clave}) — {empresa.activa ? "Activa" : "Inactiva"}
        <div><small>Módulos técnicos: {empresa.requiereRevision ? "Requieren revisión" :
          empresa.modulosHabilitados.length ? empresa.modulosHabilitados.join(", ").replaceAll("_", " ") : "Ninguno"}</small></div>
      </li>)}</ul>
      {!gestionHabilitada ? <p>Los cambios están deshabilitados hasta que OPTIMA configure y autorice la gestión.</p> :
        <div className="field-group" style={{ display: "grid", gap: 10 }}>
          <h4>Cambiar habilitación técnica</h4>
          <label>Empresa cliente
            <select value={empresaElegida} disabled={ocupado} onChange={e => setEmpresaElegida(e.target.value)}>
              <option value="">Seleccioná una empresa</option>
              {empresas.filter(e => !e.esPlataforma && e.activa && !e.requiereRevision && e.version).map(e =>
                <option value={e.id} key={e.id}>{e.nombre}</option>) }
            </select>
          </label>
          <label>Módulo
            <select value={modulo} disabled={ocupado} onChange={e => setModulo(e.target.value as (typeof MODULOS)[number])}>
              {MODULOS.map(m => <option value={m} key={m}>{m.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label>Acción
            <select value={accion} disabled={ocupado} onChange={e => setAccion(e.target.value as Accion)}>
              <option value="habilitar">Habilitar</option>
              <option value="suspender">Suspender</option>
              <option value="reactivar">Reactivar</option>
            </select>
          </label>
          <label>Motivo (10 a 500 caracteres)
            <textarea rows={3} maxLength={500} disabled={ocupado} value={motivo}
              onChange={e => setMotivo(e.target.value)} placeholder="Motivo de la modificación" />
          </label>
          <p>{elegida ? (yaHabilitado ? "Módulo actualmente habilitado" : "Módulo actualmente no habilitado") :
            "Seleccioná una empresa para continuar"}</p>
          <button type="button" className="secondary-button" disabled={!listo}
            onClick={() => { void guardar(); }}>Confirmar cambio</button>
        </div>}
      <div className="field-group" style={{ display: "grid", gap: 10, marginTop: 20 }}>
        <h4>Auditoría y conciliación de módulos</h4>
        {!auditoriaDisponible ? <p>La consulta de auditoría todavía no está configurada en este entorno.</p> : <>
          <label>Empresa a revisar
            <select disabled={auditoriaOcupada} value={empresaAuditoria}
              onChange={e => { setEmpresaAuditoria(e.target.value); setIncidencias(null); setDiagnostico(null); setAuditoriaError(""); }}>
              <option value="">Seleccioná una empresa</option>
              {empresas.filter(e => !e.esPlataforma).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          <button type="button" className="secondary-button" disabled={!empresaAuditoria || auditoriaOcupada}
            onClick={() => { void consultarAuditoria(empresaAuditoria); }}>Consultar incidencias</button>
          {auditoriaError && <p role="alert">{auditoriaError}</p>}
          {auditoriaMensaje && <p role="status">{auditoriaMensaje}</p>}
          {incidencias !== null && (incidencias.length ? <ul>{incidencias.map((i, n) => <li key={`${i.operacionId}-${n}`}>
            <code>{i.operacionId || "Sin identificador válido"}</code> — {i.causa}
            {i.operacionId && <button type="button" className="secondary-button" disabled={auditoriaOcupada}
              onClick={() => { void previsualizarIncidencia(i.operacionId!); }}>Evaluar</button>}
          </li>)}</ul> : <p>No hay incidencias pendientes en el historial consultado.</p>)}
          {diagnostico && <div style={{ display: "grid", gap: 8 }}>
            <strong>Vista previa: {diagnostico.modulo} — {diagnostico.estadoDetectado}</strong>
            <small>Antes: {diagnostico.estadoAnterior.join(", ")}</small>
            <small>Propuesto: {diagnostico.estadoPropuesto.join(", ")}</small>
            <small>Actual: {diagnostico.modulosActuales.join(", ")}</small>
            {conciliacionHabilitada ? <>
              <label>Motivo de la conciliación (10 a 500 caracteres)
                <textarea value={motivoConciliar} maxLength={500} rows={3} disabled={auditoriaOcupada}
                  onChange={e => setMotivoConciliar(e.target.value)} />
              </label>
              <button type="button" className="secondary-button"
                disabled={auditoriaOcupada || motivoConciliar.trim().length < 10}
                onClick={() => { void conciliarIncidencia(); }}>Registrar conciliación</button>
            </> : <p>Conciliación en modo consulta. La escritura todavía no está habilitada.</p>}
          </div>}
        </>}
      </div>
      <small>Al reactivar un módulo vuelven a aplicarse los permisos de empleados que sigan asignados. Los cambios se registran con operación, actor, motivo y resultado. La gestión permanece deshabilitada hasta su activación controlada.</small>
    </>}
  </section>;
}
