/** OPTIMA 12C.18.7 — diagnóstico sin efectos de la configuración comercial.
 * No abre conexión, no revela secretos y JAMÁS habilita el endpoint.
 * Un conjunto de variables presentes NO equivale a aprobación de despliegue.
 */
import {listarCuentasPlataforma} from '../core/acceso-plataforma.js';
import {validarConfigLectura186} from './pool-lectura-comercial-12c186.js';

export type EstadoDiagnostico187 = 'APAGADO'|'CONFIG_INCOMPLETA'|'REVISION_OBLIGATORIA';
export type Diagnostico187 = Readonly<{
  estado:EstadoDiagnostico187;
  habilitado:boolean;
  nombresFaltantes:readonly string[];
  lectorEstructuralValido:boolean;
  requierePruebasDeAutenticacionReal:true;
  requiereControlDeDespliegue:true;
  aptoParaPublicar:false;
}>;
const OBLIGATORIAS = [
 'OPTIMA_COMERCIAL_PG_READ_ROLE',
 'OPTIMA_COMERCIAL_PG_READ_URL',
 'OPTIMA_PLATFORM_ADMIN_USER_ID',
 'OPTIMA_PLATFORM_COMPANY_ID',
 'AIRTABLE_TOKEN',
 'AIRTABLE_USERS_BASE_ID',
 'AIRTABLE_USERS_TABLE_ID',
 'AIRTABLE_COMPANIES_TABLE_ID',
 'UPSTASH_REDIS_KV_REST_API_URL',
 'UPSTASH_REDIS_KV_REST_API_TOKEN',
] as const;
const ID=/^rec[A-Za-z0-9]{14}$/;
const BASE=/^app[A-Za-z0-9]{14}$/;
const TABLA=/^tbl[A-Za-z0-9]{14}$/;

/** Sólo nombres de variables: nunca valores, URLs, usuarios ni tokens. */
export function diagnosticarEndpointComercial187(
 variables:Readonly<Record<string,string|undefined>>,
):Diagnostico187{
 const habilitado=variables.OPTIMA_COMERCIAL_HISTORIAL_PG_ENABLED==='true';
 const faltantes=OBLIGATORIAS.filter(k=>{
   const v=variables[k];return typeof v!=='string'||v.trim()==='';
 });
 const rol=variables.OPTIMA_COMERCIAL_PG_READ_ROLE??'';
 const dsn=variables.OPTIMA_COMERCIAL_PG_READ_URL??'';
 const lectorEstructuralValido=validarConfigLectura186({rol,dsn});
 if(!lectorEstructuralValido){
   for(const n of ['OPTIMA_COMERCIAL_PG_READ_ROLE','OPTIMA_COMERCIAL_PG_READ_URL']){
     if(!faltantes.includes(n as typeof OBLIGATORIAS[number]))
       faltantes.push(n as typeof OBLIGATORIAS[number]);
   }
 }
 for(const [nombre,re] of [
   ['OPTIMA_PLATFORM_ADMIN_USER_ID',ID],['OPTIMA_PLATFORM_COMPANY_ID',ID],
   ['AIRTABLE_USERS_BASE_ID',BASE],['AIRTABLE_USERS_TABLE_ID',TABLA],
   ['AIRTABLE_COMPANIES_TABLE_ID',TABLA],
 ] as const){
   const valido=nombre==='OPTIMA_PLATFORM_ADMIN_USER_ID'
     ?listarCuentasPlataforma(variables[nombre]).length>0:re.test(variables[nombre]??'');
   if(!valido&&!faltantes.includes(nombre))faltantes.push(nombre);
 }
 const estado:EstadoDiagnostico187=!habilitado?'APAGADO':
   faltantes.length?'CONFIG_INCOMPLETA':'REVISION_OBLIGATORIA';
 return Object.freeze({estado,habilitado,nombresFaltantes:Object.freeze([...faltantes]),
   lectorEstructuralValido,requierePruebasDeAutenticacionReal:true,
   requiereControlDeDespliegue:true,aptoParaPublicar:false});
}
