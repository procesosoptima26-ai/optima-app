import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGO_COMERCIAL_JERARQUICO } from "../core/catalogo-comercial-jerarquico.js";
import { MODULOS_COMERCIALES } from "../core/reglas-comerciales.js";
import {
  actualizarBorradorComercialLocal,
  crearBorradorComercialLocal,
  descartarBorradorComercialLocal,
  type ResultadoBorradorLocal,
  type BorradorContratacionLocal,
  type MotivoErrorBorrador,
} from "../core/borradores-contratacion-comercial-12c172.js";

const EMP = 'emp_'+'a'.repeat(12);
const OTRA = 'emp_'+'b'.repeat(12);
const T0 = "2026-11-10T13:00:00.000Z";
const T1 = "2026-11-10T14:00:00.000Z";
const T2 = "2026-11-10T15:00:00.000Z";
const IND = (submodulo: string, nivel: "ESTANDAR" | "PREMIUM" = "ESTANDAR") =>
  ({ modalidad: "SUBMODULO_INDEPENDIENTE" as const, submodulo, nivel });
const MOD = (modulo: (typeof MODULOS_COMERCIALES)[number], nivel: "ESENCIAL" | "GESTION" | "AVANZADO" | "PREMIUM" = "GESTION") =>
  ({ modalidad: "MODULO_PRINCIPAL" as const, modulo, nivel });

function datosNuevo() {
  return { idBorrador: "BOR-OPTIMA-001", empresaId: EMP, idContrato: null,
    versionBase: null, serviciosBase: [], serviciosPropuestos: [IND("CHEQUES")],
    motivoCambio: "Alta simulada de Cheques", ahoraIso: T0 };
}
function datosExistente() {
  return { ...datosNuevo(), idContrato: "CTR-OPTIMA-001", versionBase: 3,
    serviciosBase: [IND("CHEQUES")], serviciosPropuestos: [MOD("ADMINISTRACION")],
    motivoCambio: "Reemplazo por el módulo completo" };
}
function ok(resultado: ResultadoBorradorLocal): BorradorContratacionLocal {
  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  if (!resultado.ok) throw Error("No se creó el borrador");
  assert.equal(resultado.simulacion, true);
  assert.equal(resultado.accesoOperativoHabilitado, false);
  assert.equal(resultado.borrador.simulacion, true);
  assert.equal(resultado.borrador.accesoOperativoHabilitado, false);
  return resultado.borrador;
}
function error(resultado: ResultadoBorradorLocal, motivo: MotivoErrorBorrador) {
  assert.equal(resultado.ok, false, JSON.stringify(resultado));
  if (resultado.ok) throw Error("El borrador debería haber fallado");
  assert.equal(resultado.motivo, motivo);
  assert.ok(resultado.errores.length);
  assert.equal(resultado.accesoOperativoHabilitado, false);
  assert.equal("borrador" in resultado, false);
}
function creado() { return ok(crearBorradorComercialLocal(datosExistente())); }
function editar(borrador: BorradorContratacionLocal, serviciosPropuestos: unknown, extras: Record<string, unknown> = {}) {
  return actualizarBorradorComercialLocal({ borrador, empresaId: EMP,
    revisionEsperada: borrador.revisionLocal, versionBaseEsperada: borrador.versionBase,
    serviciosPropuestos, motivoCambio: "Actualización simulada del borrador", ahoraIso: T1, ...extras });
}

for (const ficha of CATALOGO_COMERCIAL_JERARQUICO) {
  test(`12C.17.2: borrador nuevo para ${ficha.id} sin activar accesos`, () => {
    const b = ok(crearBorradorComercialLocal({
      ...datosNuevo(), serviciosPropuestos: [IND(ficha.id, "PREMIUM")],
    }));
    assert.equal(b.estado, "BORRADOR");
    assert.equal(b.revisionLocal, 1);
    assert.equal(b.versionBase, null);
    assert.equal(b.idContrato, null);
    assert.equal(b.diferencias.length, 1);
    assert.equal(b.diferencias[0].tipo, "ALTA");
    assert.equal(b.diferencias[0].submodulo, ficha.id);
    assert.equal(b.serviciosPropuestos[0].modalidad, "SUBMODULO_INDEPENDIENTE");
  });
}

