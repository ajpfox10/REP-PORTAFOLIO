-- Seed baseline catalogs that are empty in production.
-- Idempotent inserts so the migration can be re-run safely.

-- Imaging types
INSERT INTO imaging_types
  (code, name, description, modality_code, estimated_duration_min, requires_sedation, requires_contrast, is_active)
SELECT 'RX_TX', 'Radiografia torax', 'Radiografia simple de torax', 'RX', 20, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM imaging_types WHERE name = 'Radiografia torax');

INSERT INTO imaging_types
  (code, name, description, modality_code, estimated_duration_min, requires_sedation, requires_contrast, is_active)
SELECT 'RX_ABD', 'Radiografia abdomen', 'Radiografia simple de abdomen', 'RX', 20, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM imaging_types WHERE name = 'Radiografia abdomen');

INSERT INTO imaging_types
  (code, name, description, modality_code, estimated_duration_min, requires_sedation, requires_contrast, is_active)
SELECT 'RX_MIEM', 'Radiografia miembros', 'Radiografia de miembros o articulaciones', 'RX', 25, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM imaging_types WHERE name = 'Radiografia miembros');

INSERT INTO imaging_types
  (code, name, description, modality_code, estimated_duration_min, requires_sedation, requires_contrast, is_active)
SELECT 'ECO_ABD', 'Ecografia abdominal', 'Ecografia completa de abdomen', 'US', 30, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM imaging_types WHERE name = 'Ecografia abdominal');

INSERT INTO imaging_types
  (code, name, description, modality_code, estimated_duration_min, requires_sedation, requires_contrast, is_active)
SELECT 'ECO_CARD', 'Ecocardiografia', 'Estudio ecocardiografico', 'US', 35, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM imaging_types WHERE name = 'Ecocardiografia');

INSERT INTO imaging_types
  (code, name, description, modality_code, estimated_duration_min, requires_sedation, requires_contrast, is_active)
SELECT 'ECO_GEST', 'Ecografia gestacional', 'Control ecografico de gestacion', 'US', 25, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM imaging_types WHERE name = 'Ecografia gestacional');

INSERT INTO imaging_types
  (code, name, description, modality_code, estimated_duration_min, requires_sedation, requires_contrast, is_active)
SELECT 'TAC', 'Tomografia computada', 'Tomografia computada multicorte', 'CT', 45, 1, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM imaging_types WHERE name = 'Tomografia computada');

INSERT INTO imaging_types
  (code, name, description, modality_code, estimated_duration_min, requires_sedation, requires_contrast, is_active)
SELECT 'RM', 'Resonancia magnetica', 'Resonancia magnetica', 'MRI', 60, 1, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM imaging_types WHERE name = 'Resonancia magnetica');

-- Pathology types
INSERT INTO pathology_types (name, is_active)
SELECT 'Citologia', 1
WHERE NOT EXISTS (SELECT 1 FROM pathology_types WHERE name = 'Citologia');

INSERT INTO pathology_types (name, is_active)
SELECT 'Histopatologia', 1
WHERE NOT EXISTS (SELECT 1 FROM pathology_types WHERE name = 'Histopatologia');

INSERT INTO pathology_types (name, is_active)
SELECT 'Biopsia', 1
WHERE NOT EXISTS (SELECT 1 FROM pathology_types WHERE name = 'Biopsia');

INSERT INTO pathology_types (name, is_active)
SELECT 'Necropsia', 1
WHERE NOT EXISTS (SELECT 1 FROM pathology_types WHERE name = 'Necropsia');

INSERT INTO pathology_types (name, is_active)
SELECT 'Inmunohistoquimica', 1
WHERE NOT EXISTS (SELECT 1 FROM pathology_types WHERE name = 'Inmunohistoquimica');

