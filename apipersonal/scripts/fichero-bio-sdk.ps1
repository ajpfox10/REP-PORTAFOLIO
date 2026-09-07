param(
  [Parameter(Mandatory = $true)]
  [string]$InputJson
)

$ErrorActionPreference = 'Stop'

function New-Result($ok, $extra) {
  $base = [ordered]@{ ok = [bool]$ok }
  foreach ($key in $extra.Keys) { $base[$key] = $extra[$key] }
  $base | ConvertTo-Json -Depth 12 -Compress
}

function Connect-Zk($ip) {
  $zk = New-Object -ComObject zkemkeeper.ZKEM
  $connected = $zk.Connect_Net([string]$ip, 4370)
  if (-not $connected) {
    throw "No se pudo conectar por SDK al fichero $ip"
  }
  return $zk
}

function Get-DeviceError($zk) {
  $code = 0
  try { [void]$zk.GetLastError([ref]$code) } catch {}
  return [int]$code
}

function Parse-KvLine($line) {
  $row = @{}
  foreach ($part in ([string]$line -split "`t")) {
    $idx = $part.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $part.Substring(0, $idx).Trim()
    $value = $part.Substring($idx + 1)
    if ($key.Contains(' ')) {
      $pieces = $key -split '\s+'
      $key = $pieces[$pieces.Length - 1]
    }
    $row[$key] = $value
  }
  return $row
}

# ---------------------------------------------------------------------------
# Identidad + capacidades del reloj (SDK: version, product, firmware, serie,
# GetDeviceStatus con codigos conocidos de huella/cara/palma).
# ---------------------------------------------------------------------------
function Get-DeviceIdentity($zk) {
  $ident = [ordered]@{}
  $sdkVer = ''
  try { [void]$zk.GetSDKVersion([ref]$sdkVer); $ident['sdkVersion'] = [string]$sdkVer } catch { $ident['sdkVersion'] = '' }
  $prod = ''
  try { [void]$zk.GetProductCode(1, [ref]$prod); $ident['productCode'] = [string]$prod } catch { $ident['productCode'] = '' }
  $fw = ''
  try { [void]$zk.GetFirmwareVersion(1, [ref]$fw); $ident['firmware'] = [string]$fw } catch { $ident['firmware'] = '' }
  $serial = ''
  try { [void]$zk.GetSerialNumber(1, [ref]$serial); $ident['serial'] = [string]$serial } catch { $ident['serial'] = '' }
  $platform = ''
  try { [void]$zk.GetPlatform(1, [ref]$platform); $ident['platform'] = [string]$platform } catch { $ident['platform'] = '' }
  return $ident
}

function Get-DeviceStatusMap($zk) {
  # Etiquetas "best-effort" de los codigos GetDeviceStatus mas usados.
  # OJO: 21/22/24/25 (cara/palma) varian por firmware; por eso ademas del
  # subset etiquetado devolvemos SIEMPRE el raw de un barrido 0..40 para ver
  # los numeros reales del equipo y corregir el mapeo si hace falta.
  $labels = @{
    1  = 'adminUsados'
    2  = 'huellasUsadas'
    3  = 'passwordUsados'
    4  = 'oplogUsados'
    5  = 'attlogUsados'
    6  = 'huellasCapacidad'
    7  = 'usuariosCapacidad'
    8  = 'attlogCapacidad'
    9  = 'usuariosUsados'
    21 = 'carasUsadas'
    22 = 'carasCapacidad'
    24 = 'palmasUsadas'
    25 = 'palmasCapacidad'
  }
  $raw = [ordered]@{}
  $labeled = [ordered]@{}
  for ($code = 0; $code -le 40; $code++) {
    $val = 0
    $ok = $false
    try { $ok = $zk.GetDeviceStatus(1, [int]$code, [ref]$val) } catch { $ok = $false }
    if ($ok) {
      $raw["$code"] = [int]$val
      if ($labels.ContainsKey($code)) { $labeled[$labels[$code]] = [int]$val }
    }
  }
  return [ordered]@{ raw = $raw; labeled = $labeled }
}

