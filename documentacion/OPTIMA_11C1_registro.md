# OPTIMA · Paso 11C.1 · Consulta de empresa y catálogo

- **Base de desarrollo:** rama `aprender-sesiones-optima`, commit inicial `00c4630635347962303b9e5b3a9dc1cedbc6699d`.
- **Alcance:** lectura de la empresa de la sesión, catálogo estático derivado del contrato `MODULOS`, módulos habilitados en EMPRESAS y módulos efectivos del usuario.
- **Ruta existente:** `GET /api/empresa`, mediante rewrite a `api/usuarios.ts` y `handlers/core/empresa.ts`. No se crea una función de Vercel adicional.
- **Acceso:** administrador cliente con permiso explícito `usuarios.gestionar`; la empresa se deriva de la sesión validada por servidor. No se toma `empresaId` de query/body. Otros métodos reciben 405.
- **Interfaz:** `ConsultaEmpresa` aparece en la pestaña Usuario de administradores autorizados. Es informativa; el botón Actualizar consulta solo hace GET.
- **Compatibilidad:** se conserva `empresa.modulosContratados` y `sucursalesAutorizadas`; `CORE` sigue siendo obligatorio y no aparece como módulo comercial. No cambia la normalización histórica de nombres de módulos.
- **Limitación esencial:** `MODULOS_CONTRATADOS` en Airtable representa la configuración técnica actual; no demuestra un contrato vigente ni que un módulo esté implementado. Las selecciones actuales no se cambian.
- **Pruebas agregadas:** catálogo sin duplicados, CORE fuera del catálogo comercial, rechazo de métodos de escritura, sesión obligatoria, aislamiento de empresa, ADMIN/usuario y empresa inactiva. Todas con mocks, sin escrituras reales.
- **Pendientes posteriores:** 11C.2 identidad global de plataforma; 11C.3 habilitación/suspensión/reactivación; 11C.4 regresión e integración aislada. El P0 `STOCK_INVENTARIO` sigue pendiente independiente, sin modificaciones.
- **Estado de despliegue:** este script solo deja cambios locales. Registrar resultados reales, commit, Preview y pruebas después de la ejecución y revisión; NO marcar implementado en Preview ni Production antes de comprobarlo.
