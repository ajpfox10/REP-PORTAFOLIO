-- 087__siape_novedades_regimen.sql
-- Que novedades ofrece SiAPe a cada tipo de agente. El selector Licencia-Permiso y los
-- combos de Novedades de Ausentismo cambian segun la persona abierta: con un becado
-- faltan las licencias de planta (20/10/2026). El robot siape_control_novedades abre un
-- agente de cada regimen y anota aca lo que vio.
--
-- regimen: BECADOS, RESIDENTES, 10471 PLANTA, 10471 GUARDIA, 10430 TITULAR, 10430 INTERINO.
-- dni: el agente con el que se leyo la ultima vez.
-- El robot nunca pone vigente = 0 (solo avisa); visto_ultimo dice cuando la vio por ultima vez.

CREATE TABLE IF NOT EXISTS siape_novedades_regimen (
  origen VARCHAR(40) NOT NULL,
  novedad VARCHAR(150) NOT NULL,
  regimen VARCHAR(30) NOT NULL,
  vigente TINYINT(1) NOT NULL DEFAULT 1,
  dni VARCHAR(20) NULL,
  visto_primero DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  visto_ultimo DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (origen, novedad, regimen),
  KEY ix_regimen (regimen, vigente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
