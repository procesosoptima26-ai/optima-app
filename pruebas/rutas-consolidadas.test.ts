import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import autenticacion from "../api/autenticacion.js";
import usuarios from "../api/usuarios.js";

type Resultado = { status: number; body: unknown };
function respuesta() {
  const estado: Resultado = {status: 200, body: null};
  const res = {
    setHeader() { return this; },
    status(n: number) { estado.status = n; return this; },
    json(v: unknown) { estado.body = v; return this; },
  } as unknown as VercelResponse;
  return {estado, res};
}

test("rutas consolidadas conservan los endpoints y menos de 12 funciones", () => {
  const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    rewrites: Array<{source: string;destination: string}>;
  };
  const src = cfg.rewrites.map((r) => r.source);
  for (const esperado of ["/api/login", "/api/logout", "/api/session", "/api/actividad", "/api/usuarios/:accion"]) {
    assert.ok(src.includes(esperado));
  }
  const ficheros = readdirSync("api", {withFileTypes: true})
    .filter((e) => e.isFile() && e.name.endsWith(".ts")).length;
  const administrativos = readdirSync("api/administracion", {withFileTypes: true})
    .filter((e) => e.isFile() && e.name.endsWith(".ts")).length;
  assert.equal(ficheros + administrativos, 10);
});

test("routers: rutas inexistentes fallan cerradas y cada accion conserva su metodo", async () => {
  const hacer = async (router: typeof autenticacion, accion: string, method: string) => {
    const r = respuesta();
    await router({method, query: {accion}} as unknown as VercelRequest, r.res);
    return r.estado.status;
  };
  assert.equal(await hacer(autenticacion, "desconocido", "GET"), 404);
  assert.equal(await hacer(usuarios, "desconocido", "GET"), 404);
  assert.equal(await hacer(autenticacion, "session", "POST"), 405);
  assert.equal(await hacer(autenticacion, "actividad", "GET"), 405);
  assert.equal(await hacer(autenticacion, "login", "GET"), 405);
  assert.equal(await hacer(autenticacion, "logout", "GET"), 405);
  assert.equal(await hacer(usuarios, "opciones", "POST"), 405);
  assert.equal(await hacer(usuarios, "invitar", "GET"), 405);
  assert.equal(await hacer(usuarios, "validar-invitacion", "GET"), 405);
  assert.equal(await hacer(usuarios, "activar", "GET"), 405);
});