# ---------------------------------------------------------------------------
# Conteo de biometria en el reloj real (no en la base).
# Usa SSR_GetDeviceDataCount y, si falla, cuenta parseando SSR_GetDeviceData.
# ---------------------------------------------------------------------------
function Count-BiodataType($zk, $pin, $bioType) {
  $count = 0
  $filter = "Pin=$pin`tType=$bioType"
  # Intento A: firma de 5 args (tablename, filter, options, ref count).
  try {
    $c = 0
    if ($zk.SSR_GetDeviceDataCount(1, 'biodata', $filter, '', [ref]$c)) { return [int]$c }
  } catch {}
  # Intento B: firma de 4 args (tablename, filter, ref count).
  try {
    $c = 0
    if ($zk.SSR_GetDeviceDataCount(1, 'biodata', $filter, [ref]$c)) { return [int]$c }
  } catch {}
  # Fallback: bajar y contar parseando.
  try {
    $data = ''
    $ok = $zk.SSR_GetDeviceData(1, [ref]$data, 10485760, 'biodata', '*', "Pin=$pin", '')
    if ($ok -and $data) {
      foreach ($line in (([string]$data) -split "(`r`n|`n)")) {
        $clean = ([string]$line).Trim()
        if (-not $clean) { continue }
        $kv = Parse-KvLine $clean
        $typeRaw = $kv['BioType']; if (-not $typeRaw) { $typeRaw = $kv['Type'] }
        $t = 0; [void][int]::TryParse([string]$typeRaw, [ref]$t)
        if ($t -eq [int]$bioType) { $count++ }
      }
    }
  } catch {}
  return [int]$count
}

function Count-Fingers($zk, $pin) {
  $count = 0
  for ($i = 0; $i -le 9; $i++) {
    $tmp = ''; $len = 0
    try {
      if ($zk.SSR_GetUserTmpStr(1, [string]$pin, $i, [ref]$tmp, [ref]$len) -and $tmp) { $count++ }
    } catch {}
  }
  return [int]$count
}

# ---------------------------------------------------------------------------
# Sonda de capacidades: prueba en vivo si el firmware realmente deja leer
# cara / huella / biodata para un PIN dado. Sirve para validar contra el
# reloj real sin escribir nada.
# ---------------------------------------------------------------------------
function Probe-Capabilities($zk, $pin) {
  $probe = [ordered]@{}

  $ft = ''; $fl = 0
  try {
    $ok = $zk.GetUserFaceStr(1, [string]$pin, 50, [ref]$ft, [ref]$fl)
    $probe['getUserFaceStr'] = [ordered]@{ ok = [bool]$ok; length = [int]$fl; deviceError = (Get-DeviceError $zk) }
  } catch { $probe['getUserFaceStr'] = [ordered]@{ ok = $false; error = $_.Exception.Message } }

  $tt = ''; $tl = 0
  try {
    $ok = $zk.SSR_GetUserTmpStr(1, [string]$pin, 0, [ref]$tt, [ref]$tl)
    $probe['ssrGetUserTmpStr'] = [ordered]@{ ok = [bool]$ok; length = [int]$tl; deviceError = (Get-DeviceError $zk) }
  } catch { $probe['ssrGetUserTmpStr'] = [ordered]@{ ok = $false; error = $_.Exception.Message } }

  $bd = ''
  try {
    $ok = $zk.SSR_GetDeviceData(1, [ref]$bd, 10485760, 'biodata', '*', "Pin=$pin", '')
    $probe['ssrGetDeviceData'] = [ordered]@{ ok = [bool]$ok; bytes = ([string]$bd).Length; deviceError = (Get-DeviceError $zk) }
  } catch { $probe['ssrGetDeviceData'] = [ordered]@{ ok = $false; error = $_.Exception.Message } }

  return $probe
}

