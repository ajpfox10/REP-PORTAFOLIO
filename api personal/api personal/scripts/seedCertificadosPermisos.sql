-- Permisos para plantillas de certificados
INSERT INTO permisos (clave, descripcion, dominio_id) 
SELECT 'certificados:plantillas:read', 'Listar plantillas de certificados', NULL
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE clave = 'certificados:plantillas:read');

INSERT INTO permisos (clave, descripcion, dominio_id) 
SELECT 'certificados:generate', 'Generar certificados con plantilla específica', NULL
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE clave = 'certificados:generate');

-- Asignar a admin
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT 1, p.id
FROM permisos p
WHERE p.clave LIKE 'certificados:%'
  AND NOT EXISTS (
    SELECT 1 FROM roles_permisos rp 
    WHERE rp.rol_id = 1 AND rp.permiso_id = p.id
  );