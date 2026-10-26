-- 081: alertas_agente.origen = clave de la alerta generada automáticamente por un error de datos de un
-- robot ("carga|<sha1 de cola+dni+tipo de motivo>"). Sirve para no duplicarla, cerrarla sola cuando el
-- error desaparece de la cola y no recrearla si alguien la desactivó (services/alertasCargaRobots.ts).
-- La columna también se agrega sola en runtime (ensureEsquema) si falta.
ALTER TABLE alertas_agente ADD COLUMN origen VARCHAR(80) NULL, ADD KEY idx_alertas_agente_origen (origen);
