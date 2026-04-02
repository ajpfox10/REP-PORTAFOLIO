-- =============================================================
-- DEFENSA CIVIL ARGENTINA - SEED DATA (IDEMPOTENTE)
-- Ejecutar sobre la base de datos: defensacivil (dev o prod)
-- Contraseña por defecto de todos los usuarios: Admin2503!
-- =============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Limpiar para poder re-ejecutar sin errores
TRUNCATE TABLE audit_logs;
TRUNCATE TABLE incident_status_history;
TRUNCATE TABLE incident_resources;
TRUNCATE TABLE incident_units;
TRUNCATE TABLE incidents;
TRUNCATE TABLE refresh_tokens;
TRUNCATE TABLE police_stations;
TRUNCATE TABLE localities;
TRUNCATE TABLE partidos;
TRUNCATE TABLE users;
TRUNCATE TABLE incident_subtypes;
TRUNCATE TABLE incident_types;
TRUNCATE TABLE provinces;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================
-- TIPOS DE INCIDENTES
-- =============================================================
INSERT INTO incident_types (code, name, description, icon, color_hex, sort_order) VALUES
('INCENDIO',              'Incendio',                'Incendios estructurales, vehiculares, forestales o industriales', 'fire',          '#FF4500', 1),
('CAIDA_POSTE',           'Caída de Poste / Árbol',  'Postes eléctricos, telefónicos, semáforos o árboles caídos',     'zap',           '#FFA500', 2),
('ACCIDENTE_TRANSITO',    'Accidente de Tránsito',   'Colisiones, vuelcos, atropellos o accidentes múltiples',          'car',           '#FF6347', 3),
('INUNDACION',            'Inundación',              'Inundaciones en viviendas, vías públicas o espacios subterráneos','droplets',      '#1E90FF', 4),
('ESCAPE_GAS',            'Escape de Gas',           'Fugas de gas domiciliario o en redes externas',                  'wind',          '#FFD700', 5),
('DERRUMBE',              'Derrumbe / Colapso',      'Derrumbes parciales o totales de estructuras, muros o techos',   'building',      '#8B4513', 6),
('RESCATE',               'Rescate',                 'Rescate en altura, agua o estructuras derrumbadas',              'anchor',        '#20B2AA', 7),
('MATERIALES_PELIGROSOS', 'Materiales Peligrosos',   'Incidentes con sustancias químicas, biológicas o radiactivas',   'flask',         '#9400D3', 8),
('EMERGENCIA_MEDICA',     'Emergencia Médica',        'Emergencias médicas masivas o triage en eventos críticos',       'heart',         '#DC143C', 9),
('TORMENTA',              'Tormenta / Temporal',      'Tormentas severas, granizo, viento fuerte o rayos',             'cloud-lightning','#483D8B',10),
('BUSQUEDA',              'Búsqueda y Rescate',       'Personas extraviadas o atrapadas que requieren búsqueda activa', 'search',        '#228B22',11),
('OTRO',                  'Otro',                    'Otros incidentes no categorizados',                              'alert-circle',  '#808080',99);

