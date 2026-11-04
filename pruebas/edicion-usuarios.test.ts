import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { construirCambiosEmpleado, leerEmpleadoEditable } from "../core/edicion-usuarios.js";
import { detalleEmpleado, editarEmpleado } from "../handlers/usuarios/editar.js";
import type { OpcionesAlta } from "../core/alta-usuarios.js";

const ADMIN = "rec" + "A".repeat(14);
const EMPLEADO = "rec" + "B".repeat(14);
const OTRA_EMPRESA_USER = "rec" + "I".repeat(14);
const EMPRESA = "rec" + "C".repeat(14);
const OTRA_EMPRESA = "rec" + "D".repeat(14);
const SUCURSAL = "rec" + "E".repeat(14);
const OTRA_SUCURSAL = "rec" + "F".repeat(14);
const TOKEN = "s".repeat(43);

const opciones: OpcionesAlta = {
  modulos: [{id:"CORE",opcionAirtable:"USUARIO"},{id:"INVENTARIO",opcionAirtable:"INVENTARIO"}],
  sucursales: [{id:SUCURSAL,nombre:"Sucursal de prueba"}],
  permisos: [
    {id:"usuarios.ver",campo:"PERMISOS_USUARIOS",opcionAirtable:"VER"},
    {id:"usuarios.gestionar",campo:"PERMISOS_USUARIOS",opcionAirtable:"GESTIONAR USUARIOS"},
    {id:"inventario.ver",campo:"PERMISOS_INVENTARIO",opcionAirtable:"VER"},
  ],
};
const empleado = () => ({
  id:EMPLEADO,
  fields: {
    USUARIO:"EMPLEADO_TEST",NOMBRE:"Empleado", ROL:"USUARIO",ACTIVO:true,
    EMPRESA:[EMPRESA], SUCURSALES_AUTORIZADAS:[SUCURSAL],
    SUCURSAL_PREDETERMINADA:[SUCURSAL],MODULOS:["USUARIO","INVENTARIO"],
    PERMISOS_INVENTARIO:["VER"],
  } as Record<string, unknown>,
});
function respuesta() {
  const estado = {status:200, body:null as unknown};
  const res = {setHeader(){return this},status(s:number){estado.status=s;return this},
    json(d:unknown){estado.body=d;return this}} as unknown as VercelResponse;
  return {estado,res};
}
test("Paso 10B: cambios de empleados no aceptan escalamiento de módulos, sucursales ni permisos", () => {
  const solicitud = {sucursalIds:[SUCURSAL],sucursalPredeterminadaId:SUCURSAL,
    modulos:["CORE","INVENTARIO"],permisos:["inventario.ver"]};
  const correcto = construirCambiosEmpleado(solicitud,opciones);
  assert.equal(correcto.ok,true);
  if (!correcto.ok) return;
  assert.deepEqual(correcto.campos.SUCURSALES_AUTORIZADAS,[SUCURSAL]);
  assert.deepEqual(correcto.campos.SUCURSAL_PREDETERMINADA,[SUCURSAL]);
  assert.deepEqual(correcto.campos.PERMISOS_INVENTARIO,["VER"]);
  assert.deepEqual(correcto.campos.PERMISOS_MOVIMIENTOS,[]);
  assert.ok(!Object.keys(correcto.campos).some(k=>["ROL","EMPRESA","ACTIVO","PASSWORD_HASH","NOMBRE"].includes(k)));
  for (const bad of [
    {...solicitud, sucursalIds:[OTRA_SUCURSAL]},
    {...solicitud, sucursalPredeterminadaId:OTRA_SUCURSAL},
    {...solicitud, modulos:["CORE","MOVIMIENTOS"]},
    {...solicitud, modulos:["CORE"], permisos:["inventario.ver"]},
    {...solicitud, permisos:["usuarios.gestionar","administracion.configurar"]},
    {...solicitud, permisos:["inventario.ver","inventario.ver"]},
  ]) assert.equal(construirCambiosEmpleado(bad,opciones).ok,false);
});
test("Paso 10B: jamás edita ADMIN, propio usuario ni otra empresa",()=>{
  assert.equal(leerEmpleadoEditable(empleado(),EMPRESA,ADMIN,opciones)?.usuario,"EMPLEADO_TEST");
  const ajeno=empleado();ajeno.fields.EMPRESA=[OTRA_EMPRESA];
  assert.equal(leerEmpleadoEditable(ajeno,EMPRESA,ADMIN,opciones),null);
  const administrador=empleado();administrador.fields.ROL="ADMIN";
  assert.equal(leerEmpleadoEditable(administrador,EMPRESA,ADMIN,opciones),null);
  assert.equal(leerEmpleadoEditable(empleado(),EMPRESA,EMPLEADO,opciones),null);
});

