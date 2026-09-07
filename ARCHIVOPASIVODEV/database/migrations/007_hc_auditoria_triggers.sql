USE `archivo_pasivo`;

DROP TRIGGER IF EXISTS trg_hc_auditoria_ai;
DROP TRIGGER IF EXISTS trg_hc_auditoria_au;

DELIMITER $$
CREATE TRIGGER trg_hc_auditoria_ai
AFTER INSERT ON historias_clinicas
FOR EACH ROW
BEGIN
  INSERT INTO historias_clinicas_auditoria
    (historia_clinica_id, pedido_id, usuario_id, accion, campo, valor_anterior, valor_nuevo)
  VALUES
    (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'CREAR'), 'dni', NULL, NEW.dni),
    (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'CREAR'), 'apellido_nombre', NULL, NEW.apellido_nombre),
    (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'CREAR'), 'fecha_ultimo_movimiento', NULL, DATE_FORMAT(NEW.fecha_ultimo_movimiento, '%Y-%m-%d')),
    (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'CREAR'), 'caja', NULL, NEW.caja),
    (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'CREAR'), 'comentarios', NULL, NEW.comentarios),
    (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'CREAR'), 'etiqueta_impresa', NULL, CAST(NEW.etiqueta_impresa AS CHAR));
END$$

CREATE TRIGGER trg_hc_auditoria_au
AFTER UPDATE ON historias_clinicas
FOR EACH ROW
BEGIN
  IF NOT (OLD.dni <=> NEW.dni) THEN
    INSERT INTO historias_clinicas_auditoria
      (historia_clinica_id, pedido_id, usuario_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'ACTUALIZAR'), 'dni', OLD.dni, NEW.dni);
  END IF;

  IF NOT (OLD.apellido_nombre <=> NEW.apellido_nombre) THEN
    INSERT INTO historias_clinicas_auditoria
      (historia_clinica_id, pedido_id, usuario_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'ACTUALIZAR'), 'apellido_nombre', OLD.apellido_nombre, NEW.apellido_nombre);
  END IF;

  IF NOT (OLD.fecha_ultimo_movimiento <=> NEW.fecha_ultimo_movimiento) THEN
    INSERT INTO historias_clinicas_auditoria
      (historia_clinica_id, pedido_id, usuario_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'ACTUALIZAR'), 'fecha_ultimo_movimiento', DATE_FORMAT(OLD.fecha_ultimo_movimiento, '%Y-%m-%d'), DATE_FORMAT(NEW.fecha_ultimo_movimiento, '%Y-%m-%d'));
  END IF;

  IF NOT (OLD.caja <=> NEW.caja) THEN
    INSERT INTO historias_clinicas_auditoria
      (historia_clinica_id, pedido_id, usuario_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'ACTUALIZAR'), 'caja', OLD.caja, NEW.caja);
  END IF;

  IF NOT (OLD.comentarios <=> NEW.comentarios) THEN
    INSERT INTO historias_clinicas_auditoria
      (historia_clinica_id, pedido_id, usuario_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'ACTUALIZAR'), 'comentarios', OLD.comentarios, NEW.comentarios);
  END IF;

  IF NOT (OLD.etiqueta_impresa <=> NEW.etiqueta_impresa) THEN
    INSERT INTO historias_clinicas_auditoria
      (historia_clinica_id, pedido_id, usuario_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'ACTUALIZAR'), 'etiqueta_impresa', CAST(OLD.etiqueta_impresa AS CHAR), CAST(NEW.etiqueta_impresa AS CHAR));
  END IF;

  IF NOT (OLD.fecha_impresion <=> NEW.fecha_impresion) THEN
    INSERT INTO historias_clinicas_auditoria
      (historia_clinica_id, pedido_id, usuario_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'ACTUALIZAR'), 'fecha_impresion', DATE_FORMAT(OLD.fecha_impresion, '%Y-%m-%d %H:%i:%s'), DATE_FORMAT(NEW.fecha_impresion, '%Y-%m-%d %H:%i:%s'));
  END IF;

  IF NOT (OLD.impreso_por <=> NEW.impreso_por) THEN
    INSERT INTO historias_clinicas_auditoria
      (historia_clinica_id, pedido_id, usuario_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (NEW.id, @hc_audit_pedido_id, @hc_audit_usuario_id, COALESCE(@hc_audit_accion, 'ACTUALIZAR'), 'impreso_por', CAST(OLD.impreso_por AS CHAR), CAST(NEW.impreso_por AS CHAR));
  END IF;
END$$
DELIMITER ;
