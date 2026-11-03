import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import argon2 from "argon2";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import solicitar from "../handlers/usuarios/solicitar-recuperacion.js";
import restablecer from "../handlers/usuarios/restablecer.js";
import { guardarSesion, buscarSesion } from "../lib/session.js";

const uid = `rec${"A".repeat(14)}`;
const eid = `rec${"B".repeat(14)}`;
const oldToken = "s".repeat(43);
const email = "usuario@example.org";
const user = "PRUEBA01";
function respuesta() {
  const estado = { status: 200, data: null as unknown };
  const res = { setHeader(){return this}, status(n:number){estado.status=n;return this},
    json(x:unknown){estado.data=x;return this} } as unknown as VercelResponse;
  return { estado, res };
}
const req = (body: unknown, method="POST") => ({ method, body, headers: {} } as VercelRequest);

test("Paso 9H: no enumera usuarios, token vence, cambio revoca sesiones y token no se reutiliza", async t => {
  const oldFetch = globalThis.fetch;
  const vars = {
    OPTIMA_PASSWORD_RESET_ENABLED: "true",
    OPTIMA_PUBLIC_URL: "https://optima-preview.example.org",
    RESEND_API_KEY: "test-key",
    OPTIMA_EMAIL_FROM: "OPTIMA <no-reply@example.org>",
    AIRTABLE_USERS_BASE_ID: "appTest", AIRTABLE_USERS_TABLE_ID: "tblUsers", AIRTABLE_TOKEN: "test",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-recuperacion.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "test",
  };
  const prev = Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));
  Object.assign(process.env,vars);
  t.after(()=>{globalThis.fetch=oldFetch;
    for(const [k,v] of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  });
  const store=new Map<string,string>();
  let enviados=0, cambios=0, link="";
  let passwordHash=await argon2.hash("Antes123!", {type:argon2.argon2id});
  const usuario={USUARIO:user, Email:email,ACTIVO:true,EMPRESA:[eid],PASSWORD_HASH:passwordHash,ROL:"USUARIO"};
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==="redis-recuperacion.invalid") {
      const [op,k,v,...rest]=JSON.parse(String(init?.body)) as (string|number)[];
      const key=String(k);
      if(op==="GET")return Response.json({result:store.get(key)??null});
      if(op==="SET"){
        if(rest.includes("NX")&&store.has(key))return Response.json({result:null});
        store.set(key,String(v));return Response.json({result:"OK"});
      }
      if(op==="INCR"){
        const next=Number(store.get(key)||0)+1;store.set(key,String(next));return Response.json({result:next});
      }
      if(op==="EXPIRE")return Response.json({result:1});
      if(op==="EVAL"){
        const ar=JSON.parse(String(init?.body)) as (string|number)[];
        const x=String(ar[3]),owner=String(ar[4]);
        if(store.get(x)===owner){store.delete(x);return Response.json({result:1});}
        return Response.json({result:0});
      }
      if(op==="DEL")return Response.json({result:+store.delete(key)});
      throw new Error("Comando Redis inesperado: "+op);
    }
    if(url.hostname==="api.airtable.com"){
      if(url.searchParams.has("filterByFormula")) {
        const formula=url.searchParams.get("filterByFormula")||"";
        return Response.json({records:formula.includes(user.toLowerCase())?[{id:uid,fields:usuario}]:[]});
      }
      if(url.pathname.endsWith("/"+uid)&&init?.method==="PATCH") {
        const fields=(JSON.parse(String(init.body)) as {fields:Record<string,unknown>}).fields;
        assert.deepEqual(Object.keys(fields),["PASSWORD_HASH"]);
        assert.match(String(fields.PASSWORD_HASH),/^\$argon2id\$/);
        passwordHash=String(fields.PASSWORD_HASH);usuario.PASSWORD_HASH=passwordHash;cambios++;
        return Response.json({id:uid,fields:usuario});
      }
      if(url.pathname.endsWith("/"+uid))return Response.json({id:uid,fields:usuario});
    }
    if(url.hostname==="api.resend.com") {
      enviados++;
      const body=JSON.parse(String(init?.body)) as {text:string};
      link=body.text.match(/https:\/\/[^\s]+/)?.[0]??"";
      return Response.json({id:"email-test"});
    }
    throw new Error("Llamada inesperada: "+url);
  };
  await guardarSesion(oldToken,{usuarioId:uid});
  assert.equal((await buscarSesion(oldToken))?.usuarioId,uid);
  let r=respuesta();
  await solicitar(req({usuario:"DESCONOCIDO",email}),r.res);
  assert.equal(r.estado.status,200);const respuestaAnonima=JSON.stringify(r.estado.data);
  assert.equal(enviados,0);
  r=respuesta();await solicitar(req({usuario:user,email}),r.res);
  assert.equal(r.estado.status,200);
  assert.equal(JSON.stringify(r.estado.data),respuestaAnonima);
  assert.equal(enviados,1);
  const token=link.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];assert.ok(token);
  assert.ok(![...store.keys()].some(k=>k.includes(token)));
  r=respuesta();await solicitar(req({usuario:user,email}),r.res);
  assert.equal(r.estado.status,200);assert.equal(enviados,1);
  r=respuesta();await restablecer(req({token,password:"SinSimbolo123"}),r.res);
  assert.equal(r.estado.status,400);assert.equal(cambios,0);
  r=respuesta();await restablecer(req({token,password:"NuevoSeguro123!"}),r.res);
  assert.equal(r.estado.status,200);assert.equal(cambios,1);
  assert.equal(await argon2.verify(passwordHash,"NuevoSeguro123!"),true);
  assert.equal(await buscarSesion(oldToken),null);
  r=respuesta();await restablecer(req({token,password:"OtraNueva123!"}),r.res);
  assert.equal(r.estado.status,410);assert.equal(cambios,1);
});

test("Paso 9H: recuperación deshabilitada por defecto", async t=>{
  const anterior=process.env.OPTIMA_PASSWORD_RESET_ENABLED;
  delete process.env.OPTIMA_PASSWORD_RESET_ENABLED;
  t.after(()=>{if(anterior===undefined)delete process.env.OPTIMA_PASSWORD_RESET_ENABLED;else process.env.OPTIMA_PASSWORD_RESET_ENABLED=anterior});
  const r=respuesta();await solicitar(req({usuario:user,email}),r.res);
  assert.equal(r.estado.status,503);
});
