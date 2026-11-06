import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { leerEstadoModulos } from "../core/gestion-modulos.js";
import { analizarHistorialAuditoria } from "../lib/conciliacion-modulos.js";
import { diagnosticarOperacionPendiente, registrarResolucionConciliada, ErrorResolucionAuditoria } from "../lib/resolucion-modulos-auditada.js";
import handler from "../handlers/core/conciliar-modulos.js";

const rec = (c: string) => `rec${c.repeat(14)}`;
const tbl = (c: string) => `tbl${c.repeat(14)}`;
const EMP = rec("E"), PLAT = rec("P"), ADMIN = rec("U"), OTRO_ADMIN = rec("V");
const BASE = `app${"A".repeat(14)}`, USU = tbl("U"), EMP_T = tbl("E"), AUD_T = tbl("T");
const COOKIE = "s".repeat(43);
const ANTES = ["USUARIO", "INVENTARIO", "REPORTES"];
const DESPUES = ["USUARIO", "INVENTARIO"];
const eAntes = leerEstadoModulos(EMP, true, ANTES), eDespues = leerEstadoModulos(EMP, true, DESPUES);
if (!eAntes.ok || !eDespues.ok) throw new Error("Precondiciones de pruebas inválidas");
const ESTADO_ANTES = eAntes.estado, ESTADO_DESPUES = eDespues.estado;
const snapshot = (op: readonly string[], version: string) =>
  JSON.stringify({ MODULOS_CONTRATADOS: op, ACTIVA: true, VERSION: version });
const SA = snapshot(ANTES, ESTADO_ANTES.version), SD = snapshot(DESPUES, ESTADO_DESPUES.version);
const opId = () => randomUUID();
type Registro = { id: string; fields: Record<string, unknown> };
function intentos(id: string = opId(), resultado?: "INDETERMINADO"): Registro[] {
  const f = { ID_EVENTO: randomUUID(), OPERACION_ID: id, EMPRESA_ID: EMP, ACTOR_USUARIO_ID: ADMIN,
    MODULO: "REPORTES", ACCION: "MODULO_SUSPENDER", RECURSO_TIPO: "EMPRESA", RECURSO_ID: EMP,
    RESULTADO: "INTENTO", ESTADO_ANTERIOR: SA, ESTADO_NUEVO: SD, DETALLE: "INICIO", ESQUEMA_VERSION: "1" };
  const datos: Registro[] = [{ id: rec("R"), fields: { ...f } }];
  if (resultado) datos.push({ id: rec("S"), fields: { ...f, ID_EVENTO: randomUUID(),
    RESULTADO: resultado, ESTADO_NUEVO: undefined, DETALLE: "ESTADO_INCIERTO" } });
  return datos;
}
function cierre(registros: Registro[], tipo: "APLICADO" | "NO_APLICADO", actor = OTRO_ADMIN): Registro[] {
  const f = registros[0].fields;
  return [...registros, { id: rec("T"), fields: {
    ...f, ID_EVENTO: randomUUID(), ACTOR_USUARIO_ID: actor,
    RESULTADO: "CONCILIADO", ESTADO_NUEVO: tipo === "APLICADO" ? SD : SA,
    DETALLE: tipo === "APLICADO" ? "CONCILIADO_APLICADO" : "CONCILIADO_NO_APLICADO",
  } }];
}

