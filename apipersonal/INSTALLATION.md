# Instalación y Configuración - IMPORTANTE

## ANTES DE CORRER TESTS O LA API

**DEBES ejecutar la migración SQL para arreglar el schema de tu base de datos.**

### Paso 1: Ejecutar Migración SQL

```bash
# Conecta a MySQL
mysql -u root -p personalv5_test

# O si usas la DB de producción
mysql -u root -p personalv5
```

Luego ejecuta el script de migración:

```sql
source scripts/migrations/000__fix_schema_for_production.sql;
```

O desde la línea de comandos:

```bash
mysql -u root -p personalv5_test < scripts/migrations/000__fix_schema_for_production.sql
```

### Paso 2: Crear Usuario Admin

```bash
mysql -u root -p personalv5_test < scripts/migrations/seed_test_users.sql
```

Esto crea:
- **Email**: `admin@local.com`
- **Password**: `Admin123!`

### Paso 3: Verificar

```sql
-- Verificar que roles tiene timestamps
DESCRIBE roles;

-- Verificar que usuarios tiene las columnas correctas
DESCRIBE usuarios;

-- Verificar que existen las nuevas tablas
SHOW TABLES LIKE '%password_reset%';
SHOW TABLES LIKE '%two_factor%';

-- Verificar que existe el admin
SELECT * FROM usuarios WHERE email = 'admin@local.com';
```

## Ahora sí puedes correr los tests

```bash
npm install
npm test
```

## Qué Hace la Migración

La migración `000__fix_schema_for_production.sql`:

1. Agrega `created_at` y `updated_at` a la tabla `roles`
2. Renombra `password` → `password_hash` en `usuarios`
3. Agrega columna `active` en `usuarios` 
4. Agrega columna `rol_id` en `usuarios`
5. Agrega columna `two_factor_enabled` en `usuarios`
6. Renombra `creado_en` → `created_at` en `usuarios`
7. Renombra `actualizado_en` → `updated_at` en `usuarios`
8. Crea tabla `password_reset_tokens`
9. Crea tabla `two_factor_codes`
10. Crea rol `admin` si no existe
11. Crea permisos necesarios
12. Asigna permisos al rol admin
13. Agrega timestamps a `roles_permisos` y `permisos`

## Si algo sale mal

Si la migración falla:

```sql
-- Ver qué columnas tiene roles
DESCRIBE roles;

-- Ver qué columnas tiene usuarios
DESCRIBE usuarios;

-- Ver el error específico
SHOW WARNINGS;
```

La mayoría de los `ALTER TABLE` usan `IF NOT EXISTS` o ignorarán errores si la columna ya existe.

## Estructura Final Esperada

### Tabla `roles`
```sql
- id INT
- nombre VARCHAR(100)
- descripcion VARCHAR(255)
- created_at DATETIME  ← NUEVO
- updated_at DATETIME  ← NUEVO
- deleted_at DATETIME
- created_by INT
- updated_by INT
```

### Tabla `usuarios`
```sql
- id INT
- email VARCHAR(255)
- password_hash VARCHAR(255)  ← RENOMBRADO de 'password'
- nombre VARCHAR(255)
- rol_id INT  ← NUEVO
- estado ENUM('activo','inactivo')
- active TINYINT(1)  ← NUEVO
- two_factor_enabled TINYINT(1)  ← NUEVO
- created_at DATETIME  ← RENOMBRADO de 'creado_en'
- updated_at DATETIME  ← RENOMBRADO de 'actualizado_en'
- deleted_at DATETIME
- created_by INT
- updated_by INT
```

### Tabla `password_reset_tokens` (NUEVA)
```sql
- id INT UNSIGNED
- usuario_id INT
- token_hash VARCHAR(64)
- expires_at DATETIME
- used_at DATETIME
- created_at DATETIME
- updated_at DATETIME
```

### Tabla `two_factor_codes` (NUEVA)
```sql
- id INT UNSIGNED
- usuario_id INT
- code_hash VARCHAR(64)
- expires_at DATETIME
- verified_at DATETIME
- attempts INT UNSIGNED
- created_at DATETIME
- updated_at DATETIME
```

## Luego de la migración

Una vez ejecutada la migración, todos los tests deberían pasar:

```bash
npm test
```

Deberías ver:
- Auth tests passing
- API Keys tests passing
- Webhooks tests passing
- Documents tests passing
- Eventos tests passing

## Soporte

Si tienes problemas:
1. Verifica que MySQL esté corriendo
2. Verifica los permisos de tu usuario MySQL
3. Revisa los logs en `logs/app-YYYY-MM-DD.log`
4. Consulta `DEPLOYMENT.md` para troubleshooting

---

**¡Importante!** Ejecuta SIEMPRE la migración `000__fix_schema_for_production.sql` **ANTES** de cualquier otra cosa.
