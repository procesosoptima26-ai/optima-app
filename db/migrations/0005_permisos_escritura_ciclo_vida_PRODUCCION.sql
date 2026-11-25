-- OPTIMA Core 0005 — permisos EXACTOS para que la app (rol de escritura de Producción)
-- pueda cambiar el estado de una empresa. Solo otorga permisos; no crea ni cambia datos.
--   ciclo_vida          : leer, insertar y modificar (nunca borrar)
--   ciclo_vida_eventos  : leer e insertar (nunca modificar ni borrar; además lo bloquea un trigger)
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'optima_prod_writer') THEN
    RAISE EXCEPTION 'No existe el rol optima_prod_writer en esta base';
  END IF;
  GRANT SELECT, INSERT, UPDATE ON optima_comercial.ciclo_vida TO optima_prod_writer;
  GRANT SELECT, INSERT ON optima_comercial.ciclo_vida_eventos TO optima_prod_writer;
  GRANT USAGE ON SEQUENCE optima_comercial.ciclo_vida_eventos_id_evento_seq TO optima_prod_writer;
  IF has_table_privilege('optima_prod_writer', 'optima_comercial.ciclo_vida', 'DELETE')
     OR has_table_privilege('optima_prod_writer', 'optima_comercial.ciclo_vida_eventos', 'UPDATE')
     OR has_table_privilege('optima_prod_writer', 'optima_comercial.ciclo_vida_eventos', 'DELETE') THEN
    RAISE EXCEPTION 'El rol de escritura tiene permisos de más';
  END IF;
END
$$;
COMMIT;
