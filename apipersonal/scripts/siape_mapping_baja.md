# Mapeo SIAPE - Baja de agente

Fecha de mapeo: 2026-10-05 (en vivo, observador `siape_observador_jab.py` -> `siape_map_baja/`)
Coordenadas JAB lógicas (ventana 1366x768 en esta sesión, sin escala).

## Navegación

- Módulo RRHH → menú `Cargos` → frame interno **`Cargos y Carrera Administrativa`** (el nombre trae muchos espacios al final: comparar con `.strip()`).
- Cabecera de búsqueda del agente (común a todas las pestañas):
  - `text` `APELLIDO y NOMBRE` (142,120,280,27) editable
  - `text` `LEGAJO` (735,120,80,27) editable
  - `text` `DOCUMENTO` (523,120,48,27) = tipo (DNI) · número en `text` sin nombre (574,120,100,27) — no editable
  - `text` `CUIT - CUIL` (891,120,113,27)
  - `push button` `BUSCAR` (1020,120,134,30)
  - `push button` `Ingresar como Supervisor` (1164,122,24,25)
- Pestañas (`page tab`, y=176): CARGOS · FUNCIONES · FUNCION 10.471 · PRESUPUESTO · ESCALAFON · PREST. SERVICIO · RESERVA / RETENC. · **` BAJA`** (813,176,114,22; el nombre lleva espacio adelante) · OTROS DATOS · PLANTA TEMPORARIA

## Pestaña BAJA

| Control | Rol JAB | Nombre | Bounds |
|---|---|---|---|
| Fecha de baja | text | `FECHA DE BAJA` | (278,281,93,27) — formato `dd/mm/aaaa`, viene precargada con la fecha del día |
| Calendario | push button | `CALENDARIO` | (378,281,26,27) |
| Acto de baja | text | `ACTO DE BAJA` | (278,321,426,27) |
| Lista de actos (LOV) | push button | `...` | (710,321,26,27) |
| Ver acto | push button | `VER` | (746,321,26,27) — deshabilitado hasta que haya acto |
| Motivo de baja | text | `MOTIVO DE BAJA` (el nombre JAB viene ensuciado: ` BAJA tab page  BAJA tab page MOTIVO DE BAJA`; usar la descripción) | (278,361,426,27) |
| Lista de motivos (LOV) | push button | `...` | (710,361,26,27) |
| Traslado con cargo | check box | `Traslado Con Cargo` | (306,458,126,20) — deshabilitado |
| Organismo | text | `ORGANISMO` | (306,518,398,27) — deshabilitado (se habilita con traslado) |
| Lista de organismos | push button | `...` | (710,518,26,27) |

Leyenda en pantalla: *"Las Bajas Definitivas deben tener previamente una baja preventiva cargada, excepto Fin designación de los Temporario y las Funciones Limitadas."*

Los tres botones `...` tienen el mismo nombre: distinguirlos por la Y (321 acto, 361 motivo, 518 organismo).

## Barra de herramientas (y=51)

`Guardar` (4) · `Imprimir` (28) · `Agregar` (59) · `Save` (83) · `Enter Query` (113) · `Re Query` (137) · `cancel` (161) · `Up` (192) · `Down` (216) · `Acerca de` (295) · `Calcular diferencia entre Fechas` (319) · `Auditoria` (343) · `Enviar Solicitud al Administrador` (371) · `Salir` (400)

- `Auditoria` abre el frame interno `AUDITORIA` (grilla Operación / Usuario / Fecha + botón `CERRAR` (1162,658)).

## LOVs (las dos tienen la misma forma)

Frame interno modal (`Motivos de Baja` en (227,119,473,339) / `Acto de Baja` en (187,119,473,339)):
- `text` ` Buscar` (nombre con espacio adelante), viene con `%` (comodín estilo SQL LIKE).
- `list` (manages descendants). **Carga perezosa**: solo trae ~11 ítems reales, el resto
  llega como `.....` hasta que se scrollea. Para el robot: escribir el texto en `Buscar`
  (ej. `%FALLECIMIENTO%`) + botón `Buscar`, en vez de recorrer la lista.
- Botones: `Buscar ALT B` · `Aceptar ALT A` · `Cancelar ALT C` (y=423; atajos Alt+B/A/C).
- Elegir un ítem + Aceptar copia el texto al campo (ej. MOTIVO DE BAJA = `BAJA BECA`).

### Motivos de Baja (ítem = `Motivo de Reserva:<MOTIVO>\tObservación:<tipo>`)