for (const modulo of MODULOS_COMERCIALES) {
  test(`12C.17.2: borrador de transición independiente -> ${modulo} completo`, () => {
    const hijo = CATALOGO_COMERCIAL_JERARQUICO.find(x => x.moduloPadre === modulo)!;
    const b = ok(crearBorradorComercialLocal({ ...datosExistente(),
      serviciosBase: [IND(hijo.id)], serviciosPropuestos: [MOD(modulo, "PREMIUM")],
    }));
    assert.equal(b.diferencias.filter(c => c.tipo === "CAMBIO_MODALIDAD").length, 1);
    assert.equal(b.diferencias.filter(c => c.tipo === "ALTA").length,
      CATALOGO_COMERCIAL_JERARQUICO.filter(x => x.moduloPadre === modulo).length - 1);
    assert.equal(b.diferencias.some(c => c.tipo === "BAJA"), false);
  });
}

test("12C.17.2: actualización conserva empresa, contrato, versión base e identidad", () => {
  const antes = creado();
  const despues = ok(editar(antes, [MOD("ADMINISTRACION", "PREMIUM")]));
  assert.equal(despues.idBorrador, antes.idBorrador);
  assert.equal(despues.empresaId, antes.empresaId);
  assert.equal(despues.idContrato, antes.idContrato);
  assert.equal(despues.versionBase, 3);
  assert.equal(despues.revisionLocal, 2);
  assert.equal(despues.creadoEnIso, T0);
  assert.equal(despues.actualizadoEnIso, T1);
  assert.equal(despues.diferencias.filter(x => x.tipo === "CAMBIO_MODALIDAD").length, 1);
});

test("12C.17.2: crear borrador es inmutable respecto del input", () => {
  const entrada = datosExistente();
  const b = ok(crearBorradorComercialLocal(entrada));
  entrada.serviciosBase.length = 0;
  entrada.serviciosPropuestos.length = 0;
  assert.equal(b.serviciosBase.length, 1);
  assert.equal(b.serviciosPropuestos.length, 1);
  assert.ok(Object.isFrozen(b));
  assert.ok(Object.isFrozen(b.serviciosBase));
  assert.ok(Object.isFrozen(b.serviciosPropuestos[0]));
});

test("12C.17.2: editar no muta la versión anterior", () => {
  const antes = creado();
  const despues = ok(editar(antes, [MOD("ADMINISTRACION", "PREMIUM")]));
  assert.equal(antes.revisionLocal, 1);
  assert.equal(antes.serviciosPropuestos[0].nivel, "GESTION");
  assert.equal(despues.serviciosPropuestos[0].nivel, "PREMIUM");
});

test("12C.17.2: descartar solo cambia estado local y revisión", () => {
  const antes = creado();
  const despues = ok(descartarBorradorComercialLocal({
    borrador: antes, empresaId: EMP, revisionEsperada: 1, ahoraIso: T1,
  }));
  assert.equal(antes.estado, "BORRADOR");
  assert.equal(despues.estado, "DESCARTADO_LOCAL");
  assert.equal(despues.revisionLocal, 2);
  assert.deepEqual(despues.serviciosBase, antes.serviciosBase);
  assert.deepEqual(despues.serviciosPropuestos, antes.serviciosPropuestos);
  assert.deepEqual(despues.diferencias, antes.diferencias);
});

test("12C.17.2: permite varias revisiones secuenciales con versión base estable", () => {
  const uno = creado();
  const dos = ok(editar(uno, [MOD("ADMINISTRACION", "AVANZADO")]));
  const tres = ok(editar(dos, [MOD("ADMINISTRACION", "PREMIUM")], { ahoraIso: T2 }));
  assert.equal(tres.revisionLocal, 3);
  assert.equal(tres.versionBase, 3);
  assert.equal(tres.serviciosPropuestos[0].nivel, "PREMIUM");
});

