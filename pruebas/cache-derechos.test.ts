/** Tarea 6: caché de derechos resueltos. Se prueba sobre todo lo que NO debe pasar. */
import test from "node:test";
import assert from "node:assert/strict";
import { autorizarConCache, claveDerecho, huellaContexto, jsonCanonico,
  claveGeneracionEmpresa, type AlmacenDerechos, type PeticionDerecho } from "../core/cache-derechos.js";
import { crearAlmacenDerechosRedis } from "../lib/almacen-derechos-redis.js";
import type { ContextoCore } from "../core/seguridad.js";

const EK = "emp_s84ng12hqeq1", USR = "rec" + "U".repeat(14), SUC = "rec" + "S".repeat(14);
const ctx = (cambios: Record<string, unknown> = {}): ContextoCore => ({
  usuarioId: USR, activo: true,
  empresa: { id: "rec" + "E".repeat(14), activa: true, idEstable: EK, nombre: "X" },
  sucursalesAutorizadas: [{ id: SUC, empresaId: "rec" + "E".repeat(14), nombre: "Central", activa: true }],
  modulosEmpresa: ["INVENTARIO"], modulosUsuario: ["INVENTARIO"], permisos: ["inventario.ver"], ...cambios,
} as any);
const peticion = (c: ContextoCore = ctx(), extra: Partial<PeticionDerecho> = {}): PeticionDerecho => ({
  contexto: c, capacidad: "inventario.productos.consultar", modulo: "INVENTARIO", permiso: "inventario.ver",
  recurso: { empresaId: c.empresa.id, sucursalId: SUC }, ...extra });

function almacenEnMemoria(fallos: Partial<Record<keyof AlmacenDerechos, boolean>> = {}) {
  const claves = new Map<string, number>(); const gen = new Map<string, number>(); const ops: string[] = [];
  const a: AlmacenDerechos = {
    async leerGeneracion(e) { ops.push("gen"); if (fallos.leerGeneracion) throw Error("x"); return gen.get(e) ?? 0; },
    async existe(k) { ops.push("existe"); if (fallos.existe) throw Error("x"); return claves.has(k); },
    async guardar(k, ttl) { ops.push("guardar"); if (fallos.guardar) throw Error("x"); claves.set(k, ttl); },
    async invalidarEmpresa(e) { gen.set(e, (gen.get(e) ?? 0) + 1); },
  };
  return { a, claves, ops };
}
const contador = (resultado: boolean) => { let n = 0; return { f: async () => { n++; return resultado; }, n: () => n }; };

