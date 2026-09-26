-- 049__jubilacion_anses.sql
-- Ficha ANSES por agente.
--
-- Hasta ahora los tramos de ANSES vivian SOLO adentro de cada calculo guardado
-- (jubilacion_calculos.servicios_anses, mig 020). Eso alcanza para la
-- calculadora de a un agente, pero no para barrer el padron: no hay forma de
-- saber los servicios ANSES de 3000 agentes sin abrir 3000 calculos.
--
-- Esta tabla guarda UNA ficha vigente por DNI (lo ultimo que se leyo del PDF de
-- ANSES o lo que cargo el operador a mano) para que la proyeccion por servicio
-- pueda computarlos. `tiene_datos = 0` distingue "ya lo miramos y no tiene
-- aportes en ANSES" de "todavia no lo miramos" (= no hay fila).

CREATE TABLE IF NOT EXISTS jubilacion_anses (
  id                    bigint unsigned NOT NULL AUTO_INCREMENT,
  dni                   int             NOT NULL,
  servicios             json            NULL COMMENT '[{fecha_desde,fecha_hasta,es_insalubre}]',
  tiene_datos           tinyint(1)      NOT NULL DEFAULT 1,
  origen                enum('PDF','MANUAL') NOT NULL DEFAULT 'MANUAL',
  archivo_origen        varchar(500)    NULL,
  fecha_lectura         date            NULL,
  observaciones         text            NULL,
  creado_por            bigint unsigned NULL,
  creado_por_nombre     varchar(190)    NULL,
  modificado_por        bigint unsigned NULL,
  modificado_por_nombre varchar(190)    NULL,
  created_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            datetime        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jub_anses_dni (dni),
  INDEX idx_jub_anses_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
