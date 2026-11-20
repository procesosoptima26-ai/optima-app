/** OPTIMA 12C.18.6 — puerta de entrada HTTP de SOLO LECTURA.
 * Deshabilitada por defecto. Reutiliza el handler 12C.18.5 y la sesión real
 * de OPTIMA; NO concede acceso operativo ni modifica Airtable/PostgreSQL.
 */
import {
  autenticarPlataformaReal185,
  empresaClienteMaestra185,
  resolverEmpresaClienteMaestra185,
  type EmpresaClienteMaestra185,
  crearConsultaHistorialComercial185,
  type EstadoSesion185,
} from '../handlers/core/consulta-historial-pg-12c185.js';
import {crearPoolComercialLectura186} from './pool-lectura-comercial-12c186.js';
import type {PoolPgNode183} from '../core/adaptador-pg-node-12c183.js';

type Peticion = {method?:string;query?:Record<string,unknown>;cookies?:Record<string,unknown>;body?:unknown};
type Respuesta = {setHeader(k:string,v:string):unknown;status(n:number):{json(v:unknown):unknown}};
export type DependenciasEndpoint186 = Readonly<{
  habilitado():boolean;
  crearPool():PoolPgNode183;
  autenticar(req:Peticion):Promise<EstadoSesion185>;
  empresaClienteValida(empresaId:string):Promise<boolean>;
  /** Opcional: informa además el ID estable de la empresa (clave en PostgreSQL). */
  resolverEmpresaCliente?(empresaId:string):Promise<EmpresaClienteMaestra185>;
}>;

/** El pool se crea SOLO cuando el handler autenticado llega a la lectura.
 * Nunca confiar en identidad, rol o empresa provistos en el body HTTP.
 */
export function crearEndpointHistorialComercial186(deps:DependenciasEndpoint186){
  const conexionDiferida:PoolPgNode183={connect:async()=>deps.crearPool().connect()};
  const leer=crearConsultaHistorialComercial185({pool:conexionDiferida,
    autenticar:deps.autenticar,empresaClienteValida:deps.empresaClienteValida,
    ...(deps.resolverEmpresaCliente?{resolverEmpresaCliente:deps.resolverEmpresaCliente}:{})});
  return async(req:Peticion,res:Respuesta):Promise<void>=>{
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    try{
      if(!deps.habilitado()){
        res.status(404).json({ok:false,error:'Ruta no disponible'});return;
      }
      if(req.method!=='GET'){
        res.setHeader('Allow','GET');
        res.status(405).json({ok:false,error:'Método no permitido'});return;
      }
      if(req.body!==undefined&&req.body!==null){
        res.status(400).json({ok:false,error:'Solicitud inválida'});return;
      }
      await leer(req,res);
    }catch{
      res.status(503).json({ok:false,error:'Consulta comercial temporalmente no disponible'});
    }
  };
}

/** No instala credenciales ni abre conexiones al importar este módulo.
 * Para habilitar en una futura fase se requiere revisar driver, rol y DSN.
 */
export const endpointHistorialComercial186=crearEndpointHistorialComercial186({
  habilitado:()=>process.env.OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED==='true',
  crearPool:()=>crearPoolComercialLectura186(),
  autenticar:autenticarPlataformaReal185,
  empresaClienteValida:empresaClienteMaestra185,
  resolverEmpresaCliente:resolverEmpresaClienteMaestra185,
});
