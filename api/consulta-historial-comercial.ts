/** Ruta independiente de consulta comercial 12C.18.6.
 * GET /api/consulta-historial-comercial?empresaId=...&idContrato=...
 * OFF por defecto. No altera /api/usuarios ni /api/plataforma ni Airtable.
 */
import type {VercelRequest,VercelResponse} from '@vercel/node';
import {endpointHistorialComercial186} from '../lib/endpoint-historial-comercial-12c186.js';

export default async function handler(req:VercelRequest,res:VercelResponse){
  return endpointHistorialComercial186(req,res);
}