function codigo(e: unknown, v: ErrorResolucionAuditoria["codigo"]) {
  return e instanceof ErrorResolucionAuditoria && e.codigo === v;
}
test("12B.4.3: INTENTO sin final se diagnostica como cambio aplicado", () => {
  const id = opId(), datos = intentos(id);
  const r = diagnosticarOperacionPendiente(EMP, id, datos, ESTADO_DESPUES);
  assert.equal(r.estadoDetectado, "APLICADO"); assert.equal(r.versionActual, ESTADO_DESPUES.version);
  assert.deepEqual(r.estadoAnterior, ANTES); assert.deepEqual(r.estadoPropuesto, DESPUES);
});
test("12B.4.3: INTENTO sin final se diagnostica como no aplicado", () => {
  const id = opId();
  const r = diagnosticarOperacionPendiente(EMP, id, intentos(id), ESTADO_ANTES);
  assert.equal(r.estadoDetectado, "NO_APLICADO");
});
test("12B.4.3: INDETERMINADO con snapshot omitido por Airtable puede revisarse", () => {
  const id = opId(), datos = intentos(id, "INDETERMINADO");
  assert.equal(analizarHistorialAuditoria(EMP, datos).incidencias[0]?.causa, "INDETERMINADO");
  const r = diagnosticarOperacionPendiente(EMP, id, datos, ESTADO_ANTES);
  assert.equal(r.estadoDetectado, "NO_APLICADO");
});
test("12B.4.3: un estado tercero nunca se concilia", () => {
  const id = opId(), estado = leerEstadoModulos(EMP, true, ["USUARIO", "CUENTAS_CORRIENTES"]);
  assert.ok(estado.ok);
  if (!estado.ok) return;
  assert.throws(() => diagnosticarOperacionPendiente(EMP, id, intentos(id), estado.estado),
    e => codigo(e, "ESTADO_NO_COINCIDE"));
});
test("12B.4.3: historial inválido y duplicados nunca se concilian", () => {
  const id = opId(), datos = intentos(id); datos.push({ ...datos[0], id: rec("S") });
  assert.throws(() => diagnosticarOperacionPendiente(EMP, id, datos, ESTADO_ANTES),
    e => codigo(e, "HISTORIAL_INVALIDO") || codigo(e,"INCIDENCIA_NO_CONCILIABLE"));
});
test("12B.4.3: versión falsificada del snapshot invalida el cierre", () => {
  const id=opId(), datos=intentos(id);
  datos[0].fields.ESTADO_ANTERIOR = JSON.stringify({ MODULOS_CONTRATADOS: ANTES, ACTIVA: true, VERSION: "a".repeat(64) });
  assert.throws(() => diagnosticarOperacionPendiente(EMP, id, datos, ESTADO_ANTES),
    e => codigo(e, "DATOS_INCONSISTENTES"));
});
test("12B.4.3: CONCILIADO por otro admin habilita solo con estado y código coherentes", () => {
  for (const tipo of ["APLICADO", "NO_APLICADO"] as const) {
    const id=opId(), datos=cierre(intentos(id,"INDETERMINADO"),tipo);
    const resultado=analizarHistorialAuditoria(EMP,datos);
    assert.equal(resultado.bloqueada,false);
    assert.throws(() => diagnosticarOperacionPendiente(EMP,id,datos,ESTADO_ANTES),
      e => codigo(e,"INCIDENCIA_NO_CONCILIABLE"));
  }
});
test("12B.4.3: cierre falsificado o segundo cierre bloquean el historial", () => {
  const id=opId(), datos=cierre(intentos(id),"APLICADO");
  datos[1].fields.DETALLE="OTRO_MOTIVO";
  assert.equal(analizarHistorialAuditoria(EMP,datos).bloqueada,true);
  const duplicado=cierre(intentos(opId()),"APLICADO");
  duplicado.push({...duplicado[2-1],id:rec("Y"),fields:{...duplicado[1].fields,ID_EVENTO:randomUUID()}});
  assert.equal(analizarHistorialAuditoria(EMP,duplicado).bloqueada,true);
});

type Sim = {
  enviar(method: "GET" | "POST", payload: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }>;
  readonly datos: Registro[]; readonly insertados: number; readonly renovaciones: number; readonly cambios: number;
};
const ENVS = ["OPTIMA_AUDIT_WRITES_ENABLED", "OPTIMA_PLATFORM_ADMIN_USER_ID", "OPTIMA_PLATFORM_COMPANY_ID",
  "AIRTABLE_USERS_BASE_ID", "AIRTABLE_USERS_TABLE_ID", "AIRTABLE_COMPANIES_TABLE_ID",
  "AIRTABLE_AUDITORIA_TABLE_ID", "AIRTABLE_TOKEN", "UPSTASH_REDIS_KV_REST_API_URL", "UPSTASH_REDIS_KV_REST_API_TOKEN"] as const;
