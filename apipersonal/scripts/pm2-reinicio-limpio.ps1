# pm2-reinicio-limpio.ps1 - reinicia una app de pm2 sin dejar huerfanos.
# En Windows pm2 a veces deja vivo el proceso viejo: sigue con el puerto y codigo viejo, y la
# instancia nueva entra en bucle de EADDRINUSE (paso el 16/10 y el 20/10/2026).
# Pasos: pm2 stop -> matar a quien siga escuchando el puerto -> pm2 restart --update-env ->
# comprobar que el dueno del puerto sea el pid que reporta pm2.
# Uso: powershell -ExecutionPolicy Bypass -File pm2-reinicio-limpio.ps1 -App apipersonal-prod -Puerto 3001
# Sale con 1 si no queda bien (el .cmd que lo llama no debe decir OK).
param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][int]$Puerto,
  [int]$EsperaSeg = 90
)

function DuenoPuerto {
  $c = Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess } else { return 0 }
}

function PidPm2 {
  $p = (& pm2 pid $App 2>$null | Select-Object -Last 1)
  if ("$p".Trim() -match '^\d+$') { return [int]"$p".Trim() } else { return 0 }
}

Write-Host "   [$App] pm2 stop..."
& pm2 stop $App *> $null
Start-Sleep -Seconds 2

# Lo que quede escuchando el puerto con la app frenada es un huerfano
for ($i = 0; $i -lt 5; $i++) {
  $dueno = DuenoPuerto
  if (-not $dueno) { break }
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$dueno" -ErrorAction SilentlyContinue).CommandLine
  Write-Host "   [$App] Huerfano en :$Puerto (pid $dueno) -> se mata. $cmd"
  Stop-Process -Id $dueno -Force -Confirm:$false -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
if (DuenoPuerto) {
  Write-Host "   [$App] ERROR: el puerto $Puerto sigue ocupado (pid $(DuenoPuerto))."
  exit 1
}

Write-Host "   [$App] pm2 restart --update-env..."
& pm2 restart $App --update-env *> $null

# Tiene que quedar el pid de pm2 escuchando el puerto, y estable
$t0 = Get-Date
$okDesde = $null
while (((Get-Date) - $t0).TotalSeconds -lt $EsperaSeg) {
  Start-Sleep -Seconds 2
  $pm2Pid = PidPm2
  $dueno = DuenoPuerto
  if ($pm2Pid -and $dueno -eq $pm2Pid) {
    if (-not $okDesde) { $okDesde = Get-Date }
    elseif (((Get-Date) - $okDesde).TotalSeconds -ge 8) {
      Write-Host "   [$App] OK: pid $pm2Pid escuchando :$Puerto"
      exit 0
    }
  } else {
    $okDesde = $null
  }
}
Write-Host "   [$App] ERROR: despues de $EsperaSeg s el puerto $Puerto no lo tiene pm2 (pm2 pid=$(PidPm2), dueno=$(DuenoPuerto)). Ver: pm2 logs $App"
exit 1