# ---------------------------------------------------------------------------
# Lectura de usuario desde el reloj (SDK).
# ---------------------------------------------------------------------------
function Read-User($zk, $pin) {
  $name = ''; $pwd = ''; $pri = 0; $enabled = $false
  $ok = $false
  try { $ok = $zk.SSR_GetUserInfo(1, [string]$pin, [ref]$name, [ref]$pwd, [ref]$pri, [ref]$enabled) } catch {}
  if ($ok) {
    return [ordered]@{ found = $true; pin = [string]$pin; name = [string]$name; password = [string]$pwd; privilege = [int]$pri; enabled = [bool]$enabled }
  }
  return [ordered]@{ found = $false; pin = [string]$pin }
}

# ---------------------------------------------------------------------------
# Captura completa desde el reloj origen.
# ---------------------------------------------------------------------------
function Capture-Fingers($zk, $pin) {
  $fingers = @()
  $errors = @()
  for ($i = 0; $i -le 9; $i++) {
    $tmp = ''; $len = 0; $ok = $false
    try { $ok = $zk.SSR_GetUserTmpStr(1, [string]$pin, $i, [ref]$tmp, [ref]$len) }
    catch { $errors += "SSR_GetUserTmpStr[$i]: $($_.Exception.Message)" }
    if ($ok -and $tmp) {
      $fingers += [ordered]@{ method = 'SSR_GetUserTmpStr'; fingerId = $i; template = [string]$tmp; length = [int]$len }
    }
  }
  return [ordered]@{ fingers = $fingers; errors = $errors }
}

function Capture-Bio($zk, $pin, $includeFace, $includePalm) {
  $faces = @()
  $biodata = @()
  $errors = @()

  if ($includeFace) {
    try {
      $faceTmp = ''
      $faceLen = 0
      $okFace = $zk.GetUserFaceStr(1, [string]$pin, 50, [ref]$faceTmp, [ref]$faceLen)
      if ($okFace -and $faceTmp) {
        $faces += [ordered]@{
          method = 'GetUserFaceStr'
          bioType = 9
          fingerId = 50
          template = $faceTmp
          length = [int]$faceLen
        }
      }
    } catch {
      $errors += "GetUserFaceStr: $($_.Exception.Message)"
    }
  }

  if ($includeFace -or $includePalm) {
    try {
      $data = ''
      $okData = $zk.SSR_GetDeviceData(1, [ref]$data, 10485760, 'biodata', '*', "Pin=$pin", '')
      if (-not $okData -or -not $data) {
        $data = ''
        $okData = $zk.SSR_GetDeviceData(1, [ref]$data, 10485760, 'biodata', '*', "PIN=$pin", '')
      }
      if ($okData -and $data) {
        foreach ($line in (([string]$data) -split "(`r`n|`n|`$)")) {
          $clean = ([string]$line).Trim()
          if (-not $clean) { continue }
          $kv = Parse-KvLine $clean
          $typeRaw = $kv['BioType']
          if (-not $typeRaw) { $typeRaw = $kv['Type'] }
          $bioType = 0
          [void][int]::TryParse([string]$typeRaw, [ref]$bioType)
          if ($bioType -eq 9 -and -not $includeFace) { continue }
          if ($bioType -eq 10 -and -not $includePalm) { continue }
          if (($bioType -ne 9) -and ($bioType -ne 10)) { continue }

          $slotRaw = $kv['Index']
          if (-not $slotRaw) { $slotRaw = $kv['No'] }
          if (-not $slotRaw) { $slotRaw = $kv['FingerID'] }
          $slot = 0
          [void][int]::TryParse([string]$slotRaw, [ref]$slot)
          $tmp = $kv['Tmp']
          if (-not $tmp) { $tmp = $kv['TMP'] }
          if (-not $tmp) { $tmp = $kv['Template'] }

          $biodata += [ordered]@{
            method = 'SSR_GetDeviceData'
            bioType = $bioType
            fingerId = $slot
            template = $tmp
            rawLine = $clean
            length = ([string]$tmp).Length
          }
        }
      }
    } catch {
      $errors += "SSR_GetDeviceData: $($_.Exception.Message)"
    }
  }

  return [ordered]@{ faces = $faces; biodata = $biodata; errors = $errors }
}

