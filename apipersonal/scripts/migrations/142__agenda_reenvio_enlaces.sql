-- 142__agenda_reenvio_enlaces.sql (19/11/2026, pedido del usuario)
-- Reenviar enlaces pendientes cuando cambia la dirección pública (túnel rápido de Cloudflare caído → dirección nueva).
-- Se anota con qué dirección se mandó cada enlace (al tocar WhatsApp / Copiar mensaje en la oficina):
-- un enlace SIN USAR mandado con otra dirección = hay que reenviarlo.
-- Se aplica también en runtime (ensureAgendaTablas): ADD COLUMN repetido (1060) se ignora.

ALTER TABLE agenda_habilitaciones ADD COLUMN enviado_url VARCHAR(255) NULL COMMENT 'dirección pública con la que se mandó el enlace la última vez';
ALTER TABLE agenda_habilitaciones ADD COLUMN enviado_at DATETIME NULL COMMENT 'cuándo se mandó/copió el mensaje la última vez';
ALTER TABLE agenda_habilitaciones ADD COLUMN envios INT NOT NULL DEFAULT 0 COMMENT 'veces que se mandó/copió el mensaje';
