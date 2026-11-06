# OPTIMA — Paso 12B.4.3: conciliación manual, sin alterar módulos

**Punto de partida:** rama `aprender-sesiones-optima`, commit `4de5036289e69ee8fb98c74dd13169621a9f454a` (12B.4.2). El despliegue Preview estaba READY y las escrituras comerciales no estaban habilitadas.

## Qué incorpora

- `lib/resolucion-modulos-auditada.ts`: diagnóstico puro de `INTENTO` sin final o `INDETERMINADO`, verifica que los snapshots de auditoría sean válidos y sus versiones recalculadas coincidan con los módulos guardados.
- `lib/conciliacion-modulos.ts`: reconoce `CONCILIADO` únicamente cuando existe un único `INTENTO`, cero finales normales, como máximo un `INDETERMINADO`, y un cierre coherente con resultado `CONCILIADO_APLICADO` o `CONCILIADO_NO_APLICADO`; mantiene bloqueadas secuencias malformadas o contradictorias. El listado permite que `ESTADO_NUEVO` esté ausente en un `INDETERMINADO`, como puede suceder con campos vacíos de Airtable.
- `handlers/core/conciliar-modulos.ts`: consulta de incidencias y vista previa (GET), conciliación expresa (POST) con identidad global comprobada en servidor, mismo lock Redis por empresa, dos lecturas de EMPRESAS y comparación de versión. Sólo inserta un evento `CONCILIADO` si se cumplen todos los controles; nunca hace PATCH de empresa ni reintenta una escritura incierta.
- `lib/bloqueo-modulos.ts`: renueva de forma condicional el lock Redis comprobando propietario; la API de cambio de módulos también valida la propiedad antes de iniciar y antes de hacer PATCH empresarial.
- `api/usuarios.ts` y `vercel.json`: ruta reutilizando el router `/api/usuarios` para no agregar otra función Vercel: `/api/plataforma-conciliacion`.
- Panel `ConsultaPlataforma.tsx`: consulta de incidencias, vista previa de estado anterior/propuesto/actual, confirmación de operador y motivo escrito. La posibilidad de cerrar se mantiene oculta mientras la auditoría de escritura está apagada.
- Pruebas `pruebas/conciliacion-segura-12b4-3.test.ts`: 16 casos de seguridad y comportamiento, con Redis/Airtable simulados, sin red real. Las 137 pruebas del proyecto deben seguir aprobadas además de estas 16 (153 esperadas).

## Restricciones y seguridad

1. **Nunca se altera `MODULOS_CONTRATADOS` durante una conciliación.** Se registra un evento adicional append-only con actor real de la sesión y motivo explícito. No se modifica, elimina ni sobrescribe historial anterior.
2. **Cierre sólo para estados evidentes:** módulo actual exactamente igual al anterior (`NO_APLICADO`) o al solicitado (`APLICADO`), incluidas las versiones recalculadas. Estados intermedios, auditoría inválida, secuencias duplicadas o contradicciones requieren investigación manual sin desbloqueo automático.
3. **Sin reintentos automáticos:** si falla el INSERT del cierre o su verificación posterior, mostrar error y revisar el historial antes de otro intento. Se puede haber guardado aunque no llegue la respuesta.
4. **Mismo lock por empresa**, y renovación condicional que falla cerrado si caducó. Esto no sustituye la revisión de cambios manuales desde Airtable que no respeten el lock.
5. **GET solo de administración global.** **POST sólo si `OPTIMA_AUDIT_WRITES_ENABLED=true`** y la Base Maestra y tabla están configuradas, con doble verificación. El gate comercial `OPTIMA_MODULES_CHANGES_ENABLED` no se activa ni es requisito para conciliar un incidente.
6. No agregar `OPTIMA_AUDIT_WRITES_ENABLED`, `OPTIMA_MODULES_CHANGES_ENABLED` ni `AIRTABLE_AUDITORIA_TABLE_ID` en esta instalación: ninguna prueba requiere conectar datos reales.

## Checklist de cierre técnico del Paso 12B

- [ ] Ejecutar `npm run build` y TODAS las pruebas en Ubuntu; debe haber **153 pass, 0 fail** (si no se agregaron tests externos).
- [ ] Revisar exactamente los archivos modificados, subir commit acotado y verificar Preview `READY` en Vercel.
- [ ] En Preview, configurar únicamente el ID de tabla para consultas **si se decide realizar smoke test de solo lectura**; mantener los dos gates de escritura sin activar.
- [ ] Verificar que solo administradores autorizados y la credencial del backend tengan acceso de escritura a `AUDITORIA_EVENTOS` en Airtable. Quitar permisos humanos innecesarios para editar/borrar historial. Airtable no es inmutable por sí misma.
- [ ] Confirmar en Preview que un administrador de cliente no ve ni usa la conciliación y que los cambios de módulos siguen deshabilitados.
- [ ] Dejar documentada la política de respaldos/exportación de eventos, retención, recuperación de auditoría y monitoreo de incidencias. Se requiere solución más robusta/inmutable si se exige valor probatorio fuerte.
- [ ] No realizar pruebas de POST sobre Frioteka ni sobre otra empresa real; utilizar entorno aislado para prueba de persistencia y conciliación con evento ficticio antes de habilitar operaciones reales.

## Limitaciones pendientes para explotación comercial

- Airtable no ofrece transacciones multi-tabla ni garantía de lectura instantánea entre páginas. Ediciones humanas externas pueden saltarse el bloqueo Redis; deben controlarse por permisos y procesos.
- El historial completo tiene límites de consulta (hasta 5000 eventos por empresa) y el bloqueo expira si un proceso supera su TTL; la renovación reduce el riesgo pero no garantiza atomicidad con cambios externos.
- El historial auditado todavía no constituye un almacén técnicamente inmutable. Antes de comercialización debe validarse presupuesto, límites de API, monitoreo y recuperación ante incidentes.
- Este paso no cubre integridad/idempotencia de inventario y movimientos; eso corresponde a **12D**.

**No activar escrituras comerciales por el hecho de aprobar las pruebas.** El objetivo del 12B es dejar el mecanismo técnicamente probado y seguro por defecto, no autorizar su uso real sin una prueba aislada de integración.
