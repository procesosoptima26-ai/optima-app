import assert from "node:assert/strict";
import test from "node:test";
import {
  calcularComprasSugeridas,
  agruparPorProveedor,
  redondearAlPack,
  sugeridoConUmbral,
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
    categoria: null,
    proveedores: ["Proveedor de prueba"],
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
  // El corte se aplica en silencio: no hay cartel de "código reutilizado".
  assert.deepEqual(it.avisos, []);
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

test("el ritmo mezcla el promedio de 60 días con el de los últimos 30", () => {
  // 30 unidades, todas en los últimos 30 días: promedio 60d = 0,5; promedio 30d = 1 -> ritmo 0,75.
  const r = calcularComprasSugeridas([producto({ stock: 0, multiplo: 1, ventas: ventasParejas(30, 30) })], { hoy: HOY });
  assert.equal(r.items[0].ventaDiaria, 0.75);
  // Un producto que vendía y dejó de vender: el ritmo baja a la mitad del promedio.
  const viejas: VentaDiaria[] = [{ fecha: "2026-10-05", cantidad: 60 }];
  const r2 = calcularComprasSugeridas([producto({ stock: 0, multiplo: 1, ventas: viejas })], { hoy: HOY });
  assert.equal(r2.items[0].ventaDiaria, 0.5);
});

test("el grupo define la cobertura: lo perecedero cubre menos días que el almacén", () => {
  const ventas = ventasParejas(60, 60);
  const r = calcularComprasSugeridas(
    [
      producto({ productoId: "l", nombre: "Yogurt Cremigal Vainilla 1Lt", multiplo: 1, ventas }),
      producto({ productoId: "a", nombre: "Fideo Matarazzo Tirabuzón 500gr", multiplo: 1, ventas }),
    ],
    { hoy: HOY }
  );
  const lacteo = r.items.find((i) => i.productoId === "l")!;
  const almacen = r.items.find((i) => i.productoId === "a")!;
  assert.equal(lacteo.grupo, "LACTEOS_Y_FIAMBRES");
  assert.equal(lacteo.coberturaDias, 10);
  assert.equal(almacen.grupo, "ALMACEN");
  assert.equal(almacen.coberturaDias, 21);
});

test("temporada: a fines de noviembre los helados piden más que lo que vendieron", () => {
  const r = calcularComprasSugeridas(
    [producto({ nombre: "Helado Sape! Limón 500gr", multiplo: 1, ventas: ventasParejas(60, 60) })],
    { hoy: HOY }
  );
  const it = r.items[0];
  assert.equal(it.grupo, "HELADOS");
  assert.ok(it.factorTemporada > 1.1 && it.factorTemporada < 1.5, `factor ${it.factorTemporada}`);
  assert.ok(it.objetivo > it.ventaDiaria * it.coberturaDias);
});

test("temporada: en pleno invierno los helados bajan, y un producto sin estacionalidad no cambia", () => {
  const julio = "2026-07-15";
  const r = calcularComprasSugeridas(
    [
      producto({ productoId: "h", nombre: "Helado Sape! Limón 500gr", multiplo: 1, ventas: ventasParejas(60, 60, julio) }),
      producto({ productoId: "n", nombre: "Producto de prueba", multiplo: 1, ventas: ventasParejas(60, 60, julio) }),
    ],
    { hoy: julio }
  );
  assert.equal(r.items.find((i) => i.productoId === "n")!.factorTemporada, 1);
  assert.ok(r.items.find((i) => i.productoId === "h")!.factorTemporada <= 1.1);
});

test("discontinuado: nunca se sugiere, aunque no tenga stock y venda", () => {
  const r = calcularComprasSugeridas(
    [producto({ discontinuado: true, multiplo: null, stock: 0, ventas: ventasParejas(60, 60) })],
    { hoy: HOY }
  );
  const it = r.items[0];
  assert.equal(it.sugerido, 0);
  assert.deepEqual(it.avisos, ["DISCONTINUADO"]);
});

test("si falta menos de media caja y el stock alcanza una semana, se espera", () => {
  // 1 por día, cobertura 15 -> objetivo 15. Stock 12 -> faltan 3; pack 12 (media caja = 6) y alcanza 12 días -> no se pide.
  const r = calcularComprasSugeridas([producto({ stock: 12, multiplo: 12, ventas: ventasParejas(60, 60) })], { hoy: HOY });
  assert.equal(r.items[0].sugerido, 0);
  // Con stock 3 alcanza solo 3 días: se pide la caja.
  const r2 = calcularComprasSugeridas([producto({ stock: 3, multiplo: 12, ventas: ventasParejas(60, 60) })], { hoy: HOY });
  assert.equal(r2.items[0].sugerido, 12);
  // Si falta media caja o más, también se pide.
  const r3 = calcularComprasSugeridas([producto({ stock: 8, multiplo: 12, ventas: ventasParejas(60, 60) })], { hoy: HOY });
  assert.equal(r3.items[0].sugerido, 12);
});

test("sugeridoConUmbral: casos límite", () => {
  assert.equal(sugeridoConUmbral(0, 6, 10), 0);
  assert.equal(sugeridoConUmbral(-2, 6, 10), 0);
  assert.equal(sugeridoConUmbral(2, 6, 10), 0);
  assert.equal(sugeridoConUmbral(2, 6, 3), 6);
  assert.equal(sugeridoConUmbral(2, 6, null), 6);
  assert.equal(sugeridoConUmbral(3, 6, 10), 6);
  assert.equal(sugeridoConUmbral(0.4, 1, 20), 1);
});

// --- Pedido real, formato por proveedor y venta muy lenta (27-11-2026) ---

test("proveedor que vende por unidad: se pide la cantidad exacta, no la caja", () => {
  // 120 u/60 días = 2 por día; objetivo 30; stock 10 → faltan 20. Pack 24.
  const unidad = calcularComprasSugeridas([producto({ proveedores: ["ARCOR"], multiplo: 24, stock: 10, ventas: ventasParejas(120, 60) })], { hoy: HOY }).items[0];
  assert.equal(unidad.formatoCompra, "UNIDAD");
  assert.equal(unidad.necesidadReal, 20);
  assert.equal(unidad.sugerido, 20);
  const caja = calcularComprasSugeridas([producto({ proveedores: ["COCA COLA GOYA"], multiplo: 24, stock: 10, ventas: ventasParejas(120, 60) })], { hoy: HOY }).items[0];
  assert.equal(caja.formatoCompra, "PACK");
  assert.equal(caja.necesidadReal, 20);
  assert.equal(caja.sugerido, 24);
});

test("media caja: redondea al medio pack; huevos: de a 12", () => {
  const medio = calcularComprasSugeridas([producto({ proveedores: ["DINPRO S.A."], multiplo: 24, stock: 10, ventas: ventasParejas(120, 60) })], { hoy: HOY }).items[0];
  assert.equal(medio.paso, 12);
  assert.equal(medio.sugerido, 24); // faltan 20 → 2 medias cajas
  const huevos = calcularComprasSugeridas([producto({ proveedores: ["HUEVOS VIOLA"], multiplo: 30, stock: 10, ventas: ventasParejas(120, 60) })], { hoy: HOY }).items[0];
  assert.equal(huevos.sugerido, 24); // faltan 20 → 2 docenas
});

test("proveedor sin formato conocido: se mantiene la caja cerrada", () => {
  const r = calcularComprasSugeridas([producto({ proveedores: ["Nuevo S.A."], multiplo: 6, stock: 10, ventas: ventasParejas(120, 60) })], { hoy: HOY }).items[0];
  assert.equal(r.formatoCompra, "PACK");
  assert.equal(r.sugerido, 24);
});

test("venta muy lenta: 1 o 2 unidades en 60 días se marcan; 3 o más no; 0 conserva su aviso", () => {
  const lento = (u: number) => calcularComprasSugeridas([producto({ multiplo: 1, stock: 0, ventas: [{ fecha: HOY, cantidad: u }] })], { hoy: HOY }).items[0];
  assert.equal(lento(1).ventaMuyLenta, true);
  assert.equal(lento(2).ventaMuyLenta, true);
  assert.equal(lento(3).ventaMuyLenta, false);
  assert.equal(lento(2).unidadesVendidas, 2);
  const cero = calcularComprasSugeridas([producto({ multiplo: 6, stock: 0, ventas: [] })], { hoy: HOY }).items[0];
  assert.equal(cero.ventaMuyLenta, false);
  assert.ok(cero.avisos.includes("SIN_VENTAS_RECIENTES"));
});

test("agruparPorProveedor deja afuera la venta muy lenta", () => {
  const r = calcularComprasSugeridas([
    producto({ productoId: "l", multiplo: 1, stock: 0, ventas: [{ fecha: HOY, cantidad: 2 }] }),
    producto({ productoId: "n", multiplo: 1, stock: 0, ventas: ventasParejas(120, 60) }),
  ], { hoy: HOY });
  const ids = agruparPorProveedor(r.items).flatMap((g) => g.items.map((i) => i.productoId));
  assert.deepEqual(ids, ["n"]);
});

test("proveedor por unidad: faltantes de menos de 3 unidades no se piden; 3 o más sí", () => {
  // 2 por día, cobertura 15 días → objetivo 30. Con stock 28 faltan 2; con stock 27 faltan 3.
  const con = (stock: number) => calcularComprasSugeridas([producto({ proveedores: ["ARCOR"], multiplo: 24, stock, ventas: ventasParejas(120, 60) })], { hoy: HOY }).items[0];
  assert.equal(con(28).necesidadReal, 2);
  assert.equal(con(28).sugerido, 0);
  assert.equal(con(27).sugerido, 3);
  // Con caja cerrada la regla no cambia: se sigue pidiendo el pack.
  const caja = calcularComprasSugeridas([producto({ proveedores: ["COCA COLA GOYA"], multiplo: 6, stock: 28, ventas: ventasParejas(120, 60) })], { hoy: HOY }).items[0];
  assert.equal(caja.sugerido, 0); // falta menos de media caja y el stock alcanza: ya se esperaba
  const caja2 = calcularComprasSugeridas([producto({ proveedores: ["COCA COLA GOYA"], multiplo: 6, stock: 26, ventas: ventasParejas(120, 60) })], { hoy: HOY }).items[0];
  assert.equal(caja2.sugerido, 6);
});
