# scripts/backup/schedule.ps1
# Crear tarea programada para backup diario

$taskName = "PersonalV5 Backup Diario"
$scriptPath = "$PSScriptRoot\backup.ps1"
$workingDir = Split-Path $scriptPath -Parent

# Argumentos por defecto (ajustar según entorno)
$arguments = @(
    "-BackupDir", "C:\backups\personalv5",
    "-DbName", "personalv5",
    "-DbUser", "root",
    "-DbPassword", "",
    "-DocsDir", "D:\G\RESOLUCIONES Y VARIOS",
    "-RetentionDays", "30",
    "-Compress"
)

# Crear acción
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $($arguments -join ' ')"

# Ejecutar a las 2 AM todos los días
$trigger = New-ScheduledTaskTrigger -Daily -At "02:00AM"

# Ejecutar como SYSTEM
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount

# Configuración
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew

# Registrar tarea
Register-ScheduledTask -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force

Write-Host "✅ Tarea programada '$taskName' creada exitosamente" -ForegroundColor Green

# Ejecutar prueba inmediata
Write-Host "🚀 Ejecutando backup de prueba..." -ForegroundColor Yellow
& $scriptPath @arguments

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Backup de prueba completado" -ForegroundColor Green
} else {
    Write-Host "❌ Backup de prueba falló" -ForegroundColor Red
}