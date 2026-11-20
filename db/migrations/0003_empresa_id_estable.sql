-- OPTIMA Core 0003 — el identificador de empresa pasa a ser el código ESTABLE
-- (emp_ + 12 minúsculas/números) en lugar del código interno de Airtable (rec...).
--
-- SEGURIDAD: si existiera alguna fila con empresa_id 'rec...', PostgreSQL rechaza
-- la nueva regla y TODA la transacción se deshace sin cambiar nada.
-- Solo modifica UNA regla de la tabla contratos. No toca datos, roles ni RLS.
BEGIN;

DO $$
DECLARE
  regla text;
BEGIN
  SELECT conname INTO regla
  FROM pg_constraint
  WHERE conrelid = 'optima_comercial.contratos'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%empresa_id%'
    AND pg_get_constraintdef(oid) LIKE '%rec%';
  IF regla IS NULL THEN
    RAISE EXCEPTION 'No se encontró la regla rec... de empresa_id (¿ya fue aplicada?)';
  END IF;
  EXECUTE format('ALTER TABLE optima_comercial.contratos DROP CONSTRAINT %I', regla);
END
$$;

ALTER TABLE optima_comercial.contratos
  ADD CONSTRAINT contratos_empresa_id_estable_check
  CHECK (empresa_id ~ '^emp_[a-z0-9]{12}$');

COMMIT;
