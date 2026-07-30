import type { UsuarioSesion } from "../administracion.types";

type Props = {
  usuario: UsuarioSesion;
  onIrATerceros: () => void;
};

const INDICADORES = [
  { etiqueta: "Total a cobrar", valor: "Próximamente", detalle: "Obligaciones de clientes pendientes." },
  { etiqueta: "Total a pagar", valor: "Próximamente", detalle: "Obligaciones con proveedores pendientes." },
  { etiqueta: "Cheques por vencer", valor: "Próximamente", detalle: "Alertas y vencimientos próximos." },
  { etiqueta: "Movimientos bancarios", valor: "Próximamente", detalle: "Actividad bancaria pendiente de conciliación." },
];

export default function ResumenAdministracion({ usuario, onIrATerceros }: Props) {
  return (
    <div className="adm-stack">
      <section className="adm-welcome-card">
        <div>
          <p className="adm-card-kicker">RESUMEN GENERAL</p>
          <h3>{usuario.empresa || "Administración"}</h3>
          <p>Este será el centro operativo de documentos, cuentas corrientes, pagos, cheques y bancos.</p>
        </div>

        <button className="adm-primary-button" type="button" onClick={onIrATerceros}>
          Ver terceros
        </button>
      </section>

      <section className="adm-summary-grid">
        {INDICADORES.map((indicador) => (
          <article className="adm-summary-card" key={indicador.etiqueta}>
            <span>{indicador.etiqueta}</span>
            <strong>{indicador.valor}</strong>
            <p>{indicador.detalle}</p>
          </article>
        ))}
      </section>

      <section className="adm-card">
        <div className="adm-section-heading">
          <div>
            <p className="adm-card-kicker">ESTADO DEL MÓDULO</p>
            <h3>Construcción modular activa</h3>
          </div>
          <span className="adm-status-chip">BLOQUE 1</span>
        </div>

        <div className="adm-progress-list">
          <div className="adm-progress-item adm-progress-item-ready"><span>✓</span><div><strong>Estructura y navegación</strong><p>Contenedor principal y diseño integrado con OPTIMA.</p></div></div>
          <div className="adm-progress-item adm-progress-item-ready"><span>✓</span><div><strong>Lectura de terceros</strong><p>Clientes, proveedores, empleados y otros desde Airtable.</p></div></div>
          <div className="adm-progress-item"><span>·</span><div><strong>Próximo bloque</strong><p>Alta, edición y detalle completo de terceros.</p></div></div>
        </div>
      </section>
    </div>
  );
}
