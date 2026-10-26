# Agente SDK de relojes ZKTeco.
# Corre en una PC aparte con el SDK de la carpeta `sdk\` (sin registrarlo en Windows) y:
#   1. busca un puerto libre (empieza en puertoInicial, recuerda el último usado),
#   2. detecta su IP (la de la placa con la que llega al servidor),
#   3. abre su regla de firewall SOLO para las IP del servidor (requiere administrador la primera vez),
#   4. se anuncia al servidor cada 60 s,
#   5. atiende pedidos del servidor (con clave compartida) y ejecuta cada acción en un proceso de 32 bits aparte,
#   6. se autoactualiza: si el servidor anuncia otra versión, baja los archivos cambiados (verifica SHA-256),
#      los reemplaza y sale con código 3 para que iniciar-agente.bat lo vuelva a lanzar.
# Todas las acciones son de SOLO LECTURA sobre los relojes.

$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$AGENTE_VERSION = '0'
try { $AGENTE_VERSION = [string]((Get-Content (Join-Path $base 'version.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version) } catch {}
$logPath = Join-Path $base 'agente.log'

function Log($msg) {
  $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
  Write-Host $line
  try { Add-Content -Path $logPath -Value $line -Encoding UTF8 } catch {}
}

# ── Configuración ────────────────────────────────────────────────────────────
$cfgPath = Join-Path $base 'agente.config.json'
if (-not (Test-Path $cfgPath)) { Log "Falta $cfgPath"; exit 1 }
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$servidor = ([string]$cfg.servidor).TrimEnd('/')
$clave = [string]$cfg.clave
if (-not $servidor) { Log 'Config: falta "servidor" (ej. http://10.115.31.28:3001)'; exit 1 }
if (-not $clave -or $clave -eq 'CAMBIAR') { Log 'Config: falta "clave" (la misma que FICHERO_SDK_AGENTE_CLAVE del servidor)'; exit 1 }
$puertoInicial = if ($cfg.puertoInicial) { [int]$cfg.puertoInicial } else { 8099 }
$nombre = if ($cfg.nombre) { [string]$cfg.nombre } else { $env:COMPUTERNAME }
$sdkDir = if ($cfg.sdkDir) { [string]$cfg.sdkDir } else { 'sdk' }
if (-not [IO.Path]::IsPathRooted($sdkDir)) { $sdkDir = Join-Path $base $sdkDir }
$sdkDir = (Resolve-Path $sdkDir).Path
$zkDll = Join-Path $sdkDir 'zkemkeeper.dll'
if (-not (Test-Path $zkDll)) { Log "No esta zkemkeeper.dll en $sdkDir"; exit 1 }
$sdkVersion = ((Get-Item $zkDll).VersionInfo.FileVersion -replace '[,\s]+', '.').Trim('.')

$servidorHost = ([Uri]$servidor).Host
$permitidos = @($servidorHost)
if ($cfg.servidoresPermitidos) { $permitidos += @($cfg.servidoresPermitidos) }
$permitidos = @($permitidos | Where-Object { $_ } | Select-Object -Unique)

$ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $ps32)) { $ps32 = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe' }
$accionScript = Join-Path $base 'accion-sdk.ps1'

# ── Estado (último puerto) ───────────────────────────────────────────────────
$estadoPath = Join-Path $base 'estado.json'
$ultimoPuerto = $null
if (Test-Path $estadoPath) { try { $ultimoPuerto = [int](Get-Content $estadoPath -Raw | ConvertFrom-Json).puerto } catch {} }

# ── 1. Puerto libre ──────────────────────────────────────────────────────────
$candidatos = @()
if ($ultimoPuerto) { $candidatos += $ultimoPuerto }
$candidatos += $puertoInicial..($puertoInicial + 20)
$listener = $null; $puerto = $null
foreach ($p in ($candidatos | Select-Object -Unique)) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, [int]$p)
    $l.Start(); $listener = $l; $puerto = [int]$p; break
  } catch { }
}
if (-not $listener) { Log "No hay puerto libre entre $puertoInicial y $($puertoInicial + 20)"; exit 1 }
@{ puerto = $puerto } | ConvertTo-Json | Set-Content -Path $estadoPath -Encoding UTF8

# ── 2. IP propia (la que usa para llegar al servidor) ────────────────────────
function Get-MiIp {
  try {
    $u = New-Object System.Net.Sockets.UdpClient
    $u.Connect($servidorHost, 9)
    $ip = $u.Client.LocalEndPoint.Address.ToString()
    $u.Close(); return $ip
  } catch { return $null }
}
$miIp = Get-MiIp
if (-not $miIp) { Log "No pude detectar la IP hacia $servidorHost"; exit 1 }