function Capture-All($zk, $pin, $includeUser, $includeFinger, $includeFace, $includePalm) {
  $user = $null
  if ($includeUser) { $user = Read-User $zk $pin }
  $fingersBlock = [ordered]@{ fingers = @(); errors = @() }
  if ($includeFinger) { $fingersBlock = Capture-Fingers $zk $pin }
  $bio = Capture-Bio $zk $pin $includeFace $includePalm
  return [ordered]@{
    user = $user
    fingers = $fingersBlock.fingers
    faces = $bio.faces
    biodata = $bio.biodata
    errors = @($fingersBlock.errors + $bio.errors)
  }
}

# ---------------------------------------------------------------------------
# Aplicacion en el reloj destino.
# ---------------------------------------------------------------------------
function Apply-User($zk, $pin, $name, $password, $privilege) {
  try {
    $ok = $zk.SSR_SetUserInfo(1, [string]$pin, [string]$name, [string]$password, [int]$privilege, $true)
    $devErr = 0
    if (-not $ok) { $devErr = Get-DeviceError $zk }
    return [ordered]@{ method = 'SSR_SetUserInfo'; ok = [bool]$ok; deviceError = [int]$devErr }
  } catch {
    return [ordered]@{ method = 'SSR_SetUserInfo'; ok = $false; error = $_.Exception.Message }
  }
}

function Apply-Fingers($zk, $pin, $fingers) {
  $applied = @()
  foreach ($f in @($fingers)) {
    try {
      $ok = $zk.SSR_SetUserTmpStr(1, [string]$pin, [int]$f.fingerId, [string]$f.template)
      $devErr = 0
      if (-not $ok) { $devErr = Get-DeviceError $zk }
      $applied += [ordered]@{ method = 'SSR_SetUserTmpStr'; fingerId = [int]$f.fingerId; ok = [bool]$ok; deviceError = [int]$devErr }
    } catch {
      $applied += [ordered]@{ method = 'SSR_SetUserTmpStr'; fingerId = [int]$f.fingerId; ok = $false; error = $_.Exception.Message }
    }
  }
  return $applied
}

function Apply-Bio($zk, $pin, $faces, $biodata, $includeFace, $includePalm) {
  $applied = @()
  $errors = @()

  foreach ($face in @($faces)) {
    if (-not $includeFace) { continue }
    try {
      $okSet = $zk.SetUserFaceStr(1, [string]$pin, 50, [string]$face.template, [int]$face.length)
      $devErr = 0
      if (-not $okSet) { $devErr = Get-DeviceError $zk }
      $applied += [ordered]@{ method = 'SetUserFaceStr'; bioType = 9; ok = [bool]$okSet; deviceError = [int]$devErr }
    } catch {
      $errors += "SetUserFaceStr: $($_.Exception.Message)"
    }
  }

  foreach ($row in @($biodata)) {
    $bioType = [int]$row.bioType
    if ($bioType -eq 9 -and -not $includeFace) { continue }
    if ($bioType -eq 10 -and -not $includePalm) { continue }
    try {
      $line = [string]$row.rawLine
      if (-not $line) {
        $line = "Pin=$pin`tType=$bioType`tTmp=$($row.template)"
      }
      $okSet = $zk.SSR_SetDeviceData(1, 'biodata', $line, '')
      $devErr = 0
      if (-not $okSet) { $devErr = Get-DeviceError $zk }
      $applied += [ordered]@{ method = 'SSR_SetDeviceData'; bioType = $bioType; ok = [bool]$okSet; deviceError = [int]$devErr }
    } catch {
      $errors += "SSR_SetDeviceData: $($_.Exception.Message)"
    }
  }

  return [ordered]@{ applied = $applied; errors = $errors }
}

