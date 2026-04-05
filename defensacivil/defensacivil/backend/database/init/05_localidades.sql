-- =============================================================
-- LOCALIDADES PRINCIPALES DE ARGENTINA
-- Ejecutar DESPUÉS de 03_partidos_completos.sql
-- =============================================================
SET NAMES utf8mb4;

-- Helper: inserta localidades referenciando partido por nombre + provincia
-- Estructura: INSERT INTO localities (partido_id, name, postal_code, latitude, longitude)

-- =============================================================
-- BUENOS AIRES - Partidos del Conurbano y principales
-- =============================================================

-- La Matanza
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'La Matanza'
JOIN (
  SELECT 'San Justo'           AS name, '1754' AS cp, -34.6815 AS lat, -58.5597 AS lng UNION ALL
  SELECT 'Ramos Mejía',                 '1704',       -34.6460,        -58.5620 UNION ALL
  SELECT 'Villa Luzuriaga',             '1752',       -34.6700,        -58.5900 UNION ALL
  SELECT 'González Catán',              '1759',       -34.7700,        -58.6400 UNION ALL
  SELECT 'Laferrere',                   '1757',       -34.7500,        -58.5900 UNION ALL
  SELECT 'Ciudad Evita',                '1778',       -34.7000,        -58.5300 UNION ALL
  SELECT 'Isidro Casanova',             '1765',       -34.7100,        -58.5800 UNION ALL
  SELECT 'Lomas del Mirador',           '1752',       -34.6600,        -58.5500 UNION ALL
  SELECT 'Tapiales',                    '1770',       -34.7000,        -58.5000 UNION ALL
  SELECT 'Villa Madero',                '1771',       -34.6900,        -58.5100 UNION ALL
  SELECT 'Aldo Bonzi',                  '1770',       -34.7000,        -58.5200
) AS ld;

-- La Plata
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'La Plata'
JOIN (
  SELECT 'La Plata'            AS name, '1900' AS cp, -34.9205 AS lat, -57.9536 AS lng UNION ALL
  SELECT 'City Bell',                   '1880',       -34.8780,        -58.0500 UNION ALL
  SELECT 'Villa Elisa',                 '1894',       -34.8770,        -58.0900 UNION ALL
  SELECT 'Tolosa',                      '1907',       -34.9100,        -57.9700 UNION ALL
  SELECT 'Gonnet',                      '1897',       -34.8990,        -58.0200 UNION ALL
  SELECT 'Los Hornos',                  '1904',       -34.9600,        -57.9700 UNION ALL
  SELECT 'Melchor Romero',              '1906',       -34.9300,        -58.0000 UNION ALL
  SELECT 'Villa Elvira',                '1903',       -34.9400,        -57.9200 UNION ALL
  SELECT 'Arturo Seguí',                '1893',       -34.8800,        -58.0700
) AS ld;

-- Quilmes
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Quilmes'
JOIN (
  SELECT 'Quilmes'             AS name, '1878' AS cp, -34.7204 AS lat, -58.2537 AS lng UNION ALL
  SELECT 'Bernal',                      '1876',       -34.7050,        -58.2800 UNION ALL
  SELECT 'Ezpeleta',                    '1882',       -34.7500,        -58.2200 UNION ALL
  SELECT 'Don Bosco',                   '1884',       -34.7300,        -58.2600 UNION ALL
  SELECT 'Quilmes Oeste',               '1879',       -34.7300,        -58.2900 UNION ALL
  SELECT 'Villa La Florida',            '1880',       -34.7400,        -58.2700
) AS ld;

-- Lanús
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Lanús'
JOIN (
  SELECT 'Lanús'               AS name, '1824' AS cp, -34.7070 AS lat, -58.3930 AS lng UNION ALL
  SELECT 'Lanús Oeste',                 '1826',       -34.7000,        -58.4100 UNION ALL
  SELECT 'Monte Chingolo',              '1823',       -34.7300,        -58.3700 UNION ALL
  SELECT 'Remedios de Escalada',        '1826',       -34.7200,        -58.4000 UNION ALL
  SELECT 'Valentín Alsina',             '1822',       -34.6900,        -58.4000
) AS ld;

