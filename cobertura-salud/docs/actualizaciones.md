# Actualizaciones automáticas de la app de escritorio

## 📁 CARPETA donde van las versiones nuevas (para que se auto-instalen)

```
C:\apps\cobertura-salud\backend\wwwroot\updates\
```

Todo lo que va en esa carpeta lo sirve el backend en:

```
http://192.168.0.21:8510/updates/
```

En esa carpeta tienen que quedar **estos 3 archivos** (los genera el build):

- `latest.yml`  ← el que dice cuál es la última versión (IMPRESCINDIBLE)
- `Cobertura Salud Setup X.Y.Z.exe`  ← el instalador de la versión nueva
- `Cobertura Salud Setup X.Y.Z.exe.blockmap`

Las PC operadoras miran `latest.yml` al abrir la app (y cada 4 h). Si hay una versión
mayor, la descargan y se actualizan solas.

---

## 🚀 Cómo publicar una versión nueva (2 pasos)

1. Subir el número de versión en `desktop\package.json`
   (ej: `"version": "0.2.4"` → `"0.2.5"`).  **ES OBLIGATORIO subirlo**, si no, no actualiza.

2. Parado en `C:\apps\cobertura-salud\desktop`, correr:

```bash
npm run publicar
```

Eso hace TODO solo: compila el `.exe` y **copia los 3 archivos a la carpeta de updates**
(`backend\wwwroot\updates\`). No hay que copiar nada a mano.

Listo: las PC se actualizan al siguiente arranque (o dentro de 4 h).

---

## ⚠️ Primer rollout (una sola vez por PC)

El auto-update recién funciona en PC que ya tienen **v0.2.0 o superior** instalada.
En cada PC nueva hay que instalar una vez el `.exe`:

- A mano: doble clic en `Cobertura-Salud-Setup.exe` (está en el Escritorio y en
  `C:\apps\cobertura-salud\instalador\`).
- Silencioso (push por IT): `Cobertura-Salud-Setup.exe /S`

Desde esa instalación en adelante, esa PC se actualiza sola.

---

## Notas
- Instalación **por usuario, sin admin** (`perMachine: false`).
- Si Windows/Defender marca el `.exe` por no estar firmado: "Más información → Ejecutar
  de todas formas", o excluir la carpeta en Defender.
- Config técnica: `desktop\package.json` (campo `build.publish`) y `desktop\main.js`
  (`iniciarAutoUpdate`). El servidor sirve `.yml`/`.blockmap` gracias a `backend\Program.cs`.
