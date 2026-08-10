ALTER TABLE becarios_art
  ADD COLUMN origen_art ENUM('manual','automatico') NULL DEFAULT 'automatico' AFTER pagina,
  ADD KEY idx_becarios_art_origen (origen_art);

UPDATE becarios_art
SET origen_art = 'manual'
WHERE creado_por IS NOT NULL OR pagina <> '';

UPDATE becarios_art
SET origen_art = 'automatico'
WHERE origen_art IS NULL;
