# scripts/backup/backup.ps1
<#
.SYNOPSIS
    Backup automático de Base de Datos y Documentos para PersonalV5
.DESCRIPTION
    Genera backup de MySQL y de DOCUMENTS_BASE_DIR, comprime, y limpia backups viejos
.EXAMPLE
    .\backup.ps1 -BackupDir "D:\backups" -DbPassword "mypass"
#>

param(
    [string]$BackupDir = "C:\backups\personalv5",
    [string]$DbHost = "localhost",
    [string]$DbPort = "3306",
    [string]$DbName = "personalv5",
    [string]$DbUser = "root",
    [string]$DbPassword = "",
    [string]$DocsDir = "D:\G\RESOLUCIONES Y VARIOS",
    [int]$RetentionDays = 30,
    [switch]$Compress,
    [string]$NotifyEmail = ""
)

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dateStamp = Get-Date -Format "yyyyMMdd"

# Crear estructura de directorios
$dbBackupDir = "$BackupDir\db"
$docsBackupDir = "$BackupDir\docs"
$logsDir = "$BackupDir\logs"

New-Item -ItemType Directory -Force -Path $dbBackupDir | Out-Null
New-Item -ItemType Directory -Force -Path $docsBackupDir | Out-Null
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$logFile = "$logsDir\backup_$dateStamp.log"
$errorLog = "$logsDir\backup_error_$dateStamp.log"

function Write-Log {
    param($Message)
    $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$time - $Message" | Out-File -FilePath $logFile -Append
    Write-Host "$time - $Message" -ForegroundColor Cyan
}

function Write-ErrorLog {
    param($Message)
    $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$time - ERROR: $Message" | Out-File -FilePath $errorLog -Append
    Write-Host "$time - ERROR: $Message" -ForegroundColor Red
}