-- Lomas de Zamora
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Lomas de Zamora'
JOIN (
  SELECT 'Lomas de Zamora'     AS name, '1832' AS cp, -34.7600 AS lat, -58.4000 AS lng UNION ALL
  SELECT 'Banfield',                    '1828',       -34.7400,        -58.3900 UNION ALL
  SELECT 'Turdera',                     '1834',       -34.7800,        -58.3800 UNION ALL
  SELECT 'Temperley',                   '1834',       -34.7700,        -58.3800 UNION ALL
  SELECT 'Ingeniero Budge',             '1836',       -34.7900,        -58.4000 UNION ALL
  SELECT 'Miraflores',                  '1838',       -34.8000,        -58.3900 UNION ALL
  SELECT 'Villa Centenario',            '1836',       -34.7900,        -58.4200 UNION ALL
  SELECT 'Fiorito',                     '1836',       -34.7800,        -58.4100
) AS ld;

-- Morón
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Morón'
JOIN (
  SELECT 'Morón'               AS name, '1708' AS cp, -34.6500 AS lat, -58.6200 AS lng UNION ALL
  SELECT 'Haedo',                       '1706',       -34.6400,        -58.5900 UNION ALL
  SELECT 'El Palomar',                  '1684',       -34.6100,        -58.5900 UNION ALL
  SELECT 'Villa Sarmiento',             '1704',       -34.6600,        -58.6000 UNION ALL
  SELECT 'Castelar',                    '1712',       -34.6600,        -58.6500
) AS ld;

-- San Isidro
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'San Isidro'
JOIN (
  SELECT 'San Isidro'          AS name, '1642' AS cp, -34.4700 AS lat, -58.5300 AS lng UNION ALL
  SELECT 'Martínez',                    '1640',       -34.4900,        -58.5000 UNION ALL
  SELECT 'Beccar',                      '1643',       -34.4600,        -58.5200 UNION ALL
  SELECT 'Acassuso',                    '1641',       -34.4700,        -58.5100 UNION ALL
  SELECT 'La Horqueta',                 '1644',       -34.4500,        -58.5400 UNION ALL
  SELECT 'Boulogne',                    '1661',       -34.4900,        -58.5500
) AS ld;

-- Tigre
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Tigre'
JOIN (
  SELECT 'Tigre'               AS name, '1648' AS cp, -34.4300 AS lat, -58.5800 AS lng UNION ALL
  SELECT 'Don Torcuato',                '1611',       -34.4700,        -58.6300 UNION ALL
  SELECT 'General Pacheco',             '1617',       -34.4600,        -58.6500 UNION ALL
  SELECT 'El Talar',                    '1618',       -34.4400,        -58.6700 UNION ALL
  SELECT 'Ricardo Rojas',               '1618',       -34.4400,        -58.6900 UNION ALL
  SELECT 'Villa la Ñata',               '1640',       -34.3800,        -58.6100
) AS ld;

-- Tres de Febrero
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Tres de Febrero'
JOIN (
  SELECT 'Caseros'             AS name, '1678' AS cp, -34.6100 AS lat, -58.5700 AS lng UNION ALL
  SELECT 'Ciudadela',                   '1702',       -34.6300,        -58.5400 UNION ALL
  SELECT 'Ramos Mejía',                 '1704',       -34.6500,        -58.5600 UNION ALL
  SELECT 'Villa del Parque',            '1672',       -34.6000,        -58.5800 UNION ALL
  SELECT 'Palermo Chico',               '1675',       -34.5900,        -58.5800 UNION ALL
  SELECT 'El Libertador',               '1673',       -34.6000,        -58.5900
) AS ld;

-- General Pueyrredón (Mar del Plata)
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'General Pueyrredón'
JOIN (
  SELECT 'Mar del Plata'       AS name, '7600' AS cp, -38.0023 AS lat, -57.5575 AS lng UNION ALL
  SELECT 'Batán',                       '7609',       -37.9500,        -57.7000 UNION ALL
  SELECT 'Sierra de los Padres',        '7611',       -37.9300,        -57.8400 UNION ALL
  SELECT 'Chapadmalal',                 '7607',       -38.1700,        -57.6700 UNION ALL
  SELECT 'El Marquesado',               '7612',       -37.9800,        -57.7500
) AS ld;

