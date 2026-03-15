#!/bin/bash
# scripts/backup/schedule.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
CRON_FILE="/etc/cron.d/personalv5-backup"

# Crear entrada de cron (diario a las 2 AM)
cat << EOF | sudo tee "$CRON_FILE"
# Backup automático PersonalV5 - Diario 2:00 AM
0 2 * * * root $BACKUP_SCRIPT /backups/personalv5 localhost 3306 personalv5 root "password" "/mnt/g/RESOLUCIONES Y VARIOS" 30 true admin@local.com >> /var/log/personalv5-backup.log 2>&1
EOF

sudo chmod 644 "$CRON_FILE"
echo "✅ Cron job creado en $CRON_FILE"

# Ejecutar prueba
echo "🚀 Ejecutando backup de prueba..."
sudo -u root bash "$BACKUP_SCRIPT" /backups/personalv5 localhost 3306 personalv5 root "" "/mnt/g/RESOLUCIONES Y VARIOS" 30 true ""

if [ $? -eq 0 ]; then
    echo "✅ Backup de prueba completado"
else
    echo "❌ Backup de prueba falló"
fi