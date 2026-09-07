-- Additional seed data for optional catalogs and lightweight patient profiles.
-- Idempotent by business key where possible.

-- Vaccine manufacturers
INSERT INTO vaccine_manufacturers (name, country, website, is_active)
SELECT 'Zoetis', 'Estados Unidos', 'https://www.zoetis.com', 1
WHERE NOT EXISTS (SELECT 1 FROM vaccine_manufacturers WHERE name = 'Zoetis');

INSERT INTO vaccine_manufacturers (name, country, website, is_active)
SELECT 'MSD Animal Health', 'Estados Unidos', 'https://www.msd-animal-health.com', 1
WHERE NOT EXISTS (SELECT 1 FROM vaccine_manufacturers WHERE name = 'MSD Animal Health');

INSERT INTO vaccine_manufacturers (name, country, website, is_active)
SELECT 'Boehringer Ingelheim', 'Alemania', 'https://www.boehringer-ingelheim.com', 1
WHERE NOT EXISTS (SELECT 1 FROM vaccine_manufacturers WHERE name = 'Boehringer Ingelheim');

INSERT INTO vaccine_manufacturers (name, country, website, is_active)
SELECT 'Virbac', 'Francia', 'https://www.virbac.com', 1
WHERE NOT EXISTS (SELECT 1 FROM vaccine_manufacturers WHERE name = 'Virbac');

UPDATE vaccines v
LEFT JOIN vaccine_manufacturers vm ON vm.name = CASE
  WHEN v.id IN (1,2,3) THEN 'Zoetis'
  WHEN v.id IN (4,5,6) THEN 'MSD Animal Health'
  WHEN v.id IN (7,8) THEN 'Boehringer Ingelheim'
  ELSE 'Virbac'
END
SET v.manufacturer_id = COALESCE(v.manufacturer_id, vm.id),
    v.manufacturer = COALESCE(v.manufacturer, vm.name)
WHERE vm.id IS NOT NULL;

-- Antiparasitic products
INSERT INTO antiparasitic_products
  (name, active_ingredient, parasite_type, target_species, presentation, dosage_guideline, interval_months, is_active)
SELECT 'Drontal Plus', 'Praziquantel + Pirantel + Febantel', 'internal', 'dog', 'Comprimidos', '1 comprimido cada 10 kg', 3, 1
WHERE NOT EXISTS (SELECT 1 FROM antiparasitic_products WHERE name = 'Drontal Plus');

INSERT INTO antiparasitic_products
  (name, active_ingredient, parasite_type, target_species, presentation, dosage_guideline, interval_months, is_active)
SELECT 'Profender Spot On', 'Emodepsida + Praziquantel', 'internal', 'cat', 'Pipeta spot on', 'Aplicacion segun peso', 3, 1
WHERE NOT EXISTS (SELECT 1 FROM antiparasitic_products WHERE name = 'Profender Spot On');

INSERT INTO antiparasitic_products
  (name, active_ingredient, parasite_type, target_species, presentation, dosage_guideline, interval_months, is_active)
SELECT 'Bravecto', 'Fluralaner', 'external', 'dog', 'Comprimido masticable', '1 comprimido segun rango de peso', 3, 1
WHERE NOT EXISTS (SELECT 1 FROM antiparasitic_products WHERE name = 'Bravecto');

INSERT INTO antiparasitic_products
  (name, active_ingredient, parasite_type, target_species, presentation, dosage_guideline, interval_months, is_active)
SELECT 'Revolution', 'Selamectina', 'both', 'cat', 'Pipeta spot on', '1 pipeta mensual segun peso', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM antiparasitic_products WHERE name = 'Revolution');

INSERT INTO antiparasitic_products
  (name, active_ingredient, parasite_type, target_species, presentation, dosage_guideline, interval_months, is_active)
SELECT 'NexGard Spectra', 'Afoxolaner + Milbemicina', 'both', 'dog', 'Comprimido masticable', '1 comprimido mensual segun peso', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM antiparasitic_products WHERE name = 'NexGard Spectra');

