!macro customInstall
  ; Si quedo una instalacion vieja "para todos los usuarios" (C:\Program Files\Cobertura Salud,
  ; p.ej. 0.2.8) se desinstala en silencio: esa copia preguntaba antes de actualizar y nunca
  ; se reemplazaba. ExecWait no pide UAC: sin permisos falla en silencio y la app lo reintenta.
  IfFileExists "$PROGRAMFILES64\Cobertura Salud\Uninstall Cobertura Salud.exe" 0 +2
    ExecWait '"$PROGRAMFILES64\Cobertura Salud\Uninstall Cobertura Salud.exe" /allusers /S'

  ; Acceso directo en el escritorio SIEMPRE, tambien en las actualizaciones silenciosas
  ; (electron-builder no lo recrea al actualizar si el usuario lo habia borrado).
  IfFileExists "$DESKTOP\Cobertura Salud.lnk" +2 0
    CreateShortCut "$DESKTOP\Cobertura Salud.lnk" "$appExe" "" "$appExe" 0

  ; Tras una actualizacion automatica la app se vuelve a abrir sola. electron-builder la
  ; abre via el shell del explorador, que en algunos equipos (RDP) no arranca: se abre
  ; tambien directo. Si arrancan las dos, el single-instance lock de main.js cierra una.
  ${if} ${isForceRun}
    Exec '"$appExe" --updated'
  ${endIf}
!macroend
