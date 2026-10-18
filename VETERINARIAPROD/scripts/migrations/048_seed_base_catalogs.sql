-- ============================================================================
-- Migration 048: catálogos base para clínicas nuevas
--
-- Una instalación nueva (o una clínica recién registrada) necesita especies,
-- vacunas, tipos de turno, monedas y otros catálogos para poder operar.
-- Cada INSERT usa WHERE NOT EXISTS: en bases que ya los tienen no duplica nada.
-- ============================================================================

DROP PROCEDURE IF EXISTS migrate_048_add_column;
CREATE PROCEDURE migrate_048_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @migrate_048_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE migrate_048_stmt FROM @migrate_048_sql;
    EXECUTE migrate_048_stmt;
    DEALLOCATE PREPARE migrate_048_stmt;
  END IF;
END;

CALL migrate_048_add_column('species', 'slug', 'VARCHAR(64) NULL');
CALL migrate_048_add_column('currencies', 'name', 'VARCHAR(64) NULL');
CALL migrate_048_add_column('currencies', 'symbol', 'VARCHAR(8) NULL');

DROP PROCEDURE IF EXISTS migrate_048_add_column;

-- ── Especies ────────────────────────────────────────────────────────────────
INSERT INTO species_categories (name, display_name)
SELECT seed.name, seed.display_name
  FROM (
    SELECT 'pets' AS name, 'Mascotas' AS display_name
    UNION ALL SELECT 'exotics', 'Exóticos'
    UNION ALL SELECT 'large_animals', 'Grandes animales'
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM species_categories sc WHERE sc.name = seed.name);

-- El orden importa en una base vacía: la migración 038 carga razas de perro
-- (species_id = 1) y de gato (species_id = 2).
INSERT INTO species (common_name, scientific_name, slug, category_id, is_active)
SELECT seed.common_name, seed.scientific_name, seed.slug,
       (SELECT sc.id FROM species_categories sc WHERE sc.name = seed.category), 1
  FROM (
    SELECT 1 AS sort, 'Perro' AS common_name, 'Canis lupus familiaris' AS scientific_name, 'dog' AS slug, 'pets' AS category
    UNION ALL SELECT 2, 'Gato', 'Felis catus', 'cat', 'pets'
    UNION ALL SELECT 3, 'Conejo', 'Oryctolagus cuniculus', 'rabbit', 'exotics'
    UNION ALL SELECT 4, 'Hurón', 'Mustela putorius furo', 'ferret', 'exotics'
    UNION ALL SELECT 5, 'Ave', 'Aves', 'bird', 'exotics'
    UNION ALL SELECT 6, 'Roedor', 'Rodentia', 'rodent', 'exotics'
    UNION ALL SELECT 7, 'Reptil', 'Reptilia', 'reptile', 'exotics'
    UNION ALL SELECT 8, 'Caballo', 'Equus ferus caballus', 'horse', 'large_animals'
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM species s WHERE s.common_name = seed.common_name)
 ORDER BY seed.sort;

UPDATE species SET slug = 'dog'    WHERE slug IS NULL AND common_name = 'Perro';
UPDATE species SET slug = 'cat'    WHERE slug IS NULL AND common_name = 'Gato';

-- ── Monedas ─────────────────────────────────────────────────────────────────
INSERT INTO currencies (code, name, symbol)
SELECT seed.code, seed.name, seed.symbol
  FROM (
    SELECT 'ARS' AS code, 'Peso argentino' AS name, '$' AS symbol
    UNION ALL SELECT 'USD', 'Dólar estadounidense', 'US$'
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM currencies c WHERE c.code = seed.code);

-- ── Países (la migración 039 carga provincias con country_id = 1) ────────────
INSERT INTO countries (name, code, iso2, iso3)
SELECT 'Argentina', 'AR', 'AR', 'ARG'
 WHERE NOT EXISTS (SELECT 1 FROM countries WHERE iso2 = 'AR');

-- ── Tipos de turno (globales: organization_id NULL) ─────────────────────────
INSERT INTO appointment_types (name, default_duration_minutes, color_hex, requires_prep, is_active)
SELECT seed.name, seed.duration, seed.color, seed.prep, 1
  FROM (
    SELECT 'Consulta general' AS name, 30 AS duration, '#0F766E' AS color, 0 AS prep
    UNION ALL SELECT 'Control',          20, '#2563EB', 0
    UNION ALL SELECT 'Vacunación',       15, '#7C3AED', 0
    UNION ALL SELECT 'Urgencia',         30, '#DC2626', 0
    UNION ALL SELECT 'Cirugía',          90, '#B45309', 1
    UNION ALL SELECT 'Estudios',         45, '#0891B2', 1
  ) AS seed
 WHERE NOT EXISTS (
   SELECT 1 FROM appointment_types at WHERE at.name = seed.name AND at.organization_id IS NULL
 );

