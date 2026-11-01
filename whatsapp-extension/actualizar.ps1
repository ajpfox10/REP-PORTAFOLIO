# actualizar.ps1 - actualizador de la extension "Personal - Avisos por WhatsApp" (una PC).
# Lo corre la tarea programada que crea instalar-actualizador.cmd (al iniciar sesion y cada 2 horas).
# Consulta version.json en el servidor de la app; si hay una version mas nueva baja el zip y pisa
# los archivos de esta carpeta (manifest.json al final). La extension ve el cambio y se recarga sola.
# Servidores: uno por linea en servidores.txt (el primero que responda). Log: actualizador.log.
# Sin acentos a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.
$ErrorActionPreference = 'Stop'
$carpeta = $PSScriptRoot
$log = Join-Path $carpeta 'actualizador.log'

function Log($msg) {
  $linea = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  try {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 200KB) { Remove-Item $log -Force }
    Add-Content -Path $log -Value $linea -Encoding UTF8
  } catch { }
}

try {
  $local = (Get-Content (Join-Path $carpeta 'manifest.json') -Raw | ConvertFrom-Json).version
  $servidores = @()
  $txt = Join-Path $carpeta 'servidores.txt'
  if (Test-Path $txt) { $servidores = Get-Content $txt | ForEach-Object { $_.Trim().TrimEnd('/') } | Where-Object { $_ -and -not $_.StartsWith('#') } }

  $base = $null; $remota = $null
  foreach ($s in $servidores) {
    try {
      $r = Invoke-WebRequest -Uri "$s/extension-whatsapp/version.json?t=$([DateTime]::Now.Ticks)" -UseBasicParsing -TimeoutSec 15
      $remota = ($r.Content | ConvertFrom-Json).version
      if ($remota) { $base = $s; break }
    } catch { }
  }
  if (-not $base) { Log "Sin respuesta de ningun servidor ($($servidores -join ', '))"; exit 0 }

  if ([version]$remota -le [version]$local) { exit 0 }  # al dia: no se loguea para no llenar el log

  Log "Hay version nueva: $local -> $remota ($base)"
  $tmp = Join-Path $env:TEMP "hpw-ext-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'ext.zip'
    Invoke-WebRequest -Uri "$base/extension-whatsapp/personal-whatsapp-extension.zip?t=$([DateTime]::Now.Ticks)" -OutFile $zip -UseBasicParsing -TimeoutSec 60
    $dest = Join-Path $tmp 'x'
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    $nuevoManifest = Join-Path $dest 'manifest.json'
    if (-not (Test-Path $nuevoManifest)) { throw 'El zip no tiene manifest.json' }
    if ((Get-Content $nuevoManifest -Raw | ConvertFrom-Json).version -ne $remota) { throw 'La version del zip no coincide con version.json' }

    # Primero todo lo demas y el manifest al final: la extension solo se recarga cuando ve la version nueva
    Get-ChildItem $dest -File | Where-Object { $_.Name -ne 'manifest.json' -and $_.Name -ne 'servidores.txt' } |
      ForEach-Object { Copy-Item $_.FullName (Join-Path $carpeta $_.Name) -Force }
    Copy-Item $nuevoManifest (Join-Path $carpeta 'manifest.json') -Force
    Log "Actualizada a $remota"
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
} catch {
  Log "ERROR: $($_.Exception.Message)"
}