test("Paso 10B: API sin sesión, ajenos, conflicto de versión y PATCH limitado",async t=>{
  const originalFetch=globalThis.fetch;
  const vars:Record<string,string>={
    AIRTABLE_USERS_BASE_ID:"appPrueba",AIRTABLE_USERS_TABLE_ID:"tblUsuarios",
    AIRTABLE_COMPANIES_TABLE_ID:"tblEmpresas",AIRTABLE_SUCURSALES_TABLE_ID:"tblSucursales",
    AIRTABLE_TOKEN:"ficticio",UPSTASH_REDIS_KV_REST_API_URL:"https://redis-edicion.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN:"ficticio",
  };
  const orig=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));
  Object.assign(process.env,vars);
  t.after(()=>{globalThis.fetch=originalFetch;for(const [k,v] of Object.entries(orig)){
    if(v===undefined)delete process.env[k];else process.env[k]=v;
  }});
  const adminFields={
    USUARIO:"ADMIN_PRUEBA",NOMBRE:"Admin", ROL:"ADMIN",ACTIVO:true,
    EMPRESA:[EMPRESA],MODULOS:["USUARIO","INVENTARIO"],
    SUCURSALES_AUTORIZADAS:[SUCURSAL],SUCURSAL_PREDETERMINADA:[SUCURSAL],
    PERMISOS_USUARIOS:["VER","GESTIONAR USUARIOS"],
    PERMISOS_INVENTARIO:["VER"],
  };
  const store=new Map<string,unknown>();
  store.set("usuario",empleado());
  let patchCount=0;
  let changedTenant=false;
  globalThis.fetch=async (input, init)=>{
    const url=new URL(String(input));
    if(url.hostname==="redis-edicion.invalid"){
      const [op,key]=JSON.parse(String(init?.body)) as string[];
      assert.equal(op,"GET");
      const sessionKey="optima:sesion:"+createHash("sha256").update(TOKEN).digest("hex");
      return Response.json({result:key===sessionKey?JSON.stringify({usuarioId:ADMIN,versionSesion:0}):null});
    }
    if(url.hostname!=="api.airtable.com") throw Error("No network allowed");
    if(url.pathname.endsWith("/tblUsuarios/"+ADMIN))
      return Response.json({id:ADMIN,fields:adminFields});
    if(url.pathname.endsWith("/tblEmpresas/"+EMPRESA))
      return Response.json({id:EMPRESA,fields:{
        ACTIVA:true,CLAVE_EMPRESA:"PRUEBA",NOMBRE_COMERCIAL:"Empresa",MODULOS_CONTRATADOS:["USUARIO","INVENTARIO"],
      }});
    if(url.pathname.endsWith("/tblSucursales/"+SUCURSAL))
      return Response.json({id:SUCURSAL,fields:{ACTIVA:true,EMPRESA:[EMPRESA],NOMBRE:"Prueba"}});
    if(url.pathname.endsWith("/tblUsuarios/"+EMPLEADO)){
      if(init?.method==="PATCH"){
        patchCount++;
        const p=JSON.parse(String(init.body)) as {fields:Record<string,unknown>;typecast:boolean};
        assert.equal(p.typecast,false);
        assert.deepEqual(Object.keys(p.fields).sort(),[
          "SUCURSALES_AUTORIZADAS","SUCURSAL_PREDETERMINADA","MODULOS","PERMISOS_INVENTARIO",
          "PERMISOS_MOVIMIENTOS","PERMISOS_ADMINISTRACION","PERMISOS_FACTURACION",
          "PERMISOS_REPORTES","PERMISOS_AJUSTES","PERMISOS_USUARIOS","PERMISOS_SUCURSALES",
        ].sort());
        const curr=store.get("usuario") as {id:string;fields:Record<string,unknown>};
        const res={...curr,fields:{...curr.fields,...p.fields}};
        store.set("usuario",res);
        return Response.json(res);
      }
      const curr=store.get("usuario") as {id:string;fields:Record<string,unknown>};
      return Response.json(changedTenant?{...curr,fields:{...curr.fields,EMPRESA:[OTRA_EMPRESA]}}:curr);
    }
    if(url.pathname.endsWith("/tblUsuarios/"+OTRA_EMPRESA_USER))
      return Response.json({id:OTRA_EMPRESA_USER,fields:{...empleado().fields,EMPRESA:[OTRA_EMPRESA]}});
    throw Error("Unmocked request: "+url);
  };
  const req=(method:string,body?:unknown,id?:string,cookie=true)=>({
    method,body,query:{id},cookies:cookie?{optima_sesion:TOKEN}:{},
  } as unknown as VercelRequest);
  let r=respuesta();await detalleEmpleado(req("GET",undefined,EMPLEADO,false),r.res);
  assert.equal(r.estado.status,401);
  r=respuesta();await detalleEmpleado(req("GET",undefined,OTRA_EMPRESA_USER),r.res);
  assert.equal(r.estado.status,403);
  r=respuesta();await detalleEmpleado(req("GET",undefined,EMPLEADO),r.res);
  assert.equal(r.estado.status,200);
  const empleadoVisible=(r.estado.body as {empleado:{version:string}}).empleado;
  const body={
    id:EMPLEADO,version:"f".repeat(64),sucursalIds:[SUCURSAL],
    sucursalPredeterminadaId:SUCURSAL,modulos:["CORE","INVENTARIO"],permisos:["inventario.ver"],
    ROL:"ADMIN",EMPRESA:[OTRA_EMPRESA],ACTIVO:false,PASSWORD_HASH:"INYECCION",
  };
  r=respuesta();await editarEmpleado(req("POST",body),r.res);
  assert.equal(r.estado.status,409);
  assert.equal(patchCount,0);
  r=respuesta();await editarEmpleado(req("POST",{...body,version:empleadoVisible.version}),r.res);
  assert.equal(r.estado.status,200);
  assert.equal(patchCount,1);
  changedTenant=true;
  r=respuesta();await editarEmpleado(req("POST",{...body,version:empleadoVisible.version}),r.res);
  assert.equal(r.estado.status,403);
  assert.equal(patchCount,1);
});
