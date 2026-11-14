@echo off
REM ======================================================================
REM  Instalar-Extension-Personal.cmd  -  instalador UNICO de la extension
REM  "Personal - Asistente (WhatsApp y CUIL ANSES)". Se baja desde la app
REM  (Reportes -> WhatsApp -> Bajar instalador) y se abre con doble clic.
REM  Sirve para instalar por primera vez Y para arreglar/actualizar una PC:
REM   - baja la ultima version del servidor de la app
REM   - si la extension ya esta cargada en Chrome/Edge, actualiza ESA carpeta
REM     (no hay que volver a cargarla); si no, la deja en C:\ExtensionPersonal
REM   - crea la tarea de Windows que la mantiene actualizada sola
REM   - avisa si hay copias repetidas cargadas en el navegador
REM  No necesita permisos de administrador. Sin acentos a proposito.
REM ======================================================================
setlocal
set "INSTALADOR_PERSONAL=%~f0"
title Instalador - Extension de Personal
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = [IO.File]::ReadAllText($env:INSTALADOR_PERSONAL); $i = $s.IndexOf('#PS-' + 'INICIO'); Invoke-Expression $s.Substring($i)"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%

#PS-INICIO  (desde aca es PowerShell; cmd nunca llega porque sale antes con exit /b)
$ErrorActionPreference = 'Stop'
$servidores = @('http://192.168.0.21:5173', 'http://10.115.31.28:5173')
$carpetaFija = 'C:\ExtensionPersonal'
$tarea = 'Personal - Actualizar extension WhatsApp'