-- Grooming service types
INSERT INTO grooming_service_types
  (name, description, base_price_small, base_price_medium, base_price_large, duration_min_small, duration_min_medium, duration_min_large, is_active)
SELECT 'Baño y secado', 'Baño higienico con secado y cepillado', 18000, 22000, 28000, 45, 60, 75, 1
WHERE NOT EXISTS (SELECT 1 FROM grooming_service_types WHERE name = 'Baño y secado');

INSERT INTO grooming_service_types
  (name, description, base_price_small, base_price_medium, base_price_large, duration_min_small, duration_min_medium, duration_min_large, is_active)
SELECT 'Corte estético', 'Corte de pelo segun raza o preferencia', 22000, 28000, 36000, 60, 75, 90, 1
WHERE NOT EXISTS (SELECT 1 FROM grooming_service_types WHERE name = 'Corte estético');

INSERT INTO grooming_service_types
  (name, description, base_price_small, base_price_medium, base_price_large, duration_min_small, duration_min_medium, duration_min_large, is_active)
SELECT 'Baño medicinal', 'Baño con shampoo medicado', 24000, 29000, 36000, 50, 65, 80, 1
WHERE NOT EXISTS (SELECT 1 FROM grooming_service_types WHERE name = 'Baño medicinal');

INSERT INTO grooming_service_types
  (name, description, base_price_small, base_price_medium, base_price_large, duration_min_small, duration_min_medium, duration_min_large, is_active)
SELECT 'Corte de uñas', 'Corte y limado de uñas', 8000, 9000, 10000, 15, 15, 20, 1
WHERE NOT EXISTS (SELECT 1 FROM grooming_service_types WHERE name = 'Corte de uñas');

INSERT INTO grooming_service_types
  (name, description, base_price_small, base_price_medium, base_price_large, duration_min_small, duration_min_medium, duration_min_large, is_active)
SELECT 'Spa completo', 'Baño, corte, limpieza de oídos y uñas', 32000, 39000, 47000, 80, 100, 120, 1
WHERE NOT EXISTS (SELECT 1 FROM grooming_service_types WHERE name = 'Spa completo');

-- Groomers using existing user with groomer role
INSERT INTO groomers (branch_id, user_id, commission_type, commission_value, specializations, is_active)
SELECT 1, 8, 'percentage', 0.1800, 'Caninos pequeños, corte comercial y baño sanitario', 1
WHERE NOT EXISTS (SELECT 1 FROM groomers WHERE user_id = 8);

-- Suppliers
INSERT INTO suppliers
  (org_id, name, tax_id, contact_name, email, phone, address, payment_terms, notes, is_active)
SELECT 1, 'Distribuidora VetSur', '30-70111222-3', 'Luciana Romero', 'ventas@vetsur.com', '+54-11-4000-1111', 'CABA, Argentina', 30, 'Proveedor general de medicamentos e insumos', 1
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE org_id = 1 AND name = 'Distribuidora VetSur');

INSERT INTO suppliers
  (org_id, name, tax_id, contact_name, email, phone, address, payment_terms, notes, is_active)
SELECT 1, 'Agrovet Insumos', '30-70222333-4', 'Diego Peralta', 'compras@agrovet.com', '+54-11-4000-2222', 'Buenos Aires, Argentina', 15, 'Vacunas, antiparasitarios y descartables', 1
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE org_id = 1 AND name = 'Agrovet Insumos');

INSERT INTO suppliers
  (org_id, name, tax_id, contact_name, email, phone, address, payment_terms, notes, is_active)
SELECT 2, 'Central Veterinaria Andina', '30-70333444-5', 'Marina Quiroga', 'pedidos@vetandina.com', '+54-11-4000-3333', 'Cordoba, Argentina', 21, 'Proveedor multirubro', 1
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE org_id = 2 AND name = 'Central Veterinaria Andina');

