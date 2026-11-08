import assert from "node:assert/strict";
import { test } from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { crearConsultaComercial, type DependenciasConsultaComercial } from "../handlers/core/consulta-comercial.js";
import type { ResultadoConsultaContrataciones } from "../core/consulta-contrataciones-airtable.js";

const clienteId = "rec" + "C".repeat(14);
const plataformaId = "rec" + "P".repeat(14);
const otroId = "rec" + "D".repeat(14);
const contrato = {
  registroId: "rec" + "R".repeat(14), empresaId: clienteId,
  idContrato: "CTR-001", idVersion: "CTR-001-v1", version: 1,
  vigenteDesde: "2026-11-01T00:00:00.000Z", vigenteHasta: null,
  aprobadoPorId: "rec" + "A".repeat(14),
  fechaAprobacion: "2026-10-30T00:00:00.000Z",
  condicionesEconomicas: '{"importePrivado":999999}',
  servicios: [{ modalidad: "MODULO_PRINCIPAL" as const, modulo: "INVENTARIO" as const, nivel: "PREMIUM" as const }],
};

type Control = {
  sesion: boolean;
  admin: boolean;
  existe: boolean;
  resultado: ResultadoConsultaContrataciones;
  llamadas: { autenticar: number; empresa: number; contrato: number };
};
function preparar() {
  const c: Control = {
    sesion: true, admin: true, existe: true,
    resultado: { ok: true, contratacion: contrato },
    llamadas: { autenticar: 0, empresa: 0, contrato: 0 },
  };
  const deps: DependenciasConsultaComercial = {
    async autenticar() {
      c.llamadas.autenticar++;
      if (!c.sesion) return { estado: "SIN_SESION" };
      if (!c.admin) return { estado: "NO_AUTORIZADO" };
      return { estado: "OK", empresaPlataformaId: plataformaId };
    },
    async buscarEmpresa(id) {
      c.llamadas.empresa++;
      return c.existe ? { id, nombre: "Empresa ficticia" } : null;
    },
    async buscarContrato() { c.llamadas.contrato++; return c.resultado; },
  };
  const handler = crearConsultaComercial(deps);
  async function pedir(method = "GET", query: Record<string, unknown> = { empresaId: clienteId }) {
    let status = 200; let json: any; const headers: Record<string, string> = {};
    const req = { method, query } as unknown as VercelRequest;
    const res = {
      setHeader(k: string, v: string) { headers[k] = v; return this; },
      status(n: number) { status = n; return this; },
      json(data: unknown) { json = data; return this; },
    } as unknown as VercelResponse;
    await handler(req, res);
    return { status, json, headers };
  }
  return { c, pedir };
}

test("12C.15.2: consulta válida solo muestra servicios y versión, sin precios ni permisos", async () => {
  const { pedir, c } = preparar();
  const r = await pedir();
  assert.equal(r.status, 200);
  assert.equal(r.json.estado, "VIGENTE");
  assert.equal(r.json.empresa.id, clienteId);
  assert.equal(r.json.contrato.version, 1);
  assert.equal(r.json.contrato.servicios.length, 1);
  assert.equal(r.json.soloConsulta, true);
  assert.equal(r.json.accesoOperativoHabilitado, false);
  assert.equal(JSON.stringify(r.json).includes("999999"), false);
  assert.equal(JSON.stringify(r.json).includes("aprobadoPorId"), false);
  assert.deepEqual(c.llamadas, { autenticar: 1, empresa: 1, contrato: 1 });
  assert.equal(r.headers["Cache-Control"], "no-store");
});

test("12C.15.2: registro inexistente se informa como sin contrato, sin bloquear operaciones", async () => {
  const { pedir, c } = preparar();
  c.resultado = { ok: false, motivo: "SIN_CONTRATO" };
  const r = await pedir();
  assert.equal(r.status, 200);
  assert.equal(r.json.estado, "SIN_CONTRATO");
  assert.equal(r.json.contrato, null);
  assert.equal(r.json.accesoOperativoHabilitado, false);
});

test("12C.15.2: versiones históricas se informan sin vigencia", async () => {
  const { pedir, c } = preparar();
  c.resultado = { ok: false, motivo: "NO_VIGENTE" };
  const r = await pedir();
  assert.equal(r.status, 200);
  assert.equal(r.json.estado, "NO_VIGENTE");
});

