-- OPTIMA Core 0006 (PRODUCCIÓN) — permisos EXACTOS de los dos roles de la aplicación.
-- Por qué existe: las migraciones 0001 y 0002 no otorgan permisos a nadie. En Preview
-- se otorgaron a mano; acá quedan escritos y verificados para poder repetirlos igual.
-- Solo otorga permisos; no crea ni cambia datos. Ejecutar DESPUÉS de 0001..0005.
--   Lector  (optima_prod_reader): solo SELECT.
--   Escritor(optima_prod_writer): nunca DELETE; en tablas de historial solo INSERT/SELECT.
BEGIN;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['optima_prod_reader', 'optima_prod_writer'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      RAISE EXCEPTION 'No existe el rol % en esta base', r;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN
      RAISE EXCEPTION 'El rol % tiene privilegios de más (superusuario, salta seguridad por empresa, o crea roles/bases)', r;
    END IF;
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA optima_comercial TO optima_prod_reader, optima_prod_writer;

-- Lector
GRANT SELECT ON optima_comercial.borradores, optima_comercial.ciclo_vida,
  optima_comercial.contratos, optima_comercial.eventos, optima_comercial.versiones
  TO optima_prod_reader;

-- Escritor
GRANT SELECT, INSERT, UPDATE ON optima_comercial.borradores, optima_comercial.contratos,
  optima_comercial.versiones TO optima_prod_writer;
GRANT SELECT, INSERT ON optima_comercial.eventos, optima_comercial.idempotencia
  TO optima_prod_writer;
GRANT USAGE ON SEQUENCE optima_comercial.eventos_id_evento_seq TO optima_prod_writer;
-- (ciclo_vida y ciclo_vida_eventos, con su secuencia, las otorga 0005.)

-- Verificación: si algo no coincide exactamente, TODO se deshace.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['borradores','ciclo_vida','ciclo_vida_eventos','contratos','eventos','idempotencia','versiones'] LOOP
    IF has_table_privilege('optima_prod_writer', 'optima_comercial.' || t, 'DELETE')
       OR has_table_privilege('optima_prod_writer', 'optima_comercial.' || t, 'TRUNCATE')
       OR has_table_privilege('optima_prod_reader', 'optima_comercial.' || t, 'INSERT')
       OR has_table_privilege('optima_prod_reader', 'optima_comercial.' || t, 'UPDATE')
       OR has_table_privilege('optima_prod_reader', 'optima_comercial.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'Permisos de más en la tabla %', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ciclo_vida_eventos','eventos','idempotencia'] LOOP
    IF has_table_privilege('optima_prod_writer', 'optima_comercial.' || t, 'UPDATE') THEN
      RAISE EXCEPTION 'El escritor no debe modificar la tabla de historial %', t;
    END IF;
  END LOOP;
  IF NOT (has_table_privilege('optima_prod_writer', 'optima_comercial.contratos', 'UPDATE')
      AND has_table_privilege('optima_prod_writer', 'optima_comercial.versiones', 'UPDATE')
      AND has_table_privilege('optima_prod_writer', 'optima_comercial.borradores', 'UPDATE')
      AND has_table_privilege('optima_prod_writer', 'optima_comercial.ciclo_vida', 'UPDATE')
      AND has_table_privilege('optima_prod_writer', 'optima_comercial.eventos', 'INSERT')
      AND has_table_privilege('optima_prod_writer', 'optima_comercial.idempotencia', 'INSERT')
      AND has_table_privilege('optima_prod_reader', 'optima_comercial.ciclo_vida', 'SELECT')) THEN
    RAISE EXCEPTION 'Faltan permisos esperados';
  END IF;
END
$$;
COMMIT;
