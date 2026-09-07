# SDK ZKTeco (zkemkeeper) — 32 bits

DLLs del **Standalone Communication Protocol SDK v6.2.4.11 (32 bits)** de ZKTeco,
empaquetadas como parte del proyecto para poder instalar en otra máquina (prod).

Se usan para trasladar **cara (BioType 9)** y **palma (BioType 10)** entre ficheros
por SDK directo (COM), sin tocar el ADMS viejo. El backend las invoca vía
`scripts/fichero-bio-sdk.ps1` con `New-Object -ComObject zkemkeeper.ZKEM`.

## Arquitectura (importante)

- Todas las DLLs son **x86 (32 bits)** — verificado (machine type `0x014C`).
- Por eso:
  - Se copian a **`C:\Windows\SysWOW64`** (no `System32`).
  - Se registra con el **regsvr32 de 32 bits**: `C:\Windows\SysWOW64\regsvr32.exe`.
  - El backend llama al **PowerShell de 32 bits**:
    `C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe`
    (un COM 32-bit no carga en un proceso 64-bit — ya está así en el route).

> El `Auto-install_sdk.bat` que trae ZKTeco NO sirve tal cual en Windows 64-bit:
> copia a `System32` y registra con el `regsvr32` de 64 bits. Usar el
> `instalar-sdk.bat` de esta carpeta en su lugar.

## Instalar en otra máquina

1. Copiar esta carpeta completa a la máquina destino.
2. Click derecho sobre **`instalar-sdk.bat`** → **Ejecutar como administrador**.
3. Verificar (debe imprimir `ZKEM OK`):

```
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -Command "New-Object -ComObject zkemkeeper.ZKEM | Out-Null; 'ZKEM OK'"
```

Para revertir el registro del COM: `desinstalar-sdk.bat` (como administrador).

## Contenido (13 DLLs)

- `zkemkeeper.dll` — COM principal (la única que se registra con regsvr32).
- `zkemsdk.dll`, `commpro.dll`, `comms.dll`, `plcommpro.dll`, `plcomms.dll`,
  `tcpcomm.dll`, `pltcpcomm.dll`, `usbcomm.dll`, `rscomm.dll`, `rscagent.dll`,
  `plrscomm.dll`, `plrscagent.dll` — dependencias de transporte/soporte.
  No se registran, pero deben estar presentes junto a `zkemkeeper.dll`.

Origen: `tools/zkteco-standalone-sdk/.../Communication Protocol SDK(32Bit Ver6.2.4.11)/sdk`.
