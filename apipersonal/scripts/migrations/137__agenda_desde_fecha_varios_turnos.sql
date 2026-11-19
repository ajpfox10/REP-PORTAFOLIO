-- 137__agenda_desde_fecha_varios_turnos.sql (17/11/2026, pedido del usuario)
-- 1) "Dar turnos a partir del <fecha>": el enlace no ofrece días anteriores a esa fecha y la ventana
--    ("Hasta (días)") se cuenta desde ahí. Se prende/apaga con turnos_desde_activo. La oficina no se limita.
-- 2) Un agente puede tener VARIOS turnos reservados (p.ej. Jubilación + Entrega de papeles):
--    se quita uq_at_dni. El horario sigue siendo exclusivo (uq_at_slot NO se toca).
-- Se aplica también en runtime (ensureAgendaTablas): ADD COLUMN repetido (1060) / DROP INDEX ya hecho (1091) se ignoran.

ALTER TABLE agendas ADD COLUMN turnos_desde DATE NULL COMMENT 'dar turnos a partir de esta fecha';
ALTER TABLE agendas ADD COLUMN turnos_desde_activo TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE agenda_turnos DROP INDEX uq_at_dni;
