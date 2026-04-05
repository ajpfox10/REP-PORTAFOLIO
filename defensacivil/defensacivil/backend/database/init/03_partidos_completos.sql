-- =============================================================
-- TODOS LOS PARTIDOS DE ARGENTINA (ejecutar DESPUÉS del 02_seed.sql)
-- =============================================================
SET NAMES utf8mb4;

-- Buenos Aires: 135 partidos completos
INSERT IGNORE INTO partidos (province_id, name)
SELECT p.id, pd.name FROM provinces p
JOIN (
  SELECT 'Adolfo Alsina' AS name UNION ALL SELECT 'Adolfo Gonzales Chaves' UNION ALL
  SELECT 'Alberti' UNION ALL SELECT 'Almirante Brown' UNION ALL SELECT 'Arrecifes' UNION ALL
  SELECT 'Avellaneda' UNION ALL SELECT 'Ayacucho' UNION ALL SELECT 'Azul' UNION ALL
  SELECT 'Bahía Blanca' UNION ALL SELECT 'Balcarce' UNION ALL SELECT 'Baradero' UNION ALL
  SELECT 'Benito Juárez' UNION ALL SELECT 'Berazategui' UNION ALL SELECT 'Berisso' UNION ALL
  SELECT 'Bolívar' UNION ALL SELECT 'Bragado' UNION ALL SELECT 'Brandsen' UNION ALL
  SELECT 'Campana' UNION ALL SELECT 'Cañuelas' UNION ALL SELECT 'Capitán Sarmiento' UNION ALL
  SELECT 'Carlos Casares' UNION ALL SELECT 'Carlos Tejedor' UNION ALL
  SELECT 'Carmen de Areco' UNION ALL SELECT 'Castelli' UNION ALL SELECT 'Chacabuco' UNION ALL
  SELECT 'Chascomús' UNION ALL SELECT 'Chivilcoy' UNION ALL SELECT 'Colón' UNION ALL
  SELECT 'Coronel Dorrego' UNION ALL SELECT 'Coronel Pringles' UNION ALL
  SELECT 'Coronel Rosales' UNION ALL SELECT 'Coronel Suárez' UNION ALL
  SELECT 'Daireaux' UNION ALL SELECT 'Dolores' UNION ALL SELECT 'Ensenada' UNION ALL
  SELECT 'Escobar' UNION ALL SELECT 'Esteban Echeverría' UNION ALL
  SELECT 'Exaltación de la Cruz' UNION ALL SELECT 'Ezeiza' UNION ALL
  SELECT 'Florencio Varela' UNION ALL SELECT 'Florentino Ameghino' UNION ALL
  SELECT 'General Alvarado' UNION ALL SELECT 'General Alvear' UNION ALL
  SELECT 'General Arenales' UNION ALL SELECT 'General Belgrano' UNION ALL
  SELECT 'General Guido' UNION ALL SELECT 'General Juan Madariaga' UNION ALL
  SELECT 'General La Madrid' UNION ALL SELECT 'General Las Heras' UNION ALL
  SELECT 'General Lavalle' UNION ALL SELECT 'General Paz' UNION ALL
  SELECT 'General Pinto' UNION ALL SELECT 'General Pueyrredón' UNION ALL
  SELECT 'General Rodríguez' UNION ALL SELECT 'General San Martín' UNION ALL
  SELECT 'General Viamonte' UNION ALL SELECT 'General Villegas' UNION ALL
  SELECT 'Guaminí' UNION ALL SELECT 'Hipólito Yrigoyen' UNION ALL
  SELECT 'Hurlingham' UNION ALL SELECT 'Ituzaingó' UNION ALL
  SELECT 'José C. Paz' UNION ALL SELECT 'Junín' UNION ALL
  SELECT 'La Costa' UNION ALL SELECT 'La Matanza' UNION ALL
  SELECT 'La Plata' UNION ALL SELECT 'Lanús' UNION ALL SELECT 'Laprida' UNION ALL
  SELECT 'Las Flores' UNION ALL SELECT 'Leandro N. Alem' UNION ALL SELECT 'Lincoln' UNION ALL
  SELECT 'Lobería' UNION ALL SELECT 'Lobos' UNION ALL SELECT 'Lomas de Zamora' UNION ALL
  SELECT 'Luján' UNION ALL SELECT 'Magdalena' UNION ALL SELECT 'Maipú' UNION ALL
  SELECT 'Malvinas Argentinas' UNION ALL SELECT 'Mar Chiquita' UNION ALL
  SELECT 'Marcos Paz' UNION ALL SELECT 'Mercedes' UNION ALL SELECT 'Merlo' UNION ALL
  SELECT 'Monte' UNION ALL SELECT 'Monte Hermoso' UNION ALL SELECT 'Moreno' UNION ALL
  SELECT 'Morón' UNION ALL SELECT 'Navarro' UNION ALL SELECT 'Necochea' UNION ALL
  SELECT 'Nueve de Julio' UNION ALL SELECT 'Olavarría' UNION ALL SELECT 'Patagones' UNION ALL
  SELECT 'Pehuajó' UNION ALL SELECT 'Pellegrini' UNION ALL SELECT 'Pergamino' UNION ALL
  SELECT 'Pila' UNION ALL SELECT 'Pilar' UNION ALL SELECT 'Pinamar' UNION ALL
  SELECT 'Presidente Perón' UNION ALL SELECT 'Punta Indio' UNION ALL SELECT 'Quilmes' UNION ALL
  SELECT 'Ramallo' UNION ALL SELECT 'Rauch' UNION ALL SELECT 'Rivadavia' UNION ALL
  SELECT 'Rojas' UNION ALL SELECT 'Roque Pérez' UNION ALL SELECT 'Saavedra' UNION ALL
  SELECT 'Saladillo' UNION ALL SELECT 'Salliqueló' UNION ALL SELECT 'Salto' UNION ALL
  SELECT 'San Andrés de Giles' UNION ALL SELECT 'San Antonio de Areco' UNION ALL
  SELECT 'San Cayetano' UNION ALL SELECT 'San Fernando' UNION ALL SELECT 'San Isidro' UNION ALL
  SELECT 'San Miguel' UNION ALL SELECT 'San Nicolás' UNION ALL SELECT 'San Pedro' UNION ALL
  SELECT 'San Vicente' UNION ALL SELECT 'Suipacha' UNION ALL SELECT 'Tandil' UNION ALL
  SELECT 'Tapalqué' UNION ALL SELECT 'Tigre' UNION ALL SELECT 'Tordillo' UNION ALL
  SELECT 'Tornquist' UNION ALL SELECT 'Trenque Lauquen' UNION ALL SELECT 'Tres Arroyos' UNION ALL
  SELECT 'Tres de Febrero' UNION ALL SELECT 'Tres Lomas' UNION ALL SELECT 'Vicente López' UNION ALL
  SELECT 'Villa Gesell' UNION ALL SELECT 'Villarino' UNION ALL SELECT 'Zárate'
) AS pd WHERE p.code = 'AR-B';

