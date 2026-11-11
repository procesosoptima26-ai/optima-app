\set ON_ERROR_STOP on
-- OPTIMA 12C.18.2: se ejecuta únicamente en instancia PostgreSQL efímera
-- preparada por scripts/probar-postgres-aislado-12c182.sh.
BEGIN;
INSERT INTO optima_comercial.contratos
  (empresa_id, id_contrato, revision, huella_historial)
VALUES ('recAAAAAAAAAAAAAA', 'CTR-PRUEBA-182', 0, repeat('a',64));
INSERT INTO optima_comercial.versiones
  (empresa_id,id_contrato,id_version,numero,estado,servicios,motivo_cambio,
   aprobado_por_id,aprobado_en)
VALUES ('recAAAAAAAAAAAAAA','CTR-PRUEBA-182','VER-PRUEBA-0001',1,'APROBADA',
        '[]'::jsonb,'Aprobación para pruebas aisladas','recBBBBBBBBBBBBBB',
        '2026-11-11T10:00:00Z');

DO $test$
DECLARE fallo BOOLEAN := false;
BEGIN
  -- La aprobación no puede convertirse directamente en histórica.
  BEGIN
    UPDATE optima_comercial.versiones SET estado='HISTORICA',
      vigente_desde='2026-11-11T11:00:00Z', vigente_hasta='2026-11-11T12:00:00Z',
      sustituida_por_id='VER-PRUEBA-0002'
    WHERE id_version='VER-PRUEBA-0001';
  EXCEPTION WHEN raise_exception THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Transición APROBADA -> HISTORICA permitida'; END IF;
END
$test$;

UPDATE optima_comercial.versiones SET estado='VIGENTE',
    vigente_desde='2026-11-11T11:00:00Z'
WHERE empresa_id='recAAAAAAAAAAAAAA' AND id_contrato='CTR-PRUEBA-182'
AND id_version='VER-PRUEBA-0001';

DO $test$
DECLARE fallo BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE optima_comercial.versiones SET servicios='[{"falso":true}]'::jsonb,
      estado='HISTORICA', vigente_hasta='2026-11-11T12:00:00Z',
      sustituida_por_id='VER-PRUEBA-0002'
    WHERE id_version='VER-PRUEBA-0001';
  EXCEPTION WHEN raise_exception THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Datos de versión aprobada reescritos'; END IF;
END
$test$;

INSERT INTO optima_comercial.versiones
  (empresa_id,id_contrato,id_version,numero,estado,servicios,motivo_cambio,
   aprobado_por_id,aprobado_en)
VALUES ('recAAAAAAAAAAAAAA','CTR-PRUEBA-182','VER-PRUEBA-0002',2,'APROBADA',
        '[]'::jsonb,'Cambio para pruebas aisladas','recBBBBBBBBBBBBBB',
        '2026-11-11T12:00:00Z');

DO $test$
DECLARE fallo BOOLEAN := false;
BEGIN
  -- Un contrato no puede tener dos VIGENTES al mismo tiempo.
  BEGIN
    UPDATE optima_comercial.versiones SET estado='VIGENTE',
       vigente_desde='2026-11-11T13:00:00Z'
    WHERE id_version='VER-PRUEBA-0002';
  EXCEPTION WHEN unique_violation THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Dos versiones vigentes permitidas'; END IF;
END
$test$;

DO $test$
DECLARE fallo BOOLEAN := false;
BEGIN
  -- Tampoco se pueden crear dos versiones APROBADAS simultáneas.
  BEGIN
    INSERT INTO optima_comercial.versiones
      (empresa_id,id_contrato,id_version,numero,estado,servicios,motivo_cambio,
       aprobado_por_id,aprobado_en)
    VALUES ('recAAAAAAAAAAAAAA','CTR-PRUEBA-182','VER-PRUEBA-0003',3,'APROBADA',
      '[]','Otra aprobación para comprobación','recBBBBBBBBBBBBBB','2026-11-11T12:00:00Z');
  EXCEPTION WHEN unique_violation THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Dos versiones aprobadas permitidas'; END IF;
END
$test$;

UPDATE optima_comercial.versiones SET estado='HISTORICA',
    vigente_hasta='2026-11-11T13:00:00Z', sustituida_por_id='VER-PRUEBA-0002'
WHERE id_version='VER-PRUEBA-0001';
UPDATE optima_comercial.versiones SET estado='VIGENTE',
    vigente_desde='2026-11-11T13:00:00Z'
WHERE id_version='VER-PRUEBA-0002';

INSERT INTO optima_comercial.eventos
  (empresa_id,id_contrato,revision_antes,revision_despues,tipo,id_version,
   actor_usuario_id,fecha_evento)
VALUES ('recAAAAAAAAAAAAAA','CTR-PRUEBA-182',0,1,'APROBACION',
        'VER-PRUEBA-0001','recBBBBBBBBBBBBBB','2026-11-11T10:00:00Z');

