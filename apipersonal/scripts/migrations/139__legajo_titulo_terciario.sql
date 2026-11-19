-- 139__legajo_titulo_terciario.sql (18/11/2026, pedido del usuario)
-- Estudios con nivel TERCIARIO aparte (técnicos de enfermería, radiología, profesorados de instituto, etc.):
-- estudios_nivel ya es VARCHAR(30) → admite 'TERCIARIO' sin cambio; se agregan título terciario + institución.
-- El legajo oficial (PDF) no tiene renglón de terciario: si no hay universitario, el título terciario se imprime
-- en el renglón de "Título universitario" con la aclaración "(Terciario)" y se tilda Secundario.
-- Se aplica también en runtime (COLUMNAS_NUEVAS en routes/legajo.routes.ts): columna repetida (1060) se ignora.

ALTER TABLE legajo_datos_personales ADD COLUMN titulo_terciario VARCHAR(200) NULL AFTER titulo_secundario_otorgado;
ALTER TABLE legajo_datos_personales ADD COLUMN titulo_terciario_otorgado VARCHAR(200) NULL AFTER titulo_terciario;
