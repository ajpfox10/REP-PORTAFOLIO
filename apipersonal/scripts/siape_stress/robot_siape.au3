; ============================================================================
; robot_siape.au3 v4 - Carga de ANUAL COMPLEMENTARIA (stress) en SIAPE
; Credenciales: SIAPE_USER / SIAPE_PASS del .env del proyecto.
; Config: robot.cfg (DRY_RUN, DO_LOGIN, ONLY_ONE) si existe; sino defaults de abajo.
; Lee: coords.ini, coords_login.ini, worklist.csv
; Escribe: robot.log  y  robot_result.csv (dni;estado por agente: ok/dry)
; ============================================================================
#include <ScreenCapture.au3>
Global $WT = "Sistema Unico Provincial de Administracion de Personal"

; ---------------- CONFIG (defaults; robot.cfg los pisa) ----------------
Global $DO_LOGIN  = True
Global $DRY_RUN   = True
Global $ONLY_ONE  = True
Global $LAUNCH    = True     ; abrir SIAPE si no esta abierto
Global $T         = 450
Global $TDLG      = 1400
Global $TLOGIN    = 6000
Global $TAPP      = 4500
Global $LAUNCH_TIMEOUT = 90  ; seg a esperar que aparezca la ventana de SIAPE
Global $jnlp      = "C:\Users\Administrator\Desktop\SIAPES.jnlp"

Global $dir        = @ScriptDir
Global $envFile    = $dir & "\..\..\.env"   ; .env de la app (dev o prod, segun donde este la carpeta)
Global $logFile    = $dir & "\robot.log"
Global $workFile   = $dir & "\worklist.csv"
Global $cfgFile    = $dir & "\robot.cfg"
Global $resultFile = $dir & "\robot_result.csv"

_LoadCfg()   ; pisa DRY_RUN/DO_LOGIN/ONLY_ONE si hay robot.cfg
FileDelete($resultFile)

Global $CX[18], $CY[18]
Global $LX[6],  $LY[6]
_LoadCoords($dir & "\coords.ini", $CX, $CY, "t", 17)
_LoadCoords($dir & "\coords_login.ini", $LX, $LY, "L", 5)

Global $usuario = _EnvRead($envFile, "SIAPE_USER")

If Not WinExists($WT) Then
    If $LAUNCH Then
        If Not _EnsureOpen() Then _Fatal("No pude abrir SIAPE (revisar ruta del .jnlp / prompt de Java).")
    Else
        _Fatal("No encuentro la ventana de SIAPE. Abrila primero (o poné $LAUNCH=True).")
    EndIf
EndIf
WinActivate($WT)
WinWaitActive($WT, "", 8)
_CenterWindow()
Global $g_base = WinGetPos($WT)
_Log("=== START DO_LOGIN=" & $DO_LOGIN & " DRY_RUN=" & $DRY_RUN & " ONLY_ONE=" & $ONLY_ONE & " base=" & $g_base[0] & "," & $g_base[1])

If $DO_LOGIN Then
    If Not _Login() Then _Fatal("Fallo el login (revisar coords_login.ini / .env).")
EndIf

If Not FileExists($workFile) Then _Fatal("Falta worklist.csv")
Local $lines = FileReadToArray($workFile)
Local $proc = 0, $ok = 0, $err = 0
For $i = 0 To UBound($lines) - 1
    Local $ln = StringStripWS($lines[$i], 3)
    If $ln = "" Then ContinueLoop
    If StringLeft(StringUpper($ln), 3) = "DNI" Then ContinueLoop
    Local $f = StringSplit($ln, ";", 2)
    If UBound($f) < 4 Then
        _Log("SKIP mal formada: " & $ln)
        ContinueLoop
    EndIf
    $proc += 1
    Local $r = _CargarUno(StringStripWS($f[0],3), StringStripWS($f[1],3), StringStripWS($f[2],3), StringStripWS($f[3],3))
    If $r Then
        $ok += 1
    Else
        $err += 1
    EndIf
    If $ONLY_ONE Then ExitLoop
Next
_Log("=== FIN proc=" & $proc & " ok=" & $ok & " err=" & $err)
If $ONLY_ONE Or $proc <= 1 Then
    MsgBox(64, "Robot SIAPE", "Terminado." & @CRLF & "Procesados: " & $proc & @CRLF & "OK: " & $ok & @CRLF & "Errores: " & $err)
EndIf
Exit