test("caché: primer pedido calcula y guarda; el segundo sale de la caché sin recalcular", async () => {
  const m = almacenEnMemoria(); const c = contador(true);
  assert.equal(await autorizarConCache(peticion(), m.a, "preview", c.f), true);
  assert.equal(await autorizarConCache(peticion(), m.a, "preview", c.f), true);
  assert.equal(c.n(), 1); assert.equal(m.claves.size, 1);
  assert.equal([...m.claves.values()][0], 60);
});
test("caché: una denegación NUNCA se guarda y siempre se recalcula", async () => {
  const m = almacenEnMemoria(); const c = contador(false);
  assert.equal(await autorizarConCache(peticion(), m.a, "preview", c.f), false);
  assert.equal(await autorizarConCache(peticion(), m.a, "preview", c.f), false);
  assert.equal(c.n(), 2); assert.equal(m.claves.size, 0);
});
test("caché: si cambia cualquier dato del contexto (permisos, módulos, sucursales, estado) NO hay acierto", async () => {
  const m = almacenEnMemoria(); const c = contador(true);
  await autorizarConCache(peticion(), m.a, "preview", c.f);
  const variantes = [ctx({ permisos: [] }), ctx({ modulosUsuario: [] }), ctx({ modulosEmpresa: ["REPORTES"] }),
    ctx({ sucursalesAutorizadas: [] }), ctx({ activo: false }),
    ctx({ empresa: { id: "rec" + "E".repeat(14), activa: false, idEstable: EK, nombre: "X" } })];
  for (const v of variantes) await autorizarConCache(peticion(v), m.a, "preview", c.f);
  assert.equal(c.n(), 1 + variantes.length); // cada variante tuvo que calcular de nuevo
});
test("caché: otro usuario, otra capacidad, otra sucursal u otro permiso no comparten apunte", () => {
  const base = claveDerecho("preview", 0, peticion());
  assert.notEqual(base, claveDerecho("preview", 0, peticion(ctx({ usuarioId: "rec" + "V".repeat(14) }))));
  assert.notEqual(base, claveDerecho("preview", 0, peticion(ctx(), { capacidad: "inventario.productos.crear" })));
  assert.notEqual(base, claveDerecho("preview", 0, peticion(ctx(), { recurso: { empresaId: "x", sucursalId: "rec" + "T".repeat(14) } })));
  assert.notEqual(base, claveDerecho("preview", 0, peticion(ctx(), { permiso: "inventario.editar" })));
});
test("caché: preview y production no comparten claves", () => {
  assert.notEqual(claveDerecho("preview", 0, peticion()), claveDerecho("production", 0, peticion()));
  assert.notEqual(claveGeneracionEmpresa("preview", EK), claveGeneracionEmpresa("production", EK));
});
test("caché: invalidar la empresa (suspender/cancelar/renovar) deja sin efecto TODOS los apuntes al instante", async () => {
  const m = almacenEnMemoria(); const c = contador(true);
  await autorizarConCache(peticion(), m.a, "preview", c.f);
  await autorizarConCache(peticion(), m.a, "preview", c.f);
  assert.equal(c.n(), 1);
  await m.a.invalidarEmpresa(EK);
  await autorizarConCache(peticion(), m.a, "preview", c.f);
  assert.equal(c.n(), 2);
});
test("caché: si la empresa suspendida pasa a denegar, deja de conceder inmediatamente tras invalidar", async () => {
  const m = almacenEnMemoria(); let permitido = true;
  const f = async () => permitido;
  assert.equal(await autorizarConCache(peticion(), m.a, "preview", f), true);
  permitido = false; await m.a.invalidarEmpresa(EK);
  assert.equal(await autorizarConCache(peticion(), m.a, "preview", f), false);
});
test("caché: si Redis falla al leer, la caché NUNCA concede: evalúa completo (y deniega si corresponde)", async () => {
  for (const fallo of ["leerGeneracion", "existe"] as const) {
    const m = almacenEnMemoria({ [fallo]: true }); const c = contador(false);
    assert.equal(await autorizarConCache(peticion(), m.a, "preview", c.f), false);
    assert.equal(c.n(), 1);
  }
});
test("caché: si Redis falla al guardar, el resultado verificado igual se devuelve", async () => {
  const m = almacenEnMemoria({ guardar: true });
  assert.equal(await autorizarConCache(peticion(), m.a, "preview", contador(true).f), true);
});
test("caché: sin ID estable válido ni toca Redis y deja que el cálculo completo decida", async () => {
  const m = almacenEnMemoria(); const c = contador(false);
  const sin = ctx({ empresa: { id: "rec" + "E".repeat(14), activa: true, nombre: "X" } });
  assert.equal(await autorizarConCache(peticion(sin), m.a, "preview", c.f), false);
  assert.deepEqual(m.ops, []); assert.equal(c.n(), 1);
});
test("caché: componentes de clave inválidos (inyección) no producen clave", () => {
  assert.throws(() => claveDerecho("preview", 0, peticion(ctx(), { capacidad: "a b" })));
  assert.throws(() => claveDerecho("preview", 0, peticion(ctx(), { permiso: "x*" })));
  assert.throws(() => claveDerecho("prev iew", 0, peticion()));
  assert.throws(() => claveDerecho("preview", -1, peticion()));
  assert.throws(() => claveDerecho("preview", 0, peticion(ctx({ usuarioId: "usuario*" }))));
});
test("huella: es estable ante el orden de las claves y cambia ante cualquier dato", () => {
  assert.equal(jsonCanonico({ b: 1, a: [2, { d: 1, c: 2 }] }), jsonCanonico({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(huellaContexto(ctx()), huellaContexto(ctx()));
  assert.notEqual(huellaContexto(ctx()), huellaContexto(ctx({ permisos: ["inventario.ver", "x"] })));
});
test("redis: comandos exactos (GET gen, EXISTS, SET EX, INCR) y fallos propagados", async () => {
  const comandos: Array<Array<string | number>> = []; let respuesta: unknown = null;
  const a = crearAlmacenDerechosRedis("preview", async (c) => { comandos.push(c); return respuesta; });
  assert.equal(await a.leerGeneracion(EK), 0);
  respuesta = "3"; assert.equal(await a.leerGeneracion(EK), 3);
  respuesta = 1; assert.equal(await a.existe("k"), true);
  respuesta = 0; assert.equal(await a.existe("k"), false);
  respuesta = "OK"; await a.guardar("k", 60);
  respuesta = 4; await a.invalidarEmpresa(EK);
  assert.deepEqual(comandos.at(-2), ["SET", "k", "1", "EX", 60]);
  assert.deepEqual(comandos.at(-1), ["INCR", `optima:preview:derechos:gen:${EK}`]);
  respuesta = "NO"; await assert.rejects(a.guardar("k", 60));
  respuesta = 0; await assert.rejects(a.invalidarEmpresa(EK));
  respuesta = "abc"; await assert.rejects(a.leerGeneracion(EK));
  await assert.rejects(a.invalidarEmpresa("recAAAAAAAAAAAAAA"));
});
