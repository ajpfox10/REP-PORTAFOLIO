-- 043__alertas_jubilacion_event.sql
-- Alertas del tramite jubilatorio en el banner del agente (alertas_agente).
--
-- OJO: este archivo es la copia de referencia. El procedure lo RECREA el codigo
-- en cada arranque (ensureAlertasJubilacionJob en src/routes/jubilacion.routes.ts)
-- y el EVENT se crea con IF NOT EXISTS desde el mismo lugar, asi que en prod no
-- hace falta correr nada a mano. Si cambia la logica, cambiala en el TS.
--
-- Reglas:
--   * la alerta nace cuando hay fecha cargada y el tramite esta abierto
--     (estado IDENTIFICADO / EN_TRAMITE);
--   * se pone urgente cuando faltan 15 dias o menos;
--   * si la fecha pasa, la alerta NO se da de baja: queda como VENCIDA hasta que
--     alguien la elimine a mano (DELETE /alertas-agente/:id);
--   * baja automatica solo si se borra la fecha, se elimina el registro o el
--     agente pasa a Jubilado / Descartado;
--   * una alerta ya cerrada a mano no revive para la misma fecha (se la reconoce
--     porque la fecha va escrita en el texto del mensaje).

DROP PROCEDURE IF EXISTS sp_sync_alertas_jubilacion;

