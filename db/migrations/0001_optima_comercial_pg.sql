-- OPTIMA 12C.18.1 — PostgreSQL (DISEÑO PARA AMBIENTE AISLADO)
-- NO EJECUTAR EN PRODUCCION; requiere DBA, backup, roles y pruebas reales.
-- Ejecutar una sola vez en una base NUEVA, separada de Frioteka.
-- No se crean usuarios, permisos de aplicación, endpoints ni conexiones Airtable.
BEGIN;
CREATE SCHEMA optima_comercial;
REVOKE ALL ON SCHEMA optima_comercial FROM PUBLIC;

CREATE TABLE optima_comercial.contratos (
  empresa_id TEXT NOT NULL CHECK (empresa_id ~ '^rec[A-Za-z0-9]{14}$'),
  id_contrato TEXT NOT NULL CHECK (id_contrato ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$'),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  huella_historial CHAR(64) NOT NULL CHECK (huella_historial ~ '^[0-9a-f]{64}$'),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id_contrato)
);

CREATE TABLE optima_comercial.versiones (
  empresa_id TEXT NOT NULL,
  id_contrato TEXT NOT NULL,
  id_version TEXT NOT NULL CHECK (id_version ~ '^VER-[A-Za-z0-9_-]{4,60}$'),
  numero INTEGER NOT NULL CHECK (numero > 0),
  estado TEXT NOT NULL CHECK (estado IN ('APROBADA', 'VIGENTE', 'HISTORICA')),
  servicios JSONB NOT NULL CHECK (jsonb_typeof(servicios) = 'array'),
  motivo_cambio TEXT NOT NULL CHECK (char_length(motivo_cambio) BETWEEN 10 AND 500),
  aprobado_por_id TEXT NOT NULL CHECK (aprobado_por_id ~ '^rec[A-Za-z0-9]{14}$'),
  aprobado_en TIMESTAMPTZ NOT NULL,
  vigente_desde TIMESTAMPTZ,
  vigente_hasta TIMESTAMPTZ,
  sustituida_por_id TEXT,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id_contrato, id_version),
  UNIQUE (empresa_id, id_contrato, numero),
  FOREIGN KEY (empresa_id, id_contrato) REFERENCES optima_comercial.contratos
    (empresa_id, id_contrato) ON DELETE RESTRICT,
  FOREIGN KEY (empresa_id, id_contrato, sustituida_por_id)
    REFERENCES optima_comercial.versiones(empresa_id, id_contrato, id_version)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (estado = 'APROBADA' AND vigente_desde IS NULL AND vigente_hasta IS NULL AND sustituida_por_id IS NULL)
    OR (estado = 'VIGENTE' AND vigente_desde IS NOT NULL AND vigente_hasta IS NULL AND sustituida_por_id IS NULL AND vigente_desde >= aprobado_en)
    OR (estado = 'HISTORICA' AND vigente_desde IS NOT NULL AND vigente_hasta IS NOT NULL AND sustituida_por_id IS NOT NULL
        AND vigente_desde >= aprobado_en AND vigente_hasta >= vigente_desde)
  )
);
CREATE UNIQUE INDEX una_version_vigente_por_contrato
  ON optima_comercial.versiones (empresa_id, id_contrato) WHERE estado = 'VIGENTE';
CREATE UNIQUE INDEX una_version_aprobada_por_contrato
  ON optima_comercial.versiones (empresa_id, id_contrato) WHERE estado = 'APROBADA';

CREATE TABLE optima_comercial.borradores (
  empresa_id TEXT NOT NULL,
  id_contrato TEXT NOT NULL,
  id_borrador TEXT NOT NULL,
  revision_borrador BIGINT NOT NULL CHECK (revision_borrador >= 1),
  version_base INTEGER,
  servicios_propuestos JSONB NOT NULL CHECK (jsonb_typeof(servicios_propuestos) = 'array'),
  motivo_cambio TEXT NOT NULL CHECK (char_length(motivo_cambio) BETWEEN 10 AND 500),
  estado TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR', 'DESCARTADO', 'APROBADO')),
  creado_por_id TEXT NOT NULL CHECK (creado_por_id ~ '^rec[A-Za-z0-9]{14}$'),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id_contrato, id_borrador),
  FOREIGN KEY (empresa_id, id_contrato) REFERENCES optima_comercial.contratos
    (empresa_id, id_contrato) ON DELETE RESTRICT
);

