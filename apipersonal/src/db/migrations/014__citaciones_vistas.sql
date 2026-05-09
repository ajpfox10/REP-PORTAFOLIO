-- Registra cada vez que un operador ve una citación activa en ventanilla.
CREATE TABLE IF NOT EXISTS citaciones_vistas (
  id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  citacion_id INT          NOT NULL,
  visto_por   VARCHAR(255) NOT NULL,
  usuario_id  INT          NULL,
  accion      VARCHAR(64)  NOT NULL DEFAULT 'visto',
  visto_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip          VARCHAR(64)  NULL,
  CONSTRAINT fk_cv_citacion FOREIGN KEY (citacion_id)
    REFERENCES citaciones(id) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX idx_cv_citacion (citacion_id),
  INDEX idx_cv_usuario  (usuario_id)
);
