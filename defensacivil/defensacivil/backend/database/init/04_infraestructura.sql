-- =============================================================
-- INFRAESTRUCTURA: Hospitales, Salitas, Bomberos, SAME, Defensa Civil
-- Ejecutar DESPUÉS del 02_seed.sql y 03_partidos_completos.sql
-- =============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS infrastructure_points (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  type        ENUM('HOSPITAL','SALITA','BOMBEROS','SAME','DEFENSA_CIVIL','CUARTEL_GN','OTRO') NOT NULL,
  name        VARCHAR(200) NOT NULL,
  address     VARCHAR(255) NULL,
  phone       VARCHAR(100) NULL,
  province_id INT UNSIGNED NULL,
  partido_id  INT UNSIGNED NULL,
  latitude    DECIMAL(10,8) NULL,
  longitude   DECIMAL(11,8) NULL,
  beds        INT UNSIGNED NULL COMMENT 'Camas disponibles (hospitales)',
  level       VARCHAR(30)  NULL COMMENT 'Nivel de complejidad',
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_infra_type     (type),
  KEY idx_infra_province (province_id),
  KEY idx_infra_coords   (latitude, longitude),
  CONSTRAINT fk_infra_province FOREIGN KEY (province_id) REFERENCES provinces (id),
  CONSTRAINT fk_infra_partido  FOREIGN KEY (partido_id)  REFERENCES partidos  (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

TRUNCATE TABLE infrastructure_points;

-- =============================================================
-- HOSPITALES
-- =============================================================
INSERT INTO infrastructure_points (type, name, address, phone, province_id, partido_id, latitude, longitude, beds, level)
SELECT 'HOSPITAL', ip.name, ip.address, ip.phone,
  (SELECT id FROM provinces WHERE code = ip.prov),
  (SELECT id FROM partidos  WHERE name = ip.partido AND province_id = (SELECT id FROM provinces WHERE code = ip.prov) LIMIT 1),
  ip.lat, ip.lng, ip.beds, ip.level
FROM (
  -- CABA
  SELECT 'Hospital Ramos Mejía'              AS name, 'General Urquiza 609, CABA'         AS address, '(011) 4127-0200' AS phone, 'AR-C' AS prov, 'Recoleta'    AS partido, -34.6083 AS lat, -58.4050 AS lng, 750 AS beds, 'Alta complejidad' AS level UNION ALL
  SELECT 'Hospital Fernández',                         'Cerviño 3356, CABA',                           '(011) 4808-2600',         'AR-C',          'Palermo',              -34.5815,        -58.4060,         350,           'Alta complejidad' UNION ALL
  SELECT 'Hospital Rivadavia',                         'Av. Las Heras 2670, CABA',                     '(011) 4809-2000',         'AR-C',          'Recoleta',             -34.5863,        -58.3926,         400,           'Alta complejidad' UNION ALL
  SELECT 'Hospital Argerich',                          'Pi y Margall 750, La Boca, CABA',              '(011) 4121-0700',         'AR-C',          'La Boca',              -34.6235,        -58.3674,         600,           'Alta complejidad' UNION ALL
  SELECT 'Hospital Pirovano',                          'Monroe 3555, CABA',                            '(011) 4545-7272',         'AR-C',          'Belgrano',             -34.5634,        -58.4576,         300,           'Alta complejidad' UNION ALL
  SELECT 'Hospital Álvarez',                           'Aranguren 2701, CABA',                         '(011) 4611-6666',         'AR-C',          'Caballito',            -34.6330,        -58.4620,         420,           'Alta complejidad' UNION ALL
  -- Buenos Aires
  SELECT 'Hospital San Martín de La Plata',            'Calle 1 esq. 70, La Plata',                   '(0221) 457-5000',         'AR-B',          'La Plata',             -34.9100,        -57.9700,         550,           'Alta complejidad' UNION ALL
  SELECT 'Hospital Iriarte',                           'Iriarte 1479, Quilmes',                        '(011) 4257-2030',         'AR-B',          'Quilmes',              -34.7200,        -58.2600,         250,           'Media complejidad' UNION ALL
  SELECT 'Hospital Paroissien',                        'Mercedes esq. Av. Crovara, La Matanza',        '(011) 4458-2000',         'AR-B',          'La Matanza',           -34.6800,        -58.5300,         400,           'Alta complejidad' UNION ALL
  SELECT 'Hospital El Cruce',                          'Av. Calchaquí 5401, Florencio Varela',         '(011) 4275-9090',         'AR-B',          'Florencio Varela',     -34.8195,        -58.2742,         350,           'Alta complejidad' UNION ALL
  SELECT 'Hospital Municipal Mar del Plata',           'Av. Córdoba 4545, Mar del Plata',              '(0223) 499-7400',         'AR-B',          'General Pueyrredón',   -38.0100,        -57.5600,         500,           'Alta complejidad' UNION ALL
  -- Córdoba
  SELECT 'Hospital Nacional de Clínicas',              'Santa Rosa 1564, Córdoba',                     '(0351) 433-8026',         'AR-X',          'Capital',              -31.4070,        -64.1950,         400,           'Alta complejidad' UNION ALL
  SELECT 'Hospital de Urgencias Córdoba',              'Catamarca 441, Córdoba',                       '(0351) 427-6200',         'AR-X',          'Capital',              -31.4180,        -64.1870,         280,           'Alta complejidad' UNION ALL
  SELECT 'Hospital San Antonio de Río Cuarto',         'Las Heras 430, Río Cuarto',                    '(0358) 466-0500',         'AR-X',          'Río Cuarto',           -33.1232,        -64.3492,         300,           'Alta complejidad' UNION ALL
  -- Santa Fe
  SELECT 'Hospital J. B. Iturraspe',                  'Bv. Pellegrini 3551, Santa Fe',                '(0342) 457-2100',         'AR-S',          'La Capital',           -31.6300,        -60.6900,         450,           'Alta complejidad' UNION ALL
  SELECT 'Hospital Provincial de Rosario',             'Alem 1450, Rosario',                           '(0341) 480-8111',         'AR-S',          'Rosario',              -32.9600,        -60.6400,         500,           'Alta complejidad' UNION ALL
  SELECT 'Hospital Centenario Rosario',                'Urquiza 3101, Rosario',                        '(0341) 480-8600',         'AR-S',          'Rosario',              -32.9500,        -60.6600,         350,           'Alta complejidad' UNION ALL
  -- Mendoza
  SELECT 'Hospital Central de Mendoza',                'Salta 199, Mendoza',                           '(0261) 420-0600',         'AR-M',          'Capital',              -32.8900,        -68.8300,         600,           'Alta complejidad' UNION ALL
  SELECT 'Hospital Lagomaggiore',                      'Timoteo Gordillo s/n, Mendoza',                '(0261) 449-0500',         'AR-M',          'Capital',              -32.9000,        -68.8400,         400,           'Alta complejidad' UNION ALL
  -- Tucumán
  SELECT 'Hospital Padilla',                           'Alberdi 550, Tucumán',                         '(0381) 424-7300',         'AR-T',          'Capital',              -26.8200,        -65.2100,         500,           'Alta complejidad' UNION ALL
  SELECT 'Hospital del Niño Jesús',                    'Santiago 1561, Tucumán',                       '(0381) 422-0282',         'AR-T',          'Capital',              -26.8150,        -65.2050,         200,           'Pediátrico' UNION ALL
  -- Salta
  SELECT 'Hospital San Bernardo',                      'Tobías 69, Salta',                             '(0387) 432-0000',         'AR-A',          'Capital',              -24.7900,        -65.4100,         600,           'Alta complejidad' UNION ALL
  -- Neuquén
  SELECT 'Hospital Castro Rendón',                     'Buenos Aires 450, Neuquén',                    '(0299) 449-0800',         'AR-Q',          'Confluencia',      -38.9516,        -68.0591,         400,           'Alta complejidad' UNION ALL
  -- Bariloche
  SELECT 'Hospital Ramón Carrillo',                    'Moreno 601, Bariloche',                        '(0294) 442-6100',         'AR-R',          'Bariloche',            -41.1350,        -71.3100,         250,           'Alta complejidad'
) AS ip;

-- =============================================================
-- CENTROS DE SALUD / SALITAS
-- =============================================================
INSERT INTO infrastructure_points (type, name, address, phone, province_id, partido_id, latitude, longitude, level)
SELECT 'SALITA', cs.name, cs.address, cs.phone,
  (SELECT id FROM provinces WHERE code = cs.prov),
  (SELECT id FROM partidos  WHERE name = cs.partido AND province_id = (SELECT id FROM provinces WHERE code = cs.prov) LIMIT 1),
  cs.lat, cs.lng, cs.level
FROM (
  SELECT 'CESAC N°1 - La Boca'          AS name, 'Suárez 1265, CABA'          AS address, '(011) 4302-1240' AS phone, 'AR-C' AS prov, 'La Boca'     AS partido, -34.6280 AS lat, -58.3620 AS lng, 'Nivel 1' AS level UNION ALL
  SELECT 'CESAC N°18 - Palermo',                  'Guevara 784, CABA',                     '(011) 4554-3282',         'AR-C',          'Palermo',              -34.5880,        -58.4460,         'Nivel 1' UNION ALL
  SELECT 'UPA Villa Lugano',                       'Av. Escalada 2843, CABA',               '(011) 4602-2720',         'AR-C',          'Villa Lugano',         -34.6690,        -58.4820,         'Nivel 2' UNION ALL
  SELECT 'Centro de Salud N°15 - LP',             'Calle 19 N°1280, La Plata',             '(0221) 423-5600',         'AR-B',          'La Plata',             -34.9300,        -57.9600,         'Nivel 1' UNION ALL
  SELECT 'Salita Quilmes Este',                    'Av. Calchaquí 4100, Quilmes',           '(011) 4200-3400',         'AR-B',          'Quilmes',              -34.7400,        -58.2300,         'Nivel 1' UNION ALL
  SELECT 'Centro de Salud Sur - Rosario',         'Av. Ovidio Lagos 500, Rosario',         '(0341) 480-2500',         'AR-S',          'Rosario',              -32.9700,        -60.6300,         'Nivel 2' UNION ALL
  SELECT 'CAPS Belgrano - Córdoba',               'Av. Vélez Sarsfield 1900, Córdoba',     '(0351) 434-5900',         'AR-X',          'Capital',              -31.4300,        -64.2000,         'Nivel 1' UNION ALL
  SELECT 'Centro de Salud N°1 - Mendoza',         'Godoy Cruz 236, Mendoza',               '(0261) 420-1200',         'AR-M',          'Capital',              -32.8950,        -68.8350,         'Nivel 1'
) AS cs;

-- =============================================================
-- CUARTELES DE BOMBEROS
-- =============================================================
INSERT INTO infrastructure_points (type, name, address, phone, province_id, partido_id, latitude, longitude)
SELECT 'BOMBEROS', b.name, b.address, b.phone,
  (SELECT id FROM provinces WHERE code = b.prov),
  (SELECT id FROM partidos  WHERE name = b.partido AND province_id = (SELECT id FROM provinces WHERE code = b.prov) LIMIT 1),
  b.lat, b.lng
FROM (
  SELECT 'Bomberos Voluntarios La Boca'    AS name, 'Av. Don Pedro de Mendoza 1901, CABA' AS address, '(011) 4301-1696' AS phone, 'AR-C' AS prov, 'La Boca'          AS partido, -34.6310 AS lat, -58.3640 AS lng UNION ALL
  SELECT 'Bomberos Voluntarios Palermo',            'Av. del Libertador 4097, CABA',                 '(011) 4776-3800',         'AR-C',          'Palermo',                      -34.5780,        -58.4230 UNION ALL
  SELECT 'Cuartel Central Bomberos CABA',           'Venezuela 1750, CABA',                          '(011) 4383-3300',         'AR-C',          'San Telmo',                    -34.6150,        -58.3910 UNION ALL
  SELECT 'Bomberos Voluntarios La Plata',           'Calle 1 N°987, La Plata',                       '(0221) 427-1000',         'AR-B',          'La Plata',                     -34.9200,        -57.9600 UNION ALL
  SELECT 'Bomberos Voluntarios Mar del Plata',      'Av. Juan B. Justo 4530, MdP',                  '(0223) 451-0011',         'AR-B',          'General Pueyrredón',           -38.0050,        -57.5500 UNION ALL
  SELECT 'Bomberos Voluntarios Rosario',            'Balcarce 1250, Rosario',                        '(0341) 480-0911',         'AR-S',          'Rosario',                      -32.9400,        -60.6450 UNION ALL
  SELECT 'Bomberos Voluntarios Córdoba',            'General Paz 100, Córdoba',                      '(0351) 428-7100',         'AR-X',          'Capital',                      -31.4150,        -64.1820 UNION ALL
  SELECT 'Bomberos Voluntarios Mendoza',            'San Juan 1490, Mendoza',                        '(0261) 428-0000',         'AR-M',          'Capital',                      -32.8950,        -68.8400 UNION ALL
  SELECT 'Bomberos Voluntarios Tucumán',            'Crisóstomo Álvarez 441, Tucumán',               '(0381) 421-0011',         'AR-T',          'Capital',                      -26.8250,        -65.2200 UNION ALL
  SELECT 'Bomberos Voluntarios Salta',              'Necochea 580, Salta',                           '(0387) 421-1100',         'AR-A',          'Capital',                      -24.7850,        -65.4200 UNION ALL
  SELECT 'Bomberos Voluntarios Bariloche',          'Morales 980, Bariloche',                        '(0294) 442-3300',         'AR-R',          'Bariloche',                    -41.1380,        -71.3050
) AS b;

-- =============================================================
-- BASES SAME / SAMU
-- =============================================================
INSERT INTO infrastructure_points (type, name, address, phone, province_id, partido_id, latitude, longitude)
SELECT 'SAME', sm.name, sm.address, sm.phone,
  (SELECT id FROM provinces WHERE code = sm.prov),
  (SELECT id FROM partidos  WHERE name = sm.partido AND province_id = (SELECT id FROM provinces WHERE code = sm.prov) LIMIT 1),
  sm.lat, sm.lng
FROM (
  SELECT 'SAME Central CABA'              AS name, 'Av. Pueyrredón 2179, CABA'       AS address, '107' AS phone, 'AR-C' AS prov, 'Recoleta'     AS partido, -34.5990 AS lat, -58.3990 AS lng UNION ALL
  SELECT 'SAME Base Sur CABA',                      'Av. Paseo Colón 800, CABA',                  '107',         'AR-C',          'San Telmo',             -34.6170,        -58.3700 UNION ALL
  SELECT 'SAME Base Norte CABA',                    'Av. Cabildo 3199, CABA',                     '107',         'AR-C',          'Belgrano',              -34.5610,        -58.4620 UNION ALL
  SELECT 'SAMU La Plata',                           'Calle 14 N°700, La Plata',                   '107',         'AR-B',          'La Plata',              -34.9200,        -57.9500 UNION ALL
  SELECT 'SAMU GBA Quilmes',                        'Av. Mitre 900, Quilmes',                     '107',         'AR-B',          'Quilmes',               -34.7250,        -58.2600 UNION ALL
  SELECT 'SAMU Rosario Central',                    'Moreno 935, Rosario',                        '107',         'AR-S',          'Rosario',               -32.9450,        -60.6380 UNION ALL
  SELECT 'SAMU Córdoba Central',                    'Humberto Primo 650, Córdoba',                '107',         'AR-X',          'Capital',               -31.4190,        -64.1900 UNION ALL
  SELECT 'SAMU Mendoza',                            'Amigorena 80, Mendoza',                      '107',         'AR-M',          'Capital',               -32.8920,        -68.8310 UNION ALL
  SELECT 'SAMU Tucumán',                            'Muñecas 1, Tucumán',                         '107',         'AR-T',          'Capital',               -26.8260,        -65.2180
) AS sm;

-- =============================================================
-- BASES DE DEFENSA CIVIL
-- =============================================================
INSERT INTO infrastructure_points (type, name, address, phone, province_id, partido_id, latitude, longitude)
SELECT 'DEFENSA_CIVIL', dc.name, dc.address, dc.phone,
  (SELECT id FROM provinces WHERE code = dc.prov),
  (SELECT id FROM partidos  WHERE name = dc.partido AND province_id = (SELECT id FROM provinces WHERE code = dc.prov) LIMIT 1),
  dc.lat, dc.lng
FROM (
  SELECT 'Defensa Civil CABA - Central'    AS name, 'Av. Paseo Colón 255, CABA'         AS address, '(011) 4346-8795' AS phone, 'AR-C' AS prov, 'San Telmo'         AS partido, -34.6155 AS lat, -58.3688 AS lng UNION ALL
  SELECT 'Defensa Civil La Plata',                   'Calle 53 N°773, La Plata',                    '(0221) 427-3620',         'AR-B',          'La Plata',                     -34.9180,        -57.9580 UNION ALL
  SELECT 'Defensa Civil Rosario',                    'Wheelwright 1486, Rosario',                   '(0341) 480-2550',         'AR-S',          'Rosario',                      -32.9480,        -60.6420 UNION ALL
  SELECT 'Defensa Civil Córdoba',                    'Lugones 247, Córdoba',                        '(0351) 434-6300',         'AR-X',          'Capital',                      -31.4130,        -64.1810 UNION ALL
  SELECT 'Defensa Civil Mendoza',                    'Peltier 351, Mendoza',                        '(0261) 449-7800',         'AR-M',          'Capital',                      -32.8930,        -68.8350 UNION ALL
  SELECT 'Defensa Civil Tucumán',                    'Laprida 60, Tucumán',                         '(0381) 430-7071',         'AR-T',          'Capital',                      -26.8230,        -65.2150 UNION ALL
  SELECT 'Defensa Civil Salta',                      'España 550, Salta',                           '(0387) 432-1900',         'AR-A',          'Capital',                      -24.7830,        -65.4210 UNION ALL
  SELECT 'Defensa Civil Neuquén',                    'Rivadavia 400, Neuquén',                      '(0299) 449-0600',         'AR-Q',          'Confluencia',              -38.9520,        -68.0580
) AS dc;

SELECT CONCAT(COUNT(*), ' puntos de infraestructura cargados') AS resultado FROM infrastructure_points;
SELECT type, COUNT(*) AS cantidad FROM infrastructure_points GROUP BY type;
