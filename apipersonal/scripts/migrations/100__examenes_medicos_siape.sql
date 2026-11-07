-- 100__examenes_medicos_siape.sql
-- Exámenes médicos (aptos) de SIAPE, acumulados. Reemplaza la lectura directa de
-- D:\G\APTOS\APTOS.xlsx en /tramites-documentales/aptos.
--   - la llena la exportación "Examenes Médicos Salud" (post 'examenes_medicos'):
--     la consulta trae solo el año pedido, así que se ACTUALIZA por código y
--     NUNCA se borra (lo de años anteriores queda).
--   - el robot de certificados agrega lo que ve en la grilla de Rec. Médicos
--     (origen 'pantalla'): ahí aparecen exámenes sin FECHA que la exportación por
--     período no trae.
-- Sin FK a personal: trae gente que todavía no está cargada (en_sistema=false).

CREATE TABLE IF NOT EXISTS examenes_medicos_siape (
  codigo_examen VARCHAR(30) NOT NULL,
  dni INT NOT NULL,
  apellido VARCHAR(120) NULL,
  nombre VARCHAR(120) NULL,
  cuil VARCHAR(20) NULL,
  organismo VARCHAR(120) NULL,
  tipo_examen VARCHAR(120) NULL,
  modalidad VARCHAR(60) NULL,
  fecha DATE NULL,
  estado_examen VARCHAR(60) NULL,
  resolucion VARCHAR(120) NULL,
  tipo_tramite VARCHAR(60) NULL,
  origen VARCHAR(20) NOT NULL DEFAULT 'exportacion',
  archivo VARCHAR(255) NULL,
  primera_vez TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultima_vez TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (codigo_examen),
  KEY idx_examenes_medicos_siape__dni (dni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
