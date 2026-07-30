import { useState } from "react";
import type { SeccionAdministracion, UsuarioSesion } from "./administracion.types";
import ResumenAdministracion from "./resumen/ResumenAdministracion";
import TercerosLista from "./Terceros/TercerosLista";
import "./Administracion.css";

type Props = { usuario: UsuarioSesion };

const SECCIONES: Array<{ id: SeccionAdministracion; etiqueta: string; abreviatura: string }> = [
  { id: "resumen", etiqueta: "Resumen", abreviatura: "R" },
  { id: "terceros", etiqueta: "Terceros", abreviatura: "T" },
  { id: "documentos", etiqueta: "Documentos", abreviatura: "D" },
  { id: "cuentasCorrientes", etiqueta: "Cuentas corrientes", abreviatura: "CC" },
  { id: "pagos", etiqueta: "Cobros y pagos", abreviatura: "$" },
  { id: "cheques", etiqueta: "Cheques", abreviatura: "CH" },
  { id: "bancos", etiqueta: "Bancos", abreviatura: "B" },
  { id: "configuracion", etiqueta: "Configuración", abreviatura: "A" },
];

function SeccionEnConstruccion({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <section className="adm-coming-card">
      <div className="adm-coming-icon">OPT</div>
      <p className="adm-card-kicker">ADMINISTRACIÓN V2</p>
      <h3>{titulo}</h3>
      <p>{descripcion}</p>
      <span>Se construirá sobre la nueva base administrativa.</span>
    </section>
  );
}

export default function Administracion({ usuario }: Props) {
  const [seccion, setSeccion] = useState<SeccionAdministracion>("resumen");

  function renderSeccion() {
    if (seccion === "resumen") {
      return <ResumenAdministracion usuario={usuario} onIrATerceros={() => setSeccion("terceros")} />;
    }
    if (seccion === "terceros") return <TercerosLista />;

    const contenido = {
      documentos: { titulo: "Documentos", descripcion: "Facturas, remitos, notas de crédito, gastos, sueldos y recibos." },
      cuentasCorrientes: { titulo: "Cuentas corrientes", descripcion: "Obligaciones, vencimientos, saldos y aplicaciones por tercero." },
      pagos: { titulo: "Cobros y pagos", descripcion: "Operaciones con múltiples medios y aplicación a obligaciones." },
      cheques: { titulo: "Cheques", descripcion: "Cartera, emisión, entrega, depósito, acreditación y rechazos." },
      bancos: { titulo: "Bancos", descripcion: "Cuentas, movimientos, comisiones, impuestos y conciliaciones." },
      configuracion: { titulo: "Configuración", descripcion: "Empresas, sucursales, usuarios, puntos de venta y ubicaciones." },
    } as const;

    return <SeccionEnConstruccion titulo={contenido[seccion].titulo} descripcion={contenido[seccion].descripcion} />;
  }

  return (
    <section className="adm-module">
      <div className="adm-module-title-row">
        <div>
          <p className="module-label adm-module-label">MÓDULO</p>
          <h2>Administración</h2>
          <p className="adm-module-subtitle">Gestión administrativa integral de {usuario.empresa || "la empresa"}.</p>
        </div>
        <span className="adm-version-chip">V2</span>
      </div>

      <nav className="adm-section-nav" aria-label="Secciones de administración">
        {SECCIONES.map((item) => (
          <button key={item.id} className={seccion === item.id ? "adm-section-button adm-section-button-active" : "adm-section-button"} type="button" onClick={() => setSeccion(item.id)}>
            <span>{item.abreviatura}</span><strong>{item.etiqueta}</strong>
          </button>
        ))}
      </nav>

      {renderSeccion()}
    </section>
  );
}
