# OPTIMA — Paso 11C.4 — Cierre técnico de aislamiento multiempresa

**Base de código prevista:** `9bae6e45db69310e704cb24dc65e8a644ffb0022` (11C.3), rama `aprender-sesiones-optima`. El despliegue Preview de esa base figura READY. Este documento se crea localmente; su presencia no implica por sí sola cierre en GitHub o Vercel.

## Alcance de 11C

- **11C.1:** consulta de empresa propia y catálogo informativo, desde sesión validada.
- **11C.2:** identidad global OPTIMA separada del ADMIN cliente, con ID de usuario y empresa configurados explícitamente en servidor; no se activó cuenta real de plataforma.
- **11C.3:** ruta para habilitar, suspender y reactivar **habilitaciones técnicas** de empresa, con bloqueo y control de versión, deshabilitada por defecto con `OPTIMA_MODULES_CHANGES_ENABLED` ausente o distinto de `true`.
- **11C.4:** pruebas integrales aisladas, controles regresivos y este documento de cierre; no se ejecuta escritura real.

## Matriz de pruebas 11C.4

1. Restricciones por empresa y sucursal: no se autoriza actuar sobre IDs ajenos ni inventario sin sucursal verificada.
2. Suspensión/reactivación de módulo con permisos preexistentes: intersección empresa–usuario efectiva; los demás módulos siguen autorizados.
3. Revocación al volver a leer la Base Maestra: empresa/usuario inactivo o sucursal ajena no obtiene contexto operativo.
4. Preservación de CORE y equivalencias históricas del catálogo, rechazo de módulos desconocidos y cambios inconsistentes.
5. Identidad global no derivada del rol ADMIN cliente ni de IDs enviados por navegador.
6. Por defecto, API de cambio cerrada sin conexiones externas.
7. Con servicios externos ficticios, bloqueo Redis impide escrituras simultáneas de módulos.
8. Rewrites del router consolidado y presencia de controles de autorización y gate.

Las pruebas usan mocks de Airtable/Redis. **No demuestran** que Preview y Production estén aislados en sus datos; se sabe que ambos pueden apuntar a la Base Maestra real.

## Límites y pendientes que NO bloquean terminar este fragmento

- **Pendiente P0, STOCK_INVENTARIO:** separado por decisión explícita. No se modifica ni se considera migrado.
- **Paso 12, auditoría permanente:** antes de habilitar escrituras reales de módulos, registrar actor, motivo, empresa, módulo, estado antes/después, fecha, origen y resultado. Hoy se exige motivo, pero no se persiste un evento de auditoría global.
- **Autorización de cuenta global:** se requiere crear/configurar y validar una cuenta propia de OPTIMA sin sucursales. Esta fase no crea cuenta ni altera variables de Vercel.
- **Separación contractual:** `MODULOS_CONTRATADOS` hoy refleja habilitación técnica, no constituye evidencia comercial. Suspender y reactivar no mantienen un historial de contratos ni distinguen permanentemente “nunca contratado” de “suspendido”.
- **API heredadas:** algunas operaciones siguen restringidas a la empresa piloto con `OPTIMA_LEGACY_COMPANY_ID`; no afirmar que todos los módulos operativos son completamente multiempresa.
- **Módulos sensibles y sesiones ya abiertas:** la verificación autorizativa del Core funciona en las rutas integradas; la revisión global de APIs heredadas y pruebas reales de revocación pertenecen a auditoría de seguridad posterior.
- **Despliegue y pruebas reales:** build y suite local deben aprobar, luego commit acotado, push, verificar Preview READY. No desplegar Production ni ejecutar PATCH en datos reales.

**Criterio de cierre:** 11C queda *construido y validado mediante pruebas locales/mocks y Preview de lectura*, no habilitado comercialmente ni certificado para producción. La auditoría global de Paso 12 y seguridad de Paso 13 siguen siendo prioridades.