-- Geography
INSERT INTO states (country_id, name, code)
SELECT 1, 'Ciudad Autónoma de Buenos Aires', 'CABA'
WHERE NOT EXISTS (SELECT 1 FROM states WHERE country_id = 1 AND name = 'Ciudad Autónoma de Buenos Aires');

INSERT INTO states (country_id, name, code)
SELECT 1, 'Buenos Aires', 'B'
WHERE NOT EXISTS (SELECT 1 FROM states WHERE country_id = 1 AND name = 'Buenos Aires');

INSERT INTO states (country_id, name, code)
SELECT 1, 'Córdoba', 'X'
WHERE NOT EXISTS (SELECT 1 FROM states WHERE country_id = 1 AND name = 'Córdoba');

INSERT INTO cities (state_id, name, zip_code)
SELECT s.id, 'Palermo', '1425'
FROM states s
WHERE s.name = 'Ciudad Autónoma de Buenos Aires'
  AND NOT EXISTS (SELECT 1 FROM cities c WHERE c.state_id = s.id AND c.name = 'Palermo');

INSERT INTO cities (state_id, name, zip_code)
SELECT s.id, 'Belgrano', '1428'
FROM states s
WHERE s.name = 'Ciudad Autónoma de Buenos Aires'
  AND NOT EXISTS (SELECT 1 FROM cities c WHERE c.state_id = s.id AND c.name = 'Belgrano');

INSERT INTO cities (state_id, name, zip_code)
SELECT s.id, 'La Plata', '1900'
FROM states s
WHERE s.name = 'Buenos Aires'
  AND NOT EXISTS (SELECT 1 FROM cities c WHERE c.state_id = s.id AND c.name = 'La Plata');

INSERT INTO cities (state_id, name, zip_code)
SELECT s.id, 'Córdoba', '5000'
FROM states s
WHERE s.name = 'Córdoba'
  AND NOT EXISTS (SELECT 1 FROM cities c WHERE c.state_id = s.id AND c.name = 'Córdoba');

-- Coat colors
INSERT INTO coat_colors (name, species_id)
SELECT 'Negro', 1
WHERE NOT EXISTS (SELECT 1 FROM coat_colors WHERE name = 'Negro' AND species_id = 1);
INSERT INTO coat_colors (name, species_id)
SELECT 'Blanco', 1
WHERE NOT EXISTS (SELECT 1 FROM coat_colors WHERE name = 'Blanco' AND species_id = 1);
INSERT INTO coat_colors (name, species_id)
SELECT 'Marrón', 1
WHERE NOT EXISTS (SELECT 1 FROM coat_colors WHERE name = 'Marrón' AND species_id = 1);
INSERT INTO coat_colors (name, species_id)
SELECT 'Atigrado', 2
WHERE NOT EXISTS (SELECT 1 FROM coat_colors WHERE name = 'Atigrado' AND species_id = 2);
INSERT INTO coat_colors (name, species_id)
SELECT 'Blanco y negro', 2
WHERE NOT EXISTS (SELECT 1 FROM coat_colors WHERE name = 'Blanco y negro' AND species_id = 2);
INSERT INTO coat_colors (name, species_id)
SELECT 'Gris', 2
WHERE NOT EXISTS (SELECT 1 FROM coat_colors WHERE name = 'Gris' AND species_id = 2);

-- Service categories
INSERT INTO service_categories (name, color_hex, sort_order, is_active)
SELECT 'Consultas', '#1A5FAA', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE name = 'Consultas');
INSERT INTO service_categories (name, color_hex, sort_order, is_active)
SELECT 'Diagnóstico', '#1A9E7F', 2, 1
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE name = 'Diagnóstico');
INSERT INTO service_categories (name, color_hex, sort_order, is_active)
SELECT 'Cirugía', '#C0392B', 3, 1
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE name = 'Cirugía');
INSERT INTO service_categories (name, color_hex, sort_order, is_active)
SELECT 'Internación', '#8A6200', 4, 1
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE name = 'Internación');
INSERT INTO service_categories (name, color_hex, sort_order, is_active)
SELECT 'Grooming', '#7C5CFC', 5, 1
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE name = 'Grooming');