-- =============================================================
-- SUBTIPOS
-- =============================================================
INSERT INTO incident_subtypes (incident_type_id, code, name)
SELECT id, 'ESTRUCTURAL',  'Estructural (vivienda/edificio)'   FROM incident_types WHERE code='INCENDIO' UNION ALL
SELECT id, 'VEHICULAR',    'Vehicular'                         FROM incident_types WHERE code='INCENDIO' UNION ALL
SELECT id, 'FORESTAL',     'Forestal / Interfaz urbano-rural'  FROM incident_types WHERE code='INCENDIO' UNION ALL
SELECT id, 'INDUSTRIAL',   'Industrial / Depósito'             FROM incident_types WHERE code='INCENDIO' UNION ALL
SELECT id, 'ELECTRICO',    'Poste eléctrico'                   FROM incident_types WHERE code='CAIDA_POSTE' UNION ALL
SELECT id, 'TELEFONIA',    'Poste de telefonía'                FROM incident_types WHERE code='CAIDA_POSTE' UNION ALL
SELECT id, 'SEMAFORO',     'Semáforo'                          FROM incident_types WHERE code='CAIDA_POSTE' UNION ALL
SELECT id, 'ARBOL',        'Árbol caído'                       FROM incident_types WHERE code='CAIDA_POSTE' UNION ALL
SELECT id, 'COLISION',     'Colisión'                          FROM incident_types WHERE code='ACCIDENTE_TRANSITO' UNION ALL
SELECT id, 'VUELCO',       'Vuelco'                            FROM incident_types WHERE code='ACCIDENTE_TRANSITO' UNION ALL
SELECT id, 'ATROPELLO',    'Atropello peatonal'                FROM incident_types WHERE code='ACCIDENTE_TRANSITO' UNION ALL
SELECT id, 'MULTIPLE',     'Accidente múltiple'                FROM incident_types WHERE code='ACCIDENTE_TRANSITO' UNION ALL
SELECT id, 'VIVIENDA',     'Inundación de vivienda'            FROM incident_types WHERE code='INUNDACION' UNION ALL
SELECT id, 'VIA_PUBLICA',  'Vía pública inundada'              FROM incident_types WHERE code='INUNDACION' UNION ALL
SELECT id, 'SUBTERRANEO',  'Subterráneo / Túnel'               FROM incident_types WHERE code='INUNDACION' UNION ALL
SELECT id, 'DOMICILIARIO', 'Gas domiciliario'                  FROM incident_types WHERE code='ESCAPE_GAS' UNION ALL
SELECT id, 'RED_EXTERNA',  'Red de distribución externa'       FROM incident_types WHERE code='ESCAPE_GAS' UNION ALL
SELECT id, 'PARCIAL',      'Derrumbe parcial'                  FROM incident_types WHERE code='DERRUMBE' UNION ALL
SELECT id, 'TOTAL',        'Derrumbe total'                    FROM incident_types WHERE code='DERRUMBE' UNION ALL
SELECT id, 'MURO',         'Caída de muro/pared'               FROM incident_types WHERE code='DERRUMBE' UNION ALL
SELECT id, 'TECHO',        'Caída de techo/losa'               FROM incident_types WHERE code='DERRUMBE' UNION ALL
SELECT id, 'ALTURA',       'Rescate en altura'                 FROM incident_types WHERE code='RESCATE' UNION ALL
SELECT id, 'AGUA',         'Rescate en agua'                   FROM incident_types WHERE code='RESCATE' UNION ALL
SELECT id, 'DERRUMBE_R',   'Rescate en derrumbe'               FROM incident_types WHERE code='RESCATE' UNION ALL
SELECT id, 'QUIMICO',      'Sustancias químicas'               FROM incident_types WHERE code='MATERIALES_PELIGROSOS' UNION ALL
SELECT id, 'BIOLOGICO',    'Agentes biológicos'                FROM incident_types WHERE code='MATERIALES_PELIGROSOS' UNION ALL
SELECT id, 'RADIOACTIVO',  'Material radiactivo'               FROM incident_types WHERE code='MATERIALES_PELIGROSOS' UNION ALL
SELECT id, 'PARO_CARDIO',  'Paro cardiorrespiratorio'          FROM incident_types WHERE code='EMERGENCIA_MEDICA' UNION ALL
SELECT id, 'TRAUMA',       'Trauma grave'                      FROM incident_types WHERE code='EMERGENCIA_MEDICA' UNION ALL
SELECT id, 'MASIVO',       'Evento con múltiples víctimas'     FROM incident_types WHERE code='EMERGENCIA_MEDICA';

