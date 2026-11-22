-- 144__agenda_cola_sin_leer.sql (21/11/2026, pedido del usuario)
-- Antes de mandar cada enlace, la PC que manda revisa en WhatsApp Web (sin abrir el chat) si esa persona
-- tenía mensajes SIN LEER. Si tenía: NO se manda (al mandar, WhatsApp los marcaría como leídos), queda
-- RETENIDO con lo que decían y la página avisa en el banner. La oficina decide: "Mandar igual" (forzar)
-- o "Ya lo atendí". Se aplica también en runtime (ensureAgendaTablas): ADD COLUMN repetido se ignora.

ALTER TABLE agenda_envios_cola MODIFY COLUMN estado ENUM('PENDIENTE','TOMADO','ENVIADO','ERROR','SALTEADO','CANCELADO','RETENIDO') NOT NULL DEFAULT 'PENDIENTE';
ALTER TABLE agenda_envios_cola ADD COLUMN sin_leer INT NULL COMMENT 'mensajes sin leer que tenía al ir a mandar (-1 = marcado como no leído a mano)';
ALTER TABLE agenda_envios_cola ADD COLUMN sin_leer_json TEXT NULL COMMENT 'lo que decían: [{t, tipo, texto}]';
ALTER TABLE agenda_envios_cola ADD COLUMN forzar TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = la oficina dijo Mandar igual (no se revisan los sin leer)';
