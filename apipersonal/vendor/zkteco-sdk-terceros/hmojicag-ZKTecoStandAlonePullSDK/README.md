# Standalone SDK 6.3.1.37 + Pull SDK 2.2.0.220 — copia de TERCERO

**Origen:** https://github.com/hmojicag/ZKTecoStandAlonePullSDK (commit `0ac805c`), bajado por el usuario el 22/10/2026.
**No es de ZKTeco.** Las DLL no tienen firma digital (las oficiales 6.2.4.11 tampoco), así que no hay forma de probar que no fueron alteradas.
**NO está registrado en Windows ni lo usa ningún script.** El SDK en uso sigue siendo `vendor/zkteco-sdk-32bit/` (6.2.4.11 oficial).

| Archivo | SHA-256 |
|---|---|
| `ZKTecoStandAlonePullSDK.zip` (21.156.540 bytes, 3.362 entradas) | `A284616A2775505CE7FFB091D5300CD90338FA5D5A2D2B1E56B94E933E870DBC` |

En `extraido/` solo se sacó: `SDK-Ver6.3.1.37/` (32 y 64 bits), `Changlog.txt`, `README.md` y el manual
`Doc-Ver2.1/ZKTeco_Standalone_SDK_Development_Manual_V2.1_A.2-EN.pdf`. El resto del zip (demos C#/VB con binarios compilados) no se extrajo.

## Comparación con el oficial 6.2.4.11 (22/10/2026)
- 13 DLL en común: **todas distintas** (más grandes, ej. zkemkeeper 667 KB → 790 KB). 2 nuevas: `plusbcomm.dll`, `usbstd.dll`.
- Versiones: `zkemkeeper.dll` 6.3.1.37, `plcommpro.dll` 2.2.0.220. Último cambio del changelog: 2018-05-24.
- **No trae `SetCommPasswordEx`** (anterior al cambio de seguridad de ZKTeco que pide 6.3.1.54+).
- Funciones nuevas relevantes (≈135 nombres nuevos en la DLL): teclas de estado (`GetShortkey`/`SetShortkey`), timbres
  (`GetBellSchDataEx`/`SetBellSchDataEx`/`ReadAllBellSchDataW`), firmware nuevo (`IsNewFirmwareMachine`, `GetDeviceFirmwareVersion`,
  `SetCompatOldFirmware`), tablas (`SSR_GetDeviceDataCount`, `SSR_DeleteDeviceData`, `SetDeviceTableData`), fotos de usuario
  (`UploadUserPhoto`, `DownloadPicture`, `GetPhotoByNameToFile`), vigencia de usuario (`SetUserValidDate`), modo de verificación por usuario
  (`SetUserVerifyStyle`), eventos en vivo (`OnAttTransactionEx_New`, `OnGeneralEvent`, `SetEventMode`), `SearchDevice`, `SetCommuTimeOut`, `TurnOffAlarm`.
- Ojo: `scripts/fichero-bio-sdk.ps1` llama `SSR_GetDeviceDataCount`, que **no existe** en la 6.2.4.11 instalada (por eso cae al fallback).