-- =============================================================
-- PROVINCIAS (24 jurisdicciones)
-- =============================================================
INSERT INTO provinces (code, name) VALUES
('AR-C', 'Ciudad Autónoma de Buenos Aires'),
('AR-B', 'Buenos Aires'),
('AR-K', 'Catamarca'),
('AR-H', 'Chaco'),
('AR-U', 'Chubut'),
('AR-X', 'Córdoba'),
('AR-W', 'Corrientes'),
('AR-E', 'Entre Ríos'),
('AR-P', 'Formosa'),
('AR-Y', 'Jujuy'),
('AR-L', 'La Pampa'),
('AR-F', 'La Rioja'),
('AR-M', 'Mendoza'),
('AR-N', 'Misiones'),
('AR-Q', 'Neuquén'),
('AR-R', 'Río Negro'),
('AR-A', 'Salta'),
('AR-J', 'San Juan'),
('AR-D', 'San Luis'),
('AR-Z', 'Santa Cruz'),
('AR-S', 'Santa Fe'),
('AR-G', 'Santiago del Estero'),
('AR-V', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur'),
('AR-T', 'Tucumán');

-- =============================================================
-- PARTIDOS / MUNICIPIOS
-- =============================================================
INSERT INTO partidos (province_id, name)
SELECT p.id, pd.partido
FROM provinces p
JOIN (
  SELECT 'AR-C' AS prov, 'Palermo'           AS partido UNION ALL
  SELECT 'AR-C',          'Belgrano'          UNION ALL
  SELECT 'AR-C',          'San Telmo'         UNION ALL
  SELECT 'AR-C',          'La Boca'           UNION ALL
  SELECT 'AR-C',          'Recoleta'          UNION ALL
  SELECT 'AR-C',          'Mataderos'         UNION ALL
  SELECT 'AR-C',          'Caballito'         UNION ALL
  SELECT 'AR-C',          'Villa Lugano'      UNION ALL
  SELECT 'AR-B',          'La Plata'          UNION ALL
  SELECT 'AR-B',          'Quilmes'           UNION ALL
  SELECT 'AR-B',          'Lanús'             UNION ALL
  SELECT 'AR-B',          'Lomas de Zamora'   UNION ALL
  SELECT 'AR-B',          'Morón'             UNION ALL
  SELECT 'AR-B',          'San Isidro'        UNION ALL
  SELECT 'AR-B',          'Tigre'             UNION ALL
  SELECT 'AR-B',          'Mar del Plata'     UNION ALL
  SELECT 'AR-B',          'Bahía Blanca'      UNION ALL
  SELECT 'AR-B',          'Merlo'             UNION ALL
  SELECT 'AR-B',          'General San Martín'UNION ALL
  SELECT 'AR-B',          'Tres de Febrero'   UNION ALL
  SELECT 'AR-X',          'Capital Córdoba'   UNION ALL
  SELECT 'AR-X',          'Río Cuarto'        UNION ALL
  SELECT 'AR-X',          'Villa María'       UNION ALL
  SELECT 'AR-S',          'Rosario'           UNION ALL
  SELECT 'AR-S',          'Santa Fe Capital'  UNION ALL
  SELECT 'AR-S',          'Rafaela'           UNION ALL
  SELECT 'AR-M',          'Capital Mendoza'   UNION ALL
  SELECT 'AR-M',          'San Rafael'        UNION ALL
  SELECT 'AR-M',          'Godoy Cruz'        UNION ALL
  SELECT 'AR-T',          'Capital Tucumán'   UNION ALL
  SELECT 'AR-T',          'Yerba Buena'       UNION ALL
  SELECT 'AR-A',          'Capital Salta'     UNION ALL
  SELECT 'AR-Y',          'Capital Jujuy'     UNION ALL
  SELECT 'AR-Q',          'Capital Neuquén'   UNION ALL
  SELECT 'AR-R',          'Bariloche'         UNION ALL
  SELECT 'AR-R',          'General Roca'      UNION ALL
  SELECT 'AR-N',          'Capital Posadas'   UNION ALL
  SELECT 'AR-W',          'Capital Corrientes'UNION ALL
  SELECT 'AR-E',          'Paraná'            UNION ALL
  SELECT 'AR-E',          'Concordia'
) AS pd ON p.code = pd.prov;

-- =============================================================
-- LOCALIDADES
-- =============================================================
INSERT INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT pt.id, lc.name, lc.cp, lc.lat, lc.lng
FROM partidos pt
JOIN (
  SELECT 'La Plata'           AS partido, 'La Plata Centro'     AS name, '1900' AS cp, -34.9215  AS lat, -57.9545  AS lng UNION ALL
  SELECT 'La Plata',                       'Tolosa',                      '1900',      -34.9108,          -57.9652 UNION ALL
  SELECT 'La Plata',                       'City Bell',                   '1930',      -34.8883,          -58.0564 UNION ALL
  SELECT 'La Plata',                       'Villa Elvira',                '1894',      -34.9500,          -57.9167 UNION ALL
  SELECT 'Quilmes',                         'Quilmes Centro',             '1878',      -34.7270,          -58.2535 UNION ALL
  SELECT 'Quilmes',                         'Bernal',                     '1876',      -34.7038,          -58.2838 UNION ALL
  SELECT 'Quilmes',                         'Berazategui',                '1884',      -34.7642,          -58.2113 UNION ALL
  SELECT 'Mar del Plata',                   'Mar del Plata Centro',       '7600',      -38.0023,          -57.5575 UNION ALL
  SELECT 'Mar del Plata',                   'Batán',                      '7609',      -37.9833,          -57.7167 UNION ALL
  SELECT 'Bahía Blanca',                    'Bahía Blanca Centro',        '8000',      -38.7196,          -62.2724 UNION ALL
  SELECT 'Rosario',                         'Rosario Centro',             '2000',      -32.9468,          -60.6393 UNION ALL
  SELECT 'Rosario',                         'Fisherton',                  '2000',      -32.9102,          -60.7000 UNION ALL
  SELECT 'Rosario',                         'Villa Gobernador Gálvez',    '2124',      -33.0333,          -60.6333 UNION ALL
  SELECT 'Santa Fe Capital',                'Santa Fe Centro',            '3000',      -31.6333,          -60.7000 UNION ALL
  SELECT 'Capital Córdoba',                 'Nueva Córdoba',              '5000',      -31.4210,          -64.1858 UNION ALL
  SELECT 'Capital Córdoba',                 'Güemes',                     '5000',      -31.4050,          -64.1900 UNION ALL
  SELECT 'Capital Córdoba',                 'Alberdi',                    '5000',      -31.3900,          -64.2100 UNION ALL
  SELECT 'Capital Mendoza',                 'Mendoza Centro',             '5500',      -32.8908,          -68.8272 UNION ALL
  SELECT 'Godoy Cruz',                      'Godoy Cruz Centro',          '5501',      -32.9167,          -68.8500 UNION ALL
  SELECT 'Capital Tucumán',                 'Tucumán Centro',             '4000',      -26.8241,          -65.2226 UNION ALL
  SELECT 'Capital Salta',                   'Salta Centro',               '4400',      -24.7821,          -65.4232 UNION ALL
  SELECT 'Capital Jujuy',                   'San Salvador de Jujuy',      '4600',      -24.1858,          -65.2995 UNION ALL
  SELECT 'Capital Neuquén',                 'Neuquén Centro',             '8300',      -38.9516,          -68.0591 UNION ALL
  SELECT 'Bariloche',                       'San Carlos de Bariloche',    '8400',      -41.1335,          -71.3103 UNION ALL
  SELECT 'Capital Posadas',                 'Posadas Centro',             '3300',      -27.3671,          -55.8961 UNION ALL
  SELECT 'Capital Corrientes',              'Corrientes Centro',          '3400',      -27.4806,          -58.8341 UNION ALL
  SELECT 'Paraná',                          'Paraná Centro',              '3100',      -31.7333,          -60.5167
) AS lc ON pt.name = lc.partido;

-- =============================================================
-- COMISARÍAS DE MUESTRA
-- =============================================================
INSERT INTO police_stations (name, address, phone, province_id, partido_id, latitude, longitude)
SELECT cs.name, cs.address, cs.phone, pr.id, pt.id, cs.lat, cs.lng
FROM (
  SELECT 'Comisaría 1ra - La Plata'         AS name, 'Calle 54 esq. 4, La Plata'           AS address, '(0221) 427-1000' AS phone, 'AR-B' AS prov, 'La Plata'          AS partido, -34.9215 AS lat, -57.9545 AS lng UNION ALL
  SELECT 'Comisaría 8va - Quilmes',                   'Av. Rivadavia 123, Quilmes',                     '(011) 4224-0011',         'AR-B',          'Quilmes',                      -34.7270,         -58.2535 UNION ALL
  SELECT 'Comisaría 2da - Rosario',                   'Sarmiento 645, Rosario',                         '(0341) 480-5000',         'AR-S',          'Rosario',                      -32.9468,         -60.6393 UNION ALL
  SELECT 'Comisaría 1ra - Córdoba',                   'Av. Colón 180, Córdoba',                         '(0351) 428-7000',         'AR-X',          'Capital Córdoba',              -31.4210,         -64.1858 UNION ALL
  SELECT 'Comisaría 1ra - Mendoza',                   'Belgrano 2195, Mendoza',                         '(0261) 449-1000',         'AR-M',          'Capital Mendoza',              -32.8908,         -68.8272 UNION ALL
  SELECT 'Comisaría Comunal 14 - CABA',               'Av. Díaz Vélez 4840, CABA',                      '(011) 4501-0414',         'AR-C',          'Caballito',                    -34.6156,         -58.4370 UNION ALL
  SELECT 'Comisaría Comunal 2 - CABA',                'Av. Callao 1744, CABA',                          '(011) 4816-3611',         'AR-C',          'Recoleta',                     -34.5922,         -58.3934 UNION ALL
  SELECT 'Comisaría 1ra - Tucumán',                   'Congreso 251, Tucumán',                          '(0381) 421-0300',         'AR-T',          'Capital Tucumán',              -26.8241,         -65.2226 UNION ALL
  SELECT 'Comisaría 1ra - Salta',                     'España 800, Salta',                              '(0387) 421-0000',         'AR-A',          'Capital Salta',                -24.7821,         -65.4232 UNION ALL
  SELECT 'Comisaría 1ra - Neuquén',                   'Roca 100, Neuquén',                              '(0299) 443-1000',         'AR-Q',          'Capital Neuquén',              -38.9516,         -68.0591
) AS cs
JOIN provinces pr ON pr.code = cs.prov
JOIN partidos  pt ON pt.name  = cs.partido AND pt.province_id = pr.id;

-- =============================================================
-- USUARIOS (contraseña: Admin2503!)
-- Hash bcrypt factor 12 generado para 'Admin2503!'
-- =============================================================
INSERT INTO users (uuid, username, email, password_hash, role, full_name, is_active) VALUES
(UUID(), 'admin',     'admin@defensacivil.gob.ar',     '$2a$12$5G5KTuaCEjT/fJXq5Pxt5eWV5d3nzg1Yt28.zZJRoi.CCQuGRNYOS', 'admin',  'Administrador del Sistema',  1),
(UUID(), 'operador1', 'operador1@defensacivil.gob.ar', '$2a$12$5G5KTuaCEjT/fJXq5Pxt5eWV5d3nzg1Yt28.zZJRoi.CCQuGRNYOS', 'medium', 'Operador García Juan',       1),
(UUID(), 'operador2', 'operador2@defensacivil.gob.ar', '$2a$12$5G5KTuaCEjT/fJXq5Pxt5eWV5d3nzg1Yt28.zZJRoi.CCQuGRNYOS', 'medium', 'Operadora López María',      1),
(UUID(), 'lector1',   'lector1@defensacivil.gob.ar',   '$2a$12$5G5KTuaCEjT/fJXq5Pxt5eWV5d3nzg1Yt28.zZJRoi.CCQuGRNYOS', 'read',   'Lector Rodríguez Carlos',    1);

-- =============================================================
-- INCIDENTES DE EJEMPLO
-- =============================================================
INSERT INTO incidents (uuid, incident_number, incident_type_id, title, description, status, priority,
  province_id, partido_id, address, latitude, longitude,
  affected_persons_count, injured_count, reported_by_user_id)
SELECT
  UUID(),
  CONCAT('DC-', YEAR(NOW()), '-000001'),
  (SELECT id FROM incident_types WHERE code='INCENDIO'),
  'Incendio estructural en edificio de departamentos',
  'Incendio en piso 4 de edificio de 8 pisos. Columna de humo visible a 10 cuadras. Evacuación en curso.',
  'EN_ESCENA', 'CRITICA',
  (SELECT id FROM provinces WHERE code='AR-C'),
  (SELECT id FROM partidos WHERE name='Recoleta'),
  'Av. Santa Fe 2850, Recoleta',
  -34.5922, -58.3934,
  45, 3,
  (SELECT id FROM users WHERE username='admin')
UNION ALL
SELECT
  UUID(),
  CONCAT('DC-', YEAR(NOW()), '-000002'),
  (SELECT id FROM incident_types WHERE code='ACCIDENTE_TRANSITO'),
  'Colisión múltiple en Autopista 25 de Mayo',
  'Accidente con 4 vehículos involucrados. Carril derecho cortado. Dos personas atrapadas.',
  'CONTROLADO', 'ALTA',
  (SELECT id FROM provinces WHERE code='AR-C'),
  (SELECT id FROM partidos WHERE name='La Boca'),
  'Autopista 25 de Mayo km 3, CABA',
  -34.6264, -58.3732,
  8, 2,
  (SELECT id FROM users WHERE username='operador1')
UNION ALL
SELECT
  UUID(),
  CONCAT('DC-', YEAR(NOW()), '-000003'),
  (SELECT id FROM incident_types WHERE code='INUNDACION'),
  'Inundación de viviendas en barrio Villa Elvira',
  'Crecida del arroyo El Gato. Aproximadamente 80 viviendas con ingreso de agua. Se requieren botes de rescate.',
  'EN_CAMINO', 'ALTA',
  (SELECT id FROM provinces WHERE code='AR-B'),
  (SELECT id FROM partidos WHERE name='La Plata'),
  'Calle 122 entre 603 y 604, Villa Elvira, La Plata',
  -34.9500, -57.9167,
  320, 0,
  (SELECT id FROM users WHERE username='operador2')
UNION ALL
SELECT
  UUID(),
  CONCAT('DC-', YEAR(NOW()), '-000004'),
  (SELECT id FROM incident_types WHERE code='ESCAPE_GAS'),
  'Escape de gas en planta baja de edificio',
  'Fuerte olor a gas en planta baja y primer piso. Edificio evacuado preventivamente. Metrogas notificado.',
  'RECIBIDO', 'MEDIA',
  (SELECT id FROM provinces WHERE code='AR-S'),
  (SELECT id FROM partidos WHERE name='Rosario'),
  'Corrientes 1200, Rosario',
  -32.9468, -60.6393,
  12, 0,
  (SELECT id FROM users WHERE username='operador1')
UNION ALL
SELECT
  UUID(),
  CONCAT('DC-', YEAR(NOW()), '-000005'),
  (SELECT id FROM incident_types WHERE code='CAIDA_POSTE'),
  'Caída de poste eléctrico sobre calzada',
  'Poste de alta tensión derribado por viento. Cable en tensión sobre la calzada. Calle cortada.',
  'CERRADO', 'BAJA',
  (SELECT id FROM provinces WHERE code='AR-X'),
  (SELECT id FROM partidos WHERE name='Capital Córdoba'),
  'Av. Colón 1800, Córdoba',
  -31.4210, -64.1858,
  0, 0,
  (SELECT id FROM users WHERE username='admin');

-- =============================================================
-- HISTORIAL DE ESTADOS DE EJEMPLO
-- =============================================================
INSERT INTO incident_status_history (incident_id, previous_status, new_status, changed_by_user_id, notes)
SELECT i.id, NULL, 'RECIBIDO', u.id, 'Incidente creado'
FROM incidents i, users u WHERE u.username = 'admin' AND i.incident_number LIKE '%-000001';

INSERT INTO incident_status_history (incident_id, previous_status, new_status, changed_by_user_id, notes)
SELECT i.id, 'RECIBIDO', 'EN_CAMINO', u.id, 'Unidades en camino al lugar'
FROM incidents i, users u WHERE u.username = 'admin' AND i.incident_number LIKE '%-000001';

INSERT INTO incident_status_history (incident_id, previous_status, new_status, changed_by_user_id, notes)
SELECT i.id, 'EN_CAMINO', 'EN_ESCENA', u.id, 'Bomberos llegaron al lugar. Evacuación iniciada.'
FROM incidents i, users u WHERE u.username = 'admin' AND i.incident_number LIKE '%-000001';

-- =============================================================
SELECT 'SEED COMPLETADO EXITOSAMENTE' AS resultado;
SELECT CONCAT(COUNT(*), ' tipos de incidentes') AS datos FROM incident_types;
SELECT CONCAT(COUNT(*), ' provincias')          AS datos FROM provinces;
SELECT CONCAT(COUNT(*), ' partidos')            AS datos FROM partidos;
SELECT CONCAT(COUNT(*), ' localidades')         AS datos FROM localities;
SELECT CONCAT(COUNT(*), ' comisarías')          AS datos FROM police_stations;
SELECT CONCAT(COUNT(*), ' usuarios')            AS datos FROM users;
SELECT CONCAT(COUNT(*), ' incidentes de ejemplo') AS datos FROM incidents;
-- =============================================================