-- Wards per branch
INSERT INTO wards (branch_id, name, ward_type, capacity, notes, is_active)
SELECT b.id, 'Sala general', 'general', 6, 'Internacion general de pequenos animales', 1
FROM branches b
WHERE NOT EXISTS (
  SELECT 1 FROM wards w WHERE w.branch_id = b.id AND w.name = 'Sala general'
);

INSERT INTO wards (branch_id, name, ward_type, capacity, notes, is_active)
SELECT b.id, 'Aislamiento', 'isolation', 2, 'Pacientes infectocontagiosos o inmunosuprimidos', 1
FROM branches b
WHERE NOT EXISTS (
  SELECT 1 FROM wards w WHERE w.branch_id = b.id AND w.name = 'Aislamiento'
);

INSERT INTO wards (branch_id, name, ward_type, capacity, notes, is_active)
SELECT b.id, 'Postoperatorio', 'post_op', 3, 'Recuperacion y monitoreo post quirurgico', 1
FROM branches b
WHERE NOT EXISTS (
  SELECT 1 FROM wards w WHERE w.branch_id = b.id AND w.name = 'Postoperatorio'
);

INSERT INTO wards (branch_id, name, ward_type, capacity, notes, is_active)
SELECT b.id, 'Cuidados intensivos', 'intensive_care', 2, 'Pacientes criticos con monitoreo intensivo', 1
FROM branches b
WHERE NOT EXISTS (
  SELECT 1 FROM wards w WHERE w.branch_id = b.id AND w.name = 'Cuidados intensivos'
);

-- Kennels for Sala general
INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'G1', 'cage', 'small', 'Sala general', 1
FROM wards w
WHERE w.name = 'Sala general'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'G1');

INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'G2', 'cage', 'small', 'Sala general', 1
FROM wards w
WHERE w.name = 'Sala general'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'G2');

INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'G3', 'cage', 'medium', 'Sala general', 1
FROM wards w
WHERE w.name = 'Sala general'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'G3');

INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'G4', 'cage', 'medium', 'Sala general', 1
FROM wards w
WHERE w.name = 'Sala general'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'G4');

INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'G5', 'run', 'large', 'Sala general', 1
FROM wards w
WHERE w.name = 'Sala general'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'G5');

INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'G6', 'run', 'xl', 'Sala general', 1
FROM wards w
WHERE w.name = 'Sala general'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'G6');

-- Kennels for Aislamiento
INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'I1', 'cage', 'medium', 'Aislamiento', 1
FROM wards w
WHERE w.name = 'Aislamiento'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'I1');

INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'I2', 'run', 'large', 'Aislamiento', 1
FROM wards w
WHERE w.name = 'Aislamiento'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'I2');

-- Kennels for Postoperatorio
INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'P1', 'cage', 'small', 'Postoperatorio', 1
FROM wards w
WHERE w.name = 'Postoperatorio'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'P1');

INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'P2', 'cage', 'medium', 'Postoperatorio', 1
FROM wards w
WHERE w.name = 'Postoperatorio'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'P2');

INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'P3', 'run', 'large', 'Postoperatorio', 1
FROM wards w
WHERE w.name = 'Postoperatorio'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'P3');

-- Kennels for Cuidados intensivos
INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'U1', 'incubator', 'small', 'UCI', 1
FROM wards w
WHERE w.name = 'Cuidados intensivos'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'U1');

INSERT INTO kennels (ward_id, kennel_number, kennel_type, size_category, notes, is_active)
SELECT w.id, 'U2', 'incubator', 'medium', 'UCI', 1
FROM wards w
WHERE w.name = 'Cuidados intensivos'
  AND NOT EXISTS (SELECT 1 FROM kennels k WHERE k.ward_id = w.id AND k.kennel_number = 'U2');

