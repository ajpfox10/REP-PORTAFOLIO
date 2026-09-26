# Mapeo en vivo - Gestor de Exportaciones (2026-09-22)

Continuacion de `siape_mapping_notes.md` (seccion "Exportaciones - Consultas a
Exportar", mapeada el 2026-08-20 sin interactuar). Esta vuelta se interactuo
en vivo contra SIAPE real para descubrir como automatizar la descarga.

## Bug encontrado: escala de click por coordenadas NO es confiable

Los scripts existentes (`cargar_francos_siape.py`) asumen `SIAPE_JAB_SCALE =
1.5` fijo para convertir bounds logicos de JAB a pixeles fisicos de pantalla,
y asumen que el origen de la ventana es `(0,0)`.

En esta sesion se confirmo que **el tamano fisico que reporta la ventana
(via `pygetwindow`/`win32gui`) varia entre llamadas del mismo proceso**:

- A veces devuelve `(1944 x 1104)` (escala real 1.5 respecto del logico
  `1296x736` de JAB).
- Otras veces devuelve `(1296 x 736)` (escala 1.0) para la MISMA ventana,
  sin que el usuario la haya tocado.

Esto es tipico de **virtualizacion de DPI de Windows**: un proceso Python no
declarado "DPI aware" puede recibir del sistema operativo coordenadas ya
escaladas (logicas, 96 DPI) o fisicas segun la llamada/cache, de forma
inconsistente. Como consecuencia, cualquier click calculado con un factor de
escala fijo (`bounds * 1.5`) puede caer:

- Cerca de `(0,0)` si el factor de escala usado es MAYOR al real -> cae
  sobre el icono de la ventana y abre el **menu de sistema**
  (Restaurar/Mover/Minimizar/Maximizar/Cerrar) en vez del menu de SIAPE.
- Sobre un menu vecino equivocado si el error es mas chico.

### Mitigacion aplicada (esta sesion)

Para navegar `Exportaciones -> Consultas a Exportar` se dejo de usar click
por coordenadas y se uso **navegacion 100% por teclado**, que no depende de
ningun factor de escala:

```
Alt                    # activa la barra de menu (foco en el primer menu)
Right x10               # SIAPE -> MiLegajo -> Personas -> Estructuras ->
                         # Hospitales -> Cargos -> Autorizante -> Novedades ->
                         # Rec. Medicos -> Autoseguro -> Exportaciones
Down                    # despliega Exportaciones
c                       # mnemonico de "Consultas a Exportar nemotécnico C"
```

Esto abrio `Gestor de Exportaciones` de forma confiable. **Recomendacion
para scripts futuros de esta pantalla: preferir este camino por teclado (o
recalcular la escala en cada click con
`w.width/1296.0`, `w.height/736.0` + sumar `w.left`/`w.top`) en vez de
asumir `SIAPE_JAB_SCALE=1.5` fijo.**

Nota aparte (bug menor, no la causa principal): `_jab_click_bounds()` en
`cargar_francos_siape.py` tampoco suma el origen de la ventana (`w.left`,
`w.top`) al click, solo aplica el factor de escala. Con la ventana
maximizada el origen es `(-8,-8)` o `(-12,-12)` (borde invisible de Windows),
un error chico pero real.

## Grilla completa de consultas (leida en vivo, 2026-09-22 ~19:37)

Los `y` logicos de la grilla son ESTABLES entre el mapeo del 2026-08-20 y
esta lectura (260, 285, 311, 336, 361, 387, 412, 437, 463) - la fila no se
mueve, solo cambia el contenido. El boton `Exportar` de cada fila esta en
`x=664` (logico), mismo `y` que la fila +/- 1px, ancho/alto ~27x25.

| y logico | Nro | Nombre | Tipo | Ultima exportacion | Accesos |
| --- | --- | --- | --- | --- | --- |
| 260 | 123 | Examenes Médicos Salud | Nominada | 20/08/2026 13:31 | 7 |
| 285 | 76 | Horario Administrativo a un dia | Nominada | 24/08/2026 12:47 | 8 |
| 311 | 71 | Horario Administrativo Consolidado de los Agentes | Nominada | 09/08/2026 14:58 | 5 |
| 336 | 82 | Horario Guardia Salud a un dia | Nominada | 05/01/2026 10:43 | 4 |
| 361 | 5 | Licencias Médicas | Nominada | 29/08/2026 20:05 | 1 |
| 387 | 77 | Novedades Pendientes de Autorización | Nominada | 03/09/2026 09:17 | 31 |
| 412 | 4 | Novedades Por Periodo | Nominada | 20/09/2026 17:48 | 82 |
| 437 | 79 | Novedades Rechazadas | Nominada | 03/09/2026 09:19 | 11 |
| 463 | 1 | Plantel Nominado | Nominada | 25/08/2026 13:31 | 9 |

(El campo "Nro" a veces se lee mal por JAB en la primera fila -ver
`siape_mapping_notes.md`-, los numeros de esta tabla vienen del mapeo visual
del 2026-08-20, que coincide con lo que se ve en pantalla.)

## Causa raiz confirmada y solucion (actualizado)

La causa real no era la ventana cambiando de tamano, sino **DPI virtualization
por proceso**: cada `python -c "..."` nuevo es no-DPI-aware por defecto, y
Windows le entrega a ese proceso coordenadas de ventana YA escaladas
(logicas, ~1296x736) hasta que algo en ese mismo proceso pide ser DPI-aware
(p.ej. ciertas llamadas internas de `pyautogui`). Otro proceso que consulte
la MISMA ventana en ese momento puede recibir el tamano fisico real
(1944x1110). Mezclar lecturas de distintos procesos (o de antes/despues de
que pyautogui "active" el DPI-awareness) es lo que rompia la escala.

**Fix que funciono, confirmado en vivo:** al principio del script, ANTES de
importar/usar pygetwindow o pyautogui:

```python
import ctypes
ctypes.windll.user32.SetProcessDPIAware()
```

Con eso, `pygetwindow` reporta el tamano fisico real de forma estable
(`1944 x 1110`, escala `1944/1296 = 1.5` exacto) durante TODO el proceso, y
los clicks `(bounds.x + width/2) * scale + w.left` caen exactos. Se probo
clickeando la celda `NOMBRE DE LA CONSULTA` de la fila "Novedades Por
Periodo" y el foco JAB confirmo que cayo en el campo correcto; despues se
clickeo el boton `Exportar` de esa misma fila y abrio el modal `PERIODO`
correctamente.

**Recomendacion para TODOS los scripts de SIAPE que clickean por
coordenadas:** agregar `ctypes.windll.user32.SetProcessDPIAware()` como
primera linea (antes de cualquier import que pueda tocar win32), en vez de
confiar en que el factor `1.5` alcance por si solo.

## Orden de Tab dentro de una fila de la grilla (mapeado en vivo)

Con foco en `NOMBRE DE LA CONSULTA` de una fila, Tab recorre, en este orden:

1. `NOMBRE DE LA CONSULTA` (punto de partida)
2. `ULTIMA EXPORTACIÓN`
3. `DESCRIPCION DE LA CONSULTA` (panel inferior, fuera de la grilla)
4. `ACCESOS`
5. `EXCEPCIONES` (panel inferior, fuera de la grilla)
6. `TIPO DE CONSULTA`
7. `NRO. DE CONSULTA`
8. (vuelve a `NOMBRE DE LA CONSULTA`)

**El boton `Exportar` (icono, a la derecha de `ACCESOS`) NO esta en el ciclo
de Tab** - no se puede alcanzar por teclado, solo por click. Se clickea de
forma confiable con la escala corregida (ver arriba). Bounds relativos
dentro de una fila (con `NOMBRE` en `x=64`): `Exportar` en `x=672` (mismo
`y` que la fila, `width=27, height=25`).

## Confirmado en vivo: abrir el modal PERIODO

Con la escala corregida: click en la celda `NOMBRE DE LA CONSULTA` de
"Novedades Por Periodo" (foco confirmado por JAB) -> click en su boton
`Exportar` -> se abre el modal `PERIODO` (bounds ~`275,194,435,313`),
igual que lo mapeado el 2026-08-20. **No se cargaron fechas ni se aprieto
ACEPTAR todavia** - eso sigue pendiente de autorizacion.

## Hallazgo 2026-09-25: escala inestable entre sesiones + crash de `asegurar_sesion()` en login en frio

- **Escala de click no es constante entre corridas de SIAPE**: el 22/09 la ventana
  maximizada daba `1944x1110` (escala `1.5` respecto del logico `1296x736`).
  El 25/09, en una sesion nueva de SIAPE (tras relanzarlo), la ventana quedo en
  `1616x920`, pero la escala real observada empiricamente fue **`~1.0` con un
  offset de `-8` en Y** (NO `920/736=1.25` como daria la formula ingenua).
  Se calibro clickeando, viendo donde cayo el foco real (JAB), y ajustando.
  **No asumir la formula `w.width/1296.0` sin validarla en vivo cada vez** -
  lo mas seguro es verificar el foco despues del primer click de una corrida
  nueva y auto-calibrar si no coincide.
- **`asegurar_sesion()` (en `cargar_francos_siape.py`) puede hacer crashear a
  SIAPE en un login en frio** (proceso Java recien lanzado, sin sesion
  previa): dos corridas automatizadas de punta a punta hicieron que la
  ventana de SIAPE desapareciera por completo (sin proceso `java` vivo)
  ~40-60s despues de loguear. Reproducido 2 veces. Haciendo los mismos pasos
  **a mano** (`_hacer_login()` y despues `_entrar_erreh()`, con pausas
  propias entre medio, sin llamar a `estado_siape()` enseguida) **no se cayo
  en 60s**. Sospecha: `SIAPE_POST_LOGIN_SECONDS` (default `4`s, linea ~100)
  es muy corto y `estado_siape()` dispara un recorrido JAB completo
  demasiado pronto, mientras la app todavia esta transicionando de pantalla.
  No se toco el codigo compartido (lo usan otros robots) - queda pendiente
  subir ese valor o espaciar mejor el primer `estado_siape()` post-login.
- **Workaround usado hoy**: si SIAPE no esta abierto, lanzar
  `javaws.exe "...\SIAPES.jnlp"` DIRECTO (la asociacion de archivo `.jnlp`
  vía `cmd /c start` esta rota, no abre nada) y despues loguear a mano con
  `_hacer_login()` / `_entrar_erreh()` con pausas, en vez de confiar en
  `asegurar_sesion()` para un arranque en frio completo.

## Pendiente (no probado todavia)

- Que pasa al apretar `ACEPTAR` en el modal `PERIODO`: si tira un dialogo
  nativo de Windows "Guardar como", si guarda directo a una carpeta fija de
  SIAPE, o si hay que interceptar el archivo generado. **Es el dato que
  falta para poder automatizar la descarga real a `D:\G\comparacion\SIAPE`.**
- No todas las 9 consultas necesariamente piden el modal `PERIODO` (solo se
  confirmo para "Novedades Por Periodo"); falta confirmar una por una.
