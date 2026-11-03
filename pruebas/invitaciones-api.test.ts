import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import opciones from "../api/usuarios/opciones.js";
import invitar from "../api/usuarios/invitar.js";
import validar from "../api/usuarios/validar-invitacion.js";
import activar from "../api/usuarios/activar.js";

const adminId=`rec${"A".repeat(14)}`;
const invitadoId=`rec${"B".repeat(14)}`;
const empresaId=`rec${"C".repeat(14)}`;
const sucursalId=`rec${"D".repeat(14)}`;
const sesion="s".repeat(43);

function respuesta() {
  const estado={status:200,body:null as unknown};
  const res={setHeader(){return this},status(s:number){estado.status=s;return this},json(v:unknown){estado.body=v;return this}} as unknown as VercelResponse;
  return {estado,res};
}

test("API Paso 9: invitación y activación aisladas, sin llamadas reales", async(t)=>{
  const oldFetch=globalThis.fetch;
  const env:Record<string,string>={
    OPTIMA_INVITES_ENABLED:"true", OPTIMA_PUBLIC_URL:"https://optima-preview.example.org",
    RESEND_API_KEY:"ficticio", OPTIMA_EMAIL_FROM:"Pruebas <no-reply@example.org>",
    AIRTABLE_TOKEN:"ficticio", AIRTABLE_USERS_BASE_ID:"appTest", AIRTABLE_USERS_TABLE_ID:"tblUsuarios",
    AIRTABLE_COMPANIES_TABLE_ID:"tblEmpresas",AIRTABLE_SUCURSALES_TABLE_ID:"tblSucursales",
    UPSTASH_REDIS_KV_REST_API_URL:"https://redis-test.invalid",UPSTASH_REDIS_KV_REST_API_TOKEN:"ficticio",
  };
  const envViejo=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
  Object.assign(process.env,env);
  t.after(()=>{globalThis.fetch=oldFetch;for(const [k,v] of Object.entries(envViejo)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});

  const store=new Map<string,string>();
  const keySes="optima:sesion:"+createHash("sha256").update(sesion).digest("hex");
  store.set(keySes,JSON.stringify({usuarioId:adminId}));
  let correo="";
  let invitado:Record<string,unknown>|null=null;
  let nuevoActivo=false;
  const admin:Record<string,unknown>={USUARIO:"ADMIN_TEST",NOMBRE:"Admin ficticio",ROL:"ADMIN",ACTIVO:true,
    EMPRESA:[empresaId],MODULOS:["USUARIO","INVENTARIO"],SUCURSAL_PREDETERMINADA:[sucursalId],
    SUCURSALES_AUTORIZADAS:[sucursalId],PERMISOS_USUARIOS:["VER","GESTIONAR USUARIOS"],
    PERMISOS_INVENTARIO:["VER","CREAR"]};
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==="redis-test.invalid"){
      const [op,key,value]=JSON.parse(String(init?.body)) as string[];
      if(op==="GET")return Response.json({result:store.get(key)??null});
      if(op==="SET"){
        const opciones=(JSON.parse(String(init?.body)) as string[]).slice(3);
        if(opciones.includes("NX")&&store.has(key))return Response.json({result:null});
        store.set(key,value);return Response.json({result:"OK"});
      }
      if(op==="GETDEL"){const v=store.get(key)??null;store.delete(key);return Response.json({result:v});}
      if(op==="DEL"){const ok=store.delete(key);return Response.json({result:+ok});}
      throw new Error("Redis inesperado "+op);
    }
    if(url.hostname==="api.resend.com"){
      assert.equal(init?.method,"POST");
      correo=(JSON.parse(String(init.body)) as {text:string}).text;
      return Response.json({id:"email-ficticio"});
    }
    if(url.hostname==="api.airtable.com"){
      const path=url.pathname;
      if(path.endsWith("/tblUsuarios")&&init?.method==="POST"){
        assert.equal(invitado,null);
        invitado=(JSON.parse(String(init.body)) as {fields:Record<string,unknown>}).fields;
        return Response.json({id:invitadoId,fields:invitado});
      }
      if(path.endsWith("/tblUsuarios")&&url.searchParams.has("filterByFormula")){
        return Response.json({records:[]});
      }
      if(path.endsWith(`/tblUsuarios/${invitadoId}`)&&init?.method==="PATCH"){
        const fields=(JSON.parse(String(init.body)) as {fields:Record<string,unknown>}).fields;
        assert.match(String(fields.PASSWORD_HASH),/^\$argon2id\$/);
        nuevoActivo=fields.ACTIVO===true;
        if(invitado)Object.assign(invitado,fields);
        return Response.json({id:invitadoId,fields:invitado});
      }
      if(path.endsWith(`/tblUsuarios/${invitadoId}`))return Response.json({id:invitadoId,fields:invitado});
      if(path.endsWith(`/tblUsuarios/${adminId}`))return Response.json({id:adminId,fields:admin});
      if(path.endsWith(`/tblEmpresas/${empresaId}`))return Response.json({id:empresaId,fields:{
        ACTIVA:true,CLAVE_EMPRESA:"FICTICIA",NOMBRE_COMERCIAL:"Empresa Ficticia",
        MODULOS_CONTRATADOS:["USUARIO","INVENTARIO"],
      }});
      if(path.endsWith(`/tblSucursales/${sucursalId}`))return Response.json({id:sucursalId,fields:{
        ACTIVA:true,EMPRESA:[empresaId],NOMBRE:"SUCURSAL PRUEBA",
      }});
    }
    throw new Error("Intento de conexión inesperado: "+url.toString());
  };

  const req=(method:string,body?:unknown,cookie=true)=>({method,body,cookies:cookie?{optima_sesion:sesion}:{}} as unknown as VercelRequest);
  let r=respuesta();
  await opciones(req("GET"),r.res);
  assert.equal(r.estado.status,200);
  r=respuesta();
  await invitar(req("POST",{usuario:"EMP01",nombre:"Empleado ficticio",email:"emp@example.org",
    sucursalIds:[sucursalId],sucursalPredeterminadaId:sucursalId,
    modulos:["CORE","INVENTARIO"],permisos:["inventario.ver"]}),r.res);
  assert.equal(r.estado.status,201);
  assert.equal(nuevoActivo,false);
  assert.ok(invitado);
  assert.deepEqual((invitado as Record<string,unknown>).EMPRESA,[empresaId]);
  const token=correo.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(token);
  r=respuesta();await validar(req("POST",{token},false),r.res);
  assert.equal(r.estado.status,200);
  r=respuesta();await activar(req("POST",{token,password:"ClaveFicticia123"},false),r.res);
  assert.equal(r.estado.status,200);
  assert.equal(nuevoActivo,true);
  r=respuesta();await activar(req("POST",{token,password:"ClaveFicticia123"},false),r.res);
  assert.equal(r.estado.status,410);
});

test("API invitaciones deshabilitada por defecto, sin mutaciones", async(t)=>{
  const old=process.env.OPTIMA_INVITES_ENABLED;
  delete process.env.OPTIMA_INVITES_ENABLED;
  t.after(()=>{if(old===undefined)delete process.env.OPTIMA_INVITES_ENABLED;else process.env.OPTIMA_INVITES_ENABLED=old});
  const r=respuesta();
  await invitar({method:"POST",body:{}} as VercelRequest,r.res);
  assert.equal(r.estado.status,503);
});
