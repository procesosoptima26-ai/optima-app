import assert from "node:assert/strict";
import test from "node:test";
import {
  calcularComprasSugeridas,
  agruparPorProveedor,
  redondearAlPack,
  type ProductoCompra,
  type VentaDiaria
} from "../lib/compras-sugeridas.js";

const HOY = "2026-11-27";

/** Reparte `total` unidades en partes iguales, un día por vez, terminando en `hasta`. */
function ventasParejas(total: number, dias: number, hasta = HOY): VentaDiaria[] {
  const [a, m, d] = hasta.split("-").map(Number);
  const base = Date.UTC(a, m - 1, d);
  const out: VentaDiaria[] = [];
  for (let i = 0; i < dias; i += 1) {
    const f = new Date(base - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ fecha: f, cantidad: total / dias });
  }
  return out;
}

function producto(extra: Partial<ProductoCompra> = {}): ProductoCompra {
  return {
    productoId: "rec1",
    codigo: "7790000000001",
    nombre: "Producto de prueba",
    categoria: "Almacén",
    proveedores: ["ARCOR"],
    multiplo: 6,
    stock: 0,
    ventas: [],
    ...extra
  };
}

test("venta diaria sobre los últimos 60 días y sugerido redondeado al pack", () => {
  // 120 unidades en 60 días = 2 por día. Cobertura 15 días = objetivo 30. Stock 10 -> faltan 20 -> pack de 6 -> 24.
  const r = calcularComprasSugeridas([producto({ stock: 10, ventas: ventasParejas(120, 60) })], { hoy: HOY });
  const it = r.items[0];
  assert.equal(it.ventaDiaria, 2);
  assert.equal(it.objetivo, 30);
  assert.equal(it.sugerido, 24);
  assert.equal(it.diasAlcanza, 5);
});

test("si el stock alcanza no se sugiere comprar", () => {
  const r = calcularComprasSugeridas([producto({ stock: 40, ventas: ventasParejas(120, 60) })], { hoy: HOY });
  assert.equal(r.items[0].sugerido, 0);
});

test("una necesidad exacta no sube un pack de más", () => {
  assert.equal(redondearAlPack(12, 6), 12);
  assert.equal(redondearAlPack(12.0000001, 6), 12);
  assert.equal(redondearAlPack(12.5, 6), 18);
  assert.equal(redondearAlPack(0, 6), 0);
  assert.equal(redondearAlPack(-3, 6), 0);
});

test("las ventas anteriores a la ventana de 60 días no cuentan", () => {
  const viejas: VentaDiaria[] = [{ fecha: "2026-08-01", cantidad: 1000 }];
  const r = calcularComprasSugeridas([producto({ stock: 0, ventas: viejas })], { hoy: HOY });
  assert.equal(r.items[0].ventaDiaria, 0);
});

test("cobertura por categoría y factor de temporada", () => {
  const ventas = ventasParejas(60, 60); // 1 por día
  const r = calcularComprasSugeridas(
    [producto({ categoria: "Bebidas", stock: 0, multiplo: 1, ventas })],
    { hoy: HOY, coberturaPorCategoria: { Bebidas: 30 }, factorPorCategoria: { Bebidas: 1.5 } }
  );
  assert.equal(r.items[0].coberturaDias, 30);
  assert.equal(r.items[0].factorTemporada, 1.5);
  assert.equal(r.items[0].objetivo, 45);
  assert.equal(r.items[0].sugerido, 45);
});

test("sin categoría usa cobertura y factor generales", () => {
  const r = calcularComprasSugeridas(
    [producto({ categoria: null, stock: 0, multiplo: 1, ventas: ventasParejas(60, 60) })],
    { hoy: HOY, coberturaPorCategoria: { Bebidas: 30 }, factorGeneral: 2 }
  );
  assert.equal(r.items[0].coberturaDias, 15);
  assert.equal(r.items[0].factorTemporada, 2);
});

test("sin ventas y sin stock se sugiere un pack y se marca", () => {
  const r = calcularComprasSugeridas([producto({ stock: 0, ventas: [], multiplo: 12 })], { hoy: HOY });
  assert.equal(r.items[0].sugerido, 12);
  assert.ok(r.items[0].avisos.includes("SIN_VENTAS_RECIENTES"));
  assert.equal(r.items[0].diasAlcanza, null);
});

test("sin ventas pero con stock no se sugiere nada", () => {
  const r = calcularComprasSugeridas([producto({ stock: 5, ventas: [] })], { hoy: HOY });
  assert.equal(r.items[0].sugerido, 0);
  assert.ok(r.items[0].avisos.includes("SIN_VENTAS_RECIENTES"));
});

