-- 094__nomenclador_cargos_10430.sql
-- Nomenclador de cargos de la Ley 10430 (EX-2024-40323859-GDEBA-DSTECMTRAGP,
-- planilla "AUTO NOMENCLADOR (AlfaV1.09).xlsx"). Lo carga
-- scripts/importar_nomenclador_10430.py desde el Excel.
--
-- Codigo oficial del cargo: <agrupamiento>-<codigo 4 dig>-<grado>-<clase>, ej. 4-0242-XIII-4.
--   * agrupamiento y codigo salen de nomenclador_cargos
--   * grado y clase salen de la categoria (nomenclador_categorias, por agrupamiento)
-- La letra del cargo ("Enfermero B") tiene que coincidir con la clase de la categoria:
-- clase A=A, 1=B, 2=C, 3=D, 4=E (inicial).
--
-- agentes_cargo_nomenclador guarda el cargo del agente por tramo (agentes.id), con
-- historial: un periodo por fila, el vigente con fecha_hasta NULL (misma forma que
-- agentes_especialidades). Los FK compuestos (agrupamiento_id, cargo_id) y
-- (agrupamiento_id, categoria_id) obligan a que cargo y categoria sean del mismo
-- agrupamiento.
--
-- La tabla vieja `nomenclador` (vacia, sin uso en el codigo) no se toca.
--
-- NO es idempotente como SQL plano: verificar en information_schema antes de correrlo.

CREATE TABLE nomenclador_agrupamientos (
  id      TINYINT NOT NULL,              -- numero oficial: 1..5
  nombre  VARCHAR(30) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_nomagr_nombre (nombre)
);

INSERT INTO nomenclador_agrupamientos (id, nombre) VALUES
  (1, 'SERVICIO'), (2, 'OBRERO'), (3, 'ADMINISTRATIVO'), (4, 'TECNICO'), (5, 'PROFESIONAL');

CREATE TABLE nomenclador_categorias (
  id              INT NOT NULL AUTO_INCREMENT,
  agrupamiento_id TINYINT NOT NULL,
  categoria       TINYINT NOT NULL,
  grado           VARCHAR(5) NOT NULL,     -- romano: I..XIV
  clase           VARCHAR(2) NOT NULL,     -- A, 1, 2, 3, 4
  PRIMARY KEY (id),
  UNIQUE KEY ux_nomcat_agr_cat (agrupamiento_id, categoria),
  UNIQUE KEY ux_nomcat_agr_id (agrupamiento_id, id),
  CONSTRAINT fk_nomcat_agrupamiento FOREIGN KEY (agrupamiento_id) REFERENCES nomenclador_agrupamientos (id)
);

CREATE TABLE nomenclador_cargos (
  id                    INT NOT NULL AUTO_INCREMENT,
  agrupamiento_id       TINYINT NOT NULL,
  codigo                SMALLINT NOT NULL,          -- 0 = Inicial "E"
  denominacion          VARCHAR(255) NOT NULL,
  letra                 CHAR(1) NULL,               -- letra entre comillas en la denominacion
  descripcion_tareas    TEXT NULL,
  requisitos            TEXT NULL,
  caracteristicas       TEXT NULL,
  incorporado_por       VARCHAR(255) NULL,
  dejado_sin_efecto_por VARCHAR(255) NULL,
  ambito_aplicacion     VARCHAR(255) NULL,
  vigente               TINYINT(1) NOT NULL DEFAULT 1,
  created_at            TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_nomcar_agr_codigo (agrupamiento_id, codigo),
  UNIQUE KEY ux_nomcar_agr_id (agrupamiento_id, id),
  KEY ix_nomcar_denominacion (denominacion),
  CONSTRAINT fk_nomcar_agrupamiento FOREIGN KEY (agrupamiento_id) REFERENCES nomenclador_agrupamientos (id)
);

CREATE TABLE agentes_cargo_nomenclador (
  id              INT NOT NULL AUTO_INCREMENT,
  agente_id       INT NOT NULL,
  agrupamiento_id TINYINT NOT NULL,
  cargo_id        INT NOT NULL,
  categoria_id    INT NOT NULL,
  fecha_desde     DATE NOT NULL,
  fecha_hasta     DATE NULL,
  origen          ENUM('SIAPE','MANUAL') NOT NULL DEFAULT 'MANUAL',
  observaciones   VARCHAR(255) NULL,
  abierta         TINYINT GENERATED ALWAYS AS
                    (IF(fecha_hasta IS NULL AND deleted_at IS NULL, 1, NULL)) STORED,
  created_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  created_by      INT NULL,
  updated_by      INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_agcarnom_una_abierta (agente_id, abierta),
  KEY ix_agcarnom_agente (agente_id, fecha_desde),
  KEY ix_agcarnom_cargo (agrupamiento_id, cargo_id),
  KEY ix_agcarnom_categoria (agrupamiento_id, categoria_id),
  CONSTRAINT fk_agcarnom_agente    FOREIGN KEY (agente_id) REFERENCES agentes (id),
  CONSTRAINT fk_agcarnom_cargo     FOREIGN KEY (agrupamiento_id, cargo_id)
    REFERENCES nomenclador_cargos (agrupamiento_id, id),
  CONSTRAINT fk_agcarnom_categoria FOREIGN KEY (agrupamiento_id, categoria_id)
    REFERENCES nomenclador_categorias (agrupamiento_id, id)
);