# ── 3. Firewall ──────────────────────────────────────────────────────────────
$reglaNombre = 'Agente SDK Relojes'
function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Ensure-Firewall {
  $regla = Get-NetFirewallRule -DisplayName $reglaNombre -ErrorAction SilentlyContinue
  $puertoRegla = $null
  if ($regla) { try { $puertoRegla = [string]($regla | Get-NetFirewallPortFilter).LocalPort } catch {} }
  if ($regla -and $puertoRegla -eq [string]$puerto) { return 'ok' }
  if (-not (Test-Admin)) {
    # Sin administrador Windows no deja leer las reglas: si ya se creó en un arranque anterior, igual funciona.
    Log "FIREWALL: sin permisos de administrador no puedo verificar la regla del puerto $puerto (si es la primera vez, arrancar como administrador)."
    return 'sin-verificar'
  }
  if ($regla) {
    $regla | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -LocalPort $puerto
    $regla | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress $permitidos
  } else {
    New-NetFirewallRule -DisplayName $reglaNombre -Description 'Agente SDK de relojes ZKTeco (solo pedidos del servidor)' `
      -Direction Inbound -Action Allow -Protocol TCP -LocalPort $puerto -RemoteAddress $permitidos -Profile Any | Out-Null
  }
  Log "FIREWALL: regla '$reglaNombre' abierta en TCP $puerto solo para $($permitidos -join ', ')"
  return 'ok'
}
$firewall = 'desconocido'
try { $firewall = Ensure-Firewall } catch { $firewall = 'error'; Log "FIREWALL: $($_.Exception.Message)" }

# ── 4. Anuncio al servidor ───────────────────────────────────────────────────
$ultimoAnuncio = [datetime]::MinValue
function Anunciar {
  $body = @{
    id = $nombre; host = $env:COMPUTERNAME; ip = $miIp; puerto = $puerto
    sdkVersion = $sdkVersion; agenteVersion = $AGENTE_VERSION; firewall = $firewall
  } | ConvertTo-Json -Compress
  $resp = $null
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$servidor/api/v1/fichero-sdk-agente/registro" -Body $body `
      -ContentType 'application/json; charset=utf-8' -Headers @{ 'X-Agente-Clave' = $clave } -TimeoutSec 10
    if ($script:ultimoAnuncio -eq [datetime]::MinValue) { Log "Anunciado en $servidor como '$nombre' ($miIp`:$puerto)" }
  } catch {
    Log "No pude anunciarme a $servidor : $($_.Exception.Message)"
  }
  $script:ultimoAnuncio = Get-Date
  if ($resp -and $resp.ultimaVersion -and [string]$resp.ultimaVersion -ne $AGENTE_VERSION) {
    Log "Hay version nueva en el servidor: $($resp.ultimaVersion) (tengo $AGENTE_VERSION)"
    Actualizar
  }
}