test("12C.17.2: alta de un nuevo contrato con seis módulos completos", () => {
  const b = ok(crearBorradorComercialLocal({ ...datosNuevo(),
    serviciosPropuestos: MODULOS_COMERCIALES.map(m => MOD(m)),
  }));
  assert.equal(b.diferencias.length, 29);
  assert.ok(b.diferencias.every(x => x.tipo === "ALTA"));
});

test("12C.17.2: baja simulada de un submódulo no borra contrato anterior", () => {
  const b = ok(crearBorradorComercialLocal({ ...datosExistente(),
    serviciosBase: [IND("CHEQUES"), IND("BANCOS")],
    serviciosPropuestos: [IND("CHEQUES")],
  }));
  assert.equal(b.diferencias.length, 1);
  assert.equal(b.diferencias[0].tipo, "BAJA");
  assert.equal(b.serviciosBase.length, 2);
  assert.equal(b.serviciosPropuestos.length, 1);
});

test("12C.17.2: cambio de nivel sin cambiar modalidad", () => {
  const b = ok(crearBorradorComercialLocal({ ...datosExistente(),
    serviciosBase: [IND("CHEQUES")], serviciosPropuestos: [IND("CHEQUES", "PREMIUM")],
  }));
  assert.equal(b.diferencias.length, 1);
  assert.equal(b.diferencias[0].tipo, "CAMBIO_NIVEL");
});

test("12C.17.2: permite mezclar padre de otro módulo con independiente", () => {
  const b = ok(crearBorradorComercialLocal({ ...datosNuevo(), serviciosPropuestos: [
    MOD("INVENTARIO"), IND("CHEQUES"), MOD("REPORTES", "PREMIUM"),
  ] }));
  assert.equal(b.serviciosPropuestos.length, 3);
  assert.ok(b.diferencias.length > 3);
});

test("12C.17.2: identifica solo los cambios de cobertura, no el orden de lista", () => {
  error(crearBorradorComercialLocal({ ...datosExistente(),
    serviciosBase: [IND("CHEQUES"), IND("BANCOS")],
    serviciosPropuestos: [IND("BANCOS"), IND("CHEQUES")],
  }), "SIN_CAMBIOS");
});

test("12C.17.2: no admite creación de borrador sin diferencias", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), serviciosPropuestos: [] }), "SIN_CAMBIOS");
});

test("12C.17.2: rechaza módulo principal y submódulo superpuestos", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(),
    serviciosPropuestos: [MOD("ADMINISTRACION"), IND("CHEQUES")],
  }), "CONFIGURACION_INVALIDA");
});

test("12C.17.2: rechaza contrato duplicado", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(),
    serviciosPropuestos: [IND("CHEQUES"), IND("CHEQUES")],
  }), "CONFIGURACION_INVALIDA");
});

test("12C.17.2: rechaza submódulo inexistente", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(),
    serviciosPropuestos: [IND("INVENTADO")],
  }), "CONFIGURACION_INVALIDA");
});

test("12C.17.2: rechaza niveles mezclados", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(),
    serviciosPropuestos: [{ modalidad: "MODULO_PRINCIPAL", modulo: "INVENTARIO", nivel: "ESTANDAR" }],
  }), "CONFIGURACION_INVALIDA");
});

test("12C.17.2: rechaza empresa no canónica", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), empresaId: "empresa_1" }), "DATOS_INVALIDOS");
});

test("12C.17.2: rechaza identificador de borrador inválido", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), idBorrador: "BOR-" }), "DATOS_INVALIDOS");
});

test("12C.17.2: versión base no se puede suministrar sin contrato", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), versionBase: 1 }), "DATOS_INVALIDOS");
});

test("12C.17.2: contrato existente requiere versión base", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), idContrato: "CTR-1" }), "DATOS_INVALIDOS");
});

