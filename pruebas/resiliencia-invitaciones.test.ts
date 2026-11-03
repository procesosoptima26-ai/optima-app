import assert from "node:assert/strict";
import { test } from "node:test";
import { bloquearActivacion, liberarBloqueoActivacion } from "../lib/invitaciones.js";
import { retirarUsuarioPendiente } from "../lib/usuarios-maestros.js";

const id = `rec${"A".repeat(14)}`;
const empresa = `rec${"B".repeat(14)}`;

test("bloqueo activación: exclusivo y liberación del propietario correcto", async (t) => {
  const previo=globalThis.fetch;
  const urlVieja=process.env.UPSTASH_REDIS_KV_REST_API_URL;
  const tokenViejo=process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  process.env.UPSTASH_REDIS_KV_REST_API_URL="https://redis-bloqueo-test.invalid";
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN="ficticio";
  t.after(()=>{globalThis.fetch=previo;
    if(urlVieja===undefined)delete process.env.UPSTASH_REDIS_KV_REST_API_URL;else process.env.UPSTASH_REDIS_KV_REST_API_URL=urlVieja;
    if(tokenViejo===undefined)delete process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;else process.env.UPSTASH_REDIS_KV_REST_API_TOKEN=tokenViejo;
  });
  const store=new Map<string,string>();
  globalThis.fetch=async(_input,init)=>{
    const [op,key,value,...args]=JSON.parse(String(init?.body)) as (string|number)[];
    if(op==="SET"){
      if(args.includes("NX")&&store.has(String(key)))return Response.json({result:null});
      store.set(String(key),String(value));return Response.json({result:"OK"});
    }
    if(op==="EVAL"){
      const data=JSON.parse(String(init?.body)) as (string|number)[];
      const lock=String(data[3]),owner=String(data[4]);
      if(store.get(lock)===owner){store.delete(lock);return Response.json({result:1});}
      return Response.json({result:0});
    }
    throw new Error("Comando no esperado "+op);
  };
  const token="z".repeat(43);
  const uno=await bloquearActivacion(token);
  assert.match(uno??"",/^[a-f0-9]{32}$/);
  assert.equal(await bloquearActivacion(token),null);
  await liberarBloqueoActivacion(token,"0".repeat(32));
  assert.equal(await bloquearActivacion(token),null);
  await liberarBloqueoActivacion(token,uno!);
  assert.ok(await bloquearActivacion(token));
});

test("limpieza de invitación: solo borra empleado aún inactivo de la empresa y email correctos", async (t) => {
  const previo=globalThis.fetch;
  const vars=["AIRTABLE_USERS_BASE_ID","AIRTABLE_USERS_TABLE_ID","AIRTABLE_TOKEN"] as const;
  const originales=vars.map(k=>process.env[k]);
  process.env.AIRTABLE_USERS_BASE_ID="appTest";
  process.env.AIRTABLE_USERS_TABLE_ID="tblUsuarios";
  process.env.AIRTABLE_TOKEN="ficticio";
  t.after(()=>{globalThis.fetch=previo;vars.forEach((k,i)=>{
    if(originales[i]===undefined)delete process.env[k];else process.env[k]=originales[i];
  })});
  let activo=false;
  let borrados=0;
  globalThis.fetch=async (input,init)=>{
    const path=new URL(String(input)).pathname;
    if(!path.endsWith("/"+id))throw new Error("Ruta de test inesperada");
    if(init?.method==="GET")return Response.json({id,fields:{ACTIVO:activo,Email:"test@example.org",EMPRESA:[empresa]}});
    if(init?.method==="DELETE"){borrados++;return Response.json({id,deleted:true});}
    throw new Error("Método inesperado");
  };
  assert.equal(await retirarUsuarioPendiente(id,empresa,"otro@example.org"),false);
  activo=true;
  assert.equal(await retirarUsuarioPendiente(id,empresa,"test@example.org"),false);
  activo=false;
  assert.equal(await retirarUsuarioPendiente(id,empresa,"test@example.org"),true);
  assert.equal(borrados,1);
});