-- ── Vacunas ─────────────────────────────────────────────────────────────────
INSERT INTO vaccines (name, disease_covered, is_active)
SELECT seed.name, seed.disease, 1
  FROM (
    SELECT 'Séxtuple canina' AS name, 'Moquillo, parvovirus, hepatitis, leptospirosis, parainfluenza, coronavirus' AS disease
    UNION ALL SELECT 'Óctuple canina', 'Séxtuple + cepas adicionales de leptospira'
    UNION ALL SELECT 'Antirrábica', 'Rabia'
    UNION ALL SELECT 'Tos de las perreras', 'Bordetella bronchiseptica, parainfluenza'
    UNION ALL SELECT 'Triple felina', 'Panleucopenia, rinotraqueítis, calicivirus'
    UNION ALL SELECT 'Leucemia felina', 'Virus de la leucemia felina (FeLV)'
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM vaccines v WHERE v.name = seed.name);

-- ── Antiparasitarios ────────────────────────────────────────────────────────
INSERT INTO antiparasitic_products (name, active_ingredient, parasite_type, presentation, target_species, interval_months, is_active)
SELECT seed.name, seed.ingredient, seed.parasite, seed.presentation, seed.species, seed.months, 1
  FROM (
    SELECT 'Antiparasitario interno' AS name, 'Praziquantel + pirantel + febantel' AS ingredient, 'internal' AS parasite,
           'Comprimido' AS presentation, 'dog' AS species, '3' AS months
    UNION ALL SELECT 'Pipeta antipulgas', 'Fipronil', 'external', 'Pipeta', 'dog,cat', '1'
    UNION ALL SELECT 'Comprimido masticable', 'Fluralaner', 'external', 'Comprimido', 'dog', '3'
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM antiparasitic_products ap WHERE ap.name = seed.name);

-- ── Laboratorio ─────────────────────────────────────────────────────────────
INSERT INTO lab_test_categories (name)
SELECT seed.name
  FROM (
    SELECT 'Hematología' AS name
    UNION ALL SELECT 'Bioquímica'
    UNION ALL SELECT 'Orina'
    UNION ALL SELECT 'Parasitología'
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM lab_test_categories c WHERE c.name = seed.name);

INSERT INTO lab_tests (name, code, category_id, turnaround_hours, is_active)
SELECT seed.name, seed.code, (SELECT c.id FROM lab_test_categories c WHERE c.name = seed.category), seed.hours, 1
  FROM (
    SELECT 'Hemograma completo' AS name, 'HEMO' AS code, 'Hematología' AS category, 24 AS hours
    UNION ALL SELECT 'Perfil bioquímico', 'BIOQ', 'Bioquímica', 24
    UNION ALL SELECT 'Urea y creatinina', 'RENAL', 'Bioquímica', 24
    UNION ALL SELECT 'Análisis de orina', 'ORINA', 'Orina', 24
    UNION ALL SELECT 'Coproparasitológico', 'COPRO', 'Parasitología', 48
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM lab_tests t WHERE t.code = seed.code AND t.organization_id IS NULL);

-- ── Cirugías ────────────────────────────────────────────────────────────────
INSERT INTO surgery_categories (name)
SELECT seed.name
  FROM (
    SELECT 'Tejidos blandos' AS name
    UNION ALL SELECT 'Ortopedia'
    UNION ALL SELECT 'Odontología'
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM surgery_categories c WHERE c.name = seed.name);

INSERT INTO surgery_types (name, category_id, estimated_duration_minutes, is_active)
SELECT seed.name, (SELECT c.id FROM surgery_categories c WHERE c.name = seed.category), seed.minutes, 1
  FROM (
    SELECT 'Castración' AS name, 'Tejidos blandos' AS category, 45 AS minutes
    UNION ALL SELECT 'Ovariohisterectomía', 'Tejidos blandos', 75
    UNION ALL SELECT 'Limpieza dental', 'Odontología', 60
    UNION ALL SELECT 'Osteosíntesis', 'Ortopedia', 150
  ) AS seed
 WHERE NOT EXISTS (SELECT 1 FROM surgery_types t WHERE t.name = seed.name AND t.organization_id IS NULL);
