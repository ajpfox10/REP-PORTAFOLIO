# =============================================================================
#  Handler del protocolo "p5abrir:"  —  Personal v5
# -----------------------------------------------------------------------------
#  Lo invoca Windows cuando en la web se hace click en "abrir carpeta".
#  Recibe como argumento el URI completo, por ejemplo:
#     p5abrir:%5C%5C192.168.0.21%5CG%5CDOCU%5C34458847%5CDNI
#  Lo decodifica a una ruta de red (UNC) y la abre en el Explorador de Windows,
#  en la SESION DEL USUARIO (esta PC), que es lo que se necesitaba.
#
#  Seguridad: SOLO abre rutas dentro del share  \\<host>\G\DOCU\  . Cualquier
#  otra cosa se ignora (para que una web cualquiera no pueda abrir carpetas raras).
# =============================================================================

param([string]$Uri)

# Prefijo permitido: rutas UNC dentro de \G\DOCU\ (cualquier host). Si algun dia
# cambia el share, ajustar esta expresion regular.
$RUTA_PERMITIDA = '^\\\\[^\\]+\\G\\DOCU\\'

try {
  if ([string]::IsNullOrWhiteSpace($Uri)) { exit 0 }

  # Sacar el esquema "p5abrir:" (y las barras iniciales si las hubiera).
  $scheme = 'p5abrir:'
  $rest = $Uri
  if ($rest.StartsWith($scheme, [System.StringComparison]::OrdinalIgnoreCase)) {
    $rest = $rest.Substring($scheme.Length)
  }
  $rest = $rest.TrimStart('/')

  # La web manda la ruta URL-encoded (%5C = \, %20 = espacio, etc.). Se decodifica.
  $path = [Uri]::UnescapeDataString($rest)

  # Validacion anti-abuso: solo rutas dentro de \G\DOCU\ .
  if ($path -notmatch $RUTA_PERMITIDA) { exit 0 }

  # En PowerShell, pasar $path como un unico token respeta los espacios del nombre
  # de carpeta ("Certificado ant. Provinciales") sin necesidad de comillas manuales.
  & explorer.exe $path
} catch {
  exit 0
}