; ============================================================================
Func _Login()
    _Log("Login: usuario len=" & StringLen($usuario))
    If $usuario = "" Then Return _LogRet("Falta SIAPE_USER en .env", False)
    Local $pw = _GetPassword()
    If $pw = "" Then Return _LogRet("Falta SIAPE_PASS en .env", False)
    WinActivate($WT)
    _ClickL(1)
    Sleep($T)
    _ClearAndType($usuario, 12)
    _ClickL(2)
    Sleep($T)
    _ClearAndType($pw, 20)
    $pw = ""
    _ClickL(3)
    Sleep($TLOGIN)
    _ClickL(5)
    Sleep($TAPP)
    $g_base = WinGetPos($WT)
    _Log("Login OK (entrado a eRreH)")
    Return True
EndFunc

Func _GetPassword()
    Return _EnvRead($envFile, "SIAPE_PASS")
EndFunc

Func _EnvRead($file, $key)
    If Not FileExists($file) Then Return ""
    Local $a = FileReadToArray($file)
    For $i = 0 To UBound($a) - 1
        Local $ln = $a[$i]
        If StringLeft(StringStripWS($ln, 1), 1) = "#" Then ContinueLoop
        Local $m = StringRegExp($ln, "^\s*" & $key & "\s*=\s*(.*)$", 3)
        If IsArray($m) Then
            Local $v = StringStripWS($m[0], 3)
            If StringLeft($v,1) = '"'  And StringRight($v,1) = '"'  Then $v = StringMid($v, 2, StringLen($v)-2)
            If StringLeft($v,1) = "'" And StringRight($v,1) = "'" Then $v = StringMid($v, 2, StringLen($v)-2)
            Return $v
        EndIf
    Next
    Return ""
EndFunc

Func _LoadCfg()
    If Not FileExists($cfgFile) Then Return
    $DO_LOGIN = (_CfgVal("DO_LOGIN", $DO_LOGIN ? "1" : "0") = "1")
    $DRY_RUN  = (_CfgVal("DRY_RUN",  $DRY_RUN  ? "1" : "0") = "1")
    $ONLY_ONE = (_CfgVal("ONLY_ONE", $ONLY_ONE ? "1" : "0") = "1")
EndFunc

Func _CfgVal($key, $def)
    Local $a = FileReadToArray($cfgFile)
    For $i = 0 To UBound($a) - 1
        Local $m = StringRegExp($a[$i], "^\s*" & $key & "\s*=\s*(\S+)", 3)
        If IsArray($m) Then Return StringStripWS($m[0], 3)
    Next
    Return $def
EndFunc

Func _EnsureOpen()
    If WinExists($WT) Then Return True
    _Log("SIAPE cerrado -> lanzando " & $jnlp)
    If Not FileExists($jnlp) Then Return _LogRet("No existe el .jnlp: " & $jnlp, False)
    ShellExecute($jnlp)
    Local $t = TimerInit()
    While TimerDiff($t) < $LAUNCH_TIMEOUT * 1000
        If WinExists($WT) Then
            _Log("SIAPE abierto.")
            Return True
        EndIf
        _HandleJavaPrompt()
        Sleep(1000)
    WEnd
    Return WinExists($WT)
EndFunc

Func _HandleJavaPrompt()
    Local $titles[2] = ["Advertencia de seguridad", "Security Warning"]
    For $i = 0 To UBound($titles) - 1
        If WinExists($titles[$i]) Then
            WinActivate($titles[$i])
            Sleep(400)
            Send("!e")        ; Ejecutar
            Sleep(200)
            Send("{ENTER}")   ; por si el boton por defecto es Run
        EndIf
    Next
EndFunc

Func _CenterWindow()
    Local $p = WinGetPos($WT)
    If Not IsArray($p) Then Return
    Local $x = Int((@DesktopWidth - $p[2]) / 2)
    Local $y = Int((@DesktopHeight - $p[3]) / 2)
    If $x < 0 Then $x = 0
    If $y < 0 Then $y = 0
    WinMove($WT, "", $x, $y)
    Sleep(300)
    _Log("Ventana centrada en " & $x & "," & $y)
EndFunc

Func _CheckError()
    ; El cartel "Error" es un frame INTERNO de Java (no ventana): se detecta por
    ; la CAMPANITA ROJA (~0xD54848) en la zona central del formulario. Se cierra con Enter.
    Local $x1 = $g_base[0] + 450, $y1 = $g_base[1] + 300
    Local $x2 = $g_base[0] + 1250, $y2 = $g_base[1] + 700
    Local $c = PixelSearch($x1, $y1, $x2, $y2, 0xFF0000, 40)
    If @error Then Return False    ; no hay campanita -> sin error
    _Log("Campanita roja detectada en " & $c[0] & "," & $c[1] & " -> cerrando alert")
    For $i = 1 To 3
        Send("{ENTER}")
        Sleep(500)
        PixelSearch($x1, $y1, $x2, $y2, 0xFF0000, 40)
        If @error Then ExitLoop     ; ya no esta -> cerrado
    Next
    Return True
