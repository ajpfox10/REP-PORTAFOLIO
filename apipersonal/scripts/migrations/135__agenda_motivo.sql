-- 135__agenda_motivo.sql (16/11/2026)
-- Una sola agenda para la oficina (así no se pisan los horarios) y cada turno lleva su MOTIVO:
-- lista fija (Jubilación, Entrega de papeles, Nacimiento, Apelación de licencia) u "Otro" escrito a mano.
-- Lo elige la oficina al habilitar/dar el turno; si el enlace salió sin motivo, lo elige el agente.
-- Solo los turnos con motivo "Jubilación" se copian a jubilacion_citas.
-- Además: agenda_turnos.citacion_id = citación creada en `citaciones` (sincronizarCitaciones).
-- Se aplica también en runtime (ensureAgendaTablas): un ADD COLUMN repetido (1060) se ignora.

ALTER TABLE agenda_habilitaciones ADD COLUMN motivo VARCHAR(150) NULL COMMENT 'motivo elegido por la oficina (NULL = lo elige el agente)';
ALTER TABLE agenda_turnos ADD COLUMN motivo VARCHAR(150) NULL;
ALTER TABLE agenda_turnos ADD COLUMN citacion_id INT NULL COMMENT 'citación creada en citaciones';

-- Los turnos que ya se copiaron a jubilación son de motivo Jubilación
UPDATE agenda_turnos SET motivo = 'Jubilación' WHERE motivo IS NULL AND jubilacion_cita_id IS NOT NULL;

-- La agenda "Jubilación" pasa a ser la agenda única de la oficina
UPDATE agendas SET nombre = 'Turnos de Personal' WHERE nombre = 'Jubilación' AND carga_jubilacion = 1
   AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM agendas WHERE nombre = 'Turnos de Personal') x);
