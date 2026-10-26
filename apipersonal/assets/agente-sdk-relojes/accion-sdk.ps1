param(
  [Parameter(Mandatory = $true)][string]$SdkDir,
  [Parameter(Mandatory = $true)][string]$InputB64
)
$InputJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($InputB64))
# Ejecuta UNA acción de solo lectura contra un reloj con el SDK de $SdkDir, SIN registrarlo en Windows:
# el objeto COM se crea a través de un manifiesto (activation context). Corre en PowerShell de 32 bits y en
# un proceso aparte del agente: si la DLL revienta, se cae este proceso y no el agente.

$ErrorActionPreference = 'Stop'

function Out-Json($obj) { $obj | ConvertTo-Json -Depth 8 -Compress }

$CLSID = '{00853A19-BD51-419B-9269-2DABE57EB61F}'
$LIBID = '{FE9DED34-E159-408E-8490-B720A5E632C7}'

function Write-Manifest($dir) {
  $files = Get-ChildItem -Path $dir -Filter *.dll | Sort-Object Name
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  [void]$sb.AppendLine('<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">')
  [void]$sb.AppendLine('  <assemblyIdentity type="win32" name="agente.zkemkeeper.sxs" version="1.0.0.0" />')
  foreach ($f in $files) {
    if ($f.Name -ieq 'zkemkeeper.dll') {
      [void]$sb.AppendLine("  <file name=`"$($f.Name)`">")
      [void]$sb.AppendLine("    <comClass clsid=`"$CLSID`" progid=`"zkemkeeper.ZKEM`" threadingModel=`"Both`" tlbid=`"$LIBID`" />")
      [void]$sb.AppendLine("    <typelib tlbid=`"$LIBID`" version=`"1.0`" helpdir=`"`" />")
      [void]$sb.AppendLine('  </file>')
    } else {
      [void]$sb.AppendLine("  <file name=`"$($f.Name)`" />")
    }
  }
  [void]$sb.AppendLine('</assembly>')
  $path = Join-Path $dir 'zkemkeeper.sxs.manifest'
  [IO.File]::WriteAllText($path, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
  return $path
}

# El activation context tiene que quedar ACTIVO en el hilo durante todas las llamadas (no solo al crear el
# objeto): cada llamada por IDispatch busca la type library, y en una PC sin el SDK registrado solo la encuentra
# a través del manifiesto. Si aun así no aparece, se registra la type library solo para el usuario actual (HKCU).
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SxsZk {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ACTCTX {
    public int cbSize; public uint dwFlags; public string lpSource; public ushort wProcessorArchitecture;
    public ushort wLangId; public string lpAssemblyDirectory; public string lpResourceName;
    public string lpApplicationName; public IntPtr hModule;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateActCtxW(ref ACTCTX a);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool ActivateActCtx(IntPtr h, out IntPtr cookie);
  [DllImport("oleaut32.dll", CharSet = CharSet.Unicode, PreserveSig = false)] static extern void LoadTypeLibEx(string file, int kind, out IntPtr lib);
  [DllImport("oleaut32.dll", CharSet = CharSet.Unicode, PreserveSig = false)] static extern void RegisterTypeLibForUser(IntPtr lib, string path, string helpDir);
  public static void Activar(string manifest, string dir) {
    var a = new ACTCTX();
    a.cbSize = Marshal.SizeOf(typeof(ACTCTX));
    a.dwFlags = 0x4; // ACTCTX_FLAG_ASSEMBLY_DIRECTORY_VALID
    a.lpSource = manifest;
    a.lpAssemblyDirectory = dir;
    IntPtr h = CreateActCtxW(ref a);
    if (h == new IntPtr(-1)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "CreateActCtx");
    IntPtr cookie;
    if (!ActivateActCtx(h, out cookie)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "ActivateActCtx");
  }
  public static void RegistrarTypeLibUsuario(string dll) {
    IntPtr lib; LoadTypeLibEx(dll, 2 /*REGKIND_NONE*/, out lib);
    RegisterTypeLibForUser(lib, dll, System.IO.Path.GetDirectoryName(dll));
    Marshal.Release(lib);
  }
}
'@

function New-Zk($dir) {
  # Las DLL dependientes (zkemsdk, commpro, tcpcomm...) se buscan también en el directorio actual y el PATH.
  Set-Location $dir
  [Environment]::CurrentDirectory = $dir
  $env:PATH = "$dir;$env:PATH"
  [SxsZk]::Activar((Write-Manifest $dir), $dir)
  $zk = New-Object -ComObject zkemkeeper.ZKEM
  try { $v = ''; [void]$zk.GetSDKVersion([ref]$v) } catch {
    if ($_.Exception.Message -notmatch '8002801D') { throw }
    [SxsZk]::RegistrarTypeLibUsuario((Join-Path $dir 'zkemkeeper.dll'))
    $zk = New-Object -ComObject zkemkeeper.ZKEM
  }
  return $zk
}

function LastErr($zk) { $c = 0; try { [void]$zk.GetLastError([ref]$c) } catch {}; return [int]$c }

# Opciones conocidas (barrido real sobre G3 Pro, 22/10/2026).
$OPCIONES = @(
  'DeviceID','~DeviceName','~SerialNumber','~ProductTime','~OEMVendor','~Platform','~OS','~AlgVer','~ZKFPVersion',
  'Language','NewLng','VOLUME','KeyPadBeep','VoiceOn','LockOn','~LockFunOn','LockCount','DoorSensorTimeout',
  'AlarmAttLog','AlarmReRec','IdleMinute','TOMenu','TOState','StateMode','AttState','Must1To1','MustEnroll',
  'RS232BaudRate','RS232On','RS485On','USB232On','IPAddress','NetMask','GATEIPAddress','DHCP','DNS','MAC','UDPPort','WifiOn',
  'ICLOCKSVRURL','IclockSvrFun','WebServerURLModel','ProxyServerIP','ProxyServerPort','EnableProxyServer','PushOptionsFlag',
  'TZAdj','DtFmt','CurTimeMode','DLSTMode','~DSTF','DaylightSavingTimeOn','DaylightSavingTime','StandardTime',
  '~MaxAttLogCount','~MaxFingerCount','~MaxUserCount','~MaxFace7Count','~MaxUserPhotoCount','~MaxBioPhotoCount','~MaxPvCount',
  'COMKey','MThreshold','EThreshold','VThreshold','FPRetry','NoiseThreshold','DownloadFPCnt',
  'OnlyPINCard','~RFCardOn','~PIN2Width','CardKey','~IsOnlyRFMachine','IsSupportABCPin','~UserExtFmt','IMEFunOn',
  'CameraOpen','CapturePic','PhotoFunOn','ShowPhoto','UploadPhoto','BioPhotoFun','BioDataFun',
  'MultiBioDataSupport','MultiBioPhotoSupport','MultiBioVersion','FingerFunOn','FaceFunOn','ZKFaceVersion','FaceAntiFake',
  'PvFunOn','PvVersion','PvMThreshold','PvVThreshold','FvFunOn','VisilightFun','~SMS','SMSCount','WorkCode',
  'AntiPassbackOn','~APBFO','WiegandFmt','WiegandID','ODD','WGFailedID','WGSiteCode','WGPulseWidth','WGPulseInterval','~USBDisk','~SSR'
)

function Do-Info($zk) {
  $r = [ordered]@{}
  $v = ''; try { [void]$zk.GetFirmwareVersion(1, [ref]$v) } catch {}; $r.firmware = $v
  $v = ''; try { [void]$zk.GetDeviceFirmwareVersion(1, [ref]$v); $r.firmwareDispositivo = $v } catch { $r.firmwareDispositivo = '(no disponible en este SDK)' }
  try { $r.arquitecturaNueva = [bool]$zk.IsNewFirmwareMachine(1) } catch { $r.arquitecturaNueva = '(no disponible en este SDK)' }
  $v = ''; try { [void]$zk.GetSerialNumber(1, [ref]$v) } catch {}; $r.serie = $v
  $v = ''; try { [void]$zk.GetProductCode(1, [ref]$v) } catch {}; $r.producto = $v
  $v = ''; try { [void]$zk.GetPlatform(1, [ref]$v) } catch {}; $r.plataforma = $v
  $v = ''; try { [void]$zk.GetSDKVersion([ref]$v) } catch {}; $r.sdkVersion = $v
  $labels = @{ 1='administradores'; 2='usuarios'; 3='huellas'; 4='claves'; 5='operaciones'; 6='fichadas'; 7='capHuellas'; 8='capUsuarios'; 9='capFichadas'; 10='huellasLibres'; 11='usuariosLibres'; 12='fichadasLibres'; 21='caras'; 22='capCaras'; 24='palmas'; 25='capPalmas' }
  $st = [ordered]@{}
  foreach ($k in ($labels.Keys | Sort-Object)) { $x = 0; try { if ($zk.GetDeviceStatus(1, [int]$k, [ref]$x)) { $st[$labels[$k]] = [int]$x } } catch {} }
  $r.contadores = $st
  return $r
}

function Do-Opciones($zk) {
  $r = [ordered]@{}
  foreach ($n in $OPCIONES) { $v = ''; $ok = $false; try { $ok = $zk.GetSysOption(1, $n, [ref]$v) } catch {}; if ($ok) { $r[$n] = [string]$v } }
  return $r
}

function Do-Teclas($zk) {
  $r = [ordered]@{ listas = $null; teclas = @() }
  $a = ''; $b = ''
  try { if ($zk.GetAllSFIDName(1, [ref]$a, 4096, [ref]$b, 4096)) { $r.listas = @{ teclas = $a; funciones = $b } } } catch { $r.listas = '(GetAllSFIDName no disponible)' }
  for ($k = 1; $k -le 20; $k++) {
    $kn = ''; $fn = ''; $fun = 0; $code = 0; $sname = ''; $desc = ''; $auto = 0; $times = ''
    $ok = $false
    try { $ok = $zk.GetShortkey(1, $k, [ref]$kn, [ref]$fn, [ref]$fun, [ref]$code, [ref]$sname, [ref]$desc, [ref]$auto, [ref]$times) } catch {}
    if ($ok) {
      $r.teclas += [ordered]@{ id = $k; tecla = $kn; funcion = $fn; tipo = $fun; codigoEstado = $code; nombreEstado = $sname; descripcion = $desc; autoCambio = $auto; horarios = $times }
      continue
    }
    $fun = 0; $code = 0; $sname = ''; $auto = 0; $times = ''
    try { if ($zk.SSR_GetShortkey($k, [ref]$fun, [ref]$code, [ref]$sname, [ref]$auto, [ref]$times)) {
      $r.teclas += [ordered]@{ id = $k; tipo = $fun; codigoEstado = $code; nombreEstado = $sname; autoCambio = $auto; horarios = $times; via = 'SSR_GetShortkey' } } } catch {}
  }
  if (-not $r.teclas.Count) { $r.error = "Ninguna tecla devuelta (err=$(LastErr $zk))" }
  return $r
}

function Do-Timbres($zk) {
  $r = [ordered]@{ timbres = @() }
  $okAll = $false
  try { $okAll = $zk.ReadAllBellSchData(1) } catch { $r.aviso = '(ReadAllBellSchData no disponible)' }
  if ($okAll) {
    for ($i = 0; $i -lt 500; $i++) {
      $wd = 0; $ix = 0; $en = 0; $h = 0; $m = 0; $vo = 0; $way = 0; $inD = 0; $exD = 0
      $ok = $false; try { $ok = $zk.GetEachBellInfo(1, [ref]$wd, [ref]$ix, [ref]$en, [ref]$h, [ref]$m, [ref]$vo, [ref]$way, [ref]$inD, [ref]$exD) } catch {}
      if (-not $ok) { break }
      $r.timbres += [ordered]@{ dia = $wd; indice = $ix; activo = $en; hora = ('{0:00}:{1:00}' -f $h, $m); sonido = $vo; modo = $way; durInterna = $inD; durExterna = $exD }
    }
  }
  if (-not $r.timbres.Count) { $r.error = "Sin timbres leidos (err=$(LastErr $zk))" }
  return $r
}

function Do-Conteos($zk) {
  $r = [ordered]@{}
  $tablas = [ordered]@{ usuarios = @('user', ''); huellas = @('templatev10', ''); caras = @('biodata', 'Type=2'); palmas = @('biodata', 'Type=8') }
  foreach ($k in $tablas.Keys) {
    $t = $tablas[$k][0]; $f = $tablas[$k][1]; $c = 0; $hecho = $false
    try { if ($zk.SSR_GetDeviceDataCount(1, $t, $f, '', [ref]$c)) { $r[$k] = [int]$c; $hecho = $true } } catch {}
    if (-not $hecho) { try { if ($zk.SSR_GetDeviceDataCount(1, $t, $f, [ref]$c)) { $r[$k] = [int]$c; $hecho = $true } } catch {} }
    if (-not $hecho) { $r[$k] = "no (err=$(LastErr $zk))" }
  }
  return $r
}

# Tablas internas (SSR_GetDeviceData). Primero 'user' para confirmar que la vía funciona con este SDK;
# después nombres candidatos de configuración. Solo lectura: devuelve tamaño + muestra.
$TABLAS = @(
  'user','templatev10','biodata','timezone','transaction',
  'options','option','sysoption','sysoptions','parameters','parameter','params','param','config','settings','setting',
  'sms','usersms','user_sms','udata','shortmessage','message','messageoption','smsoption','smsoptions',
  'devparam','deviceparam','sysparam','systemparam','workcode','holiday','bellschedule','bell','shortkey','attstate','statekey'
)
function Do-Tablas($zk) {
  $r = [ordered]@{}
  foreach ($t in $TABLAS) {
    $buf = ''; $ok = $false
    try { $ok = $zk.SSR_GetDeviceData(1, [ref]$buf, 4194304, $t, '*', '', '') } catch {}
    if ($ok -and $buf) {
      $lineas = @($buf -split "`r?`n" | Where-Object { $_ })
      $m = @($lineas | Select-Object -Skip 1 -First 3) -join ' | '
      $r[$t] = [ordered]@{ filas = [Math]::Max(0, $lineas.Count - 1); encabezado = $lineas[0]; muestra = $m.Substring(0, [Math]::Min(400, $m.Length)) }
    } else {
      $r[$t] = "no (err=$(LastErr $zk))"
    }
  }
  return $r
}

function Do-Funciones($zk) {
  return @($zk | Get-Member -MemberType Method | ForEach-Object { $_.Name } | Sort-Object)
}

try {
  $in = $InputJson | ConvertFrom-Json
  $accion = [string]$in.accion
  $zk = New-Zk $SdkDir
  if ($accion -eq 'funciones') { Out-Json ([ordered]@{ ok = $true; accion = $accion; data = (Do-Funciones $zk) }); exit 0 }
  $ip = [string]$in.ip
  if (-not $ip) { throw 'ip es requerida' }
  $port = if ($in.puerto) { [int]$in.puerto } else { 4370 }
  if ($in.commKey) { try { [void]$zk.SetCommPassword([int]$in.commKey) } catch {} }
  $t0 = Get-Date
  if (-not $zk.Connect_Net($ip, $port)) { throw "No conecta con $ip`:$port (err=$(LastErr $zk))" }
  try {
    switch ($accion) {
      'info'     { $data = Do-Info $zk }
      'opciones' { $data = Do-Opciones $zk }
      'teclas'   { $data = Do-Teclas $zk }
      'timbres'  { $data = Do-Timbres $zk }
      'conteos'  { $data = Do-Conteos $zk }
      'tablas'   { $data = Do-Tablas $zk }
      default    { throw "Accion desconocida: $accion" }
    }
  } finally { try { $zk.Disconnect() } catch {} }
  Out-Json ([ordered]@{ ok = $true; accion = $accion; ip = $ip; ms = [int]((Get-Date) - $t0).TotalMilliseconds; data = $data })
} catch {
  Out-Json ([ordered]@{ ok = $false; error = $_.Exception.Message })
  exit 1
}