-- Medications
INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Amoxicilina clavulanato', NULL, 'Amoxicilina + acido clavulanico', 'Antibiotico', '250 mg', 'mg', 'Comprimidos', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Amoxicilina clavulanato');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Cefalexina', NULL, 'Cefalexina', 'Antibiotico', '500 mg', 'mg', 'Comprimidos', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Cefalexina');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Enrofloxacina', NULL, 'Enrofloxacina', 'Antibiotico', '50 mg', 'mg', 'Comprimidos', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Enrofloxacina');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Meloxicam', NULL, 'Meloxicam', 'AINE', '1.5 mg/ml', 'ml', 'Suspension oral', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Meloxicam');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Carprofeno', NULL, 'Carprofeno', 'AINE', '50 mg', 'mg', 'Comprimidos', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Carprofeno');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Prednisolona', NULL, 'Prednisolona', 'Corticoide', '20 mg', 'mg', 'Comprimidos', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Prednisolona');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Metronidazol', NULL, 'Metronidazol', 'Antibiotico', '250 mg', 'mg', 'Comprimidos', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Metronidazol');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Omeprazol', NULL, 'Omeprazol', 'Gastroprotector', '20 mg', 'mg', 'Capsulas', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Omeprazol');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Maropitant', NULL, 'Maropitant', 'Antiemetico', '16 mg', 'mg', 'Comprimidos', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Maropitant');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Tramadol', NULL, 'Tramadol', 'Analgesico', '50 mg', 'mg', 'Comprimidos', 1, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Tramadol');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Gabapentina', NULL, 'Gabapentina', 'Neuromodulador', '300 mg', 'mg', 'Capsulas', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Gabapentina');

INSERT INTO medications (name, brand_name, generic_name, drug_class, concentration, unit, presentation, controlled, requires_rx, is_active)
SELECT 'Dipirona', NULL, 'Metamizol', 'Analgesico', '500 mg/ml', 'ml', 'Inyectable', 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Dipirona');

-- Breeds
INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT 1, 'Mestizo', 'General', 'unknown', 1
WHERE NOT EXISTS (SELECT 1 FROM breeds WHERE species_id = 1 AND name = 'Mestizo');

INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT 1, 'Labrador Retriever', 'Reino Unido', 'large', 1
WHERE NOT EXISTS (SELECT 1 FROM breeds WHERE species_id = 1 AND name = 'Labrador Retriever');

INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT 1, 'Caniche', 'Francia', 'small', 1
WHERE NOT EXISTS (SELECT 1 FROM breeds WHERE species_id = 1 AND name = 'Caniche');

INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT 1, 'Bulldog frances', 'Francia', 'small', 1
WHERE NOT EXISTS (SELECT 1 FROM breeds WHERE species_id = 1 AND name = 'Bulldog frances');

INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT 1, 'Pastor aleman', 'Alemania', 'large', 1
WHERE NOT EXISTS (SELECT 1 FROM breeds WHERE species_id = 1 AND name = 'Pastor aleman');

INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT 2, 'Mestizo', 'General', 'unknown', 1
WHERE NOT EXISTS (SELECT 1 FROM breeds WHERE species_id = 2 AND name = 'Mestizo');

INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT 2, 'Siames', 'Tailandia', 'small', 1
WHERE NOT EXISTS (SELECT 1 FROM breeds WHERE species_id = 2 AND name = 'Siames');

INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT 2, 'Persa', 'Iran', 'small', 1
WHERE NOT EXISTS (SELECT 1 FROM breeds WHERE species_id = 2 AND name = 'Persa');

INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT 2, 'Maine Coon', 'Estados Unidos', 'large', 1
WHERE NOT EXISTS (SELECT 1 FROM breeds WHERE species_id = 2 AND name = 'Maine Coon');

INSERT INTO breeds (species_id, name, origin, size_category, is_active)
SELECT s.id, 'Sin raza', 'General', 'unknown', 1
FROM species s
WHERE s.id NOT IN (1, 2)
  AND NOT EXISTS (SELECT 1 FROM breeds b WHERE b.species_id = s.id AND b.name = 'Sin raza');