-- Services catalog per branch
INSERT INTO services_catalog (branch_id, category_id, name, description, default_duration_min, base_price, tax_pct, is_active)
SELECT b.id, sc.id, 'Consulta clínica', 'Consulta general veterinaria', 30, 18000, 21, 1
FROM branches b
JOIN service_categories sc ON sc.name = 'Consultas'
WHERE NOT EXISTS (
  SELECT 1 FROM services_catalog s WHERE s.branch_id = b.id AND s.name = 'Consulta clínica'
);

INSERT INTO services_catalog (branch_id, category_id, name, description, default_duration_min, base_price, tax_pct, is_active)
SELECT b.id, sc.id, 'Control clínico', 'Control y seguimiento clínico', 20, 12000, 21, 1
FROM branches b
JOIN service_categories sc ON sc.name = 'Consultas'
WHERE NOT EXISTS (
  SELECT 1 FROM services_catalog s WHERE s.branch_id = b.id AND s.name = 'Control clínico'
);

INSERT INTO services_catalog (branch_id, category_id, name, description, default_duration_min, base_price, tax_pct, is_active)
SELECT b.id, sc.id, 'Hemograma y bioquímica', 'Extracción y procesamiento básico de laboratorio', 25, 26000, 21, 1
FROM branches b
JOIN service_categories sc ON sc.name = 'Diagnóstico'
WHERE NOT EXISTS (
  SELECT 1 FROM services_catalog s WHERE s.branch_id = b.id AND s.name = 'Hemograma y bioquímica'
);

INSERT INTO services_catalog (branch_id, category_id, name, description, default_duration_min, base_price, tax_pct, is_active)
SELECT b.id, sc.id, 'Radiografía simple', 'Estudio radiográfico simple', 20, 22000, 21, 1
FROM branches b
JOIN service_categories sc ON sc.name = 'Diagnóstico'
WHERE NOT EXISTS (
  SELECT 1 FROM services_catalog s WHERE s.branch_id = b.id AND s.name = 'Radiografía simple'
);

INSERT INTO services_catalog (branch_id, category_id, name, description, default_duration_min, base_price, tax_pct, is_active)
SELECT b.id, sc.id, 'Internación día', 'Internación y monitoreo por 24 horas', 1440, 35000, 21, 1
FROM branches b
JOIN service_categories sc ON sc.name = 'Internación'
WHERE NOT EXISTS (
  SELECT 1 FROM services_catalog s WHERE s.branch_id = b.id AND s.name = 'Internación día'
);

INSERT INTO services_catalog (branch_id, category_id, name, description, default_duration_min, base_price, tax_pct, is_active)
SELECT b.id, sc.id, 'Castración felina', 'Procedimiento quirúrgico programado', 60, 48000, 21, 1
FROM branches b
JOIN service_categories sc ON sc.name = 'Cirugía'
WHERE NOT EXISTS (
  SELECT 1 FROM services_catalog s WHERE s.branch_id = b.id AND s.name = 'Castración felina'
);

INSERT INTO services_catalog (branch_id, category_id, name, description, default_duration_min, base_price, tax_pct, is_active)
SELECT b.id, sc.id, 'Baño y corte', 'Servicio integral de grooming', 90, 28000, 21, 1
FROM branches b
JOIN service_categories sc ON sc.name = 'Grooming'
WHERE NOT EXISTS (
  SELECT 1 FROM services_catalog s WHERE s.branch_id = b.id AND s.name = 'Baño y corte'
);

