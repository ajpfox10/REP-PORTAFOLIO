# repuntar-tareas-prod.ps1
# Pasa las tareas programadas que corren scripts de DEV a la carpeta de scripts de PROD,
# para que los robots lean el .env de prod (base personalv5) y no el de dev (personalv5_dev).
# Lo llama deploy-prod.cmd despues de copiar los scripts. Idempotente.
#   -Probar : solo muestra lo que cambiaria.
# Sale con 0 si todas las tareas quedaron en prod (o no habia nada que cambiar), 1 si alguna fallo.
param([switch]$Probar)

$dev  = 'C:\apps\personaldev\apipersonal\scripts'
$prod = 'C:\apps\personalprod\apipersonal-prod\scripts'
$fallas = 0; $cambiadas = 0

function Repuntar([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return $s }
  return [regex]::Replace($s, [regex]::Escape($dev), $prod.Replace('$', '$$'), 'IgnoreCase')
}

foreach ($t in Get-ScheduledTask) {
  $usaDev = $false
  foreach ($a in $t.Actions) {
    if ("$($a.Execute) $($a.Arguments) $($a.WorkingDirectory)" -match [regex]::Escape($dev)) { $usaDev = $true }
  }
  if (-not $usaDev) { continue }
  $nombre = "$($t.TaskPath)$($t.TaskName)"

  $nuevas = @(); $falta = $null
  foreach ($a in $t.Actions) {
    $exe = Repuntar $a.Execute; $arg = Repuntar $a.Arguments; $dir = Repuntar $a.WorkingDirectory
    if ($exe -like "$prod*" -and -not (Test-Path $exe)) { $falta = $exe }
    if ($dir -like "$prod*" -and -not (Test-Path $dir)) { $falta = $dir }
    $p = @{ Execute = $exe }
    if ($arg) { $p.Argument = $arg }
    if ($dir) { $p.WorkingDirectory = $dir }
    $nuevas += New-ScheduledTaskAction @p
  }
  if ($falta) {
    # p.ej. tareas viejas de siape_stress cuyo script ya no existe: se dejan como estan
    Write-Host "   SALTEO $nombre (no existe en prod: $falta)"
    continue
  }
  if ($Probar) { Write-Host "   CAMBIARIA $nombre -> $prod"; $cambiadas++; continue }
  try {
    Set-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName -Action $nuevas -ErrorAction Stop | Out-Null
    Write-Host "   OK $nombre -> prod"; $cambiadas++
  } catch {
    Write-Host "   ERROR $nombre : $($_.Exception.Message)"; $fallas++
  }
}
Write-Host "   Tareas repuntadas: $cambiadas  Fallas: $fallas"
if ($fallas -gt 0) { exit 1 } else { exit 0 }