test("12C.17.2: contrato nuevo no puede simular historial previo", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), serviciosBase: [IND("CHEQUES")],
    serviciosPropuestos: [IND("BANCOS")] }), "DATOS_INVALIDOS");
});

test("12C.17.2: no acepta atributos extra de precios", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), condicionesEconomicas: "100000" }), "DATOS_INVALIDOS");
});

test("12C.17.2: no acepta claves inesperadas", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), accesoOperativoHabilitado: true }), "DATOS_INVALIDOS");
});

test("12C.17.2: la razón del cambio es obligatoria", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), motivoCambio: "" }), "DATOS_INVALIDOS");
});

test("12C.17.2: fecha no UTC rechazada", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), ahoraIso: "10/11/2026" }), "FECHA_INVALIDA");
});

test("12C.17.2: fecha imposible rechazada", () => {
  error(crearBorradorComercialLocal({ ...datosNuevo(), ahoraIso: "2026-02-31T13:00:00.000Z" }), "FECHA_INVALIDA");
});

test("12C.17.2: no acepta datos de contrato desconocidos", () => {
  error(crearBorradorComercialLocal({ ...datosExistente(), idContrato: " CTR 001 " }), "DATOS_INVALIDOS");
});

test("12C.17.2: no acepta versión fraccionaria o cero", () => {
  error(crearBorradorComercialLocal({ ...datosExistente(), versionBase: 0 }), "DATOS_INVALIDOS");
  error(crearBorradorComercialLocal({ ...datosExistente(), versionBase: 1.5 }), "DATOS_INVALIDOS");
});

test("12C.17.2: al actualizar rechaza otra empresa", () => {
  const b = creado();
  error(editar(b, [MOD("ADMINISTRACION", "PREMIUM")], { empresaId: OTRA }), "EMPRESA_NO_COINCIDE");
});

test("12C.17.2: al descartar rechaza otra empresa", () => {
  error(descartarBorradorComercialLocal({ borrador: creado(), empresaId: OTRA,
    revisionEsperada: 1, ahoraIso: T1 }), "EMPRESA_NO_COINCIDE");
});

test("12C.17.2: revisión optimista bloquea edición vieja", () => {
  const a = creado();
  const b = ok(editar(a, [MOD("ADMINISTRACION", "PREMIUM")]));
  error(editar(b, [MOD("ADMINISTRACION", "ESENCIAL")], { revisionEsperada: 1 }), "REVISION_DESACTUALIZADA");
});

test("12C.17.2: bloquea descarte con revisión vieja", () => {
  const b = ok(editar(creado(), [MOD("ADMINISTRACION", "PREMIUM")]));
  error(descartarBorradorComercialLocal({ borrador: b, empresaId: EMP,
    revisionEsperada: 1, ahoraIso: T2 }), "REVISION_DESACTUALIZADA");
});

test("12C.17.2: bloquea edición si la versión del contrato cambió", () => {
  error(editar(creado(), [MOD("ADMINISTRACION", "PREMIUM")],
    { versionBaseEsperada: 4 }), "VERSION_BASE_DESACTUALIZADA");
});

test("12C.17.2: bloquea cambio que no modifica propuesta", () => {
  error(editar(creado(), [MOD("ADMINISTRACION")]), "SIN_CAMBIOS");
});

test("12C.17.2: al volver a la base pide descartar, sin generar versión ficticia", () => {
  error(editar(creado(), [IND("CHEQUES")]), "SIN_CAMBIOS");
});

test("12C.17.2: no acepta editar propuesta incompatible", () => {
  error(editar(creado(), [MOD("ADMINISTRACION"), IND("CHEQUES")]), "CONFIGURACION_INVALIDA");
});

test("12C.17.2: fecha de revisión nunca retrocede", () => {
  error(editar(creado(), [MOD("ADMINISTRACION", "PREMIUM")],
    { ahoraIso: "2026-11-09T13:00:00.000Z" }), "FECHA_INVALIDA");
});