-- Price lists
INSERT INTO price_lists (branch_id, currency_id, name, description, valid_from, is_default, is_active)
SELECT b.id, 1, 'Lista general', 'Lista de precios vigente', CURDATE(), 1, 1
FROM branches b
WHERE NOT EXISTS (
  SELECT 1 FROM price_lists pl WHERE pl.branch_id = b.id AND pl.name = 'Lista general'
);

INSERT INTO price_lists (branch_id, currency_id, name, description, valid_from, is_default, is_active)
SELECT b.id, 1, 'Lista promo grooming', 'Promociones de grooming', CURDATE(), 0, 1
FROM branches b
WHERE JSON_EXTRACT(COALESCE(b.services_enabled, JSON_ARRAY()), '$') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM price_lists pl WHERE pl.branch_id = b.id AND pl.name = 'Lista promo grooming'
  );

-- Price list items for general list
INSERT INTO price_list_items (price_list_id, service_id, price, discount_pct, is_active)
SELECT pl.id, s.id, s.base_price, 0, 1
FROM price_lists pl
JOIN services_catalog s ON s.branch_id = pl.branch_id
WHERE pl.name = 'Lista general'
  AND NOT EXISTS (
    SELECT 1 FROM price_list_items pli WHERE pli.price_list_id = pl.id AND pli.service_id = s.id
  );

-- Discount grooming items
INSERT INTO price_list_items (price_list_id, service_id, price, discount_pct, is_active)
SELECT pl.id, s.id, ROUND(s.base_price * 0.9, 2), 10, 1
FROM price_lists pl
JOIN services_catalog s ON s.branch_id = pl.branch_id
JOIN service_categories sc ON sc.id = s.category_id
WHERE pl.name = 'Lista promo grooming'
  AND sc.name = 'Grooming'
  AND NOT EXISTS (
    SELECT 1 FROM price_list_items pli WHERE pli.price_list_id = pl.id AND pli.service_id = s.id
  );

-- Lab reference ranges
INSERT INTO lab_reference_ranges (lab_test_id, species_id, sex, min_value, max_value, unit, notes)
SELECT lt.id, 1, 'any', 60, 120, 'mg/dL', 'Rango canino orientativo'
FROM lab_tests lt
WHERE lt.name = 'Glucosa'
  AND NOT EXISTS (SELECT 1 FROM lab_reference_ranges rr WHERE rr.lab_test_id = lt.id AND rr.species_id = 1 AND rr.sex = 'any');

INSERT INTO lab_reference_ranges (lab_test_id, species_id, sex, min_value, max_value, unit, notes)
SELECT lt.id, 2, 'any', 70, 150, 'mg/dL', 'Rango felino orientativo'
FROM lab_tests lt
WHERE lt.name = 'Glucosa'
  AND NOT EXISTS (SELECT 1 FROM lab_reference_ranges rr WHERE rr.lab_test_id = lt.id AND rr.species_id = 2 AND rr.sex = 'any');

INSERT INTO lab_reference_ranges (lab_test_id, species_id, sex, min_value, max_value, unit, notes)
SELECT lt.id, 1, 'any', 15, 55, 'mg/dL', 'Rango canino orientativo'
FROM lab_tests lt
WHERE lt.name = 'Urea'
  AND NOT EXISTS (SELECT 1 FROM lab_reference_ranges rr WHERE rr.lab_test_id = lt.id AND rr.species_id = 1 AND rr.sex = 'any');

INSERT INTO lab_reference_ranges (lab_test_id, species_id, sex, min_value, max_value, unit, notes)
SELECT lt.id, 2, 'any', 20, 65, 'mg/dL', 'Rango felino orientativo'
FROM lab_tests lt
WHERE lt.name = 'Urea'
  AND NOT EXISTS (SELECT 1 FROM lab_reference_ranges rr WHERE rr.lab_test_id = lt.id AND rr.species_id = 2 AND rr.sex = 'any');

