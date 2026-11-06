# OPTIMA — 12B.4.1: detección conservadora de incidentes de auditoría

**Punto de partida:** rama `aprender-sesiones-optima`, commit `05be53880b49377fee552af23aabc7b68b880890` (cierre del 12B.3). Esta etapa **no conecta** el detector a la API de cambios y **no habilita** escrituras reales.

## Función

- `lib/conciliacion-modulos.ts` analiza un conjunto completo de eventos de `AUDITORIA_EVENTOS` agrupados por `OPERACION_ID`, únicamente para operaciones `MODULO_*`.
- `analizarHistorialAuditoria(empresaId, registros)` no hace peticiones externas y devuelve `bloqueada`, `operacionesAnalizadas` e `incidencias`.
- Considera **cerradas** exclusivamente secuencias íntegramente coherentes `INTENTO → CONFIRMADO` o `INTENTO → FALLIDO`, con un solo evento inicial y uno final. Para confirmar, el snapshot final debe coincidir con el estado propuesto; para fallar, debe coincidir con el anterior.
- **Requieren revisión:** `INTENTO` sin final, `INDETERMINADO`, `CONCILIADO` (hasta definir el protocolo), eventos duplicados, identidad discordante, secuencias contradictorias, datos malformados o campos ajenos al cambio.
- `consultarIncidenciasAuditoria(empresaId)` consulta por GET el historial completo de **una empresa** con filtro validado, paginación y límites estrictos. Una falla de red, configuración o paginación lanza `ErrorConsultaAuditoria`: el próximo paso deberá interpretarla como **bloqueo**, nunca como ausencia de incidencias.
- No registra nuevos eventos ni edita registros existentes, no expone rutas HTTP y no lee datos operativos de Frioteka.

## Limitaciones deliberadas

- **No es aún una barrera activa.** 12B.4.2 debe invocar el detector bajo el mismo bloqueo de empresa, justo antes del cambio, e impedir escrituras si `bloqueada=true` **o** cualquier consulta falla.
- `AUDITORIA_EVENTOS` en Airtable no es inmutable por naturaleza. Los permisos directos y la integridad externa se deben revisar antes de activar escrituras.
- Una operación recién iniciada puede tener sólo `INTENTO`; eso se trata como pendiente hasta registrar el resultado.
- La detección de una secuencia cerrada no demuestra por sí sola que el estado actual de EMPRESAS siga siendo el mismo. Debe verificarse de forma separada en el proceso de conciliación.
- `CONCILIADO` **no desbloquea** en esta etapa. 12B.4.3 debe establecer cómo verificar un caso, autorizar y auditar el cierre con controles anti-concurrencia.
- Esta función no ofrece idempotencia ni transacción multitabla; el proceso de negocio existente debe seguir sin reintentar un PATCH incierto.

## Pruebas

- `pruebas/conciliacion-modulos-12b4-1.test.ts`: 17 escenarios locales, todas las comunicaciones externas simuladas.
- Ejecutar `npm run build` y toda la batería de `pruebas/*.test.ts` en Ubuntu antes de subir cambios.
- **No activar** `OPTIMA_MODULES_CHANGES_ENABLED`, `OPTIMA_AUDIT_WRITES_ENABLED` ni agregar `AIRTABLE_AUDITORIA_TABLE_ID` a Vercel en esta etapa.

**Siguiente:** 12B.4.2 — conectar detección al endpoint con bloqueo por empresa, pruebas de lectura fallida y de operaciones pendientes, manteniendo escrituras reales apagadas.