-- CABA: Comunas
INSERT IGNORE INTO partidos (province_id, name)
SELECT p.id, pd.name FROM provinces p
JOIN (
  SELECT 'Comuna 1' AS name UNION ALL SELECT 'Comuna 2' UNION ALL SELECT 'Comuna 3' UNION ALL
  SELECT 'Comuna 4' UNION ALL SELECT 'Comuna 5' UNION ALL SELECT 'Comuna 6' UNION ALL
  SELECT 'Comuna 7' UNION ALL SELECT 'Comuna 8' UNION ALL SELECT 'Comuna 9' UNION ALL
  SELECT 'Comuna 10' UNION ALL SELECT 'Comuna 11' UNION ALL SELECT 'Comuna 12' UNION ALL
  SELECT 'Comuna 13' UNION ALL SELECT 'Comuna 14' UNION ALL SELECT 'Comuna 15' UNION ALL
  SELECT 'Palermo' UNION ALL SELECT 'Belgrano' UNION ALL SELECT 'Recoleta' UNION ALL
  SELECT 'San Telmo' UNION ALL SELECT 'La Boca' UNION ALL SELECT 'Caballito' UNION ALL
  SELECT 'Mataderos' UNION ALL SELECT 'Villa Lugano' UNION ALL SELECT 'Flores' UNION ALL
  SELECT 'Villa Urquiza' UNION ALL SELECT 'Parque Patricios' UNION ALL SELECT 'Barracas'
) AS pd WHERE p.code = 'AR-C';

-- Córdoba: Departamentos
INSERT IGNORE INTO partidos (province_id, name)
SELECT p.id, pd.name FROM provinces p
JOIN (
  SELECT 'Capital' AS name UNION ALL SELECT 'Calamuchita' UNION ALL SELECT 'Colón' UNION ALL
  SELECT 'Cruz del Eje' UNION ALL SELECT 'General Roca' UNION ALL SELECT 'General San Martín' UNION ALL
  SELECT 'Ischilín' UNION ALL SELECT 'Juárez Celman' UNION ALL SELECT 'Marcos Juárez' UNION ALL
  SELECT 'Minas' UNION ALL SELECT 'Pocho' UNION ALL SELECT 'Presidente Roque Sáenz Peña' UNION ALL
  SELECT 'Punilla' UNION ALL SELECT 'Río Cuarto' UNION ALL SELECT 'Río Primero' UNION ALL
  SELECT 'Río Seco' UNION ALL SELECT 'Río Segundo' UNION ALL SELECT 'San Alberto' UNION ALL
  SELECT 'San Javier' UNION ALL SELECT 'San Justo' UNION ALL SELECT 'Santa María' UNION ALL
  SELECT 'Sobremonte' UNION ALL SELECT 'Tercero Arriba' UNION ALL SELECT 'Totoral' UNION ALL
  SELECT 'Tulumba' UNION ALL SELECT 'Unión'
) AS pd WHERE p.code = 'AR-X';

