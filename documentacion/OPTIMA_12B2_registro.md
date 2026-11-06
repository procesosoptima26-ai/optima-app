# OPTIMA — Paso 12B.2: motor de auditoría (sin integración operativa)

**Base técnica:** rama `aprender-sesiones-optima`, commit `dccc8b73abb9ef9a9c5ab58e5780c73ff0b5e7c0` (cierre 11C.4). El administrador global ya ingresó correctamente en Preview. Esta etapa no altera código de gestión ni datos reales.

## Qué se agrega

- `lib/auditoria-eventos.ts`: helper interno sin ruta HTTP, que genera UUID de operación/evento, valida identidad recibida **desde sesión verificada por servidor**, prepara snapshots técnicos acotados y realiza solo `POST` (crear registro). Nunca PATCH/DELETE.
- `pruebas/auditoria-eventos-12b2.test.ts`: 12 pruebas con `fetch` ficticio; sin comunicación con Airtable o Redis real.
- Este registro técnico.

La tabla real ya existe: `AUDITORIA_EVENTOS` (`tblYVXXhejq3nWQ8T`), en `OPTIMA - BASE MAESTRA`. Contiene 20 campos; `REGISTRADO_EN` es fecha de creación calculada por Airtable. `FECHA_HORA_UTC` se envía en ISO UTC aunque Airtable use zona horaria de visualización argentina.

## Barreras de seguridad

1. **Deshabilitado por defecto.** Requiere `OPTIMA_AUDIT_WRITES_ENABLED=true`, `AIRTABLE_AUDITORIA_TABLE_ID`, `AIRTABLE_USERS_BASE_ID`, `AIRTABLE_TOKEN`. No agregar estas variables durante 12B.2.
2. **El servidor determina actor y empresa.** No llamar al helper con campos directos del navegador. El helper comprueba formato de IDs, estados, acción y UUID; no reemplaza autenticación/autorización.
3. **Snapshots con lista blanca:** únicamente `MODULOS_CONTRATADOS`, `ACTIVA` y `VERSION`. Rechaza contraseñas, tokens, PII y campos inesperados. No incluir valores personales en `MOTIVO`; `DETALLE` sólo admite códigos técnicos.
4. **Append-only de aplicación.** Sólo `POST`. `INTENTO` y `CONFIRMADO` son dos filas diferentes con el mismo `OPERACION_ID` y diferentes `ID_EVENTO`. Nunca sobrescribir historial.
5. **Confirmación y estados inciertos.** Comprobar respuesta con ID de registro y los dos UUID; fallas/red/timeouts devuelven `CONFIRMACION_INCIERTA`. No reintentar automáticamente. Conciliar por `OPERACION_ID` antes de reintentar cualquier operación.
6. **Persistencia Airtable no inmutable:** usuarios con permisos de edición en la base podrían alterar/eliminar registros. Restringir permisos directos, separar credenciales de escritura cuando corresponda y evaluar exportación a almacén inmutable para auditoría formal.
7. **Airtable no ofrece transacciones multi-tabla.** El motor no garantiza atomicidad entre evento y cambio empresarial; 12B.3 deberá establecer flujo `INTENTO → CAMBIO → CONFIRMADO/FALLIDO/INDETERMINADO`, conciliador y tratamiento de errores. Si falla el evento INTENTO, no ejecutar cambio de módulo.

## Alcance y condiciones de avance

- 12B.2 construye el motor y lo prueba **localmente con mocks**; no conecta `handlers/core/gestion-modulos.ts` ni activa la API. No crear eventos reales en Airtable.
- El gate existente `OPTIMA_MODULES_CHANGES_ENABLED` debe permanecer ausente. No usar `true` todavía.
- No tocar `STOCK_INVENTARIO`, `STOCK_LOTES`, `MOVIMIENTOS`, usuarios, sucursales ni otras tablas operativas.
- Cuando pase build y pruebas: revisar los **tres archivos nuevos**, hacer commit/push acotados y validar Vercel Preview `READY`.
- **Siguiente: 12B.3** integrar la auditoría en cambios de módulos con pruebas de fallos antes y después de la escritura, permisos de tabla y conciliación; recién después preparar activación controlada.
