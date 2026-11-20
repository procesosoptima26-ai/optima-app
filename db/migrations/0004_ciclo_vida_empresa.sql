-- OPTIMA Core 0004 — ciclo de vida de la empresa cliente (Tarea 5).
-- Guarda TRES hechos por empresa: hasta cuándo está pagado el período,
-- desde cuándo está suspendida y desde cuándo está cancelada; más un REGISTRO
-- inmodificable de cada cambio (quién, cuándo y por qué).
-- Solo AGREGA tablas nuevas. No toca contratos, versiones ni datos existentes.
-- El rol de lectura recibe SOLO SELECT; los permisos de escritura se otorgan
-- en la etapa que habilita los cambios (no ahora).
BEGIN;

CREATE TABLE optima_comercial.ciclo_vida (
  empresa_id TEXT PRIMARY KEY CHECK (empresa_id ~ '^emp_[a-z0-9]{12}$'),
  periodo_hasta TIMESTAMPTZ,
  suspendido_desde TIMESTAMPTZ,
  cancelado_desde TIMESTAMPTZ,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE optima_comercial.ciclo_vida_eventos (
  id_evento BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id TEXT NOT NULL,
  revision_despues BIGINT NOT NULL CHECK (revision_despues >= 1),
  tipo TEXT NOT NULL CHECK (tipo IN
    ('RENOVACION', 'SUSPENSION', 'LEVANTAR_SUSPENSION', 'CANCELACION', 'REACTIVACION')),
  actor_usuario_id TEXT NOT NULL CHECK (actor_usuario_id ~ '^rec[A-Za-z0-9]{14}$'),
  motivo TEXT NOT NULL CHECK (char_length(motivo) BETWEEN 10 AND 500),
  periodo_hasta_despues TIMESTAMPTZ,
  suspendido_desde_despues TIMESTAMPTZ,
  cancelado_desde_despues TIMESTAMPTZ,
  fecha_evento TIMESTAMPTZ NOT NULL,
  registrada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, revision_despues),
  FOREIGN KEY (empresa_id) REFERENCES optima_comercial.ciclo_vida (empresa_id) ON DELETE RESTRICT
);

-- Los eventos nunca se editan ni se borran; el estado de una empresa nunca se borra.
CREATE TRIGGER ciclo_vida_eventos_inmutables BEFORE UPDATE OR DELETE
  ON optima_comercial.ciclo_vida_eventos
  FOR EACH ROW EXECUTE FUNCTION optima_comercial.bloquear_mutacion_eventos();
CREATE TRIGGER ciclo_vida_no_borrar BEFORE DELETE ON optima_comercial.ciclo_vida
  FOR EACH ROW EXECUTE FUNCTION optima_comercial.bloquear_mutacion_eventos();

-- Aislamiento por empresa (igual que el resto de las tablas comerciales).
ALTER TABLE optima_comercial.ciclo_vida ENABLE ROW LEVEL SECURITY;
ALTER TABLE optima_comercial.ciclo_vida FORCE ROW LEVEL SECURITY;
CREATE POLICY ciclo_vida_empresa ON optima_comercial.ciclo_vida
  FOR ALL USING (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''))
  WITH CHECK (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''));
ALTER TABLE optima_comercial.ciclo_vida_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE optima_comercial.ciclo_vida_eventos FORCE ROW LEVEL SECURITY;
CREATE POLICY ciclo_vida_eventos_empresa ON optima_comercial.ciclo_vida_eventos
  FOR ALL USING (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''))
  WITH CHECK (empresa_id = NULLIF(current_setting('optima.empresa_id', true), ''));

REVOKE ALL ON optima_comercial.ciclo_vida FROM PUBLIC;
REVOKE ALL ON optima_comercial.ciclo_vida_eventos FROM PUBLIC;

-- Solo lectura para el rol lector (si existe en esta base).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'optima_preview_reader') THEN
    GRANT SELECT ON optima_comercial.ciclo_vida TO optima_preview_reader;
  ELSE
    RAISE NOTICE 'No existe el rol optima_preview_reader: otorgar SELECT en ciclo_vida al rol lector que corresponda.';
  END IF;
END
$$;

COMMIT;