# ---------------------------------------------------------------------------
# Borrado en el reloj destino (peligroso).
#   scope: 'todo' | 'huellas' | 'cara' | 'palma' | 'usuario'
# ---------------------------------------------------------------------------
function Delete-Bio($zk, $pin, $scope) {
  $done = @()
  $errors = @()
  $scope = [string]$scope
  if (-not $scope) { $scope = 'todo' }

  if ($scope -eq 'huellas' -or $scope -eq 'todo') {
    for ($i = 0; $i -le 9; $i++) {
      try {
        $ok = $zk.SSR_DeleteEnrollData(1, [string]$pin, $i)
        if ($ok) { $done += "huella $i" }
      } catch { $errors += "SSR_DeleteEnrollData[$i]: $($_.Exception.Message)" }
    }
  }
  if ($scope -eq 'cara' -or $scope -eq 'todo') {
    try {
      $ok = $zk.SSR_DeleteDeviceData(1, 'biodata', "Pin=$pin`tType=9", '')
      if ($ok) { $done += 'cara' }
    } catch { $errors += "SSR_DeleteDeviceData[cara]: $($_.Exception.Message)" }
  }
  if ($scope -eq 'palma' -or $scope -eq 'todo') {
    try {
      $ok = $zk.SSR_DeleteDeviceData(1, 'biodata', "Pin=$pin`tType=10", '')
      if ($ok) { $done += 'palma' }
    } catch { $errors += "SSR_DeleteDeviceData[palma]: $($_.Exception.Message)" }
  }
  if ($scope -eq 'usuario' -or $scope -eq 'todo') {
    try {
      $ok = $zk.SSR_DeleteEnrollData(1, [string]$pin, 12)
      if ($ok) { $done += 'usuario (todo)' }
    } catch { $errors += "SSR_DeleteEnrollData[12]: $($_.Exception.Message)" }
  }
  return [ordered]@{ done = $done; errors = $errors }
}

