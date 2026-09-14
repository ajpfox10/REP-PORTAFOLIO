-- 047__agentes_estado_cambio_ocupacion.sql
--
-- Suma el estado 'CAMBIO DE OCUPACION' al ENUM agentes.estado_empleo.
--
-- Un cambio de ocupacion (p.ej. un administrativo que se recibe y pasa a
-- tecnico) se modela como un hito de carrera: se cierra el tramo vigente con
-- este estado y fecha_egreso, y se abre un tramo nuevo ACTIVO el dia siguiente.
-- Se usa un estado propio (no 'BAJA') para que no cuente como baja real, igual
-- que 'CAMBIO DE DNI'.
--
-- Correr en dev y prod (personalv5).

ALTER TABLE agentes
  MODIFY COLUMN estado_empleo
  ENUM('ACTIVO','INACTIVO','BAJA','COMISION','TRAMITE','CAMBIO DE DNI','CAMBIO DE OCUPACION')
  NULL DEFAULT NULL;