CREATE PROCEDURE sp_sync_alertas_jubilacion()
BEGIN
  -- ── Presentacion de papeles ──────────────────────────────────────────────
  UPDATE alertas_agente a
    JOIN posibles_jubilados p ON p.dni = a.dni
     AND p.deleted_at IS NULL
     AND p.estado IN ('IDENTIFICADO','EN_TRAMITE')
     AND p.fecha_presentacion_papeles IS NOT NULL
  SET a.mensaje = IF(p.fecha_presentacion_papeles >= CURDATE(),
        CONCAT('Presentación de papeles de la jubilación: ', DATE_FORMAT(p.fecha_presentacion_papeles, '%d/%m/%Y'), '.'),
        CONCAT('VENCIDA — debía presentar los papeles de la jubilación el ', DATE_FORMAT(p.fecha_presentacion_papeles, '%d/%m/%Y'), ' (',
               IF(DATEDIFF(CURDATE(), p.fecha_presentacion_papeles) = 1, 'hace 1 día',
                  CONCAT('hace ', DATEDIFF(CURDATE(), p.fecha_presentacion_papeles), ' días')), ').')),
      a.urgente = IF(p.fecha_presentacion_papeles <= CURDATE() + INTERVAL 15 DAY, 1, 0)
  WHERE a.titulo = 'Jubilación · Presentación de papeles' AND a.activa = 1 AND a.deleted_at IS NULL
    AND (a.mensaje <> IF(p.fecha_presentacion_papeles >= CURDATE(),
        CONCAT('Presentación de papeles de la jubilación: ', DATE_FORMAT(p.fecha_presentacion_papeles, '%d/%m/%Y'), '.'),
        CONCAT('VENCIDA — debía presentar los papeles de la jubilación el ', DATE_FORMAT(p.fecha_presentacion_papeles, '%d/%m/%Y'), ' (',
               IF(DATEDIFF(CURDATE(), p.fecha_presentacion_papeles) = 1, 'hace 1 día',
                  CONCAT('hace ', DATEDIFF(CURDATE(), p.fecha_presentacion_papeles), ' días')), ').'))
      OR a.urgente <> IF(p.fecha_presentacion_papeles <= CURDATE() + INTERVAL 15 DAY, 1, 0));

  INSERT INTO alertas_agente (dni, titulo, mensaje, urgente, activa, creado_por)
  SELECT p.dni, 'Jubilación · Presentación de papeles',
         IF(p.fecha_presentacion_papeles >= CURDATE(),
            CONCAT('Presentación de papeles de la jubilación: ', DATE_FORMAT(p.fecha_presentacion_papeles, '%d/%m/%Y'), '.'),
            CONCAT('VENCIDA — debía presentar los papeles de la jubilación el ', DATE_FORMAT(p.fecha_presentacion_papeles, '%d/%m/%Y'), ' (',
                   IF(DATEDIFF(CURDATE(), p.fecha_presentacion_papeles) = 1, 'hace 1 día',
                      CONCAT('hace ', DATEDIFF(CURDATE(), p.fecha_presentacion_papeles), ' días')), ').')),
         IF(p.fecha_presentacion_papeles <= CURDATE() + INTERVAL 15 DAY, 1, 0), 1, NULL
  FROM posibles_jubilados p
  WHERE p.deleted_at IS NULL
    AND p.estado IN ('IDENTIFICADO','EN_TRAMITE')
    AND p.fecha_presentacion_papeles IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM alertas_agente a
      WHERE a.dni = p.dni AND a.titulo = 'Jubilación · Presentación de papeles'
        AND a.mensaje LIKE CONCAT('%', DATE_FORMAT(p.fecha_presentacion_papeles, '%d/%m/%Y'), '%'));

  UPDATE alertas_agente a
  SET a.activa = 0
  WHERE a.titulo = 'Jubilación · Presentación de papeles' AND a.activa = 1 AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM posibles_jubilados p
      WHERE p.dni = a.dni AND p.deleted_at IS NULL
        AND p.estado IN ('IDENTIFICADO','EN_TRAMITE')
        AND p.fecha_presentacion_papeles IS NOT NULL);

  -- ── Fecha prevista de jubilacion ─────────────────────────────────────────
  UPDATE alertas_agente a
    JOIN posibles_jubilados p ON p.dni = a.dni
     AND p.deleted_at IS NULL
     AND p.estado IN ('IDENTIFICADO','EN_TRAMITE')
     AND p.fecha_jubilacion IS NOT NULL
  SET a.mensaje = IF(p.fecha_jubilacion >= CURDATE(),
        CONCAT('Fecha prevista de jubilación: ', DATE_FORMAT(p.fecha_jubilacion, '%d/%m/%Y'), '.'),
        CONCAT('VENCIDA — la fecha prevista de jubilación era el ', DATE_FORMAT(p.fecha_jubilacion, '%d/%m/%Y'), ' (',
               IF(DATEDIFF(CURDATE(), p.fecha_jubilacion) = 1, 'hace 1 día',
                  CONCAT('hace ', DATEDIFF(CURDATE(), p.fecha_jubilacion), ' días')), ').')),
      a.urgente = IF(p.fecha_jubilacion <= CURDATE() + INTERVAL 15 DAY, 1, 0)
  WHERE a.titulo = 'Jubilación · Fecha prevista' AND a.activa = 1 AND a.deleted_at IS NULL
    AND (a.mensaje <> IF(p.fecha_jubilacion >= CURDATE(),
        CONCAT('Fecha prevista de jubilación: ', DATE_FORMAT(p.fecha_jubilacion, '%d/%m/%Y'), '.'),
        CONCAT('VENCIDA — la fecha prevista de jubilación era el ', DATE_FORMAT(p.fecha_jubilacion, '%d/%m/%Y'), ' (',
               IF(DATEDIFF(CURDATE(), p.fecha_jubilacion) = 1, 'hace 1 día',
                  CONCAT('hace ', DATEDIFF(CURDATE(), p.fecha_jubilacion), ' días')), ').'))
      OR a.urgente <> IF(p.fecha_jubilacion <= CURDATE() + INTERVAL 15 DAY, 1, 0));

  INSERT INTO alertas_agente (dni, titulo, mensaje, urgente, activa, creado_por)
  SELECT p.dni, 'Jubilación · Fecha prevista',
         IF(p.fecha_jubilacion >= CURDATE(),
            CONCAT('Fecha prevista de jubilación: ', DATE_FORMAT(p.fecha_jubilacion, '%d/%m/%Y'), '.'),
            CONCAT('VENCIDA — la fecha prevista de jubilación era el ', DATE_FORMAT(p.fecha_jubilacion, '%d/%m/%Y'), ' (',
                   IF(DATEDIFF(CURDATE(), p.fecha_jubilacion) = 1, 'hace 1 día',
                      CONCAT('hace ', DATEDIFF(CURDATE(), p.fecha_jubilacion), ' días')), ').')),
         IF(p.fecha_jubilacion <= CURDATE() + INTERVAL 15 DAY, 1, 0), 1, NULL
  FROM posibles_jubilados p
  WHERE p.deleted_at IS NULL
    AND p.estado IN ('IDENTIFICADO','EN_TRAMITE')
    AND p.fecha_jubilacion IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM alertas_agente a
      WHERE a.dni = p.dni AND a.titulo = 'Jubilación · Fecha prevista'
        AND a.mensaje LIKE CONCAT('%', DATE_FORMAT(p.fecha_jubilacion, '%d/%m/%Y'), '%'));

  UPDATE alertas_agente a
  SET a.activa = 0
  WHERE a.titulo = 'Jubilación · Fecha prevista' AND a.activa = 1 AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM posibles_jubilados p
      WHERE p.dni = a.dni AND p.deleted_at IS NULL
        AND p.estado IN ('IDENTIFICADO','EN_TRAMITE')
        AND p.fecha_jubilacion IS NOT NULL);
END;

CREATE EVENT IF NOT EXISTS ev_sync_alertas_jubilacion
  ON SCHEDULE EVERY 1 DAY
  STARTS DATE_ADD(CURDATE(), INTERVAL 1 DAY) + INTERVAL 10 MINUTE
  DO CALL sp_sync_alertas_jubilacion();
