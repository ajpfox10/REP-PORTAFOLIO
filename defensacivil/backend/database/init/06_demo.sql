-- =============================================================
-- DATOS DE DEMOSTRACIÓN (ejecutar DESPUÉS de 05_localidades.sql)
-- Usuarios de cada rol e incidentes repartidos en las últimas dos semanas.
-- Contraseña de todos los usuarios de ejemplo: Admin2503!
-- =============================================================
SET NAMES utf8mb4;
SET time_zone = '-03:00';

INSERT IGNORE INTO users (uuid, username, email, password_hash, role, full_name, is_active) VALUES
(UUID(), 'telefonista1', 'telefonista1@defensacivil.gob.ar', '$2a$12$5G5KTuaCEjT/fJXq5Pxt5eWV5d3nzg1Yt28.zZJRoi.CCQuGRNYOS', 'telefonista', 'Telefonista Pérez Laura', 1),
(UUID(), 'chofer1',      'chofer1@defensacivil.gob.ar',      '$2a$12$5G5KTuaCEjT/fJXq5Pxt5eWV5d3nzg1Yt28.zZJRoi.CCQuGRNYOS', 'chofer',      'Chofer Gómez Martín',     1);

-- Los incidentes del seed base quedan repartidos en el tiempo
UPDATE incidents SET started_at = NOW() - INTERVAL 2 HOUR  WHERE incident_number LIKE '%-000001';
UPDATE incidents SET started_at = NOW() - INTERVAL 26 HOUR WHERE incident_number LIKE '%-000002';
UPDATE incidents SET started_at = NOW() - INTERVAL 5 HOUR  WHERE incident_number LIKE '%-000003';
UPDATE incidents SET started_at = NOW() - INTERVAL 50 HOUR WHERE incident_number LIKE '%-000004';
UPDATE incidents SET started_at = NOW() - INTERVAL 4 DAY, closed_at = NOW() - INTERVAL 3 DAY WHERE incident_number LIKE '%-000005';

INSERT INTO incidents (uuid, incident_number, incident_type_id, title, description, status, priority,
  province_id, partido_id, address, latitude, longitude,
  affected_persons_count, injured_count, evacuated_count, reported_by_user_id, started_at, closed_at)
SELECT UUID(), CONCAT('DC-', YEAR(NOW()), '-', LPAD(d.n, 6, '0')),
  (SELECT id FROM incident_types WHERE code = d.tipo),
  d.titulo, d.descripcion, d.estado, d.prioridad,
  (SELECT id FROM provinces WHERE code = d.prov),
  (SELECT pa.id FROM partidos pa JOIN provinces pr ON pr.id = pa.province_id WHERE pr.code = d.prov AND pa.name = d.partido LIMIT 1),
  d.direccion, d.lat, d.lng, d.afectados, d.heridos, d.evacuados,
  (SELECT id FROM users WHERE username = d.usuario),
  NOW() - INTERVAL d.horas HOUR,
  IF(d.estado IN ('CERRADO','CANCELADO'), NOW() - INTERVAL (d.horas - 3) HOUR, NULL)
