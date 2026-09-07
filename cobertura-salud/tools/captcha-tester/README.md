# Captcha tester local

Laboratorio local para evaluar OCR con `ddddocr` sobre imagenes generadas por el propio proyecto.

Este tester no se conecta a SSS, ARCA, ANSES, SISA ni a ningun sitio externo. Sirve para presentacion, pruebas educativas y medicion local de reconocimiento.

## Ejecutar

```powershell
cd C:\apps\cobertura-salud
tools\captcha-tester\.venv\Scripts\python.exe tools\captcha-tester\captcha_tester.py
```

El script genera muestras en `tools\captcha-tester\out`, ejecuta OCR y muestra:

- texto esperado
- texto reconocido
- si coincidio o no
- ruta de la imagen generada
