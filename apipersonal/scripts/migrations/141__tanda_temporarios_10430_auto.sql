-- 141__tanda_temporarios_10430_auto.sql  (19/11/2026)
-- Tanda automática anual "TEMPORARIOS 10430 <año>" en tramites_tanda_interinos.
--
-- Quiénes: agentes ACTIVOS de Ley 10430 (ley_id 1 "10430" o 3 "LEY 10430") con planta
-- TEMPORARIO/A. Los 10430 sin planta cargada NO entran (decisión del usuario 19/11/2026).
--
-- Cómo: el EVENT corre todas las noches. El 1° de enero (primera corrida del año) nace la
-- tanda del año nuevo con todos los temporarios activos; el resto del año va sumando a los
-- temporarios que aparecen (altas / cambios de planta). NUNCA saca a nadie (INSERT IGNORE
-- sobre UNIQUE(tanda,dni)): una baja o un cambio de planta durante el año se queda en la tanda.
-- Las tandas de años anteriores no se tocan. origen = 'auto'.

DROP PROCEDURE IF EXISTS sp_tanda_temporarios_10430;

CREATE PROCEDURE sp_tanda_temporarios_10430()
BEGIN
  INSERT IGNORE INTO tramites_tanda_interinos (tanda, dni, origen, anio)
  SELECT CONCAT('TEMPORARIOS 10430 ', YEAR(CURDATE())), a.dni, 'auto', MIN(YEAR(a.fecha_ingreso))
    FROM agentes a
    JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
    JOIN ley l      ON l.id = a.ley_id
    JOIN plantas pl ON pl.id = a.planta_id AND pl.deleted_at IS NULL
   WHERE a.deleted_at IS NULL
     AND a.estado_empleo = 'ACTIVO'
     AND (a.ley_id IN (1, 3) OR REPLACE(COALESCE(l.nombre, ''), '.', '') LIKE '%10430%')
     AND UPPER(pl.nombre) LIKE 'TEMPORARI%'
   GROUP BY a.dni;
END;

DROP EVENT IF EXISTS ev_tanda_temporarios_10430;

CREATE EVENT ev_tanda_temporarios_10430
  ON SCHEDULE EVERY 1 DAY STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 20 MINUTE)
  DO CALL sp_tanda_temporarios_10430();

-- Arma la tanda del año en curso ya mismo.
CALL sp_tanda_temporarios_10430();