Vistos (primeros 11, orden alfabético):
| Motivo | Observación |
|---|---|
| ABANDONO DE CARGO | Baja Definitiva |
| BAJA BECA | Modificación del Cargo |
| CESANTE | Baja Definitiva |
| CESE EN LA FUNCION SIN ESTABILIDAD | Baja Definitiva |
| EXONERACION | Baja Definitiva |
| FALLECIMIENTO | Baja Definitiva |
| FIN DESIGNACION PERMANENTE | Baja Definitiva |
| FUNCION LIMITADA | Baja Definitiva |
| FUNCION LIMITADA POR CESE | Baja Definitiva |
| FUNCION LIMITADA POR RENUNCIA | Baja Definitiva |
| INCAPACIDAD LABORAL | Baja Definitiva |
| JUBILACION | Baja Definitiva |
| LIMITACION REGIMEN MODULAR | Modificación del Cargo |
| MODIFICACION PRESUPUESTARIA | Modificación del Cargo |
| NUEVA ESTRUCTURA | Modificación del Cargo |
| PLANTELES BASICOS | Modificación del Cargo |
| PRESCINDIBILIDAD | Baja Definitiva |
| RECATEGORIZACION | Modificación del Cargo |
| RECONOCIMIENTO DE SERVICIOS | Modificación del Cargo |
| REG.HORARIO 40 | Modificación del Cargo |
| REG.HORARIO 48 | Modificación del Cargo |
| REINTEGRO | Modificación del Cargo |
| RENUNCIA AL CARGO | Baja Definitiva |
| RETIRO ABSOLUTO | Baja Definitiva |
| RETIRO OBLIGATORIO | Baja Definitiva |
| RETIRO VOLUNTARIO | Baja Definitiva |
| REUBICACION | Modificación del Cargo |
| TRASLADO (A OTRA JURISDICCION) | Baja Definitiva |
| TRASLADO INTERNO | Modificación del Cargo |

Lista completa: 29 motivos (leída en vivo 05/10/2026 scrolleando la LOV).

=> El tipo preventiva/definitiva viene dado por el **motivo** (columna Observación).

### Acto de Baja (ítem = `Número:<nro>\tActo:<tipo> <nro>/<año>\tFecha:<dd/mm/aa>`)

Lista los **actos administrativos ya cargados en SIAPE** (expedientes electrónicos GDEBA,
expedientes en papel). Ej.: `Número: 10289945-GDEBA-DPTEYPBMSALGP  Acto:EXPEDIENTE ELECTRONICO-2026- 10289945-GDEBA-DPTEYPBMSALGP  Fecha:14/05/26`.
El acto tiene que existir antes de dar la baja (se buscaría por número con `%<nro>%`).
Hay ítems con número basura (`,,,,,,`, tabs) cargados a mano.

## Pendiente de mapear

- Resto de la lista de motivos (scrollear la LOV), en especial los de "Baja Preventiva".
- Dónde se da de alta un ACTO (¿menú Documentos Administrativos?).
- Qué pasa al guardar (diálogos de confirmación / error).

## Flujo real de la baja (confirmado en vivo 05/10/2026)

1. Menú **Cargos → Administración** (`Administración nemotécnico A`) abre `Cargos y Carrera Administrativa`
   (el nombre del frame trae decenas de espacios al final; detectarlo por el botón `Ingresar como Supervisor`).
2. **BUSCAR** de la cabecera abre el internal frame **`Buscador de Personas`**: radios `Apellido y Nombre` /
   `Documento`, campos de documento (tipo · `...` · número), `BUSCAR`, grilla APELLIDO Y NOMBRE | LEGAJO | TIPO |
   NRO. DOCUMENTO | CUIT - CUIL | ROL | ORGANISMO y `ACEPTAR`. Se busca por **Documento** (DNI); no por legajo.
3. Pestaña CARGOS: **doble click en el cargo actual (fila amarilla)** = la fila con DESDE y HASTA vacío. Cada
   celda trae la columna en `description` (LEY, DESDE, HASTA, ACTO…). El doble click deja la pestaña BAJA al frente.
4. **Ingresar como Supervisor** (botón azul "SE", (1164,122)): no abre ventana; habilita la edición — FECHA DE
   BAJA / ACTO / MOTIVO pasan a estado JAB `editable`. Sin esto, escribir da "Información: No puede escribir.".
   La acción JAB (`el.click()`) NO lo aprieta: hace falta click real de mouse.
5. FECHA DE BAJA + MOTIVO (LOV) → Guardar → cambiar MOTIVO al definitivo → Guardar.

Notas JAB: el `name` de un campo enfocado viene ensuciado (` BAJA tab page FECHA DE BAJA`): buscar por
`description`. `F._jab_buscar` se corta por tiempo en esta pantalla (grilla de cientos de celdas); el walker de
`siape_observador_jab.recorrer` (solo visibles) la lee en ~5 s.

## Primera baja real (06/10/2026, xxxxxxx, DNI xxxxxxx)

- Preventiva: FECHA 31/08/2026 + MOTIVO `BAJA BECA` → Guardar → "Informacion Se han Guardado los cambios."
- **Guardar saca del modo Supervisor**: los campos dejan de ser editables y la LOV responde "No puede
  escribir". Antes del segundo guardado hay que volver a apretar Supervisor.
- Definitiva: MOTIVO `FIN DESIGNACION` → Guardar → "Se han Guardado los cambios."
- **La lista de motivos depende del cargo.** En un becario NO existe `FIN DESIGNACION PERMANENTE` (esa es la
  de planta); aparecen `FIN DESIGNACION`, `LIMITACION DE DESIGNACION TEMPORARIA`, `CAMBIO DE AUTORIDAD`…
  Residente que termina → `FIN DESIGNACION` (decisión del usuario).
- Si el filtro `%motivo%` deja una sola fila, SiAPe la elige y cierra la LOV solo.
- Supervisor: el click justo después del doble click a veces no toma; se reintenta verificando `editable`.