INSERT INTO optima_comercial.idempotencia
  (empresa_id,id_contrato,clave,huella_solicitud,respuesta,revision_aplicada)
VALUES ('recAAAAAAAAAAAAAA','CTR-PRUEBA-182','OP-PRUEBA-00000001',repeat('b',64),
        '{"revisionAplicada":1,"idVersion":"VER-PRUEBA-0001","tipo":"APROBACION"}'::jsonb,1);

DO $test$
DECLARE fallo BOOLEAN;
BEGIN
  fallo := false;
  BEGIN
    UPDATE optima_comercial.eventos SET tipo='ACTIVACION' WHERE revision_despues=1;
  EXCEPTION WHEN raise_exception THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Auditoría editable'; END IF;
  fallo := false;
  BEGIN
    DELETE FROM optima_comercial.eventos WHERE revision_despues=1;
  EXCEPTION WHEN raise_exception THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Auditoría borrable'; END IF;
  fallo := false;
  BEGIN
    UPDATE optima_comercial.idempotencia SET revision_aplicada=2
    WHERE clave='OP-PRUEBA-00000001';
  EXCEPTION WHEN raise_exception THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Idempotencia mutable'; END IF;
  fallo := false;
  BEGIN
    INSERT INTO optima_comercial.idempotencia
      (empresa_id,id_contrato,clave,huella_solicitud,respuesta,revision_aplicada)
    VALUES ('recAAAAAAAAAAAAAA','CTR-PRUEBA-182','OP-PRUEBA-00000001',repeat('b',64),'{}',1);
  EXCEPTION WHEN unique_violation THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Idempotencia duplicada permitida'; END IF;
  fallo := false;
  BEGIN
    INSERT INTO optima_comercial.eventos
      (empresa_id,id_contrato,revision_antes,revision_despues,tipo,id_version,
       actor_usuario_id,fecha_evento)
    VALUES ('recAAAAAAAAAAAAAA','CTR-PRUEBA-182',0,1,'APROBACION',
      'VER-PRUEBA-0001','recBBBBBBBBBBBBBB','2026-11-11T10:00:00Z');
  EXCEPTION WHEN unique_violation THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Evento duplicado permitido'; END IF;
  fallo := false;
  BEGIN
    DELETE FROM optima_comercial.contratos WHERE id_contrato='CTR-PRUEBA-182';
  EXCEPTION WHEN raise_exception THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Contrato borrado'; END IF;
  fallo := false;
  BEGIN
    INSERT INTO optima_comercial.contratos
      (empresa_id,id_contrato,revision,huella_historial)
    VALUES ('identidad-invalida','CTR-OTRO',0,repeat('a',64));
  EXCEPTION WHEN check_violation THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'ID empresa inválido permitido'; END IF;
  fallo := false;
  BEGIN
    INSERT INTO optima_comercial.borradores
      (empresa_id,id_contrato,id_borrador,revision_borrador,servicios_propuestos,
       motivo_cambio,creado_por_id)
    VALUES ('recAAAAAAAAAAAAAA','CTR-INEXISTENTE','BOR-INEXISTENTE',1,'[]',
      'Prueba de clave foránea','recBBBBBBBBBBBBBB');
  EXCEPTION WHEN foreign_key_violation THEN fallo := true;
  END;
  IF NOT fallo THEN RAISE EXCEPTION 'Borrador huérfano permitido'; END IF;
END
$test$;

-- Aislamiento de empresas con mismo identificador comercial.
INSERT INTO optima_comercial.contratos
  (empresa_id,id_contrato,revision,huella_historial)
VALUES ('recCCCCCCCCCCCCCC','CTR-PRUEBA-182',0,repeat('c',64));

DO $test$
BEGIN
  IF (SELECT count(*) FROM optima_comercial.contratos
      WHERE id_contrato='CTR-PRUEBA-182') <> 2 THEN
    RAISE EXCEPTION 'Aislamiento por empresa incorrecto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM optima_comercial.versiones
     WHERE id_version='VER-PRUEBA-0001' AND estado='HISTORICA'
       AND sustituida_por_id='VER-PRUEBA-0002') THEN
    RAISE EXCEPTION 'Historial no conservado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM optima_comercial.versiones
     WHERE id_version='VER-PRUEBA-0002' AND estado='VIGENTE') THEN
    RAISE EXCEPTION 'Nueva versión no vigente';
  END IF;
END
$test$;
ROLLBACK;
DO $test$
BEGIN
 IF EXISTS(SELECT 1 FROM optima_comercial.contratos
   WHERE id_contrato='CTR-PRUEBA-182') THEN
   RAISE EXCEPTION 'ROLLBACK no eliminó las filas de prueba';
 END IF;
END
$test$;
SELECT 'PRUEBAS_SQL_OK_12C182';
