import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import listar, { usuarioParaListado } from "../handlers/usuarios/listar.js";

const adminId = `rec${"A".repeat(14)}`;
const otroId = `rec${"B".repeat(14)}`;
const empresaId = `rec${"C".repeat(14)}`;
const empresaAjena = `rec${"D".repeat(14)}`;
const sucursalId = `rec${"E".repeat(14)}`;
const tokenSesion = "s".repeat(43);
function respuesta() {
  const estado = { status: 200, body: null as unknown };
  const res = { setHeader(){return this}, status(n:number){estado.status=n;return this},
    json(v:unknown){estado.body=v;return this} } as unknown as VercelResponse;
  return { estado, res };
}

test("Paso 10A: lista solo usuarios de la empresa, pagina y nunca expone hashes", async (t) => {
  const anterior = globalThis.fetch;
  const vars: Record<string,string> = {
    AIRTABLE_USERS_BASE_ID: "appPrueba", AIRTABLE_USERS_TABLE_ID: "tblUsuarios", AIRTABLE_TOKEN: "ficticio",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresas", AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursales",
    UPSTASH_REDIS_KV_REST_API_URL: "https://redis-listar.invalid", UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio",
  };
  const previos = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => { globalThis.fetch = anterior;
    for (const [k,v] of Object.entries(previos)) { if (v===undefined) delete process.env[k]; else process.env[k]=v; }
  });
  const admin = {
    USUARIO: "ADMIN_PRUEBA", NOMBRE: "Administrador", ROL: "ADMIN", ACTIVO: true,
    EMPRESA: [empresaId], MODULOS: ["USUARIO"],
    SUCURSALES_AUTORIZADAS: [sucursalId], SUCURSAL_PREDETERMINADA: [sucursalId],
    PERMISOS_USUARIOS: ["VER", "GESTIONAR USUARIOS"],
  };
  let paginas = 0;
  let rol: string = "ADMIN";
  globalThis.fetch = async (entrada, opciones) => {
    const url = new URL(String(entrada));
    if (url.hostname === "redis-listar.invalid") {
      const [op, key] = JSON.parse(String(opciones?.body)) as string[];
      assert.equal(op, "GET");
      const sesion = "optima:sesion:" + createHash("sha256").update(tokenSesion).digest("hex");
      return Response.json({ result: key === sesion ? JSON.stringify({usuarioId:adminId,versionSesion:0}) : null });
    }
    if (url.hostname === "api.airtable.com") {
      assert.equal(opciones?.method ?? "GET", "GET", "Paso 10A no escribe Airtable");
      if (url.pathname.endsWith("/tblUsuarios/" + adminId)) return Response.json({id:adminId,fields:{...admin,ROL:rol}});
      if (url.pathname.endsWith("/tblEmpresas/" + empresaId)) return Response.json({id:empresaId,fields:{
        ACTIVA:true,CLAVE_EMPRESA:"EMPRESA_PRUEBA",NOMBRE_COMERCIAL:"Prueba",MODULOS_CONTRATADOS:["USUARIO"],
      }});
      if (url.pathname.endsWith("/tblSucursales/" + sucursalId)) return Response.json({id:sucursalId,fields:{
        ACTIVA:true,EMPRESA:[empresaId],NOMBRE:"Sucursal segura",
      }});
      if (url.pathname.endsWith("/tblUsuarios")) {
        paginas++;
        assert.equal(url.searchParams.get("pageSize"),"100");
        assert.ok(url.searchParams.getAll("fields[]").includes("EMPRESA"));
        assert.ok(!url.searchParams.getAll("fields[]").includes("PASSWORD_HASH"));
        if (url.searchParams.get("offset") === "pagina-2") return Response.json({records:[
          {id:`rec${"F".repeat(14)}`,fields:{EMPRESA:[empresaId], USUARIO:"EMPLEADA",NOMBRE:"Empleada",ACTIVO:false,
            Email:"emp@example.org",ROL:"USUARIO",MODULOS:["USUARIO"],SUCURSALES_AUTORIZADAS:[sucursalId],
            PASSWORD_HASH:"NO_DEBE_SALIR"}},
        ]});
        return Response.json({offset:"pagina-2",records:[
          {id:adminId,fields:{...admin,PASSWORD_HASH:"NO_DEBE_SALIR"}},
          {id:otroId,fields:{...admin,EMPRESA:[empresaAjena],USUARIO:"OTRA_EMPRESA",PASSWORD_HASH:"NO_DEBE_SALIR"}},
          {id:`rec${"G".repeat(14)}`,fields:{...admin,EMPRESA:[empresaId,empresaAjena],USUARIO:"AMBIGUO"}},
        ]});
      }
    }
    throw new Error("Conexión simulada inesperada: " + url);
  };
  const req = {method:"GET",cookies:{optima_sesion:tokenSesion}} as unknown as VercelRequest;
  let r=respuesta(); await listar(req,r.res);
  assert.equal(r.estado.status,200);
  const cuerpo = r.estado.body as {ok:boolean;usuarios:Array<{usuario:string;email:string;activo:boolean;id:string}>};
  assert.equal(cuerpo.ok,true);
  assert.equal(paginas,2);
  assert.deepEqual(cuerpo.usuarios.map((u)=>u.usuario),["ADMIN_PRUEBA","EMPLEADA"]);
  assert.equal(cuerpo.usuarios[1].activo,false);
  assert.equal(cuerpo.usuarios[1].email,"emp@example.org");
  assert.ok(!JSON.stringify(cuerpo).includes("PASSWORD_HASH"));
  assert.ok(!JSON.stringify(cuerpo).includes("NO_DEBE_SALIR"));
  assert.ok(!JSON.stringify(cuerpo).includes("OTRA_EMPRESA"));
  rol="USUARIO";
  r=respuesta();await listar(req,r.res);
  assert.equal(r.estado.status,403,"empleado sin rol ADMIN no puede consultar");
});

test("Paso 10A: deniega sin sesión y métodos de escritura", async () => {
  let r=respuesta();
  await listar({method:"POST"} as VercelRequest,r.res);
  assert.equal(r.estado.status,405);
  r=respuesta();await listar({method:"GET",cookies:{}} as VercelRequest,r.res);
  assert.equal(r.estado.status,401);
  const empresaId=`rec${"H".repeat(14)}`;
  const u=usuarioParaListado({id:`rec${"I".repeat(14)}`,fields:{EMPRESA:[empresaId],USUARIO:"OK",PASSWORD_HASH:"secreto"}},
    empresaId, []);
  assert.equal(u?.usuario,"OK");
  assert.ok(!JSON.stringify(u).includes("secreto"));
});
