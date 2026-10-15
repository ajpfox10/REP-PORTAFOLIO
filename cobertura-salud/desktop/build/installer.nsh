; Caches que deja Chromium/Electron en una carpeta de datos (no toca cookies ni logins).
!macro borrarCaches DIR
  RMDir /r "${DIR}\Cache"
  RMDir /r "${DIR}\Code Cache"
  RMDir /r "${DIR}\GPUCache"
  RMDir /r "${DIR}\DawnGraphiteCache"
  RMDir /r "${DIR}\DawnWebGPUCache"
  RMDir /r "${DIR}\Service Worker"
  RMDir /r "${DIR}\Shared Dictionary"
  RMDir /r "${DIR}\blob_storage"
!macroend

!macro customInstall
  ; Si quedo una instalacion vieja "para todos los usuarios" (C:\Program Files\Cobertura Salud,
  ; p.ej. 0.2.8) se desinstala en silencio: esa copia preguntaba antes de actualizar y nunca
  ; se reemplazaba. ExecWait no pide UAC: sin permisos falla en silencio y la app lo reintenta.
  IfFileExists "$PROGRAMFILES64\Cobertura Salud\Uninstall Cobertura Salud.exe" 0 +2
    ExecWait '"$PROGRAMFILES64\Cobertura Salud\Uninstall Cobertura Salud.exe" /allusers /S'

  ; Borra todo rastro de versiones anteriores (la app esta cerrada mientras se instala):
  ; carpeta vacia de la vieja instalacion "para todos", instaladores viejos que bajo el
  ; updater (el que se esta ejecutando ahora queda bloqueado y lo borra la app al abrir),
  ; caches de la version anterior (las cookies/sesiones de los organismos se conservan)
  ; y el instalador semilla que se copio al escritorio.
  RMDir "$PROGRAMFILES64\Cobertura Salud"
  RMDir /r "$LOCALAPPDATA\cobertura-salud-desktop-updater"
  !insertmacro borrarCaches "$APPDATA\cobertura-salud-desktop"
  !insertmacro borrarCaches "$APPDATA\cobertura-salud-desktop\Partitions\organismos"
  Delete "$DESKTOP\Cobertura-Salud-Setup.exe"
  Delete "$DESKTOP\Cobertura Salud Setup *.exe"

  ; Acceso directo en el escritorio SIEMPRE y apuntando a ESTA version: se borra el que
  ; haya (podia abrir una copia vieja) y se crea de nuevo. electron-builder no lo recrea
  ; en las actualizaciones silenciosas.
  Delete "$DESKTOP\Cobertura Salud.lnk"
  CreateShortCut "$DESKTOP\Cobertura Salud.lnk" "$appExe" "" "$appExe" 0

  ; Tras una actualizacion automatica la app se vuelve a abrir sola. electron-builder la
  ; abre via el shell del explorador, que en algunos equipos (RDP) no arranca: se abre
  ; tambien directo. Si arrancan las dos, el single-instance lock de main.js cierra una.
  ${if} ${isForceRun}
    Exec '"$appExe" --updated'
  ${endIf}
!macroend