EndFunc

Func _CargarUno($dni, $anio, $dias, $lic)
    _Log("--- CargarUno dni=" & $dni & " anio=" & $anio & " dias=" & $dias & " lic=" & $lic)
    _Click(1)
    Sleep($T)
    _Click(2)
    Sleep($TDLG)
    _Click(3)
    Sleep($TDLG)
    _Click(4)
    Sleep($T)
    _ClearAndType($dni, 12)
    _Click(5)
    Sleep($TDLG)
    _Click(6)
    Sleep($T)
    _Click(7)
    Sleep($TDLG)
    ; --- Picker de licencia (robusto: asegura que el filtro entre) ---
    _Click(8)                 ; "..." Licencia -> abre "Licencias y Permisos"
    Sleep($TDLG + 700)        ; el picker tarda en abrir
    _Click3(9)                ; triple-clic en campo Buscar (selecciona el "%")
    Sleep(250)
    Send("{DEL}")
    Sleep(150)
    Send($lic, 1)             ; tipear la licencia exacta
    Sleep(250)
    _Click(10)                ; Buscar
    Sleep($TDLG + 400)
    _Click(11)                ; primera fila (ya filtrada = la correcta)
    Sleep($T)
    _Click(12)                ; Aceptar
    Sleep($TDLG)
    ; Año -> TAB -> C. Días (orden real de campos; evita clic frágil en Días)
    _Click(13)
    Sleep($T)
    _ClearAndType($anio, 6)
    Send("{TAB}")
    Sleep(250)
    _ClearAndType($dias, 6)
    If $DRY_RUN Then
        _Log("DRY_RUN: fila llena dni=" & $dni & ", NO se guarda.")
        FileWriteLine($resultFile, $dni & ";dry")
        If $ONLY_ONE Then MsgBox(48, "DRY-RUN", "Fila llena para DNI " & $dni & "." & @CRLF & "NO se guardo (modo prueba). Revisa.")
        Return True
    EndIf
    _Click(15)        ; Guardar
    Sleep($TDLG)
    _Click(16)        ; Aceptar del "¿Confirma?"
    Sleep($TDLG)
    _ScreenCapture_Capture($dir & "\shot_" & $dni & ".png")
    If _CheckError() Then
        _Log("Guardado FALLO (SIAPE: Error) dni=" & $dni)
        FileWriteLine($resultFile, $dni & ";error")
        Return True
    EndIf
    _Log("Guardado OK dni=" & $dni)
    FileWriteLine($resultFile, $dni & ";ok")
    Return True
EndFunc

Func _Click($n)
    MouseMove($g_base[0] + $CX[$n], $g_base[1] + $CY[$n], 8)
    MouseClick("left", $g_base[0] + $CX[$n], $g_base[1] + $CY[$n], 1, 5)
EndFunc

Func _Click3($n)
    MouseMove($g_base[0] + $CX[$n], $g_base[1] + $CY[$n], 8)
    MouseClick("left", $g_base[0] + $CX[$n], $g_base[1] + $CY[$n], 3, 5)
EndFunc

Func _ClickL($n)
    MouseMove($g_base[0] + $LX[$n], $g_base[1] + $LY[$n], 8)
    MouseClick("left", $g_base[0] + $LX[$n], $g_base[1] + $LY[$n], 1, 5)
EndFunc

Func _ClearAndType($txt, $maxClear)
    Send("{END}")
    Send("{BACKSPACE " & $maxClear & "}")
    Sleep(120)
    Send($txt, 1)
EndFunc

Func _LoadCoords($file, ByRef $ax, ByRef $ay, $pref, $max)
    If Not FileExists($file) Then _Fatal("Falta " & $file)
    Local $a = FileReadToArray($file)
    For $i = 0 To UBound($a) - 1
        Local $m = StringRegExp($a[$i], "^" & $pref & "(\d+)=(-?\d+),(-?\d+)", 3)
        If IsArray($m) Then
            Local $idx = Int($m[0])
            If $idx >= 1 And $idx <= $max Then
                $ax[$idx] = Int($m[1])
                $ay[$idx] = Int($m[2])
            EndIf
        EndIf
    Next
EndFunc

Func _Log($s)
    FileWriteLine($logFile, @YEAR & "-" & @MON & "-" & @MDAY & " " & @HOUR & ":" & @MIN & ":" & @SEC & "  " & $s)
EndFunc

Func _LogRet($s, $r)
    _Log($s)
    Return $r
EndFunc

Func _Fatal($s)
    _Log("FATAL: " & $s)
    MsgBox(16, "Robot SIAPE - ERROR", $s)
    Exit
EndFunc
