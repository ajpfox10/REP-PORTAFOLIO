# Backup y Restore

## Backup

Script principal: `scripts/backup/backup.sh`

Genera:

- dump MySQL comprimido,
- opcional upload a S3,
- limpieza por retención.

Variables relevantes:

- `BACKUP_DIR`
- `BACKUP_RETENTION_DAYS`
- `DB_NAME`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `S3_BUCKET`

## Restore

Script principal: `scripts/backup/restore.sh`

Uso:

```bash
./scripts/backup/restore.sh /backups/mysql/vetmanager_YYYYMMDD_HHMMSS.sql.gz
```

## Restore drill semanal

Script:

```bash
./scripts/backup/restore-drill.sh /backups/mysql/vetmanager_YYYYMMDD_HHMMSS.sql.gz
```

## Verificación obligatoria post-restore

1. Restaurar en una base aislada, no sobre producción.
2. Levantar al menos `gateway`, `auth` y `patients` apuntando a esa DB.
3. Ejecutar:

```bash
node scripts/migrate.js --status
```

4. Verificar:

- login con usuario de prueba,
- lectura de pacientes,
- lectura de historia clínica,
- lectura de reportes,
- `GET /health/ready` de servicios principales.

## Frecuencia recomendada

- Backup diario.
- Restore de verificación al menos semanal.
- Restore obligatorio antes de cambios grandes de esquema.
