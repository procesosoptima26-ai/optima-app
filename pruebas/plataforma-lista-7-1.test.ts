import test from "node:test";
import assert from "node:assert/strict";
import { listarCuentasPlataforma, esCuentaPlataformaConfigurada } from "../core/acceso-plataforma.js";

const A = "recAAAAAAAAAAAAAA", B = "recBBBBBBBBBBBBBB", C = "recCCCCCCCCCCCCCC", D = "recDDDDDDDDDDDDDD";
test("un solo ID sigue funcionando", () => assert.deepEqual(listarCuentasPlataforma(A), [A]));
test("hasta 3 IDs, con espacios", () => assert.deepEqual(listarCuentasPlataforma(`${A}, ${B} ,${C}`), [A, B, C]));
test("4 IDs, vacío, repetido o inválido fallan cerrado", () => {
  for (const v of [`${A},${B},${C},${D}`, "", undefined, `${A},`, `${A},${A}`, `${A},recmal`, `,${A}`])
    assert.deepEqual(listarCuentasPlataforma(v as string | undefined), [], String(v));
});
test("esCuentaPlataformaConfigurada acepta solo los listados", () => {
  const prev = process.env.OPTIMA_PLATFORM_ADMIN_USER_ID;
  try {
    process.env.OPTIMA_PLATFORM_ADMIN_USER_ID = `${A},${B}`;
    assert.equal(esCuentaPlataformaConfigurada(A), true);
    assert.equal(esCuentaPlataformaConfigurada(B), true);
    assert.equal(esCuentaPlataformaConfigurada(C), false);
    process.env.OPTIMA_PLATFORM_ADMIN_USER_ID = `${A},malo`;
    assert.equal(esCuentaPlataformaConfigurada(A), false);
  } finally {
    if (prev === undefined) delete process.env.OPTIMA_PLATFORM_ADMIN_USER_ID; else process.env.OPTIMA_PLATFORM_ADMIN_USER_ID = prev;
  }
});
