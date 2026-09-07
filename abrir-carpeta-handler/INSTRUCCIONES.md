# Abrir carpeta con un click — instalación del handler `p5abrir:`

Esto hace que, al tocar **"abrir carpeta"** (o un documento faltante) en la web de
Personal v5, se **abra solito el Explorador de Windows en TU PC**, mostrando la
carpeta del agente en `DOCU`.

Funciona en el propio servidor y en **cualquier PC de la red**, porque el que abre
el Explorador es la PC donde estás mirando el navegador — no el servidor.

> ¿Por qué hace falta instalar algo? Un navegador, por seguridad, no puede abrir
> carpetas de Windows por su cuenta. Este mini-handler es el "permiso" que le das a
> **tu** PC para que, cuando la web lo pida, abra esa carpeta (y nada más: solo abre
> rutas dentro de `\\...\G\DOCU\`).

---

## Instalar (en cada PC que vaya a usarlo)

1. **Copiá esta carpeta completa** a un lugar fijo de la PC, por ejemplo
   `C:\personalv5\abrir-carpeta-handler\`.
   ⚠️ No la borres ni la muevas después de instalar: el registro apunta al archivo
   `abrir-carpeta.ps1` que está acá adentro.
2. Doble click en **`Instalar.cmd`**.
   - No hace falta ser administrador (se instala solo para tu usuario de Windows).
   - Si Windows/antivirus advierte, elegí "Más información → Ejecutar de todas formas".
3. Listo. Probá desde la web: tocá "abrir carpeta".
   - La **primera vez** el navegador (Chrome/Edge) pregunta si permitís abrir
     `p5abrir:` → **Aceptar** (podés tildar "Recordar" / "Permitir siempre").

Si otra persona usa la misma PC con **otro usuario de Windows**, tiene que correr
`Instalar.cmd` con su usuario también (es por-usuario).

---

## Probar que quedó bien

- En la web, tocá el **DNI** de un agente o un chip de documento faltante.
- Debería abrirse una ventana del Explorador en la carpeta correspondiente.
- Si **no** se abre, igual la ruta quedó **copiada al portapapeles**: abrí el
  Explorador (**Win + E**) y pegá (**Ctrl + V**, Enter). Que no abra solo casi
  siempre significa que falta correr `Instalar.cmd` en esa PC/usuario.

---

## Desinstalar

Doble click en **`Desinstalar.cmd`**. Después de eso, el botón de la web sigue
funcionando pero solo **copia la ruta** al portapapeles (pegás a mano).

---

## Requisitos

- Windows con PowerShell (viene de fábrica).
- Que la PC llegue al recurso de red `\\<servidor>\G` (el mismo share que ya usan
  para ver `DOCU`). Si desde el Explorador podés entrar a `\\192.168.0.21\G\DOCU`,
  entonces el handler va a andar.

## Contenido de la carpeta

| Archivo             | Para qué sirve                                            |
|---------------------|-----------------------------------------------------------|
| `abrir-carpeta.ps1` | El launcher que abre el Explorador. **No borrar.**        |
| `Instalar.cmd`      | Registra el protocolo `p5abrir:` para tu usuario.         |
| `Desinstalar.cmd`   | Lo quita.                                                 |
| `INSTRUCCIONES.md`  | Este archivo.                                             |

## Nota de seguridad

El handler **solo** abre el Explorador y **solo** en rutas que empiezan con
`\\<host>\G\DOCU\`. Cualquier otra ruta se ignora. No ejecuta programas ni abre
archivos: únicamente muestra la carpeta.
