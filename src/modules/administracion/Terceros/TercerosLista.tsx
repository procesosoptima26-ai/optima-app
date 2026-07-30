import { useEffect, useMemo, useState } from "react";
import { obtenerTerceros } from "../administracion.api";
import type { MensajeAdministracion, RolTercero, Tercero } from "../administracion.types";

const FILTROS: Array<{ valor: RolTercero | "TODOS"; etiqueta: string }> = [
  { valor: "TODOS", etiqueta: "Todos" },
  { valor: "CLIENTE", etiqueta: "Clientes" },
  { valor: "PROVEEDOR", etiqueta: "Proveedores" },
  { valor: "EMPLEADO", etiqueta: "Empleados" },
  { valor: "OTRO", etiqueta: "Otros" },
];

function obtenerNombreVisible(tercero: Tercero) {
  return tercero.tercero || tercero.razonSocial || tercero.nombreComercial || [tercero.nombre, tercero.apellido].filter(Boolean).join(" ") || "Tercero sin nombre";
}

export default function TercerosLista() {
  const [terceros, setTerceros] = useState<Tercero[]>([]);
  const [filtro, setFiltro] = useState<RolTercero | "TODOS">("TODOS");
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<MensajeAdministracion>(null);

  useEffect(() => {
    cargarTerceros();
  }, [filtro]);

  async function cargarTerceros() {
    try {
      setCargando(true);
      setMensaje(null);
      const datos = await obtenerTerceros(filtro === "TODOS" ? undefined : filtro);
      setTerceros(datos);
    } catch (error) {
      console.error("Error cargando terceros:", error);
      setMensaje({ tipo: "error", texto: error instanceof Error ? error.message : "No se pudieron cargar los terceros." });
    } finally {
      setCargando(false);
    }
  }

  const tercerosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return terceros;
    return terceros.filter((tercero) => [obtenerNombreVisible(tercero), tercero.codigoTercero, tercero.cuitCuil, tercero.numeroDocumento, tercero.telefono, tercero.email].join(" ").toLowerCase().includes(texto));
  }, [terceros, busqueda]);

  return (
    <div className="adm-stack">
      <section className="adm-card">
        <div className="adm-section-heading">
          <div>
            <p className="adm-card-kicker">GESTIÓN CENTRALIZADA</p>
            <h3>Terceros</h3>
            <p>Clientes, proveedores, empleados y otros contactos en una sola tabla.</p>
          </div>
          <button className="adm-primary-button" type="button" disabled title="Se habilitará en el próximo bloque">+ Nuevo tercero</button>
        </div>

        <div className="adm-filter-grid">
          {FILTROS.map((item) => (
            <button key={item.valor} className={filtro === item.valor ? "adm-filter-button adm-filter-button-active" : "adm-filter-button"} type="button" onClick={() => setFiltro(item.valor)}>{item.etiqueta}</button>
          ))}
        </div>

        <input className="adm-search-input" value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Buscar por nombre, código, CUIT, teléfono o email..." />
      </section>

      {mensaje && <div className={`message message-${mensaje.tipo}`}>{mensaje.texto}</div>}

      {cargando ? (
        <div className="adm-empty-card">Cargando terceros...</div>
      ) : tercerosFiltrados.length === 0 ? (
        <div className="adm-empty-card">No hay terceros para mostrar con este filtro.</div>
      ) : (
        <section className="adm-third-party-list">
          {tercerosFiltrados.map((tercero) => (
            <article className="adm-third-party-card" key={tercero.id}>
              <div className="adm-third-party-main">
                <div className="adm-third-party-title-row">
                  <div><span>{tercero.codigoTercero || "SIN CÓDIGO"}</span><h4>{obtenerNombreVisible(tercero)}</h4></div>
                  <span className={tercero.activo ? "adm-active-chip" : "adm-inactive-chip"}>{tercero.activo ? "ACTIVO" : "INACTIVO"}</span>
                </div>

                <div className="adm-role-list">
                  {tercero.roles.length > 0 ? tercero.roles.map((rol) => <strong key={rol}>{rol}</strong>) : <strong>SIN ROL</strong>}
                </div>

                <div className="adm-third-party-data">
                  <p><strong>CUIT/CUIL:</strong> {tercero.cuitCuil || tercero.numeroDocumento || "Sin cargar"}</p>
                  <p><strong>Teléfono:</strong> {tercero.telefono || "Sin cargar"}</p>
                  <p><strong>Email:</strong> {tercero.email || "Sin cargar"}</p>
                  <p><strong>Condición IVA:</strong> {tercero.condicionIva || "Sin cargar"}</p>
                </div>
              </div>

              <button className="adm-soft-button" type="button" disabled title="El detalle se habilitará en el próximo bloque">Ver detalle</button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