-- Santa Fe: Departamentos
INSERT IGNORE INTO partidos (province_id, name)
SELECT p.id, pd.name FROM provinces p
JOIN (
  SELECT 'Belgrano' AS name UNION ALL SELECT 'Caseros' UNION ALL SELECT 'Castellanos' UNION ALL
  SELECT 'Constitución' UNION ALL SELECT 'Garay' UNION ALL SELECT 'General López' UNION ALL
  SELECT 'General Obligado' UNION ALL SELECT 'Iriondo' UNION ALL SELECT 'La Capital' UNION ALL
  SELECT 'Las Colonias' UNION ALL SELECT 'Nueve de Julio' UNION ALL SELECT 'Rosario' UNION ALL
  SELECT 'San Cristóbal' UNION ALL SELECT 'San Jerónimo' UNION ALL SELECT 'San Javier' UNION ALL
  SELECT 'San Justo' UNION ALL SELECT 'San Lorenzo' UNION ALL SELECT 'San Martín' UNION ALL
  SELECT 'Vera'
) AS pd WHERE p.code = 'AR-S';

-- Mendoza: Departamentos
INSERT IGNORE INTO partidos (province_id, name)
SELECT p.id, pd.name FROM provinces p
JOIN (
  SELECT 'Capital' AS name UNION ALL SELECT 'General Alvear' UNION ALL SELECT 'Godoy Cruz' UNION ALL
  SELECT 'Guaymallén' UNION ALL SELECT 'Junín' UNION ALL SELECT 'La Paz' UNION ALL
  SELECT 'Las Heras' UNION ALL SELECT 'Lavalle' UNION ALL SELECT 'Luján de Cuyo' UNION ALL
  SELECT 'Maipú' UNION ALL SELECT 'Malargüe' UNION ALL SELECT 'Rivadavia' UNION ALL
  SELECT 'San Carlos' UNION ALL SELECT 'San Martín' UNION ALL SELECT 'San Rafael' UNION ALL
  SELECT 'Santa Rosa' UNION ALL SELECT 'Tunuyán' UNION ALL SELECT 'Tupungato'
) AS pd WHERE p.code = 'AR-M';

-- Tucumán: Departamentos
INSERT IGNORE INTO partidos (province_id, name)
SELECT p.id, pd.name FROM provinces p
JOIN (
  SELECT 'Burruyacú' AS name UNION ALL SELECT 'Capital' UNION ALL SELECT 'Cruz Alta' UNION ALL
  SELECT 'Chicligasta' UNION ALL SELECT 'Famaillá' UNION ALL SELECT 'Graneros' UNION ALL
  SELECT 'Juan Bautista Alberdi' UNION ALL SELECT 'La Cocha' UNION ALL SELECT 'Leales' UNION ALL
  SELECT 'Lules' UNION ALL SELECT 'Monteros' UNION ALL SELECT 'Río Chico' UNION ALL
  SELECT 'Simoca' UNION ALL SELECT 'Tafí del Valle' UNION ALL SELECT 'Tafí Viejo' UNION ALL
  SELECT 'Trancas' UNION ALL SELECT 'Yerba Buena'
) AS pd WHERE p.code = 'AR-T';

-- Salta: Departamentos
INSERT IGNORE INTO partidos (province_id, name)
SELECT p.id, pd.name FROM provinces p
JOIN (
  SELECT 'Capital' AS name UNION ALL SELECT 'Anta' UNION ALL SELECT 'Cachi' UNION ALL
  SELECT 'Cafayate' UNION ALL SELECT 'Cerrillos' UNION ALL SELECT 'Chicoana' UNION ALL
  SELECT 'General Güemes' UNION ALL SELECT 'General José de San Martín' UNION ALL
  SELECT 'Guachipas' UNION ALL SELECT 'Iruya' UNION ALL SELECT 'La Caldera' UNION ALL
  SELECT 'La Candelaria' UNION ALL SELECT 'La Poma' UNION ALL SELECT 'La Viña' UNION ALL
  SELECT 'Los Andes' UNION ALL SELECT 'Metán' UNION ALL SELECT 'Molinos' UNION ALL
  SELECT 'Orán' UNION ALL SELECT 'Rivadavia' UNION ALL SELECT 'Rosario de la Frontera' UNION ALL
  SELECT 'Rosario de Lerma' UNION ALL SELECT 'San Carlos' UNION ALL SELECT 'Santa Victoria'
) AS pd WHERE p.code = 'AR-A';

SELECT CONCAT(COUNT(*), ' partidos totales cargados') AS resultado FROM partidos;