test("12C.15.2: usuario sin sesión nunca consulta empresa ni contrato", async () => {
  const { pedir, c } = preparar();
  c.sesion = false;
  const r = await pedir();
  assert.equal(r.status, 401);
  assert.equal(c.llamadas.empresa, 0);
  assert.equal(c.llamadas.contrato, 0);
});

test("12C.15.2: ADMIN de cliente no es administrador global", async () => {
  const { pedir, c } = preparar();
  c.admin = false;
  const r = await pedir();
  assert.equal(r.status, 403);
  assert.equal(c.llamadas.contrato, 0);
});

test("12C.15.2: los métodos de escritura se rechazan sin consultas", async () => {
  for (const metodo of ["POST", "PATCH", "PUT", "DELETE"]) {
    const { pedir, c } = preparar();
    assert.equal((await pedir(metodo)).status, 405);
    assert.deepEqual(c.llamadas, { autenticar: 0, empresa: 0, contrato: 0 });
  }
});

test("12C.15.2: ID empresa inválido no consulta otras tablas", async () => {
  const { pedir, c } = preparar();
  assert.equal((await pedir("GET", { empresaId: "inventado" })).status, 400);
  assert.equal(c.llamadas.empresa, 0);
});

test("12C.15.2: no se admiten identificadores de empresa en formato array", async () => {
  const { pedir, c } = preparar();
  assert.equal((await pedir("GET", { empresaId: [clienteId, otroId] })).status, 400);
  assert.equal(c.llamadas.empresa, 0);
});

test("12C.15.2: no permite consultar a la propia empresa de plataforma", async () => {
  const { pedir, c } = preparar();
  assert.equal((await pedir("GET", { empresaId: plataformaId })).status, 400);
  assert.equal(c.llamadas.empresa, 0);
});

test("12C.15.2: impide parámetros desconocidos", async () => {
  const { pedir, c } = preparar();
  assert.equal((await pedir("GET", { empresaId: clienteId, usuarioId: otroId })).status, 400);
  assert.equal(c.llamadas.contrato, 0);
});

test("12C.15.2: rechaza acción de ruta distinta", async () => {
  const { pedir, c } = preparar();
  assert.equal((await pedir("GET", { empresaId: clienteId, accion: "gestion_modulos" })).status, 400);
  assert.equal(c.llamadas.contrato, 0);
});

test("12C.15.2: empresa desconocida no permite leer contrataciones", async () => {
  const { pedir, c } = preparar();
  c.existe = false;
  assert.equal((await pedir()).status, 404);
  assert.equal(c.llamadas.contrato, 0);
});

test("12C.15.2: contratos incompatibles no se muestran como vigentes", async () => {
  const { pedir, c } = preparar();
  c.resultado = { ok: false, motivo: "INCONSISTENTE" };
  const r = await pedir();
  assert.equal(r.status, 503);
  assert.equal(JSON.stringify(r.json).includes("999999"), false);
});

test("12C.15.2: error de red no filtra secretos", async () => {
  let autenticar = 0;
  const h = crearConsultaComercial({
    async autenticar() { autenticar++; return { estado: "OK", empresaPlataformaId: plataformaId }; },
    async buscarEmpresa() { throw new Error("TOKEN_SECRETO_FICTICIO"); },
    async buscarContrato() { throw new Error("NO_DEBE_OCURRIR"); },
  });
  const req = { method: "GET", query: { empresaId: clienteId } } as unknown as VercelRequest;
  let status = 0; let body: any;
  const res = { setHeader() { return this; }, status(n: number) { status = n; return this; }, json(v: unknown) { body = v; return this; } } as unknown as VercelResponse;
  await h(req, res);
  assert.equal(autenticar, 1);
  assert.equal(status, 503);
  assert.equal(JSON.stringify(body).includes("TOKEN_SECRETO"), false);
});

test("12C.15.2: rechaza una respuesta de contrato para empresa ajena", async () => {
  const { pedir, c } = preparar();
  c.resultado = { ok: true, contratacion: { ...contrato, empresaId: otroId } };
  const r = await pedir();
  assert.equal(r.status, 503);
  assert.equal(JSON.stringify(r.json).includes(otroId), false);
});
