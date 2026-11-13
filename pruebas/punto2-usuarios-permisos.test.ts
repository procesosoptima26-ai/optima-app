/** Punto 2: pruebas de seguridad aisladas. NUNCA usan credenciales reales. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { validarSolicitudEstado, reactivacionValida, gestionEstadoHabilitada, proyectarEstadoEmpleado } from "../core/estado-usuarios.js";
import { leerEmpleadoEditable } from "../core/edicion-usuarios.js";
import { ejecutarOperacionCoreAuditada } from "../lib/auditoria-core-transversal.js";
import { snapshotAccesosEmpleado } from "../core/snapshots-auditoria-core.js";
import estado from "../handlers/usuarios/estado.js";

const ID = (v: string) => `rec${v.repeat(14)}`;
const EMPRESA = ID("C");
const SUCURSAL = ID("D");
const ADMIN = ID("A");
const EMPLEADO = ID("B");
const TOKEN = "s".repeat(43);
const VERSION = "f".repeat(64);
const solicitud = (activo: boolean) => ({
  id: EMPLEADO, activo, version: VERSION,
  motivo: "Actualización autorizada de estado del empleado",
});

function response() {
  const estadoRes = { status: 200, body: null as unknown };
  const res = { setHeader() { return this; },
    status(n: number) { estadoRes.status = n; return this; },
    json(d: unknown) { estadoRes.body = d; return this; } } as unknown as VercelResponse;
  return { estadoRes, res };
}

test("P2: exige ID, versión, booleano y motivo claro", () => {
  assert.equal(validarSolicitudEstado(solicitud(false)).ok, true);
  for (const valor of [
    null, [], {},
    { ...solicitud(false), id: "recNO_ES_VALIDO" },
    { ...solicitud(false), version: "x".repeat(64) },
    { ...solicitud(false), activo: "false" },
    { ...solicitud(false), motivo: "corto" },
    { ...solicitud(false), motivo: "a".repeat(501) },
  ]) assert.equal(validarSolicitudEstado(valor).ok, false);
  const v = validarSolicitudEstado({ ...solicitud(false), motivo: "  Se revocan accesos de empleado  " });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.datos.motivo, "Se revocan accesos de empleado");
});

test("P2: no reactiva invitaciones sin contraseña validada", () => {
  assert.equal(reactivacionValida({}), false);
  assert.equal(reactivacionValida({ PASSWORD_HASH: "" }), false);
  assert.equal(reactivacionValida({ PASSWORD_HASH: "contraseña" }), false);
  assert.equal(reactivacionValida({ PASSWORD_HASH: "$argon2i$abc" }), false);
  assert.equal(reactivacionValida({ PASSWORD_HASH: "$argon2id$v=19$m=65536,t=3,p=4$sal$hash" }), true);
});

test("P2: cambiar estados requiere cuatro condiciones de servidor, nunca del navegador", () => {
  const flags = {
    OPTIMA_USERS_STATUS_ENABLED: "true",
    OPTIMA_CORE_AUDIT_ENFORCE_ENABLED: "true",
    OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED: "true",
    OPTIMA_AUDIT_WRITES_ENABLED: "true",
  };
  assert.equal(gestionEstadoHabilitada({}), false);
  for (const clave of Object.keys(flags)) {
    const combinacion = { ...flags, [clave]: "false" };
    assert.equal(gestionEstadoHabilitada(combinacion), false, clave);
  }
  assert.equal(gestionEstadoHabilitada(flags), true);
});

test("P2: un administrador no edita su propia cuenta, otro ADMIN o empresa ajena", () => {
  const opciones = { sucursales: [{ id: SUCURSAL, nombre: "Goya" }],
    modulos: [{ id: "CORE" as const, opcionAirtable: "USUARIO" }],
    permisos: [{ id: "usuarios.ver" as const, campo: "PERMISOS_USUARIOS", opcionAirtable: "VER" }],
  };
  const crear = (id: string, empresa = EMPRESA, rol = "USUARIO") => ({
    id, fields: { USUARIO: "EMPLEADO", NOMBRE: "Empleado", EMPRESA: [empresa],
      ROL: rol, ACTIVO: true, SUCURSALES_AUTORIZADAS: [SUCURSAL],
      SUCURSAL_PREDETERMINADA: [SUCURSAL], MODULOS: ["USUARIO"],
      PERMISOS_USUARIOS: ["VER"],
    },
  });
  assert.equal(leerEmpleadoEditable(crear(EMPLEADO), EMPRESA, ADMIN, opciones)?.activo, true);
  assert.equal(leerEmpleadoEditable(crear(ADMIN), EMPRESA, ADMIN, opciones), null);
  assert.equal(leerEmpleadoEditable(crear(EMPLEADO, ID("E")), EMPRESA, ADMIN, opciones), null);
  assert.equal(leerEmpleadoEditable(crear(EMPLEADO, EMPRESA, "ADMIN"), EMPRESA, ADMIN, opciones), null);
});

test("P2: no existe una ruta pública de escritura sin una sesión", async () => {
  for (const method of ["GET", "POST"]) {
    const r = response();
    await estado({ method, cookies: {}, body: solicitud(false) } as unknown as VercelRequest, r.res);
    assert.equal(r.estadoRes.status, 401);
  }
  const r = response();
  await estado({ method: "DELETE", cookies: {} } as unknown as VercelRequest, r.res);
  assert.equal(r.estadoRes.status, 405);
});

test("P2: admin autenticado ve bloqueo preventivo; nunca escribe con auditoría apagada", async t => {
  const originalFetch = globalThis.fetch;
  const vars: Record<string, string> = {
    AIRTABLE_USERS_BASE_ID: "appPrueba", AIRTABLE_USERS_TABLE_ID: "tblUsuarios",
    AIRTABLE_COMPANIES_TABLE_ID: "tblEmpresas", AIRTABLE_SUCURSALES_TABLE_ID: "tblSucursales",
    AIRTABLE_TOKEN: "ficticio", UPSTASH_REDIS_KV_REST_API_URL: "https://redis-p2.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN: "ficticio", OPTIMA_USERS_STATUS_ENABLED: "false",
  };
  const anteriores = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(anteriores)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  const adminCampos = { USUARIO: "ADMIN_PRUEBA", ROL: "ADMIN", ACTIVO: true,
    EMPRESA: [EMPRESA], MODULOS: ["USUARIO"],
    SUCURSALES_AUTORIZADAS: [SUCURSAL], SUCURSAL_PREDETERMINADA: [SUCURSAL],
    PERMISOS_USUARIOS: ["VER", "GESTIONAR USUARIOS"],
  };
  let mutaciones = 0;
  globalThis.fetch = async (input, opts) => {
    const url = new URL(String(input));
    if (url.hostname === "redis-p2.invalid") {
      const [accion, clave] = JSON.parse(String(opts?.body)) as string[];
      assert.equal(accion, "GET");
      const sesion = "optima:sesion:" + createHash("sha256").update(TOKEN).digest("hex");
      return Response.json({ result: clave === sesion ? JSON.stringify({ usuarioId: ADMIN, versionSesion: 0 }) : null });
    }
    assert.equal(url.hostname, "api.airtable.com");
    if ((opts?.method ?? "GET") !== "GET") { mutaciones++; throw new Error("Escritura prohibida en esta prueba"); }
    if (url.pathname.endsWith("/tblUsuarios/" + ADMIN)) return Response.json({ id: ADMIN, fields: adminCampos });
    if (url.pathname.endsWith("/tblEmpresas/" + EMPRESA)) return Response.json({ id: EMPRESA,
      fields: { ACTIVA: true, CLAVE_EMPRESA: "PRUEBA", MODULOS_CONTRATADOS: ["USUARIO"] } });
    if (url.pathname.endsWith("/tblSucursales/" + SUCURSAL)) return Response.json({ id: SUCURSAL,
      fields: { ACTIVA: true, EMPRESA: [EMPRESA], NOMBRE: "Sucursal" } });
    throw new Error("Solicitud no simulada: " + url.pathname);
  };
  const req = (method: string, body?: unknown) => ({ method, body,
    cookies: { optima_sesion: TOKEN } } as unknown as VercelRequest);
  let r = response(); await estado(req("GET"), r.res);
  assert.equal(r.estadoRes.status, 200);
  assert.equal((r.estadoRes.body as { habilitado: boolean }).habilitado, false);
  r = response(); await estado(req("POST", solicitud(false)), r.res);
  assert.equal(r.estadoRes.status, 503);
  assert.equal(mutaciones, 0);
});

test("P2: auditoría admite las nuevas acciones sin persistir nada en servicios externos", async () => {
  const anteriores = Object.fromEntries([
    "OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED", "OPTIMA_CORE_AUDIT_ENFORCE_ENABLED",
  ].map(k => [k, process.env[k]]));
  process.env.OPTIMA_CORE_AUDIT_GLOBAL_GATE_ENABLED = "false";
  process.env.OPTIMA_CORE_AUDIT_ENFORCE_ENABLED = "false";
  try {
    const eventos: string[] = [];
    for (const accion of ["USUARIO_ACTIVAR", "USUARIO_DESACTIVAR"] as const) {
      let escrito = false;
      const anterior = { ACTIVA: accion === "USUARIO_DESACTIVAR" };
      const propuesto = { ACTIVA: accion === "USUARIO_ACTIVAR" };
      const r = await ejecutarOperacionCoreAuditada({ actorId: ADMIN, empresaId: EMPRESA,
        empresaNombre: "EMPRESA PRUEBA", accion, recursoTipo: "USUARIO", recursoId: EMPLEADO,
        motivo: "Actualización autorizada del estado de la cuenta",
        anterior, propuesto,
        escribir: async () => { escrito = true; },
        releer: async () => ({ estado: escrito ? propuesto : anterior, dato: { confirmado: true } }),
        registrar: async (evento) => { eventos.push(evento.resultado);
          return { eventoId: "ev-prueba", operacionId: evento.operacionId, registroId: ID("Z") }; },
      });
      assert.equal(r.dato.confirmado, true);
    }
    assert.deepEqual(eventos, ["INTENTO", "CONFIRMADO", "INTENTO", "CONFIRMADO"]);
  } finally {
    for (const [k, v] of Object.entries(anteriores)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("P2: auditoría proyecta VERSION nueva y confirma el estado releído de Airtable", () => {
  const opciones = {
    sucursales: [{ id: SUCURSAL, nombre: "Goya" }],
    modulos: [{ id: "CORE" as const, opcionAirtable: "USUARIO" }],
    permisos: [{ id: "usuarios.ver" as const, campo: "PERMISOS_USUARIOS", opcionAirtable: "VER" }],
  };
  const registro = { id: EMPLEADO, fields: {
    EMPRESA: [EMPRESA], ROL: "USUARIO", ACTIVO: true,
    USUARIO: "PRUEBA", NOMBRE: "Empleado", MODULOS: ["USUARIO"],
    SUCURSALES_AUTORIZADAS: [SUCURSAL], SUCURSAL_PREDETERMINADA: [SUCURSAL],
    PERMISOS_USUARIOS: ["VER"],
  } };
  const previo = leerEmpleadoEditable(registro, EMPRESA, ADMIN, opciones);
  assert.ok(previo);
  const propuesto = proyectarEstadoEmpleado(registro, previo, false);
  const releido = leerEmpleadoEditable({ ...registro, fields: { ...registro.fields, ACTIVO: false } },
    EMPRESA, ADMIN, opciones);
  assert.ok(releido);
  assert.notEqual(propuesto.version, previo.version);
  assert.deepEqual(snapshotAccesosEmpleado(propuesto), snapshotAccesosEmpleado(releido));
  const restaurado = proyectarEstadoEmpleado({ ...registro, fields: { ...registro.fields, ACTIVO: false } },
    releido, true);
  assert.deepEqual(snapshotAccesosEmpleado(restaurado), snapshotAccesosEmpleado(previo));
});
