# Firmware G3 Pro — ZMM720-NF-Ver1.1.40

> ⛔ **NO CARGAR EN LOS G3 PRO.** Revisado 24/10/2026: el encabezado de `emfw.cfg` dice
> `ZMM100_TFTFirmwareVersion=Ver 8.00 Jun 04 2021` (plataforma **ZMM100**), y nuestros G3 Pro son **ZMM720_TFT**.
> No coincide con lo que dice la guía de TVC; cargarlo podría inutilizar el reloj.

**No es un archivo oficial de ZKTeco.** Viene de la carpeta de Google Drive que enlaza la guía de TVC México
(distribuidor) "G3 Pro – Saturación de Datos", clave TVC ZKT0810009, fecha 2024-07-08.
No trae firma ni checksum del fabricante: el hash de abajo solo identifica ESTE archivo.

| Archivo | SHA-256 |
|---|---|
| `ActualizacionG3PRO.zip` (2.030.134 bytes) | `E656C478F49EC42F5AF8B8EEB10FB1F0634FBFED7B885F56DDDF4F89F7651B57` |

Contenido del zip: `emfw.cfg` (3.564.665 bytes, fechado 2021-07-03).
La guía dice `enfw.cfg`, pero el archivo real se llama `emfw.cfg` (nombre estándar de firmware ZK). No renombrarlo.

## Para qué
Los 3 G3 Pro del hospital (entrada arriba, salida arriba, salida abajo) tienen `ZMM720-NF-Ver1.1.34`.
Según la guía, esa versión puede dar el error "Saturación de Datos" al fichar (no guarda la checada) y se corrige con la 1.1.40.
Al 22/10/2026 los relojes fichan bien: **no se aplicó**.

## Procedimiento (guía TVC)
1. Pendrive de **4 GB o menos**, **FAT32**, vacío.
2. Descomprimir y copiar `emfw.cfg` en la raíz.
3. En el G3 Pro: **Menú Principal → Sistema → Actualización por USB**.
4. Carga sola y pide reiniciar al terminar.
5. Verificar que quede `ZMM720-NF-Ver1.1.40`.

## Antes / después
- Probar primero en UN reloj (entrada arriba).
- Antes: confirmar que no queden fichadas sin subir al ADMS; leer por SDK usuarios/huellas/caras para comparar.
- Después: que vuelva a conectarse al ADMS (iclock.LastActivity) y conserve usuarios, huellas y opciones (ej. FaceAntiFake=1).