# ── 6. Autoactualización ─────────────────────────────────────────────────────
function Actualizar {
  try {
    $h = @{ 'X-Agente-Clave' = $clave }
    $paq = Invoke-RestMethod -Uri "$servidor/api/v1/fichero-sdk-agente/paquete" -Headers $h -TimeoutSec 20
    $tmp = Join-Path $base '_update'
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    $cambios = @()
    foreach ($a in $paq.archivos) {
      $local = Join-Path $base ($a.nombre -replace '/', '\')
      if ((Test-Path $local) -and ((Get-FileHash $local -Algorithm SHA256).Hash -eq $a.sha256)) { continue }
      $dest = Join-Path $tmp ($a.nombre -replace '/', '\')
      New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
      Invoke-WebRequest -UseBasicParsing -Uri "$servidor/api/v1/fichero-sdk-agente/archivo?nombre=$([Uri]::EscapeDataString($a.nombre))" -Headers $h -OutFile $dest -TimeoutSec 60
      if ((Get-FileHash $dest -Algorithm SHA256).Hash -ne $a.sha256) { throw "Hash distinto en $($a.nombre): descarga corrupta, no actualizo nada" }
      $cambios += $a.nombre
    }
    foreach ($n in $cambios) {
      $local = Join-Path $base ($n -replace '/', '\')
      New-Item -ItemType Directory -Force (Split-Path $local) | Out-Null
      Copy-Item (Join-Path $tmp ($n -replace '/', '\')) $local -Force
    }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Log "Actualizado a $($paq.version) ($($cambios.Count) archivo(s)). Reiniciando..."
    try { $listener.Stop() } catch {}
    exit 3
  } catch {
    Log "No pude actualizarme: $($_.Exception.Message)"
  }
}

# ── 5. Atención de pedidos ───────────────────────────────────────────────────
function Ejecutar-Accion($payload) {
  $json = $payload | ConvertTo-Json -Compress
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ps32
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$accionScript`" -SdkDir `"$sdkDir`" -InputB64 $b64"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  if (-not $proc.WaitForExit(120000)) {
    try { $proc.Kill() } catch {}
    return @{ ok = $false; error = 'La accion supero 120 s y se corto' } | ConvertTo-Json -Compress
  }
  $out = ($outTask.Result).Trim()
  $lineas = @($out -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') })
  if ($lineas.Count) { return $lineas[-1] }
  $err = ($errTask.Result).Trim()
  return @{ ok = $false; error = "El proceso del SDK termino sin respuesta (codigo $($proc.ExitCode)). $err" } | ConvertTo-Json -Compress
}

function Responder($stream, [int]$status, [string]$json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $reason = @{ 200 = 'OK'; 400 = 'Bad Request'; 401 = 'Unauthorized'; 403 = 'Forbidden'; 404 = 'Not Found'; 500 = 'Internal Server Error' }[$status]
  $head = "HTTP/1.1 $status $reason`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush()
}

function Atender($client) {
  $client.ReceiveTimeout = 10000
  $stream = $client.GetStream()
  $remoto = ([System.Net.IPEndPoint]$client.Client.RemoteEndPoint).Address.ToString() -replace '^::ffff:', ''
  try {
    $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::UTF8, $false, 8192, $true)
    $primera = $reader.ReadLine()
    if (-not $primera) { return }
    $partes = $primera.Split(' ')
    $metodo = $partes[0]; $ruta = ($partes[1] -split '\?')[0]
    $headers = @{}
    while ($true) {
      $l = $reader.ReadLine()
      if ($null -eq $l -or $l -eq '') { break }
      $i = $l.IndexOf(':'); if ($i -gt 0) { $headers[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() }
    }
    $body = ''
    $len = 0; if ($headers['content-length']) { $len = [int]$headers['content-length'] }
    if ($len -gt 0) { $buf = New-Object char[] $len; $leido = 0; while ($leido -lt $len) { $n = $reader.Read($buf, $leido, $len - $leido); if ($n -le 0) { break }; $leido += $n }; $body = New-Object string($buf, 0, $leido) }

    if ($remoto -ne '127.0.0.1' -and $permitidos -notcontains $remoto) {
      Log "Rechazado $remoto (no es el servidor)"; Responder $stream 403 '{"ok":false,"error":"origen no permitido"}'; return
    }
    if ($headers['x-agente-clave'] -ne $clave) {
      Log "Rechazado $remoto (clave incorrecta)"; Responder $stream 401 '{"ok":false,"error":"clave incorrecta"}'; return
    }

    if ($metodo -eq 'GET' -and $ruta -eq '/salud') {
      $r = @{ ok = $true; id = $nombre; host = $env:COMPUTERNAME; ip = $miIp; puerto = $puerto; sdkVersion = $sdkVersion; agenteVersion = $AGENTE_VERSION; firewall = $firewall } | ConvertTo-Json -Compress
      Responder $stream 200 $r; return
    }
    if ($metodo -eq 'POST' -and $ruta -eq '/accion') {
      $payload = $body | ConvertFrom-Json
      $acciones = @('info', 'opciones', 'teclas', 'timbres', 'conteos', 'tablas', 'funciones')
      if ($acciones -notcontains [string]$payload.accion) { Responder $stream 400 '{"ok":false,"error":"accion no permitida"}'; return }
      Log "Accion '$($payload.accion)' contra $($payload.ip) (pedido de $remoto)"
      $res = Ejecutar-Accion @{ accion = [string]$payload.accion; ip = [string]$payload.ip; puerto = $payload.puerto; commKey = $payload.commKey }
      Responder $stream 200 $res; return
    }
    Responder $stream 404 '{"ok":false,"error":"ruta desconocida"}'
  } catch {
    Log "Error atendiendo a $remoto : $($_.Exception.Message)"
    try { Responder $stream 500 (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress) } catch {}
  } finally {
    try { $client.Close() } catch {}
  }
}

Log "Agente $AGENTE_VERSION | SDK $sdkVersion ($sdkDir) | escuchando en $miIp`:$puerto | firewall: $firewall | servidor: $servidor"
Anunciar
try {
  while ($true) {
    if ($listener.Pending()) { Atender ($listener.AcceptTcpClient()) }
    else { Start-Sleep -Milliseconds 200 }
    if (((Get-Date) - $ultimoAnuncio).TotalSeconds -ge 60) {
      $nueva = Get-MiIp
      if ($nueva -and $nueva -ne $miIp) { Log "Cambio de IP: $miIp -> $nueva"; $miIp = $nueva }
      Anunciar
    }
  }
} finally {
  $listener.Stop()
}