test("12C.17.2: fecha de descarte nunca retrocede", () => {
  error(descartarBorradorComercialLocal({ borrador: creado(), empresaId: EMP,
    revisionEsperada: 1, ahoraIso: "2026-11-09T13:00:00.000Z" }), "FECHA_INVALIDA");
});

test("12C.17.2: no se puede editar tras descarte", () => {
  const b = ok(descartarBorradorComercialLocal({ borrador: creado(), empresaId: EMP,
    revisionEsperada: 1, ahoraIso: T1 }));
  error(editar(b, [MOD("ADMINISTRACION", "PREMIUM")], { ahoraIso: T2 }), "BORRADOR_DESCARTADO");
});

test("12C.17.2: no se puede descartar dos veces", () => {
  const b = ok(descartarBorradorComercialLocal({ borrador: creado(), empresaId: EMP,
    revisionEsperada: 1, ahoraIso: T1 }));
  error(descartarBorradorComercialLocal({ borrador: b, empresaId: EMP,
    revisionEsperada: 2, ahoraIso: T2 }), "BORRADOR_DESCARTADO");
});

test("12C.17.2: rechaza borrador falsificado con diffs inconsistentes", () => {
  const b = creado();
  const falso = { ...b, diferencias: [] };
  error(editar(falso as unknown as BorradorContratacionLocal, [MOD("ADMINISTRACION", "PREMIUM")]), "BORRADOR_INVALIDO");
});

test("12C.17.2: rechaza borrador falso con acceso operativo true", () => {
  const b = creado();
  const falso = { ...b, accesoOperativoHabilitado: true };
  error(editar(falso as unknown as BorradorContratacionLocal, [MOD("ADMINISTRACION", "PREMIUM")]), "BORRADOR_INVALIDO");
});

test("12C.17.2: no acepta propiedades extra en borrador recibido", () => {
  const b = creado();
  const falso = { ...b, token: "no_leer" };
  error(editar(falso as unknown as BorradorContratacionLocal, [MOD("ADMINISTRACION", "PREMIUM")]), "BORRADOR_INVALIDO");
});

test("12C.17.2: rechaza actualización con atributos económicos extra", () => {
  const b = creado();
  error(editar(b, [MOD("ADMINISTRACION", "PREMIUM")], { precios: [999] }), "DATOS_INVALIDOS");
});

test("12C.17.2: los datos pueden serializarse sin credenciales ni precios", () => {
  const b = creado();
  const json = JSON.stringify(b);
  assert.ok(!json.includes("AIRTABLE_TOKEN"));
  assert.ok(!json.includes("CONDICIONES_ECONOMICAS"));
  assert.ok(!json.includes("token"));
  assert.equal(JSON.parse(json).accesoOperativoHabilitado, false);
});

test("12C.17.2: no crea estado APROBADO o VIGENTE ni permisos operativos", () => {
  const b = creado();
  assert.equal(b.estado, "BORRADOR");
  assert.equal("APROBADA" in b, false);
  assert.equal("VIGENTE" in b, false);
  assert.equal("permisos" in b, false);
});

test("12C.17.2: diferencias cíclicas no provocan excepción ni autorización", () => {
  const original = creado();
  const ciclo: Record<string, unknown> = {};
  ciclo.self = ciclo;
  const falso = { ...original, diferencias: [ciclo] };
  error(editar(falso as unknown as BorradorContratacionLocal,
    [MOD("ADMINISTRACION", "PREMIUM")]), "BORRADOR_INVALIDO");
});

test("12C.17.2: no acepta desbordar el contador de revisiones", () => {
  const falso = { ...creado(), revisionLocal: Number.MAX_SAFE_INTEGER };
  error(editar(falso as unknown as BorradorContratacionLocal,
    [MOD("ADMINISTRACION", "PREMIUM")],
    { revisionEsperada: Number.MAX_SAFE_INTEGER }), "BORRADOR_INVALIDO");
});
