<#
  sync-guard.ps1 — evita que se suban credenciales al repo publico.

  Modos:
    -Mode Redact  : (lo llama sync-repos.cmd despues de copiar)
                    reemplaza en D:\Repositorios cada secreto conocido por xxxxxxx
                    y redacta USUARIO/CLAVE/PASSWORD = "..." en scripts .py (incluye .bak).
    -Mode Scan    : (lo llaman git_sync.bat y el hook pre-commit)
                    revisa lo que esta en stage; si encuentra algo sale con codigo 1.

  Los secretos conocidos se leen de un archivo FUERA del repo (uno por linea,
  lineas con # son comentarios):  C:\apps\sync-secretos.txt
  Para ignorar un falso positivo en una linea puntual agregar el comentario:  sync-guard:ignore
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('Redact', 'Scan')][string]$Mode,
  [string]$Repo = '',
  [string]$Blocklist = 'C:\apps\sync-secretos.txt'
)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent $MyInvocation.MyCommand.Path }
$Repo = (Get-Item -LiteralPath $Repo).FullName.TrimEnd('\')
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$latin1 = [System.Text.Encoding]::GetEncoding(28591)   # 1 byte = 1 char, ida y vuelta sin perdida
$MASK = 'xxxxxxx'

function Get-KnownSecrets {
  if (-not (Test-Path $Blocklist)) {
    Write-Host "  [AVISO] No existe $Blocklist - solo se usan los patrones genericos." -ForegroundColor Yellow
    return @()
  }
  return @(Get-Content -Encoding UTF8 $Blocklist |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') -and $_.Length -ge 4 })
}

function Hide-Value([string]$s) {
  if ($s.Length -le 4) { return '****' }
  return $s.Substring(0, 2) + ('*' * [Math]::Min(8, $s.Length - 2))
}

# ---------------------------------------------------------------- Redact
if ($Mode -eq 'Redact') {
  $secrets = Get-KnownSecrets
  $pyAssign = '(?im)^(\s*(?:USUARIO|USER|CLAVE|PASS|PASSWORD|PWD)\s*=\s*)([''"]).*?\2'
  $changed = 0

  # Solo lo que git subiria: trackeados + nuevos no ignorados (salta node_modules, bin, etc.)
  Push-Location $Repo
  $files = @(git -c core.quotepath=off ls-files -c -o --exclude-standard)
  Pop-Location

  foreach ($rel in $files) {
    if ($rel -eq 'sync-guard.ps1') { continue }
    $path = Join-Path $Repo $rel
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    if ((Get-Item -LiteralPath $path).Length -ge 5MB) { continue }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ([Array]::IndexOf($bytes, [byte]0, 0, [Math]::Min($bytes.Length, 8000)) -ge 0) { continue }   # binario -> no tocar

    $text = $latin1.GetString($bytes)
    $orig = $text
    foreach ($s in $secrets) { $text = $text.Replace($s, $MASK) }
    if ($rel -match '\.py($|\.)') { $text = [regex]::Replace($text, $pyAssign, "`${1}`${2}$MASK`${2}") }

    if ($text -cne $orig) {
      [System.IO.File]::WriteAllBytes($path, $latin1.GetBytes($text))
      Write-Host "  redactado: $rel"
      $changed++
    }
  }
  Write-Host "  Archivos redactados: $changed"
  exit 0
}

# ---------------------------------------------------------------- Scan
Push-Location $Repo
try {
  $findings = New-Object System.Collections.Generic.List[string]
  $secrets = Get-KnownSecrets

  # 1) Archivos que nunca deben subirse
  $forbiddenPath = '(?i)(^|/)(\.env(\.(?!example$|sample$|template$)[^/]*)?$|fichero_config\.json$|[^/]*\.(pem|key|pfx|p12|pyc)$|id_rsa|Login Data$|Cookies$|Web Data$|__pycache__/|\.chrome-debug/|chrome-dev-visible)'
  # PDFs, planillas, imagenes y carpetas de datos: solo se permiten los assets reales del codigo
  $dataFile    = '(?i)\.(pdf|csv|xlsx?|png|jpe?g|webp|bmp)$|(^|/)(storage|uploads|capturas|screenshots|fichadas)/|fichad[^/]*\.txt$|(^|/)attlog[^/]*\.txt$'
  $dataAllowed = '(?i)^(apipersonal/src/templates/|apipersonal/assets/|TRABAJO PRACTICO FINAL/img/)'
  $staged = @(git -c core.quotepath=off diff --cached --name-only --diff-filter=ACMR)
  foreach ($f in $staged) {
    if ($f -match $forbiddenPath -and $f -notmatch '\.playwright/') { $findings.Add("ARCHIVO PROHIBIDO  $f"); continue }
    if ($f -match $dataFile -and $f -notmatch $dataAllowed) { $findings.Add("DATOS/DOCUMENTO/CAPTURA  $f") }
  }

  # 2) Secretos conocidos en cualquier archivo del stage (incluye binarios)
  foreach ($s in $secrets) {
    $hits = @(git -c core.quotepath=off grep --cached -F -l -e $s 2>$null)
    foreach ($h in $hits) { $findings.Add("SECRETO CONOCIDO ($(Hide-Value $s))  $h") }
  }

  # 3) Patrones genericos solo en las lineas agregadas
  $allowPath = '(?i)(^|/)(tests?|__tests__|e2e|fixtures?)/|\.(test|spec)\.[jt]sx?$|\.example$|\.sample$|/\.github/workflows/|(^|/)assets/[^/]+\.js$'
  $placeholder = '(?i)change_?me|x{4,}|\*{3,}|your[-_]|tu[-_]|example|redacted|fake|dummy|placeholder|_pass_word_|_user_name_|<[^>]+>|\$\{|process\.env|os\.environ|%[A-Z_]+%'
  $rules = @(
    @{ n = 'PASSWORD/SECRET LITERAL'; r = '(?i)(pass(word|wd)?|pwd|clave|contrase.a|secret|token|api_?key|private_?key)\w*[''"]?\s*[:=]\s*[''"]([^''"\s]{6,})[''"]' },
    @{ n = 'CONNECTION STRING';      r = '(?i)(Password|Pwd)\s*=\s*([^;''"\s<>]{4,})' },
    @{ n = 'URL CON CREDENCIALES';   r = '(?i)[a-z][a-z0-9+.-]*://[^\s/:@''"]+:([^\s/@''"]{3,})@' },
    @{ n = 'MYSQL -p INLINE';        r = '(?i)\bmysql\w*(\.exe)?["'']?\s.*\s-p([^\s"'']{4,})' },
    @{ n = 'CLAVE PRIVADA';          r = '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
    @{ n = 'TOKEN DE SERVICIO';      r = '(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|xox[abp]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})' }
  )

  $file = $null; $lineNo = 0
  git -c core.quotepath=off diff --cached -U0 --no-color --no-ext-diff --diff-filter=ACMR | ForEach-Object {
    $l = $_
    if ($l.StartsWith('+++ ')) { $file = if ($l -eq '+++ /dev/null') { $null } else { $l.Substring(6) }; return }
    if ($l -match '^@@ -\S+ \+(\d+)') { $lineNo = [int]$Matches[1]; return }
    if (-not $file -or -not $l.StartsWith('+')) { return }
    $content = $l.Substring(1)
    $cur = $lineNo; $lineNo++
    if ($file -match $allowPath -or $content -match 'sync-guard:ignore' -or $content.Length -gt 1000) { return }
    foreach ($rule in $rules) {
      $m = [regex]::Match($content, $rule.r)
      if (-not $m.Success) { continue }
      if ($m.Value -match $placeholder) { continue }
      $findings.Add("$($rule.n)  ${file}:$cur")
      break
    }
  }

  if ($findings.Count -gt 0) {
    Write-Host ''
    Write-Host '  [BLOQUEADO] Se detectaron posibles credenciales en lo que se iba a subir:' -ForegroundColor Red
    $findings | Sort-Object -Unique | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
    Write-Host ''
    Write-Host '  Que hacer:'
    Write-Host '    * Mover el valor a una variable de entorno (.env) en el origen C:\apps\...'
    Write-Host "    * O agregar el valor a $Blocklist para que sync-repos.cmd lo redacte"
    Write-Host '    * Si es un falso positivo, agregar el comentario  sync-guard:ignore  en esa linea'
    exit 1
  }
  Write-Host '  [OK] Sin credenciales detectadas en el stage.' -ForegroundColor Green
  exit 0
}
finally { Pop-Location }