INSERT INTO lab_reference_ranges (lab_test_id, species_id, sex, min_value, max_value, unit, notes)
SELECT lt.id, 1, 'any', 0.5, 1.6, 'mg/dL', 'Rango canino orientativo'
FROM lab_tests lt
WHERE lt.name = 'Creatinina'
  AND NOT EXISTS (SELECT 1 FROM lab_reference_ranges rr WHERE rr.lab_test_id = lt.id AND rr.species_id = 1 AND rr.sex = 'any');

INSERT INTO lab_reference_ranges (lab_test_id, species_id, sex, min_value, max_value, unit, notes)
SELECT lt.id, 2, 'any', 0.8, 2.0, 'mg/dL', 'Rango felino orientativo'
FROM lab_tests lt
WHERE lt.name = 'Creatinina'
  AND NOT EXISTS (SELECT 1 FROM lab_reference_ranges rr WHERE rr.lab_test_id = lt.id AND rr.species_id = 2 AND rr.sex = 'any');

-- Clinical patient facts must not be seeded into production patients.
-- Demo allergies/conditions belong in explicit fixture scripts guarded by a demo tenant.
/*
-- Patient allergies
INSERT INTO patient_allergies (patient_id, allergen, reaction_type, severity, reaction_description, is_active, diagnosed_at)
SELECT p.id, 'Penicilina', 'Erupción cutánea', 'moderate', 'Prurito y eritema luego de administración', 1, CURDATE()
FROM patients p
WHERE p.id = 1
  AND NOT EXISTS (SELECT 1 FROM patient_allergies a WHERE a.patient_id = p.id AND a.allergen = 'Penicilina');

INSERT INTO patient_allergies (patient_id, allergen, reaction_type, severity, reaction_description, is_active, diagnosed_at)
SELECT p.id, 'Carne vacuna', 'Intolerancia digestiva', 'mild', 'Vómitos y diarrea intermitente', 1, CURDATE()
FROM patients p
WHERE p.id = 2
  AND NOT EXISTS (SELECT 1 FROM patient_allergies a WHERE a.patient_id = p.id AND a.allergen = 'Carne vacuna');

INSERT INTO patient_allergies (patient_id, allergen, reaction_type, severity, reaction_description, is_active, diagnosed_at)
SELECT p.id, 'Pulgas', 'Dermatitis alérgica', 'moderate', 'Prurito intenso con lesiones por rascado', 1, CURDATE()
FROM patients p
WHERE p.id = 3
  AND NOT EXISTS (SELECT 1 FROM patient_allergies a WHERE a.patient_id = p.id AND a.allergen = 'Pulgas');

-- Patient chronic conditions
INSERT INTO patient_chronic_conditions (patient_id, condition_name, diagnosed_at, managed_with, notes, is_active)
SELECT p.id, 'Dermatitis crónica', CURDATE(), 'Control dermatológico y dieta hipoalergénica', 'Seguimiento mensual', 1
FROM patients p
WHERE p.id = 1
  AND NOT EXISTS (SELECT 1 FROM patient_chronic_conditions c WHERE c.patient_id = p.id AND c.condition_name = 'Dermatitis crónica');

INSERT INTO patient_chronic_conditions (patient_id, condition_name, diagnosed_at, managed_with, notes, is_active)
SELECT p.id, 'Enfermedad renal crónica', CURDATE(), 'Dieta renal y controles de laboratorio', 'Control trimestral', 1
FROM patients p
WHERE p.id = 2
  AND NOT EXISTS (SELECT 1 FROM patient_chronic_conditions c WHERE c.patient_id = p.id AND c.condition_name = 'Enfermedad renal crónica');

INSERT INTO patient_chronic_conditions (patient_id, condition_name, diagnosed_at, managed_with, notes, is_active)
SELECT p.id, 'Artrosis', CURDATE(), 'Meloxicam según necesidad y control de peso', 'Actividad moderada', 1
FROM patients p
WHERE p.id = 3
  AND NOT EXISTS (SELECT 1 FROM patient_chronic_conditions c WHERE c.patient_id = p.id AND c.condition_name = 'Artrosis');
*/