# ===========================================================================
# Dispatcher
# ===========================================================================
try {
  $req = $InputJson | ConvertFrom-Json
  $action = [string]$req.action
  $pin = [string]$req.pin
  $includeUser = [bool]$req.includeUser
  $includeFinger = [bool]$req.includeFinger
  $includeFace = [bool]$req.includeFace
  $includePalm = [bool]$req.includePalm

  # --- info: identidad + capacidades de un reloj ---
  if ($action -eq 'info') {
    $zk = Connect-Zk ([string]$req.ip)
    try {
      $identity = Get-DeviceIdentity $zk
      $status = Get-DeviceStatusMap $zk
    } finally {
      try { $zk.Disconnect() | Out-Null } catch {}
    }
    New-Result $true ([ordered]@{ action = 'info'; identity = $identity; status = $status })
    exit 0
  }

  # --- diagnose: identidad + capacidades + sonda en vivo (test contra reloj real) ---
  if ($action -eq 'diagnose') {
    $zk = Connect-Zk ([string]$req.ip)
    try {
      $identity = Get-DeviceIdentity $zk
      $status = Get-DeviceStatusMap $zk
      $probe = $null
      if ($pin) { $probe = Probe-Capabilities $zk $pin }
    } finally {
      try { $zk.Disconnect() | Out-Null } catch {}
    }
    New-Result $true ([ordered]@{ action = 'diagnose'; pin = $pin; identity = $identity; status = $status; probe = $probe })
    exit 0
  }

  # --- count: cuanta biometria tiene un PIN en el reloj real ---
  if ($action -eq 'count') {
    if (-not $pin) { throw 'pin requerido' }
    $zk = Connect-Zk ([string]$req.ip)
    try {
      $huellas = Count-Fingers $zk $pin
      $caras = Count-BiodataType $zk $pin 9
      $palmas = Count-BiodataType $zk $pin 10
      $user = Read-User $zk $pin
    } finally {
      try { $zk.Disconnect() | Out-Null } catch {}
    }
    New-Result $true ([ordered]@{ action = 'count'; pin = $pin; user = $user; huellas = $huellas; caras = $caras; palmas = $palmas })
    exit 0
  }

  # --- readUser: leer un usuario del reloj ---
  if ($action -eq 'readUser') {
    if (-not $pin) { throw 'pin requerido' }
    $zk = Connect-Zk ([string]$req.ip)
    try { $user = Read-User $zk $pin }
    finally { try { $zk.Disconnect() | Out-Null } catch {} }
    New-Result $true ([ordered]@{ action = 'readUser'; user = $user })
    exit 0
  }

  # --- delete: borrar biometria/usuario en el reloj (peligroso) ---
  if ($action -eq 'delete') {
    if (-not $pin) { throw 'pin requerido' }
    $zk = Connect-Zk ([string]$req.ip)
    try {
      try { [void]$zk.EnableDevice(1, $false) } catch {}
      $result = Delete-Bio $zk $pin ([string]$req.scope)
      try { [void]$zk.RefreshData(1) } catch {}
    } finally {
      try { [void]$zk.EnableDevice(1, $true) } catch {}
      try { $zk.Disconnect() | Out-Null } catch {}
    }
    New-Result $true ([ordered]@{ action = 'delete'; pin = $pin; scope = ([string]$req.scope); result = $result })
    exit 0
  }

  # --- capture: bajar del origen sin escribir en ningun lado ---
  if ($action -eq 'capture') {
    if (-not $pin) { throw 'pin requerido' }
    $origin = Connect-Zk ([string]$req.originIp)
    try {
      $capture = Capture-All $origin $pin $includeUser $includeFinger $includeFace $includePalm
    } finally {
      try { $origin.Disconnect() | Out-Null } catch {}
    }
    New-Result $true ([ordered]@{ action = 'capture'; pin = $pin; captured = $capture })
    exit 0
  }

  # --- transfer: origen -> servidor -> destino, todo por SDK directo ---
  if ($action -eq 'transfer') {
    if (-not $pin) { throw 'pin requerido' }
    if (-not $includeUser -and -not $includeFinger -and -not $includeFace -and -not $includePalm) {
      throw 'sin datos para trasladar (usuario/huella/cara/palma)'
    }

    $origin = Connect-Zk ([string]$req.originIp)
    try {
      $capture = Capture-All $origin $pin $includeUser $includeFinger $includeFace $includePalm
    } finally {
      try { $origin.Disconnect() | Out-Null } catch {}
    }

    # Datos de usuario: preferir lo que viene del servidor; si no, lo capturado del origen.
    $userName = [string]$req.userName
    $password = [string]$req.password
    $privilege = 0
    [void][int]::TryParse([string]$req.privilege, [ref]$privilege)
    if (-not $userName -and $capture.user -and $capture.user.found) {
      $userName = [string]$capture.user.name
      if (-not $password) { $password = [string]$capture.user.password }
      $privilege = [int]$capture.user.privilege
    }

    $applied = @()
    $applyErrors = @()
    $userResult = $null

    $target = Connect-Zk ([string]$req.targetIp)
    try {
      try { [void]$target.EnableDevice(1, $false) } catch {}

      if ($includeUser) {
        $userResult = Apply-User $target $pin $userName $password $privilege
        $applied += $userResult
      }
      if ($includeFinger) {
        $applied += (Apply-Fingers $target $pin $capture.fingers)
      }
      if ($includeFace -or $includePalm) {
        $bioApply = Apply-Bio $target $pin $capture.faces $capture.biodata $includeFace $includePalm
        $applied += $bioApply.applied
        $applyErrors += $bioApply.errors
      }

      try { [void]$target.RefreshData(1) } catch {}
    } finally {
      try { [void]$target.EnableDevice(1, $true) } catch {}
      try { $target.Disconnect() | Out-Null } catch {}
    }

    New-Result $true ([ordered]@{
      action = 'transfer'
      pin = $pin
      captured = [ordered]@{
        user = $capture.user
        fingers = $capture.fingers
        faces = $capture.faces
        biodata = $capture.biodata
        errors = $capture.errors
      }
      applied = $applied
      applyErrors = @($applyErrors + $capture.errors)
    })
    exit 0
  }

  throw "accion SDK no soportada: $action"
} catch {
  New-Result $false ([ordered]@{ error = $_.Exception.Message })
  exit 1
}