function T([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
function ManifestDe([string]$dir) {
  try { return (Get-Content (Join-Path $dir 'manifest.json') -Raw | ConvertFrom-Json) } catch { return $null }
}
function EsNuestra([string]$dir) { $m = ManifestDe $dir; return ($m -and ([string]$m.name).StartsWith('Personal - ')) }
function VersionDe([string]$dir) { $m = ManifestDe $dir; if ($m) { return [string]$m.version } else { return $null } }
function Menor([string]$a, [string]$b) { try { return ([version]$a -lt [version]$b) } catch { return $false } }

try {
  T ''
  T '  INSTALADOR DE LA EXTENSION DE PERSONAL (WhatsApp, CUIL ANSES, RDAM)' Cyan
  T '  ====================================================================' Cyan
  T ''

  # 1) Servidor de la app y version publicada
  $base = $null; $remota = $null
  foreach ($s in $servidores) {
    try {
      $r = Invoke-WebRequest -Uri "$s/extension-whatsapp/version.json?t=$([DateTime]::Now.Ticks)" -UseBasicParsing -TimeoutSec 15
      $remota = [string]($r.Content | ConvertFrom-Json).version
      if ($remota) { $base = $s; break }
    } catch { }
  }
  if (-not $base) { throw "No hay conexion con el servidor de la app ($($servidores -join ' / ')). Revisar la red de esta PC." }
  T "  Ultima version publicada: $remota"

  # 2) Copias de la extension ya cargadas en Chrome / Edge (todos los perfiles de este usuario de Windows)
  $copias = @()
  $navegadores = @(
    @{ Nav = 'Chrome'; Dir = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data' },
    @{ Nav = 'Edge';   Dir = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data' }
  )
  foreach ($n in $navegadores) {
    if (-not (Test-Path $n.Dir)) { continue }
    foreach ($perfil in (Get-ChildItem $n.Dir -Directory -ErrorAction SilentlyContinue)) {
      foreach ($archivo in @('Secure Preferences', 'Preferences')) {
        $f = Join-Path $perfil.FullName $archivo
        if (-not (Test-Path $f)) { continue }
        try { $txt = [IO.File]::ReadAllText($f) } catch { continue }
        foreach ($m in [regex]::Matches($txt, '"path"\s*:\s*("(?:[^"\\]|\\.)*")')) {
          try { $p = [string]($m.Groups[1].Value | ConvertFrom-Json) } catch { continue }
          if ($p -notmatch '^[A-Za-z]:\\') { continue }
          if (-not (Test-Path -LiteralPath (Join-Path $p 'manifest.json'))) { continue }
          if (-not (EsNuestra $p)) { continue }
          $dir = (Resolve-Path -LiteralPath $p).Path.TrimEnd('\')
          if (-not ($copias | Where-Object { $_.Dir -eq $dir -and $_.Nav -eq $n.Nav -and $_.Perfil -eq $perfil.Name })) {
            $copias += [pscustomobject]@{ Nav = $n.Nav; Perfil = $perfil.Name; Dir = $dir; Version = (VersionDe $dir) }
          }
        }
      }
    }
  }
  $dirs = @($copias | ForEach-Object { $_.Dir } | Sort-Object -Unique)

  # 3) Carpeta destino: la que ya usa el navegador (no hay que volver a cargarla); si no hay, la fija
  $yaCargada = $dirs.Count -gt 0
  if (-not $yaCargada) {
    $destino = $carpetaFija
    try { New-Item -ItemType Directory -Force $destino | Out-Null }
    catch { $destino = Join-Path $env:USERPROFILE 'ExtensionPersonal'; New-Item -ItemType Directory -Force $destino | Out-Null }
  } elseif ($dirs -contains $carpetaFija) {
    $destino = $carpetaFija
  } else {
    # la de version mas alta (la mas nueva es la que se esta usando)
    $destino = ($copias | Sort-Object { try { [version]$_.Version } catch { [version]'0.0' } } -Descending | Select-Object -First 1).Dir
  }
  $versionAntes = VersionDe $destino
  if ($yaCargada) {
    $donde = ($copias | Where-Object { $_.Dir -eq $destino } | ForEach-Object { "$($_.Nav) ($($_.Perfil))" }) -join ', '
    T "  Ya estaba cargada en: $donde"
    T "  Carpeta: $destino  (version $versionAntes)"
  } else {
    T "  No estaba cargada en Chrome ni en Edge: se instala en $destino"
  }

  # 4) Bajar el zip y copiar a la carpeta (manifest.json al final: la extension se recarga al verlo)
  if ($versionAntes -and -not (Menor $versionAntes $remota)) {
    T "  Ya tiene la ultima version ($versionAntes): no se bajan archivos." Green
  } else {
    T '  Bajando la extension...'
    $tmp = Join-Path $env:TEMP "hpw-inst-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force $tmp | Out-Null
    try {
      $zip = Join-Path $tmp 'ext.zip'
      Invoke-WebRequest -Uri "$base/extension-whatsapp/personal-whatsapp-extension.zip?t=$([DateTime]::Now.Ticks)" -OutFile $zip -UseBasicParsing -TimeoutSec 120
      $x = Join-Path $tmp 'x'
      Expand-Archive -Path $zip -DestinationPath $x -Force
      if (-not (EsNuestra $x)) { throw 'El archivo bajado no es la extension (falta manifest.json).' }
      Get-ChildItem $x -File | Where-Object { $_.Name -ne 'manifest.json' -and -not ($_.Name -eq 'servidores.txt' -and (Test-Path (Join-Path $destino 'servidores.txt'))) } |
        ForEach-Object { Copy-Item $_.FullName (Join-Path $destino $_.Name) -Force }
      Copy-Item (Join-Path $x 'manifest.json') (Join-Path $destino 'manifest.json') -Force
    } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    T "  Extension copiada: version $(VersionDe $destino)" Green
  }

  # 5) Actualizacion automatica: tarea de Windows (cada 2 horas) + acceso en Inicio (al prender la PC)
  $vbs = Join-Path $destino 'actualizar-oculto.vbs'
  if (Test-Path $vbs) {
    & schtasks.exe /Create /SC MINUTE /MO 120 /TN $tarea /TR "wscript.exe `"$vbs`"" /F | Out-Null
    if ($LASTEXITCODE -ne 0) { T '  ATENCION: no se pudo crear la tarea de actualizacion automatica.' Yellow }
    try {
      $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Personal - Actualizar extension WhatsApp.lnk'
      $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
      $sc.TargetPath = 'wscript.exe'; $sc.Arguments = "`"$vbs`""; $sc.WindowStyle = 7; $sc.Save()
    } catch { }
    T '  Actualizacion automatica: activada (al prender la PC y cada 2 horas).' Green
  }

  # 6) Copias repetidas: no se actualizan solas y pueden mandar mensajes dos veces
  $otras = @($copias | Where-Object { $_.Dir -ne $destino })
  if ($otras.Count -gt 0) {
    T ''
    T '  ATENCION: hay OTRA copia de la extension cargada en el navegador:' Yellow
    foreach ($o in $otras) {
      T "    - $($o.Nav) ($($o.Perfil)): $($o.Dir)  (version $($o.Version))" Yellow
      if (-not ($copias | Where-Object { $_.Dir -eq $destino -and $_.Nav -eq $o.Nav -and $_.Perfil -eq $o.Perfil })) {
        T "      despues de quitarla, en ese $($o.Nav) cargar esta carpeta: $destino" Yellow
      }
    }
    T '  Esa copia NO se actualiza sola y si quedan dos activas pueden salir mensajes repetidos.' Yellow
    T '  Abrir chrome://extensions (o edge://extensions), buscar la tarjeta cuya carpeta' Yellow
    T '  ("Cargada desde") sea esa, y tocar QUITAR.' Yellow
  }

  # 7) Que falta hacer
  T ''
  if (-not $yaCargada) {
    try { Set-Clipboard -Value $destino } catch { }
    T '  FALTA UN PASO (una sola vez en esta PC):' Cyan
    T '   1. En Chrome (o Edge) pegar en la barra de direcciones:  chrome://extensions   (Edge: edge://extensions)'
    T '   2. Activar "Modo de desarrollador" (Chrome: arriba a la derecha / Edge: costado izquierdo).'
    T '   3. Tocar "Cargar descomprimida" (Edge: "Cargar desempaquetada").'
    T "   4. En la ventana de carpetas, arriba donde dice la ruta, pegar con Ctrl+V:  $destino"
    T '      (la ruta ya quedo copiada) y tocar "Seleccionar carpeta".'
    T '   5. Abrir WhatsApp Web en ese mismo navegador y recargar la app con F5.'
    T ''
    T '  Desde ahi se actualiza sola: no hace falta volver a correr este instalador.' Green
  } else {
    if ($versionAntes -and (Menor $versionAntes '1.4.0')) {
      T "  FALTA: la version vieja ($versionAntes) no sabe recargarse sola. Abrir chrome://extensions" Cyan
      T '  (o edge://extensions) y tocar la flecha circular de recargar en la extension de Personal.' Cyan
    } elseif (-not (Menor $versionAntes $remota)) {
      T '  LISTO. La extension ya estaba al dia y queda actualizandose sola.' Green
    } else {
      T '  LISTO. El navegador toma la version nueva solo en menos de 5 minutos' Green
      T '  (o ya mismo, tocando recargar en chrome://extensions). Despues apretar F5 en la app.' Green
    }
  }
  exit 0
} catch {
  T ''
  T "  ERROR: $($_.Exception.Message)" Red
  T '  Avisar a Personal (sistemas) con una foto de esta ventana.' Red
  exit 1
}