FROM (
  SELECT 6 AS n, 'INUNDACION' AS tipo, 'Anegamiento de calles en Quilmes Oeste' AS titulo, 'Lluvia intensa: 30 cm de agua en la calzada y viviendas bajas con ingreso de agua.' AS descripcion, 'EN_ESCENA' AS estado, 'ALTA' AS prioridad, 'AR-B' AS prov, 'Quilmes' AS partido, 'Av. Calchaquí 2900, Quilmes' AS direccion, -34.7420 AS lat, -58.2840 AS lng, 120 AS afectados, 0 AS heridos, 35 AS evacuados, 'telefonista1' AS usuario, 1 AS horas UNION ALL
  SELECT 7, 'INUNDACION', 'Desborde del arroyo Las Piedras', 'Familias aisladas en la ribera del arroyo. Se solicitan botes.', 'EN_CAMINO', 'CRITICA', 'AR-B', 'Quilmes', 'Calle 844 y 893, San Francisco Solano', -34.7790, -58.3120, 60, 1, 48, 'telefonista1', 3 UNION ALL
  SELECT 8, 'TORMENTA', 'Voladura de techos por ráfagas', 'Ráfagas de 90 km/h. Tres viviendas con techos de chapa desprendidos.', 'CONTROLADO', 'MEDIA', 'AR-B', 'Lomas de Zamora', 'Av. Hipólito Yrigoyen 9200, Lomas de Zamora', -34.7610, -58.4020, 14, 2, 6, 'operador1', 20 UNION ALL
  SELECT 9, 'INCENDIO', 'Incendio de pastizal junto a la autopista', 'Humo sobre la calzada, visibilidad reducida. Bomberos voluntarios trabajando.', 'CERRADO', 'MEDIA', 'AR-B', 'Tigre', 'Ruta 9 km 32, Tigre', -34.4260, -58.6370, 0, 0, 0, 'operador2', 30 UNION ALL
  SELECT 10, 'ESCAPE_GAS', 'Fuga de gas en edificio escolar', 'Olor intenso a gas en la escuela. Alumnos evacuados al patio.', 'CERRADO', 'ALTA', 'AR-C', 'Caballito', 'Av. Rivadavia 5400, Caballito', -34.6190, -58.4410, 350, 0, 350, 'telefonista1', 44 UNION ALL
  SELECT 11, 'ACCIDENTE_TRANSITO', 'Vuelco de camión en General Paz', 'Camión volcado con carga de cereales. Dos carriles cortados.', 'CERRADO', 'ALTA', 'AR-C', 'Mataderos', 'Av. General Paz y Av. Eva Perón', -34.6560, -58.5280, 1, 1, 0, 'operador1', 70 UNION ALL
  SELECT 12, 'CAIDA_POSTE', 'Árbol caído sobre vehículos estacionados', 'Árbol de gran porte sobre dos autos. Sin personas atrapadas.', 'CERRADO', 'BAJA', 'AR-C', 'Belgrano', 'Av. Cabildo 1900, Belgrano', -34.5610, -58.4560, 0, 0, 0, 'operador2', 96 UNION ALL
  SELECT 13, 'EMERGENCIA_MEDICA', 'Golpe de calor en evento masivo', 'Varias personas descompensadas en un recital al aire libre.', 'CERRADO', 'ALTA', 'AR-S', 'Rosario', 'Parque de la Independencia, Rosario', -32.9550, -60.6590, 22, 22, 0, 'operador1', 120 UNION ALL
  SELECT 14, 'DERRUMBE', 'Derrumbe parcial de vivienda antigua', 'Colapso de pared medianera. Se verifica que no haya personas bajo los escombros.', 'CONTROLADO', 'ALTA', 'AR-B', 'Avellaneda', 'Av. Mitre 1200, Avellaneda', -34.6630, -58.3650, 4, 1, 4, 'telefonista1', 140 UNION ALL
  SELECT 15, 'RESCATE', 'Rescate de persona en altura', 'Operario atrapado en andamio a 12 metros por falla del sistema de elevación.', 'CERRADO', 'MEDIA', 'AR-X', 'Capital', 'Bv. San Juan 400, Córdoba', -31.4200, -64.1880, 1, 0, 0, 'operador2', 165 UNION ALL
  SELECT 16, 'MATERIALES_PELIGROSOS', 'Derrame de combustible en ruta', 'Camión cisterna con pérdida de gasoil. Se coloca material absorbente.', 'CERRADO', 'ALTA', 'AR-B', 'Campana', 'Ruta 9 km 74, Campana', -34.1630, -58.9590, 0, 0, 0, 'operador1', 190 UNION ALL
  SELECT 17, 'TORMENTA', 'Granizo y anegamientos en Mendoza', 'Granizo de gran tamaño. Daños en techos y calles anegadas.', 'CERRADO', 'MEDIA', 'AR-M', 'Capital', 'Av. San Martín 1100, Mendoza', -32.8900, -68.8440, 40, 3, 0, 'operador2', 215 UNION ALL
  SELECT 18, 'INCENDIO', 'Incendio en depósito de neumáticos', 'Columna de humo negro. Se evacúan las viviendas linderas.', 'CERRADO', 'CRITICA', 'AR-B', 'La Matanza', 'Ruta 3 km 25, González Catán', -34.7700, -58.6400, 80, 2, 80, 'telefonista1', 240 UNION ALL
  SELECT 19, 'INUNDACION', 'Calles anegadas en Merlo', 'Barrios bajos con agua en las viviendas.', 'CERRADO', 'MEDIA', 'AR-B', 'Merlo', 'Av. Libertador 500, Merlo', -34.6650, -58.7280, 25, 0, 12, 'operador1', 280 UNION ALL
  SELECT 20, 'BUSQUEDA', 'Búsqueda de menor extraviado', 'Niño de 8 años extraviado en zona de islas. Se coordina con Prefectura.', 'CANCELADO', 'CRITICA', 'AR-B', 'Tigre', 'Delta del Paraná, Tigre', -34.4080, -58.5790, 1, 0, 0, 'operador2', 300 UNION ALL
  SELECT 21, 'OTRO', 'Animal suelto en autopista', 'Caballo suelto sobre la calzada. Se coordina con la policía.', 'RECIBIDO', 'BAJA', 'AR-B', 'Moreno', 'Acceso Oeste km 37, Moreno', -34.6340, -58.7900, 0, 0, 0, 'telefonista1', 0
) AS d;

-- Estado inicial de cada incidente en el historial
INSERT INTO incident_status_history (incident_id, previous_status, new_status, changed_by_user_id, notes, changed_at)
SELECT i.id, NULL, 'RECIBIDO', i.reported_by_user_id, 'Incidente creado', i.started_at
FROM incidents i
WHERE NOT EXISTS (SELECT 1 FROM incident_status_history h WHERE h.incident_id = i.id);

-- Cambio al estado actual
INSERT INTO incident_status_history (incident_id, previous_status, new_status, changed_by_user_id, notes, changed_at)
SELECT i.id, 'RECIBIDO', i.status, (SELECT id FROM users WHERE username = 'chofer1'),
       'Novedad informada desde el lugar', i.started_at + INTERVAL 40 MINUTE
FROM incidents i
WHERE i.status <> 'RECIBIDO' AND i.incident_number REGEXP '-0000(0[6-9]|[12][0-9])$';

-- La numeración continúa después del último incidente cargado
INSERT INTO incident_number_sequences (year, last_seq)
SELECT YEAR(NOW()), MAX(CAST(SUBSTRING_INDEX(incident_number, '-', -1) AS UNSIGNED))
FROM incidents
WHERE incident_number LIKE CONCAT('DC-', YEAR(NOW()), '-%')
ON DUPLICATE KEY UPDATE last_seq = GREATEST(last_seq, VALUES(last_seq));
