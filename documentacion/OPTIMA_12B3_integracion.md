# OPTIMA — Paso 12B.3: integrar auditoría en la gestión de módulos

**Base:** rama `aprender-sesiones-optima`, commit `5d298a46ff35b43ac6288b2617ea517a24bc7abe` (12B.2). Sólo edición local; no efectuar cambios reales de empresa, de la tabla de auditoría ni de Vercel en este paso.

## Contrato de seguridad

1. La API `PATCH /api/plataforma-modulos` sigue apagada salvo que estén configurados **todos** los controles: `OPTIMA_MODULES_CHANGES_ENABLED=true`, `OPTIMA_AUDIT_WRITES_ENABLED=true`, `AIRTABLE_AUDITORIA_TABLE_ID` válido y las credenciales de Base Maestra. No añadir/activar esas variables en 12B.3.
2. El GET del panel sólo anuncia `gestionHabilitada` cuando se cumplen las mismas condiciones. No se delega la autorización al frontend: la API valida sesión, identidad global, empresa destino, módulo, motivo, versión optimista y lock Redis, con doble lectura de empresa.
3. Después de la segunda lectura, el servidor construye un evento INTENTO con nombre/ID de empresa y usuario extraídos de Base Maestra. Si ese INSERT no se confirma, **no hace PATCH** sobre EMPRESAS.
4. Si se confirma el INTENTO, hay **un único PATCH** de `MODULOS_CONTRATADOS` y una relectura para verificar el resultado. No hay reintentos automáticos de PATCH o de eventos de auditoría.
5. El evento final crea otra fila append-only con el mismo `OPERACION_ID`, resultado `CONFIRMADO`, `FALLIDO` o `INDETERMINADO`, estado anterior y observado, y motivo. El endpoint únicamente devuelve éxito cuando el resultado empresarial **y** la auditoría final quedaron confirmados.
6. Un fallo del evento final devuelve HTTP 503, `operacionId` y `puedeEstarAplicado`. El mensaje prohíbe repetir a ciegas. Las fallas posteriores al PATCH pueden representar una operación parcialmente aplicada.
7. Si hubo error de transporte en PATCH, se intenta sólo una lectura de verificación. Si el estado es el esperado, se registra `CONFIRMADO_TRAS_ERROR` sin reescribir. Si se mantiene la versión anterior se registra `FALLIDO`. Si el estado no coincide o no se puede leer, se registra `INDETERMINADO`.

## Archivos del paso

- Nuevo: `lib/cambio-modulos-auditado.ts` (orquestador sin HTTP).
- Nuevo: `pruebas/cambio-modulos-12b3.test.ts` (11 escenarios mock; sin red real).
- Nuevo: este documento.
- Modificados: `handlers/core/gestion-modulos.ts`, `handlers/core/plataforma.ts`, `src/modules/usuarios/ConsultaPlataforma.tsx`.
- Se adecúan las pruebas de etapas anteriores, sin eliminarlas: `pruebas/gestion-modulos-11c3.test.ts`, `pruebas/auditoria-eventos-12b2.test.ts` y `pruebas/cierre-multiempresa-11c4.test.ts` (se configuran ambos gates sólo en el mock de concurrencia, conserva HTTP 409 y cero escrituras).

## Pendientes antes de habilitar escrituras comerciales

- **12B.4:** diseñar/implementar conciliación de `INTENTO` sin resultado y `INDETERMINADO`; aplicar bloqueo preventivo de nuevas operaciones de esa empresa hasta resolver incidencias. Un resultado 503 no puede provocar un segundo PATCH automático.
- Restringir permisos de edición/borrado manual de `AUDITORIA_EVENTOS`, proteger el token, revisar permisos de acceso al historial, definir respaldo/exportación a almacenamiento inmutable si se requiere validez probatoria fuerte.
- Realizar pruebas cruzadas de concurrencia, latencia y caída de Redis/Airtable; validar persistencia y orden de eventos con un entorno de prueba, nunca sobre la empresa piloto en uso.
- Revisar de manera separada idempotencia y transaccionalidad del módulo de inventario y movimientos (12D).

**Prohibido en este paso:** activar `OPTIMA_MODULES_CHANGES_ENABLED`, activar `OPTIMA_AUDIT_WRITES_ENABLED`, insertar eventos reales o realizar mutaciones sobre EMPRESAS, stock, usuarios o sucursales. Las pruebas son exclusivamente con mocks.
