# OPTIMA — 12B.4.2: barrera preventiva sobre operaciones pendientes

**Base:** rama `aprender-sesiones-optima`, commit `d94ba268bf87f8964e3dc7ca2450055ced4b69dc` (12B.4.1).

## Integración

- `handlers/core/gestion-modulos.ts` consulta el historial completo por empresa con `consultarIncidenciasAuditoria(empresaId)` **después de obtener el lock Redis y antes de leer o modificar la empresa**.
- Cualquier operación incompleta, indeterminada, contradictoria o evento inválido ocasiona `409`, impide nuevos eventos `INTENTO` e impide `PATCH` empresarial. La respuesta muestra la cantidad de incidencias, no información sensible.
- Cualquier error de configuración, red o paginación en la consulta de auditoría ocasiona `503`, sin tratarlo como ausencia de incidentes. La liberación del lock sigue en `finally`.
- Sin lock Redis no se consulta historial, ni se permite cambio de módulos.
- Historial completo y sin incidencias habilita el flujo preexistente `INTENTO → un PATCH → relectura → CONFIRMADO/FALLIDO/INDETERMINADO`.
- El detector **solo consulta** Airtable; esta etapa no habilita ninguna escritura, variable de Vercel, ruta o permiso de usuario.

## Limitaciones y próximos controles

- Airtable no garantiza instantánea transaccional de todas las páginas, ni impide que usuarios con permiso directo manipulen el historial. Antes de producción deberán restringirse permisos, revisar integridad y definir una arquitectura de registro inmutable si se precisa.
- El lock Redis actual expira a los 120 s; una petición excesivamente lenta puede perder exclusividad. No se declara resuelto ese riesgo. Se debe revisar su renovación o un cierre de seguridad adicional antes de habilitar escrituras reales.
- La consulta conservadora de todos los eventos tiene un límite de 5000 por empresa y bloquea al excederlo. Debe escalarse y revisarse el rendimiento antes de comercializar.
- Una operación que falla **antes de confirmar INTENTO** puede haber insertado el registro y dejar la empresa bloqueada; es una decisión conservadora. No reintentar automáticamente.
- `CONCILIADO` no resuelve la incidencia todavía: **12B.4.3** definirá autorización, verificación empresarial y cierre append-only.
- Mantener `OPTIMA_MODULES_CHANGES_ENABLED`, `OPTIMA_AUDIT_WRITES_ENABLED` y `AIRTABLE_AUDITORIA_TABLE_ID` **sin configurar en Vercel** durante 12B.4.2.

## Archivos y validación

Modificados: `handlers/core/gestion-modulos.ts`, `pruebas/gestion-modulos-11c3.test.ts`, `pruebas/conciliacion-modulos-12b4-1.test.ts`.
Nuevos: `pruebas/bloqueo-preventivo-12b4-2.test.ts`, este documento.

7 pruebas nuevas usan mocks de Redis, Airtable y sesión. Verificar además todos los tests existentes (`137` esperados), compilación y Git antes de subir.