CREATE TABLE optima_comercial.eventos (
  id_evento BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id TEXT NOT NULL,
  id_contrato TEXT NOT NULL,
  revision_antes BIGINT NOT NULL CHECK (revision_antes >= 0),
  revision_despues BIGINT NOT NULL CHECK (revision_despues = revision_antes + 1),
  tipo TEXT NOT NULL CHECK (tipo IN ('APROBACION', 'ACTIVACION')),
  id_version TEXT NOT NULL,
  id_version_anterior TEXT,
  actor_usuario_id TEXT NOT NULL CHECK (actor_usuario_id ~ '^rec[A-Za-z0-9]{14}$'),
  fecha_evento TIMESTAMPTZ NOT NULL,
  registrada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, id_contrato, revision_despues),
  FOREIGN KEY (empresa_id, id_contrato) REFERENCES optima_comercial.contratos
    (empresa_id, id_contrato) ON DELETE RESTRICT,
  FOREIGN KEY (empresa_id, id_contrato, id_version)
    REFERENCES optima_comercial.versiones (empresa_id, id_contrato, id_version)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE optima_comercial.idempotencia (
  empresa_id TEXT NOT NULL,
  id_contrato TEXT NOT NULL,
  clave TEXT NOT NULL CHECK (clave ~ '^OP-[A-Za-z0-9_-]{8,72}$'),
  huella_solicitud CHAR(64) NOT NULL CHECK (huella_solicitud ~ '^[0-9a-f]{64}$'),
  respuesta JSONB NOT NULL CHECK (jsonb_typeof(respuesta) = 'object'),
  revision_aplicada BIGINT NOT NULL CHECK (revision_aplicada >= 1),
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id_contrato, clave),
  FOREIGN KEY (empresa_id, id_contrato) REFERENCES optima_comercial.contratos
    (empresa_id, id_contrato) ON DELETE RESTRICT
);

-- Auditoría de éxito: eventos siempre anexados, nunca editados ni borrados.
CREATE FUNCTION optima_comercial.bloquear_mutacion_eventos()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los eventos de contratación son inmutables';
END;
$$;
CREATE TRIGGER eventos_inmutables BEFORE UPDATE OR DELETE ON optima_comercial.eventos
FOR EACH ROW EXECUTE FUNCTION optima_comercial.bloquear_mutacion_eventos();

-- Datos económicos/de servicios aprobados nunca se reescriben.
CREATE FUNCTION optima_comercial.controlar_transicion_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.empresa_id IS DISTINCT FROM NEW.empresa_id OR
     OLD.id_contrato IS DISTINCT FROM NEW.id_contrato OR
     OLD.id_version IS DISTINCT FROM NEW.id_version OR
     OLD.numero IS DISTINCT FROM NEW.numero OR
     OLD.servicios IS DISTINCT FROM NEW.servicios OR
     OLD.motivo_cambio IS DISTINCT FROM NEW.motivo_cambio OR
     OLD.aprobado_por_id IS DISTINCT FROM NEW.aprobado_por_id OR
     OLD.aprobado_en IS DISTINCT FROM NEW.aprobado_en OR
     OLD.creada_en IS DISTINCT FROM NEW.creada_en THEN
    RAISE EXCEPTION 'No se pueden reescribir datos de una versión aprobada';
  END IF;
  IF NOT ((OLD.estado = 'APROBADA' AND NEW.estado = 'VIGENTE')
       OR (OLD.estado = 'VIGENTE' AND NEW.estado = 'HISTORICA')) THEN
    RAISE EXCEPTION 'Transición comercial no permitida';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER versiones_cambios_controlados BEFORE UPDATE ON optima_comercial.versiones
FOR EACH ROW EXECUTE FUNCTION optima_comercial.controlar_transicion_version();
CREATE TRIGGER versiones_no_borrar BEFORE DELETE ON optima_comercial.versiones
FOR EACH ROW EXECUTE FUNCTION optima_comercial.bloquear_mutacion_eventos();
CREATE TRIGGER contratos_no_borrar BEFORE DELETE ON optima_comercial.contratos
FOR EACH ROW EXECUTE FUNCTION optima_comercial.bloquear_mutacion_eventos();
CREATE TRIGGER idempotencia_no_modificar BEFORE UPDATE OR DELETE ON optima_comercial.idempotencia
FOR EACH ROW EXECUTE FUNCTION optima_comercial.bloquear_mutacion_eventos();

-- La asignación de roles/GRANT, auditoría de rechazos y políticas RLS quedan
-- pendientes para la etapa de backend autenticado. Nada queda disponible a PUBLIC.
REVOKE ALL ON ALL TABLES IN SCHEMA optima_comercial FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA optima_comercial FROM PUBLIC;
COMMIT;
