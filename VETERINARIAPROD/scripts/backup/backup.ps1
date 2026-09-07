# VetManager Pro — MySQL backup script (PowerShell)
# Usage: .\scripts\backup\backup.ps1
# Requires: mysqldump in PATH

param(
    [string]$DbHost     = $env:DB_HOST     ?? "localhost",
    [string]$DbPort     = $env:DB_PORT     ?? "3306",
    [string]$DbUser     = $env:DB_USER     ?? "root",
    [string]$DbPassword = $env:DB_PASSWORD ?? "",
    [string]$DbName     = $env:DB_NAME     ?? "vetmanager",
    [string]$BackupDir  = $env:BACKUP_DIR  ?? (Join-Path $PSScriptRoot "..\..\backups"),
    [int]   $KeepDays   = [int]($env:BACKUP_KEEP_DAYS ?? 30)
)

$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$filename  = "${DbName}_${timestamp}.sql"
$dest      = Join-Path $BackupDir $filename

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

Write-Host "[$(Get-Date)] Starting backup → $dest"

$env:MYSQL_PWD = $DbPassword
& mysqldump `
    --host=$DbHost `
    --port=$DbPort `
    --user=$DbUser `
    --single-transaction `
    --routines `
    --triggers `
    --events `
    --hex-blob `
    $DbName | Out-File -FilePath $dest -Encoding UTF8

Write-Host "[$(Get-Date)] Backup complete: $dest"

# Compress
Compress-Archive -Path $dest -DestinationPath "${dest}.zip" -Force
Remove-Item $dest
Write-Host "[$(Get-Date)] Compressed: ${dest}.zip"

# Cleanup old backups
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -Path $BackupDir -Filter "${DbName}_*.sql.zip" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Remove-Item $_.FullName
        Write-Host "[$(Get-Date)] Deleted old backup: $($_.Name)"
    }

Write-Host "[$(Get-Date)] Done."
