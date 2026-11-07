-- 105: estados nuevos en siape_carga_dias (robot de francos de reconocimientos medicos, 02/11/2026).
--   El robot cargaba el franco en dias corridos (sabados/domingos de agentes L-V). Ahora:
--   NO_TRABAJA_DIA = el dia no esta en el horario del agente: no se carga.
--   BORRAR         = el robot lo habia cargado y no corresponde: lo borra en SiAPe.
--   BORRADO        = ya se borro en SiAPe.
--   ERROR_BORRAR   = no se pudo borrar solo (agotados los intentos, o tenia otra novedad antes del franco).
--   Idempotente: MODIFY con la lista completa.
ALTER TABLE siape_carga_dias
  MODIFY estado ENUM('CARGADO','YA_EXISTIA','ERROR','NO_TRABAJA_DIA','BORRAR','BORRADO','ERROR_BORRAR') NOT NULL;
