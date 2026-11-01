' Corre actualizar.ps1 sin mostrar ninguna ventana (lo usa la tarea programada).
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & carpeta & "\actualizar.ps1""", 0, False
