# empaquetar.ps1 — arma el .zip de la extensión para que cada PC lo baje desde la app
# (pestaña WhatsApp → "Descargar extensión"). Correr después de cada cambio en la extensión:
#   powershell -ExecutionPolicy Bypass -File C:\apps\personaldev\whatsapp-extension\empaquetar.ps1
# Deja en apifront\public\extension-whatsapp\ el zip y version.json (la app compara la versión
# instalada con esta para avisar que hay una nueva). Va a prod con el deploy-prod.cmd del front.
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dst = Join-Path $src '..\apifront\public\extension-whatsapp'
New-Item -ItemType Directory -Force $dst | Out-Null

$version = (Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json).version
$archivos = Get-ChildItem $src -File | Where-Object { $_.Name -notin @('empaquetar.ps1', 'actualizador.log') }
$zip = Join-Path $dst 'personal-whatsapp-extension.zip'
Compress-Archive -Path $archivos.FullName -DestinationPath $zip -Force
# copia de siempre en C:\apps\personaldev (instalaciones viejas)
Copy-Item $zip (Join-Path $src '..\whatsapp-extension.zip') -Force

$json = '{ "version": "' + $version + '", "fecha": "' + (Get-Date -Format 'yyyy-MM-dd') + '" }'
[IO.File]::WriteAllText((Join-Path $dst 'version.json'), $json, (New-Object Text.UTF8Encoding $false))
Write-Host "Extension v$version empaquetada en $dst"
