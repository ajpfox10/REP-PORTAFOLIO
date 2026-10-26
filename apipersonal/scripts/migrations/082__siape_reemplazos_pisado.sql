-- 082: estado PISADO en siape_carga_reemplazos = registro de SIAPE que el robot de francos/rotaciones
-- sobrescribio por error (cargaba un dia "nuevo" sobre el registro que mostraba el formulario).
-- Bug corregido el 17/10/2026 en cargar_francos_siape.py (_formulario_en_blanco).
ALTER TABLE siape_carga_reemplazos
  MODIFY estado ENUM('PENDIENTE','CAMBIADO','BORRADO','FALLO','PISADO') NOT NULL DEFAULT 'PENDIENTE';
