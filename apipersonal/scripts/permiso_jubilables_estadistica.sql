-- permiso_jubilables_estadistica.sql
-- Página "Jubilables (estadística)" (/app/jubilables-estadistica): sólo
-- porcentajes y gráficos, sin datos de agentes.
-- Se le da a:
--   · director_ejecutivo (Dirección Ejecutiva)
--   · residentes (Atilio Varela, por Docencia — PROVISORIO: cuando Docencia
--     tenga usuario propio, sacarlo de este rol y armar un rol 'docencia').
-- Idempotente: se puede correr varias veces sin duplicar.

-- 1) Permiso ------------------------------------------------------------------
INSERT INTO permisos (clave, descripcion, dominio_id, created_at)
SELECT 'app:jubilables-estadistica:access',
       'Acceso a la página Jubilables (estadística agregada, sin datos de agentes)',
       NULL, NOW()
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE clave = 'app:jubilables-estadistica:access');

-- 2) Grants -------------------------------------------------------------------
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.clave = 'app:jubilables-estadistica:access'
WHERE r.nombre IN ('director_ejecutivo', 'residentes')
  AND NOT EXISTS (
    SELECT 1 FROM roles_permisos rp
    WHERE rp.rol_id = r.id AND rp.permiso_id = p.id AND rp.deleted_at IS NULL
  );

-- Verificación (opcional):
-- SELECT r.nombre, p.clave
-- FROM roles r
-- JOIN roles_permisos rp ON rp.rol_id = r.id AND rp.deleted_at IS NULL
-- JOIN permisos p ON p.id = rp.permiso_id
-- WHERE p.clave = 'app:jubilables-estadistica:access';