function Send-Notification {
    param($Subject, $Body)
    if ($NotifyEmail) {
        try {
            Send-MailMessage -To $NotifyEmail -From "backup@personalv5.local" `
                -Subject $Subject -Body $Body -SmtpServer "localhost"
        } catch {
            Write-ErrorLog "Fallo notificación email: $_"
        }
    }
}

Write-Log "========================================="
Write-Log "Iniciando backup - $timestamp"
Write-Log "========================================="

$success = $true
$errors = @()

# 1. BACKUP DE BASE DE DATOS
Write-Log "1. Backupeando base de datos: $DbName"
$dbBackupFile = "$dbBackupDir\db_$timestamp.sql"
$dbCompressedFile = "$dbBackupDir\db_$timestamp.sql.gz"

try {
    if ($DbPassword) {
        $env:MYSQL_PWD = $DbPassword
    }

    $mysqldumpCmd = "mysqldump -h $DbHost -P $DbPort -u $DbUser --single-transaction --routines --triggers --events $DbName"
    
    if ($Compress) {
        Write-Log "Generando backup comprimido (gzip)..."
        Invoke-Expression "$mysqldumpCmd" | Out-File -FilePath $dbBackupFile -Encoding utf8
        if (Test-Path $dbBackupFile) {
            & gzip -f $dbBackupFile
            $finalFile = $dbCompressedFile
            Write-Log "✅ Backup DB comprimido: $finalFile ($([math]::Round((Get-Item $finalFile).Length/1MB,2)) MB)"
        }
    } else {
        Invoke-Expression "$mysqldumpCmd" | Out-File -FilePath $dbBackupFile -Encoding utf8
        $finalFile = $dbBackupFile
        Write-Log "✅ Backup DB: $finalFile ($([math]::Round((Get-Item $finalFile).Length/1MB,2)) MB)"
    }

    # Verificar integridad (básico)
    $content = Get-Content $finalFile -TotalCount 10 -ErrorAction SilentlyContinue
    if ($content -notmatch "CREATE TABLE|INSERT INTO") {
        throw "El archivo de backup parece inválido"
    }

} catch {
    $success = $false
    $errors += "DB Backup failed: $_"
    Write-ErrorLog "❌ Error backup DB: $_"
}

# 2. BACKUP DE DOCUMENTOS
Write-Log "2. Backupeando documentos: $DocsDir"

if (Test-Path $DocsDir) {
    $docsBackupFile = "$docsBackupDir\docs_$timestamp.7z"
    
    try {
        # Verificar si 7z está disponible
        $sevenZip = Get-Command "7z" -ErrorAction SilentlyContinue
        if (-not $sevenZip) {
            $sevenZip = Get-Command "C:\Program Files\7-Zip\7z.exe" -ErrorAction SilentlyContinue
        }

        if ($sevenZip) {
            Write-Log "Comprimiendo con 7-Zip..."
            & $sevenZip.Source a -mx5 -r $docsBackupFile $DocsDir -bb0 | Out-Null
            
            if ($LASTEXITCODE -eq 0) {
                Write-Log "✅ Backup documentos: $docsBackupFile ($([math]::Round((Get-Item $docsBackupFile).Length/1MB,2)) MB)"
            } else {
                throw "7z exit code: $LASTEXITCODE"
            }
        } else {
            # Fallback: copia simple
            Write-Log "⚠️ 7z no encontrado, copiando archivos..."
            $docsCopyDir = "$docsBackupDir\docs_$timestamp"
            Copy-Item -Path $DocsDir -Destination $docsCopyDir -Recurse -Force
            Write-Log "✅ Documentos copiados a: $docsCopyDir"
        }
    } catch {
        $success = $false
        $errors += "Docs Backup failed: $_"
        Write-ErrorLog "❌ Error backup documentos: $_"
    }
} else {
    Write-Log "⚠️ Directorio de documentos no encontrado: $DocsDir"
}

# 3. LIMPIEZA DE BACKUPS VIEJOS
Write-Log "3. Limpiando backups con más de $RetentionDays días"

try {
    $cutoffDate = (Get-Date).AddDays(-$RetentionDays)
    
    $oldDbBackups = Get-ChildItem -Path $dbBackupDir -Filter "db_*.sql*" | 
                    Where-Object { $_.LastWriteTime -lt $cutoffDate }
    
    $oldDocsBackups = Get-ChildItem -Path $docsBackupDir -Filter "docs_*.7z" | 
                      Where-Object { $_.LastWriteTime -lt $cutoffDate }
    
    $oldDbBackups | Remove-Item -Force
    $oldDocsBackups | Remove-Item -Force
    
    Write-Log "✅ Eliminados: $($oldDbBackups.Count) backups DB, $($oldDocsBackups.Count) backups docs"
} catch {
    Write-ErrorLog "❌ Error limpiando backups viejos: $_"
}

# 4. VERIFICACIÓN DE INTEGRIDAD (OPCIONAL)
if ($success -and $Compress) {
    Write-Log "4. Verificando integridad del backup comprimido..."
    try {
        if (Test-Path $dbCompressedFile) {
            & gzip -t $dbCompressedFile
            Write-Log "✅ Verificación OK: $dbCompressedFile"
        }
    } catch {
        Write-ErrorLog "⚠️ Fallo verificación de integridad: $_"
    }
}

# 5. RESUMEN
Write-Log "========================================="
if ($success) {
    Write-Log "🎉 BACKUP COMPLETADO EXITOSAMENTE"
    Write-Log "📁 DB: $dbBackupDir"
    Write-Log "📁 Docs: $docsBackupDir"
    Write-Log "📁 Logs: $logsDir"
    
    if ($NotifyEmail) {
        Send-Notification -Subject "✅ Backup exitoso - $DbName" -Body @"
        Fecha: $timestamp
        DB: $DbName
        Estado: EXITOSO
        Tamaño DB: $(if (Test-Path $dbCompressedFile) { [math]::Round((Get-Item $dbCompressedFile).Length/1MB,2) + 'MB' } else { 'N/A' })
        Tamaño Docs: $(if (Test-Path $docsBackupFile) { [math]::Round((Get-Item $docsBackupFile).Length/1MB,2) + 'MB' } else { 'N/A' })
        Retención: $RetentionDays días
"@
    }
} else {
    Write-Log "❌ BACKUP COMPLETADO CON ERRORES"
    $errors | ForEach-Object { Write-Log "   - $_" }
    
    if ($NotifyEmail) {
        Send-Notification -Subject "❌ Backup fallido - $DbName" -Body @"
        Fecha: $timestamp
        DB: $DbName
        Estado: FALLIDO
        Errores:
        $($errors -join "`n")
"@
    }
}

Write-Log "========================================="

# Retornar código de salida
if ($success) { exit 0 } else { exit 1 }