-- Bahía Blanca
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Bahía Blanca'
JOIN (
  SELECT 'Bahía Blanca'        AS name, '8000' AS cp, -38.7183 AS lat, -62.2661 AS lng UNION ALL
  SELECT 'Ingeniero White',             '8103',       -38.8100,        -62.2600 UNION ALL
  SELECT 'Cabildo',                     '8142',       -38.8800,        -62.1600 UNION ALL
  SELECT 'Villa Cerrito',               '8000',       -38.7600,        -62.2200 UNION ALL
  SELECT 'Villa Bordeu',                '8000',       -38.7200,        -62.2500
) AS ld;

-- Almirante Brown
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Almirante Brown'
JOIN (
  SELECT 'Adrogué'             AS name, '1846' AS cp, -34.7987 AS lat, -58.3962 AS lng UNION ALL
  SELECT 'Burzaco',                     '1852',       -34.8300,        -58.3800 UNION ALL
  SELECT 'Claypole',                    '1849',       -34.8200,        -58.3400 UNION ALL
  SELECT 'Don Orione',                  '1847',       -34.8100,        -58.4000 UNION ALL
  SELECT 'Longchamps',                  '1854',       -34.8600,        -58.3900 UNION ALL
  SELECT 'Malvinas Argentinas',         '1844',       -34.7900,        -58.4200 UNION ALL
  SELECT 'Rafael Calzada',              '1847',       -34.8100,        -58.3700
) AS ld;

-- Merlo
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Merlo'
JOIN (
  SELECT 'Merlo'               AS name, '1722' AS cp, -34.6600 AS lat, -58.7300 AS lng UNION ALL
  SELECT 'Mariano Acosta',              '1742',       -34.6900,        -58.7800 UNION ALL
  SELECT 'Pontevedra',                  '1745',       -34.7000,        -58.7500 UNION ALL
  SELECT 'Paso del Rey',                '1742',       -34.6700,        -58.7800 UNION ALL
  SELECT 'San Antonio de Padua',        '1718',       -34.6500,        -58.7100
) AS ld;

-- Florencio Varela
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-B' AND p.name = 'Florencio Varela'
JOIN (
  SELECT 'Florencio Varela'    AS name, '1888' AS cp, -34.8100 AS lat, -58.2800 AS lng UNION ALL
  SELECT 'Bosques',                     '1889',       -34.8000,        -58.2200 UNION ALL
  SELECT 'Ingeniero Juan Allan',        '1890',       -34.8300,        -58.2100 UNION ALL
  SELECT 'San Juan Bautista',           '1891',       -34.8500,        -58.1800 UNION ALL
  SELECT 'Villa Brown',                 '1884',       -34.7900,        -58.2500
) AS ld;

-- =============================================================
-- CABA - Barrios por Comunas
-- =============================================================
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-C' AND p.name = 'Palermo'
JOIN (
  SELECT 'Palermo'             AS name, '1425' AS cp, -34.5877 AS lat, -58.4318 AS lng UNION ALL
  SELECT 'Palermo Soho',                '1414',       -34.5950,        -58.4350 UNION ALL
  SELECT 'Palermo Hollywood',           '1414',       -34.5860,        -58.4280 UNION ALL
  SELECT 'Las Cañitas',                 '1426',       -34.5750,        -58.4360
) AS ld;

INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-C' AND p.name = 'Belgrano'
JOIN (
  SELECT 'Belgrano'            AS name, '1428' AS cp, -34.5600 AS lat, -58.4550 AS lng UNION ALL
  SELECT 'Núñez',                       '1429',       -34.5450,        -58.4650 UNION ALL
  SELECT 'Coghlan',                     '1430',       -34.5550,        -58.4700
) AS ld;

INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-C' AND p.name = 'La Boca'
JOIN (
  SELECT 'La Boca'             AS name, '1160' AS cp, -34.6350 AS lat, -58.3630 AS lng UNION ALL
  SELECT 'Barracas',                    '1265',       -34.6400,        -58.3850
) AS ld;

INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-C' AND p.name = 'Caballito'
JOIN (
  SELECT 'Caballito'           AS name, '1405' AS cp, -34.6198 AS lat, -58.4388 AS lng UNION ALL
  SELECT 'Flores',                      '1406',       -34.6280,        -58.4620 UNION ALL
  SELECT 'Floresta',                    '1407',       -34.6350,        -58.4700
) AS ld;

-- =============================================================
-- CÓRDOBA
-- =============================================================
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-X' AND p.name = 'Capital'
JOIN (
  SELECT 'Córdoba'             AS name, 'X5000' AS cp, -31.4201 AS lat, -64.1888 AS lng UNION ALL
  SELECT 'Alta Córdoba',                'X5003',       -31.4000,        -64.1900 UNION ALL
  SELECT 'Alberdi',                     'X5003',       -31.4350,        -64.2100 UNION ALL
  SELECT 'Villa Cabrera',               'X5009',       -31.3900,        -64.1800 UNION ALL
  SELECT 'Cerro de las Rosas',          'X5009',       -31.3850,        -64.2000 UNION ALL
  SELECT 'Nueva Córdoba',               'X5000',       -31.4300,        -64.1900 UNION ALL
  SELECT 'General Paz',                 'X5004',       -31.4100,        -64.1800 UNION ALL
  SELECT 'Villa del Lago',              'X5009',       -31.3800,        -64.2100
) AS ld;

INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-X' AND p.name = 'Río Cuarto'
JOIN (
  SELECT 'Río Cuarto'          AS name, 'X5800' AS cp, -33.1307 AS lat, -64.3499 AS lng UNION ALL
  SELECT 'Las Higueras',                'X5814',       -33.1700,        -64.2600 UNION ALL
  SELECT 'Holmberg',                    'X5823',       -33.1600,        -64.4100
) AS ld;

INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-X' AND p.name = 'Punilla'
JOIN (
  SELECT 'Villa Carlos Paz'    AS name, 'X5152' AS cp, -31.4200 AS lat, -64.5000 AS lng UNION ALL
  SELECT 'Cosquín',                     'X5166',       -31.2400,        -64.4600 UNION ALL
  SELECT 'La Falda',                    'X5172',       -31.0900,        -64.4900
) AS ld;

-- =============================================================
-- SANTA FE
-- =============================================================
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-S' AND p.name = 'Rosario'
JOIN (
  SELECT 'Rosario'             AS name, 'S2000' AS cp, -32.9442 AS lat, -60.6505 AS lng UNION ALL
  SELECT 'Villa del Parque',            'S2001',       -32.9600,        -60.6200 UNION ALL
  SELECT 'Fisherton',                   'S2000',       -32.9300,        -60.7000 UNION ALL
  SELECT 'Tablada',                     'S2007',       -33.0000,        -60.6400 UNION ALL
  SELECT 'Arroyito',                    'S2001',       -32.9100,        -60.5800
) AS ld;

INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-S' AND p.name = 'La Capital'
JOIN (
  SELECT 'Santa Fe'            AS name, 'S3000' AS cp, -31.6333 AS lat, -60.7000 AS lng UNION ALL
  SELECT 'Alto Verde',                  'S3001',       -31.6500,        -60.6800 UNION ALL
  SELECT 'Recreo',                      'S3305',       -31.4800,        -60.7500 UNION ALL
  SELECT 'Monte Vera',                  'S3009',       -31.5300,        -60.6700
) AS ld;

-- =============================================================
-- MENDOZA
-- =============================================================
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-M' AND p.name = 'Capital'
JOIN (
  SELECT 'Mendoza'             AS name, 'M5500' AS cp, -32.8908 AS lat, -68.8272 AS lng UNION ALL
  SELECT 'Ciudad',                      'M5500',       -32.8900,        -68.8300 UNION ALL
  SELECT 'Pedro Molina',                'M5500',       -32.8800,        -68.8100
) AS ld;

INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-M' AND p.name = 'Godoy Cruz'
JOIN (
  SELECT 'Godoy Cruz'          AS name, 'M5501' AS cp, -32.9200 AS lat, -68.8400 AS lng UNION ALL
  SELECT 'Las Tortugas',                'M5501',       -32.9300,        -68.8300 UNION ALL
  SELECT 'Buena Nueva',                 'M5501',       -32.9100,        -68.8500
) AS ld;

INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-M' AND p.name = 'Guaymallén'
JOIN (
  SELECT 'Guaymallén'          AS name, 'M5521' AS cp, -32.8700 AS lat, -68.7800 AS lng UNION ALL
  SELECT 'Villa Nueva',                 'M5521',       -32.8700,        -68.7700 UNION ALL
  SELECT 'Dorrego',                     'M5533',       -32.9500,        -68.7600 UNION ALL
  SELECT 'El Sauce',                    'M5524',       -32.8400,        -68.7500
) AS ld;

-- =============================================================
-- TUCUMÁN
-- =============================================================
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-T' AND p.name = 'Capital'
JOIN (
  SELECT 'San Miguel de Tucumán' AS name, 'T4000' AS cp, -26.8241 AS lat, -65.2226 AS lng UNION ALL
  SELECT 'Yerba Buena',                   'T4107',       -26.8100,        -65.3100 UNION ALL
  SELECT 'Banda del Río Salí',           'T4109',       -26.8400,        -65.1600 UNION ALL
  SELECT 'Las Talitas',                   'T4104',       -26.7700,        -65.2000 UNION ALL
  SELECT 'El Manantial',                  'T4107',       -26.8500,        -65.3200
) AS ld;

INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-T' AND p.name = 'Tafí Viejo'
JOIN (
  SELECT 'Tafí Viejo'          AS name, 'T4103' AS cp, -26.7300 AS lat, -65.2600 AS lng UNION ALL
  SELECT 'Villa Carmela',               'T4103',       -26.7400,        -65.2500
) AS ld;

-- =============================================================
-- SALTA
-- =============================================================
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-A' AND p.name = 'Capital'
JOIN (
  SELECT 'Salta'               AS name, 'A4400' AS cp, -24.7821 AS lat, -65.4232 AS lng UNION ALL
  SELECT 'Tres Cerritos',               'A4400',       -24.7600,        -65.4000 UNION ALL
  SELECT 'San Bernardo',                'A4400',       -24.8000,        -65.4100 UNION ALL
  SELECT 'Villa San Lorenzo',           'A4407',       -24.7300,        -65.5000
) AS ld;

-- =============================================================
-- NEUQUÉN
-- =============================================================
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-Q'
JOIN (
  SELECT 'Neuquén'             AS name, 'Q8300' AS cp, -38.9516 AS lat, -68.0591 AS lng UNION ALL
  SELECT 'Plottier',                    'Q8316',       -38.9700,        -68.2300 UNION ALL
  SELECT 'Centenario',                  'Q8309',       -38.8300,        -68.1300
) AS ld WHERE p.name IN ('Confluencia', 'Capital') LIMIT 3;

-- =============================================================
-- BARILOCHE / RÍO NEGRO
-- =============================================================
INSERT IGNORE INTO localities (partido_id, name, postal_code, latitude, longitude)
SELECT p.id, ld.name, ld.cp, ld.lat, ld.lng
FROM partidos p
JOIN provinces pv ON pv.id = p.province_id AND pv.code = 'AR-R' AND p.name = 'Bariloche'
JOIN (
  SELECT 'Bariloche'           AS name, 'R8400' AS cp, -41.1335 AS lat, -71.3103 AS lng UNION ALL
  SELECT 'El Bolsón',                   'R8430',       -41.9600,        -71.5300 UNION ALL
  SELECT 'Dina Huapi',                  'R8401',       -41.0700,        -71.1600
) AS ld;

SELECT CONCAT(COUNT(*), ' localidades totales cargadas') AS resultado FROM localities;
