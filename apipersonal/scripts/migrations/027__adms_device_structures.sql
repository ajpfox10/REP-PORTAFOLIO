CREATE TABLE IF NOT EXISTS adms_device_structures (
  id INT NOT NULL AUTO_INCREMENT,
  sn VARCHAR(40) NOT NULL,
  reparticion_id INT NULL,
  servicio_id INT NULL,
  sector_id INT NULL,
  fecha_desde DATE NULL,
  fecha_hasta DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_adms_device_structures_sn (sn),
  KEY idx_adms_device_structures_rep (reparticion_id),
  KEY idx_adms_device_structures_srv (servicio_id),
  KEY idx_adms_device_structures_sec (sector_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
