# Agente SDK de relojes (SDK 6.3, prueba)

Corre en **otra PC** y deja probar el SDK ZKTeco 6.3.1.37 desde la página
**"Prueba fichero lógica nueva" → pestaña "SDK 6.3 (prueba)"**, sin tocar el SDK 6.2.4.11 registrado en el servidor.

- El SDK de `sdk\` **no se registra en Windows**: se carga con un manifiesto (activation context) en un proceso aparte por acción.
- Origen de las DLL: copia de tercero (ver `apipersonal/vendor/zkteco-sdk-terceros/`), sin firma digital.
- Todas las acciones son de **solo lectura**: info, opciones, teclas, timbres, conteos, funciones.

## Puesta en marcha (una vez)
1. Copiar esta carpeta entera a la otra PC (Windows 64 bits, que llegue a los relojes por TCP 4370).
2. En `agente.config.json`:
   - `servidor`: URL de la API (prod `http://10.115.31.28:3001`).
   - `clave`: inventar una y poner **la misma** en el `.env` de la API como `FICHERO_SDK_AGENTE_CLAVE=...` (y reiniciar la API).
   - `servidoresPermitidos`: IPs desde las que la API le habla (las dos del servidor).
3. Clic derecho en `iniciar-agente.bat` → **Ejecutar como administrador** (solo la primera vez: crea la regla de firewall
   "Agente SDK Relojes" para su puerto, abierta únicamente a las IPs del servidor).

Después alcanza con doble clic. El agente:
- busca puerto libre desde `puertoInicial` (8099) y recuerda el último en `estado.json`,
- detecta su IP (la que usa para llegar al servidor),
- se anuncia a la API cada 60 s → aparece solo en la pestaña,
- escribe todo en `agente.log`.

Arranque automático con Windows: crearlo a mano en el Programador de tareas (al iniciar el equipo, con privilegios más altos):
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<carpeta>\agente.ps1"`.

## Autoactualización
El paquete vive en `apipersonal/assets/agente-sdk-relojes` (dev) y `deploy-prod.cmd` lo copia a prod.
Para sacar una versión nueva: cambiar los archivos acá, subir `version.json` y deployar con el `.cmd`.
Cada agente, en su anuncio (60 s), ve que el servidor tiene otra versión, baja solo los archivos cambiados
(`/fichero-sdk-agente/paquete` y `/archivo`, con la clave), verifica SHA-256, los reemplaza y se reinicia
(sale con código 3 y `iniciar-agente.bat` lo relanza). No se autoactualizan `agente.config.json` ni el `.bat`.

## Quitarlo
Cerrar la ventana del agente y borrar la regla:
`Remove-NetFirewallRule -DisplayName 'Agente SDK Relojes'` (PowerShell como administrador).

## Archivos
| Archivo | Qué es |
|---|---|
| `agente.ps1` | Servidor HTTP chico: puerto, IP, firewall, anuncio, recibe pedidos con `X-Agente-Clave` |
| `accion-sdk.ps1` | Ejecuta una acción con el SDK de `sdk\` en PowerShell 32 bits (proceso aparte) |
| `agente.config.json` | Servidor, clave, puerto inicial, IPs permitidas, carpeta del SDK |
| `sdk\` | 15 DLL del SDK 6.3.1.37 (32 bits) |