function simular(t: { after(fn: () => void): void }, opts: {
  lock?: boolean; renovar?: boolean; fallaInsert?: boolean; cliente?: boolean; actual?: readonly string[];
} = {}): Sim {
  const prev = Object.fromEntries(ENVS.map(k=>[k,process.env[k]]));
  const fetchAntes=globalThis.fetch;
  t.after(()=>{
    globalThis.fetch=fetchAntes;
    for(const k of ENVS){ const v=prev[k]; if(v===undefined) delete process.env[k]; else process.env[k]=v; }
  });
  Object.assign(process.env,{
    OPTIMA_AUDIT_WRITES_ENABLED:"true", OPTIMA_PLATFORM_ADMIN_USER_ID:ADMIN,
    OPTIMA_PLATFORM_COMPANY_ID:PLAT, AIRTABLE_USERS_BASE_ID:BASE, AIRTABLE_USERS_TABLE_ID:USU,
    AIRTABLE_COMPANIES_TABLE_ID:EMP_T, AIRTABLE_AUDITORIA_TABLE_ID:AUD_T,
    AIRTABLE_TOKEN:"TOKEN_SIMULADO", UPSTASH_REDIS_KV_REST_API_URL:"https://redis-prueba.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN:"TOKEN_SIMULADO",
  });
  let insertados=0,renovaciones=0,cambios=0;
  const registros=intentos();
  globalThis.fetch=async (input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==="redis-prueba.invalid"){
      const arr=JSON.parse(String(init?.body)) as unknown[];
      if(arr[0]==="GET")return Response.json({result:String(arr[1]).startsWith("optima:version-sesion:")?null:JSON.stringify({usuarioId:opts.cliente?rec("Z"):ADMIN,versionSesion:0})});
      if(arr[0]==="SET")return Response.json({result:opts.lock===false?null:"OK"});
      if(arr[0]==="EVAL"){
        if(String(arr[1]).includes("EXPIRE")) {
          renovaciones++;
          return Response.json({result:opts.renovar===false?0:1});
        }
        return Response.json({result:1});
      }
      throw Error("Redis inesperado");
    }
    assert.equal(url.hostname,"api.airtable.com");
    if(url.pathname.endsWith(`/${USU}/${ADMIN}`)) return Response.json({id:ADMIN,fields:{
      ACTIVO:true,ROL:"ADMIN",EMPRESA:[PLAT],USUARIO:"OPTIMA_ADMIN",NOMBRE:"OPTIMA",
      SUCURSALES_AUTORIZADAS:[],SUCURSAL_PREDETERMINADA:[] }});
    if(url.pathname.endsWith(`/${EMP_T}/${PLAT}`)) return Response.json({id:PLAT,fields:{
      ACTIVA:true,NOMBRE_COMERCIAL:"OPTIMA",CLAVE_EMPRESA:"OPTIMA"}});
    if(url.pathname.endsWith(`/${EMP_T}/${EMP}`)){
      if(init?.method!=="GET") {cambios++; throw Error("NUNCA PATCH EMPRESA");}
      return Response.json({id:EMP,fields:{ACTIVA:true,CLAVE_EMPRESA:"CLIENTE",NOMBRE_COMERCIAL:"Cliente ficticio",
        MODULOS_CONTRATADOS:[...(opts.actual ?? DESPUES)]}});
    }
    if(url.pathname.endsWith(`/${AUD_T}`)){
      if(init?.method==="GET"){
        assert.equal(url.searchParams.get("filterByFormula"),`{EMPRESA_ID}="${EMP}"`);
        return Response.json({records:registros});
      }
      assert.equal(init?.method,"POST"); insertados++;
      if(opts.fallaInsert) return Response.json({error:"simulado"},{status:503});
      const b=JSON.parse(String(init.body)) as {records:Array<{fields:Record<string,string>}>};
      const f=b.records[0].fields;
      assert.equal(f.RESULTADO,"CONCILIADO");
      registros.push({id:rec("T"),fields:{...f}});
      return Response.json({records:[{id:rec("T"),fields:{ID_EVENTO:f.ID_EVENTO,OPERACION_ID:f.OPERACION_ID}}]});
    }
    throw Error("Ruta no simulada: "+url.pathname);
  };
  async function enviar(method:"GET"|"POST",payload:Record<string,unknown>){
    let status=200,json:Record<string,unknown>={};
    const req={method,cookies:{optima_sesion:COOKIE},query:method==="GET"?payload:{},
      body:method==="POST"?payload:{}} as unknown as VercelRequest;
    const res={setHeader(){return this;},status(n:number){status=n;return this;},
      json(d:Record<string,unknown>){json=d;return this;}} as unknown as VercelResponse;
    await handler(req,res);return {status,json};
  }
  return {enviar,get datos(){return registros;},get insertados(){return insertados;},
    get renovaciones(){return renovaciones;},get cambios(){return cambios;}};
}
test("12B.4.3: GET lista pendientes sin escribir en Airtable",async t=>{
  const s=simular(t);
  const r=await s.enviar("GET",{empresaId:EMP});
  assert.equal(r.status,200);assert.equal((r.json.incidencias as unknown[]).length,1);
  assert.equal(s.insertados,0);assert.equal(s.cambios,0);
});
test("12B.4.3: GET previsualiza estado real y propuesta sin realizar cambios",async t=>{
  const s=simular(t);
  const r=await s.enviar("GET",{empresaId:EMP,operacionId:s.datos[0].fields.OPERACION_ID});
  assert.equal(r.status,200);assert.equal((r.json.diagnostico as {estadoDetectado:string}).estadoDetectado,"APLICADO");
  assert.equal(s.insertados,0);
});
test("12B.4.3: POST con confirmación crea sólo CONCILIADO y verifica lectura",async t=>{
  const s=simular(t); const id=s.datos[0].fields.OPERACION_ID;
  const r=await s.enviar("POST",{empresaId:EMP,operacionId:id,versionActual:ESTADO_DESPUES.version,
    estadoDetectado:"APLICADO",motivo:"Verificación manual ficticia de cierre",confirmacion:"CONCILIAR"});
  assert.equal(r.status,200); assert.equal(s.insertados,1); assert.equal(s.cambios,0);
  assert.equal(s.renovaciones,1);
  assert.equal(s.datos[1].fields.ACTOR_USUARIO_ID,ADMIN);
  assert.equal(analizarHistorialAuditoria(EMP,s.datos).bloqueada,false);
  const duplicado=await s.enviar("POST",{empresaId:EMP,operacionId:id,versionActual:ESTADO_DESPUES.version,
    estadoDetectado:"APLICADO",motivo:"Repetición ficticia no permitida",confirmacion:"CONCILIAR"});
  assert.equal(duplicado.status,409); assert.equal(s.insertados,1);
});
test("12B.4.3: no aplica cierre cuando cambia versión o falta confirmación",async t=>{
  const s=simular(t); const id=s.datos[0].fields.OPERACION_ID;
  const a=await s.enviar("POST",{empresaId:EMP,operacionId:id,versionActual:ESTADO_ANTES.version,
    estadoDetectado:"APLICADO",motivo:"Control manual de prueba ficticia",confirmacion:"CONCILIAR"});
  assert.equal(a.status,409);
  const b=await s.enviar("POST",{empresaId:EMP,operacionId:id,versionActual:ESTADO_DESPUES.version,
    estadoDetectado:"APLICADO",motivo:"Control manual de prueba ficticia"});
  assert.equal(b.status,400);assert.equal(s.insertados,0);
});
test("12B.4.3: lectura sin rol global y lock ocupado nunca escriben",async t=>{
  const s=simular(t,{lock:false});
  const r=await s.enviar("POST",{empresaId:EMP,operacionId:s.datos[0].fields.OPERACION_ID,
    versionActual:ESTADO_DESPUES.version,estadoDetectado:"APLICADO",motivo:"Conciliación de prueba de bloqueo",confirmacion:"CONCILIAR"});
  assert.equal(r.status,409); assert.equal(s.insertados,0);
});
test("12B.4.3: falla del INSERT queda incierta, sin reintentar ni tocar empresa",async t=>{
  const s=simular(t,{fallaInsert:true});
  const r=await s.enviar("POST",{empresaId:EMP,operacionId:s.datos[0].fields.OPERACION_ID,
    versionActual:ESTADO_DESPUES.version,estadoDetectado:"APLICADO",motivo:"Prueba ficticia de error de red",confirmacion:"CONCILIAR"});
  assert.equal(r.status,503);assert.equal(s.insertados,1);assert.equal(s.cambios,0);
});
test("12B.4.3: si se pierde el lock durante conciliación se bloquea el POST",async t=>{
  const s=simular(t,{renovar:false});
  const r=await s.enviar("POST",{empresaId:EMP,operacionId:s.datos[0].fields.OPERACION_ID,
    versionActual:ESTADO_DESPUES.version,estadoDetectado:"APLICADO",
    motivo:"Validación ficticia del control de Redis",confirmacion:"CONCILIAR"});
  assert.equal(r.status,409); assert.equal(s.renovaciones,1); assert.equal(s.insertados,0); assert.equal(s.cambios,0);
});
test("12B.4.3: usuario sin identidad global no consulta ni cierra incidentes",async t=>{
  const s=simular(t,{cliente:true});
  const r=await s.enviar("GET",{empresaId:EMP});
  assert.equal(r.status,403); assert.equal(s.insertados,0); assert.equal(s.cambios,0);
});
