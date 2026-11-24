import empresa from "../handlers/core/empresa.js";
import plataforma from "../handlers/core/plataforma.js";
import consulta_comercial from "../handlers/core/consulta-comercial.js";
import gestion_modulos from "../handlers/core/gestion-modulos.js";
import conciliacion_modulos from "../handlers/core/conciliar-modulos.js";
import conciliacion_core_global from "../handlers/core/conciliar-core-global.js";
import sucursales from "../handlers/core/sucursales.js";
/** Router OPTIMA: agrupa endpoints sin alterar las autorizaciones internas. */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import opciones from "../handlers/usuarios/opciones.js";
import listar from "../handlers/usuarios/listar.js";
import { detalleEmpleado, editarEmpleado } from "../handlers/usuarios/editar.js";
import estado from "../handlers/usuarios/estado.js";
import historial_auditoria from "../handlers/usuarios/historial-auditoria.js";
import invitar from "../handlers/usuarios/invitar.js";
import validar_invitacion from "../handlers/usuarios/validar-invitacion.js";
import activar from "../handlers/usuarios/activar.js";
import solicitar_recuperacion from "../handlers/usuarios/solicitar-recuperacion.js";
import restablecer from "../handlers/usuarios/restablecer.js";
import { consultaContratoCoreReal195 } from "../handlers/core/consulta-contratos-pg-12c195.js";
import { contratoBorradorCore197, contratoAprobarCore197, contratoActivarCore197 } from "../handlers/core/escritura-contratos-pg-12c197.js";
import { cicloVidaEstadoCore, cicloVidaAccionCore } from "../handlers/core/escritura-ciclo-vida.js";
import { cicloVidaAvisosCore, cicloVidaAvisosCronCore } from "../handlers/core/avisos-ciclo-vida.js";
import { conciliacionContratoModulosReal } from "../handlers/core/conciliacion-contrato-modulos.js";
import { empresaListaReal } from "../handlers/core/empresa-lista.js";

const handlers = { empresa, plataforma, consulta_comercial, contratos_core: consultaContratoCoreReal195, contrato_borrador: contratoBorradorCore197, contrato_aprobar: contratoAprobarCore197, contrato_activar: contratoActivarCore197, ciclo_vida_estado: cicloVidaEstadoCore, ciclo_vida_accion: cicloVidaAccionCore, ciclo_vida_avisos: cicloVidaAvisosCore, ciclo_vida_avisos_cron: cicloVidaAvisosCronCore, modulos_vs_contrato: conciliacionContratoModulosReal, empresa_lista: empresaListaReal, gestion_modulos, conciliacion_modulos, conciliacion_core_global, sucursales, opciones, listar, estado, historial_auditoria, detalle: detalleEmpleado, editar: editarEmpleado, invitar, "validar-invitacion": validar_invitacion, activar,
  "solicitar-recuperacion": solicitar_recuperacion, restablecer };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const accion = req.query.accion;
  if (typeof accion !== "string" || !Object.prototype.hasOwnProperty.call(handlers, accion)) {
    return res.status(404).json({ ok: false, error: "Ruta inexistente" });
  }
  return handlers[accion as keyof typeof handlers](req, res);
}
