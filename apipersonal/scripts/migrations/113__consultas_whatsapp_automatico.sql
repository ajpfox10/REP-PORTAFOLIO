-- 113: consultas_whatsapp recibe el conteo AUTOMÁTICO (whatsapp_recibidos, extensión de Chrome).
-- cantidad = personas distintas que escribieron ese día (lo que usa el comparativo).
-- origen: MANUAL = cargado a mano (no se pisa si es > 0) · AUTO = volcado del conteo automático.
-- Las franjas y agentes/sin_agente cuentan PERSONAS (una persona puede caer en más de una franja).
-- La API también agrega estas columnas sola al arrancar (ensureColumnasAutomatico en whatsapp.routes.ts).
ALTER TABLE consultas_whatsapp
  ADD COLUMN mensajes   INT NULL AFTER cantidad,
  ADD COLUMN personas   INT NULL AFTER mensajes,
  ADD COLUMN manana     INT NULL AFTER personas,
  ADD COLUMN tarde      INT NULL AFTER manana,
  ADD COLUMN noche      INT NULL AFTER tarde,
  ADD COLUMN finde      INT NULL AFTER noche,
  ADD COLUMN agentes    INT NULL AFTER finde,
  ADD COLUMN sin_agente INT NULL AFTER agentes,
  ADD COLUMN origen     ENUM('MANUAL','AUTO') NULL AFTER sin_agente,
  ADD COLUMN volcado_at DATETIME NULL AFTER origen;

-- lo cargado a mano hasta hoy queda marcado como MANUAL
UPDATE consultas_whatsapp SET origen = 'MANUAL' WHERE cantidad > 0 AND origen IS NULL;
