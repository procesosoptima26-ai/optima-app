-- OPTIMA 12C.18.4 - Row Level Security por empresa (DEFENSA EN PROFUNDIDAD).
-- Solo en base aislada hasta que backend autentique y reconstruya estados.
-- No crea usuarios ni roles y NO concede acceso a nadie; DBA debe crear un rol
-- no propietario, NOBYPASSRLS, otorgarle permisos mínimos y usar conexiones
-- por solicitud. No ejecutar en la base de Frioteka ni en otra base existente.
-- Un rol SUPERUSER o BYPASSRLS puede saltar políticas; no usarlo como runtime.
-- El backend debe establecer optima.empresa_id a partir de sesión verificada,
-- dentro de la misma transacción (SET LOCAL / set_config(..., true)).
BEGIN;
ALTER TABLE optima_comercial.contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE optima_comercial.contratos FORCE ROW LEVEL SECURITY;
CREATE POLICY contratos_empresa ON optima_comercial.contratos
  FOR ALL USING (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''))
  WITH CHECK (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''));

ALTER TABLE optima_comercial.versiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE optima_comercial.versiones FORCE ROW LEVEL SECURITY;
CREATE POLICY versiones_empresa ON optima_comercial.versiones
  FOR ALL USING (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''))
  WITH CHECK (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''));

ALTER TABLE optima_comercial.borradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE optima_comercial.borradores FORCE ROW LEVEL SECURITY;
CREATE POLICY borradores_empresa ON optima_comercial.borradores
  FOR ALL USING (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''))
  WITH CHECK (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''));

ALTER TABLE optima_comercial.eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE optima_comercial.eventos FORCE ROW LEVEL SECURITY;
CREATE POLICY eventos_empresa ON optima_comercial.eventos
  FOR ALL USING (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''))
  WITH CHECK (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''));

ALTER TABLE optima_comercial.idempotencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE optima_comercial.idempotencia FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotencia_empresa ON optima_comercial.idempotencia
  FOR ALL USING (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''))
  WITH CHECK (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''));
COMMIT;