test("sin pack cargado usa 1 y avisa; sin proveedor avisa", () => {
  const r = calcularComprasSugeridas(
    [producto({ multiplo: null, proveedores: [], stock: 0, ventas: ventasParejas(60, 60) })],
    { hoy: HOY }
  );
  assert.equal(r.items[0].multiplo, 1);
  assert.ok(r.items[0].avisos.includes("SIN_PACK_CARGADO"));
  assert.ok(r.items[0].avisos.includes("SIN_PROVEEDOR"));
  const r2 = calcularComprasSugeridas([producto({ multiplo: 0 })], { hoy: HOY });
  assert.equal(r2.items[0].multiplo, 1);
});

test("bolsas y productos Ocupado quedan excluidos", () => {
  const r = calcularComprasSugeridas(
    [
      producto({ codigo: "10002", nombre: "BOLSAS CAMISETA" }),
      producto({ codigo: "010004", nombre: "BOLSAS ECOLÓGICAS x U" }),
      producto({ codigo: "1099", nombre: "Ocupado Goya" }),
      producto({ codigo: "7790000000002", nombre: "Yerba" })
    ],
    { hoy: HOY }
  );
  assert.equal(r.excluidos, 3);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].nombre, "Yerba");
});

test("código reutilizado: solo cuentan las ventas desde la fecha de corte", () => {
  // Hasta el 16-11 vendía otro producto (mucho). Desde el 17-11 el producto nuevo vende 1 por día.
  const ventas: VentaDiaria[] = [
    { fecha: "2026-11-10", cantidad: 500 },
    ...ventasParejas(11, 11) // del 17 al 27 de noviembre, 1 por día
  ];
  const r = calcularComprasSugeridas(
    [producto({ stock: 0, multiplo: 1, ventas, cortePorCambioDeProducto: "2026-11-17" })],
    { hoy: HOY }
  );
  const it = r.items[0];
  assert.equal(it.ventaDiaria, 1);
  assert.ok(it.avisos.includes("CODIGO_REUTILIZADO"));
  assert.equal(it.sugerido, 15);
});

test("ventas en baja: la última mitad de la ventana vende menos de la mitad que la primera", () => {
  const ventas: VentaDiaria[] = [
    { fecha: "2026-10-05", cantidad: 60 },
    { fecha: "2026-11-20", cantidad: 5 }
  ];
  const r = calcularComprasSugeridas([producto({ stock: 0, ventas })], { hoy: HOY });
  assert.ok(r.items[0].avisos.includes("VENTAS_EN_BAJA"));
  const estable = calcularComprasSugeridas([producto({ stock: 0, ventas: ventasParejas(120, 60) })], { hoy: HOY });
  assert.ok(!estable.items[0].avisos.includes("VENTAS_EN_BAJA"));
});

test("orden por urgencia: menos días de stock primero; los sin ventas al final", () => {
  const r = calcularComprasSugeridas(
    [
      producto({ productoId: "a", nombre: "Alcanza mucho", stock: 100, ventas: ventasParejas(60, 60) }),
      producto({ productoId: "b", nombre: "Sin ventas", stock: 0, ventas: [] }),
      producto({ productoId: "c", nombre: "Urgente", stock: 1, ventas: ventasParejas(60, 60) })
    ],
    { hoy: HOY }
  );
  assert.deepEqual(r.items.map((i) => i.productoId), ["c", "a", "b"]);
});

test("agrupar por proveedor: un producto con varios proveedores aparece en todos; filtra por uno", () => {
  const r = calcularComprasSugeridas(
    [
      producto({ productoId: "a", nombre: "Gaseosa", proveedores: ["COCA COLA GOYA", "COCA COLA BELLA VISTA"], stock: 0, ventas: ventasParejas(60, 60) }),
      producto({ productoId: "b", nombre: "Galletita", proveedores: ["ARCOR"], stock: 0, ventas: ventasParejas(60, 60) }),
      producto({ productoId: "c", nombre: "No hace falta", proveedores: ["ARCOR"], stock: 999, ventas: ventasParejas(60, 60) }),
      producto({ productoId: "d", nombre: "Sin proveedor", proveedores: [], stock: 0, ventas: ventasParejas(60, 60) })
    ],
    { hoy: HOY }
  );
  const grupos = agruparPorProveedor(r.items);
  const nombres = grupos.map((g) => g.proveedor);
  assert.deepEqual(nombres, ["(sin proveedor)", "ARCOR", "COCA COLA BELLA VISTA", "COCA COLA GOYA"]);
  assert.equal(grupos.find((g) => g.proveedor === "ARCOR")!.items.length, 1);
  const soloCoca = agruparPorProveedor(r.items, "COCA COLA GOYA");
  assert.equal(soloCoca.length, 1);
  assert.equal(soloCoca[0].items[0].productoId, "a");
});

test("fecha inválida corta con un error claro", () => {
  assert.throws(() => calcularComprasSugeridas([producto()], { hoy: "27/11/2026" }), /Fecha inválida/);
});
