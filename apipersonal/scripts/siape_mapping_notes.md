# Mapeo SIAPE - carga de francos/licencias

Fecha de mapeo: 2026-08-20

## Entorno

- Ventana principal: `Sistema Unico Provincial de Administracion de Personal`
- Java Access Bridge: habilitado y funcionando.
- SIAPE reporta coordenadas logicas de 1280 px de ancho, mientras la captura fisica es 1920 px.
- Factor observado para pasar de coordenada JAB a pantalla fisica: `1.5`.
- Click fisico aproximado: `(x + width / 2) * 1.5`, `(y + height / 2) * 1.5`.

## Archivos generados

- `siape_map_novedades_horario.json/txt`
- `siape_map_novedades_ausencias.json/txt`
- `siape_map_ausencias_eventuales.json/txt`
- `siape_map_tipo_ausencia_dropdown.json/txt`
- `siape_map_licencias_permisos.json/txt`
- `siape_map_tipo_licencia_selector.json/txt`
- `siape_map_exportaciones_consultas.json/txt`
- `siape_exportaciones_live_cells.json`
- `siape_exportaciones_gestor_jab.png`
- `siape_map_exportaciones_exportar_dialog.json/txt`
- `siape_exportaciones_exportar_dialog_jab.png`
- `siape_map_exportaciones_periodo_calendario.json/txt`
- `siape_exportaciones_periodo_calendario_jab.png`
- `siape_map_personas_administracion.json/txt`
- `siape_personas_administracion_jab.png`
- `siape_personas_administracion_*_controls.json`
- `siape_personas_administracion_*.png`
- `siape_personas_administracion_tabs_summary.json`
- Capturas `siape_*_screen.png`

## Navegacion principal

- Pantalla inicial de modulos:
  - Boton `RRHH`, accion JAB disponible.
- Menu RRHH / Novedades:
  - `Novedades de Ausentismo nemotécnico N`, accion JAB disponible.
  - `Ausencias Eventuales nemotécnico A`, accion JAB disponible.
  - `Licencias y Permisos nemotécnico L`, accion JAB disponible.

## Barra SIAPE

- `Guardar`: `(4,51,24,24)`, accion JAB.
- `Imprimir`: `(28,51,24,24)`, accion JAB.
- `Agregar`: `(59,51,24,24)`, accion JAB, pero en `Novedades de Ausentismo` aparece sin estado `activado` y no produjo cambios al probarlo.
- `cancel`: `(161,51,24,24)`, accion JAB.
- `Salir`: `(400,51,24,24)`, accion JAB.

## Novedades de Ausentismo

- Frame interno: `Novedades de Ausentismo`.
- Pestañas:
  - `Horario`: `(330,433,59,22)`.
  - `Licencias`: `(386,433,71,22)`.
  - `Comisiones`: `(454,433,86,22)`.
  - `Ausencias`: `(537,433,76,22)`.
  - `Permisos`: `(610,433,72,22)`.
  - `Carpetas`: `(679,433,69,22)`.
- La pestaña `Ausencias` muestra un historial/listado de ausencias por agente, no parece ser el alta principal.
- En esa pantalla el boton `Agregar` no estaba activado.

## Novedades de Ausentismo - Ficheros / busqueda de persona

Ruta usada: menu `Novedades de Ausentismo nemotécnico N`.

Pantalla previa de busqueda:

- Frame interno: `Ficheros`, bounds `(0,79,1006,624)`.
- Campo `APELLIDO Y NOMBRE`: `(158,135,426,27)`, editable.
- Boton `FILTRAR`: `(618,135,120,27)`, accion JAB.
- Campo `DESTINO`: `(158,178,400,26)`, editable.
- Boton selector de destino `...`: `(559,178,27,26)`, accion JAB.
- Boton `HISTORICOS`: `(616,178,120,26)`, accion JAB.
- Check `SOLO CONSULTA`: `(158,216,113,19)`, accion JAB.
- Grilla:
  - Columna seleccion/marca: primera fila `(15,276,16,27)`.
  - Columna `LEGAJO Necesario`: primera fila `(32,276,64,27)`.
  - Columna `APELLIDO Y NOMBRE`: primera fila `(99,275,248,27)`.
  - Columna `DESTINO`: primera fila `(351,275,107,27)`.
  - Columna `ESTRUCTURA`: primera fila `(458,275,506,27)`.
- Botones inferiores:
  - `SOLICITUDES Alt B`: `(599,655,120,27)`, accion JAB.
  - `JUSTIFICACION Alt B`: `(732,655,120,27)`, accion JAB.
  - `NOVEDADES Alt N`: `(868,655,120,27)`, accion JAB.

Prueba de busqueda sin guardar:

- Escribir `RIBEIRO` en `APELLIDO Y NOMBRE` y presionar `FILTRAR` devuelve una fila seleccionada.
- Desde esa fila, `NOVEDADES` abre el frame del agente con `APELLIDO y NOMBRE`, `LEGAJO` y pestañas de novedades.

## Novedades de Ausentismo - agente seleccionado

Se llega desde `Ficheros` con una fila seleccionada y boton `NOVEDADES`.

Encabezado:

- Frame interno: `Novedades de Ausentismo`, bounds `(0,79,1006,624)`.
- Campo `APELLIDO y NOMBRE`: `(156,116,368,24)`, editable.
- Boton selector de persona `...`: `(528,116,24,24)`, accion JAB.
- Campo `LEGAJO`: `(660,116,94,24)`, editable.
- Boton selector de legajo `...`: `(758,116,24,24)`, accion JAB.
- Check `FAMILIAR A CARGO`: `(930,117,17,20)`, accion JAB.

Pestañas del agente:

- `HORARIO`: `(10,510,73,22)`.
- `LICENCIAS`: `(80,510,81,22)`.
- `CARPETAS`: `(158,510,81,22)`.
- `AUSENCIAS Y PRESENTES`: `(236,510,89,22)`.
- `COMISIONES`: `(322,510,90,22)`.
- `x HORARIO`: `(409,510,81,22)`.
- `x EXPEDIENTE`: `(487,510,90,22)`.
- `SERVICIOS`: `(574,510,82,22)`.
- `COMPENSATORIOS`: `(653,510,89,22)`.
- `LACTANCIA`: `(739,510,83,22)`.
- `EXCEPTUADO`: `(819,510,90,22)`.
- `OBSERVACION`: `(906,510,90,22)`.

Pestaña `COMPENSATORIOS`:

- Combo `Tipo Ausencia por Hora`: `(52,197,189,24)`, accion JAB.
- Valor observado del combo: `HORA COMPENSADA`.
- Campo `Fecha Novedad`: `(249,197,93,24)`, editable.
- Boton `CALENDARIO`: `(344,195,24,24)`, accion JAB.
- Campo `Cant. Horas`: `(373,197,56,24)`, editable.
- Grilla izquierda `Ingresar Dias y Horario a Compensar`:
  - `Fecha`: primera fila `(72,266,93,24)`, editable.
  - `Hora Desde`: primera fila `(192,267,93,24)`, editable.
  - `Hora Hasta`: primera fila `(285,267,93,24)`, editable.
- Grillas derechas de consulta:
  - `Tipo Ausencia por Hora`: primera fila `(509,202,252,24)`.
  - `Fecha`: primera fila `(764,202,93,24)`.
  - `Cant. Horas`: primera fila `(860,202,53,24)`.
  - Segunda grilla: `Fecha` `(573,343,93,24)`, `Hora Desde` `(666,343,94,24)`, `Hora Hasta` `(761,343,93,24)`.
- Botones inferiores:
  - `Ver Ficha Alt F`: `(590,650,120,26)`, accion JAB.
  - `Volver a Bandeja Alt B`: `(723,650,120,26)`, accion JAB.
  - `Volver a Ficheros Alt V`: `(856,650,120,26)`, accion JAB.

Pestaña `LACTANCIA`:

- Seleccionada por JAB con `page tab list.select("LACTANCIA")`.
- Combo `Licencia-Permiso`: `(42,209,264,24)`, accion JAB.
- Check `JUSTIFICADO.`: `(325,212,92,20)`, accion JAB.
- Grilla de periodos:
  - `Año`: primera fila `(48,289,56,24)`, editable.
  - `Desde`: primera fila `(112,289,89,24)`, editable.
  - Boton `CALENDARIO` desde: `(206,289,24,24)`, accion JAB.
  - `Hasta`: primera fila `(238,289,90,24)`, editable.
  - Boton `CALENDARIO` hasta: `(333,289,24,24)`, accion JAB.
- Filas visibles siguientes:
  - Segunda fila: `Año` `(48,313,56,24)`, `Desde` `(112,313,89,24)`, `Hasta` `(238,313,90,24)`.
  - Tercera fila: `Año` `(48,337,56,24)`, `Desde` `(112,337,89,24)`, `Hasta` `(238,337,90,24)`.
  - Cuarta fila: `Año` `(48,361,56,24)`, `Desde` `(112,361,89,24)`, `Hasta` `(238,361,90,24)`.
- Botones inferiores compartidos:
  - `Ver Ficha Alt F`: `(590,650,120,26)`, accion JAB.
  - `Volver a Bandeja Alt B`: `(723,650,120,26)`, accion JAB.
  - `Volver a Ficheros Alt V`: `(856,650,120,26)`, accion JAB.

## Ausencias Eventuales

Ruta usada: menu `Ausencias Eventuales nemotécnico A`.

Controles principales:

- Frame interno: `Ausencias Eventuales`, bounds `(0,79,819,577)`.
- Campo `FECHA`: `(586,130,93,26)`, editable.
- Boton `CALENDARIO`: `(682,130,26,26)`, accion JAB.
- Columna editable de marca por fila: `(56,190,27,26)` y siguientes.
- Columna `LEGAJO Necesario`: `(96,190,80,26)` y siguientes.
- Columna `APELLIDO Y NOMBRE`: `(176,190,240,26)` y siguientes.
- Combo `TIPO DE AUSENCIA`: `(416,190,320,26)` y siguientes, accion JAB.
- Campo `BUSCAR AGENTE`: `(155,610,147,26)`, editable.
- Boton `BUSCAR Alt B`: `(315,610,120,26)`, accion JAB.
- Boton `ENVIAR AUSENCIAS Alt E`: `(556,610,200,24)`, accion JAB.

Combo `TIPO DE AUSENCIA`:

- Al abrir la primera fila, el desplegable visible publico una `list` en `(416,64,305,150)`.
- El type-ahead `FRANCO` llevo a `FRANCO (OPNYA)`.
- No se observo `FRANCO COMPENSATORIO (COMUNICACIONES)` en este combo durante el mapeo.

## Licencias y Permisos

Ruta usada: menu `Licencias y Permisos nemotécnico L`.

Controles principales visibles:

- Frame interno: `Licencias y Permisos`, bounds aproximados `(0,79,975,592)`.
- Campo `Fecha`: `(142,172,86,27)`, editable.
- Boton `CALENDARIO`: `(236,172,27,27)`, accion JAB.
- Campo `Apellido y Nombre`: `(506,172,213,27)`, editable.
- Boton `BUSCAR`: `(770,171,133,29)`, accion JAB.
- Columna `Legajo Necesario`: primera fila visible `(119,254,80,24)`.
- Columna `Apellido y Nombre`: primera fila visible `(203,254,272,24)`.
- Campo `Tipo de Licencia`: primera fila visible `(479,254,304,24)`, editable.
- Boton selector `...`: primera fila visible `(787,255,24,24)`, accion JAB.
- Boton `ENVIAR Alt E`: `(770,614,120,26)`, accion JAB.

Dialogo selector de licencia abierto desde `...`:

- Frame modal sin titulo: `(0,79,606,339)`.
- Campo `Buscar`: `(47,125,551,22)`, editable.
- Lista de resultados: `(10,159,572,212)`.
- Boton `Buscar ALT B`: `(203,383,59,27)`, accion JAB.
- Boton `Aceptar ALT A`: `(305,383,65,27)`, accion JAB.
- Boton `Cancelar ALT C`: `(375,383,65,27)`, accion JAB.
- Busqueda `%FRANCO%`: no devolvio resultados visibles.

## Exportaciones - Consultas a Exportar

Ruta usada: menu superior `Exportaciones ALT E` -> `Consultas a Exportar nemotécnico C`.

Pantalla:

- Frame interno: `Gestor de Exportaciones`, bounds `(0,79,1453,824)`.
- Grupo superior `BUSCAR CONSULTA`:
  - Organismo/Jurisdiccion visible: `MINISTERIO DE SALUD`.
  - Campo de busqueda de consulta: texto editable ancho debajo del grupo, usado para filtrar consultas.
  - Boton selector `...` junto al organismo.
- Panel derecho `BUSCAR COLUMNA`:
  - Campo de texto de busqueda de columna.
  - Lista de columnas/parametros de la consulta seleccionada.
- Grilla principal:
  - `NRO. DE CONSULTA`: primera fila `(16,260,40,25)`.
  - `NOMBRE DE LA CONSULTA`: primera fila `(56,260,347,25)`.
  - `TIPO DE CONSULTA`: primera fila `(403,260,93,25)`.
  - `ULTIMA EXPORTACIÓN`: primera fila `(496,260,127,25)`.
  - `ACCESOS`: primera fila `(623,260,40,25)`.
  - Boton/icono `Exportar`: primera fila `(664,260,27,25)`, accion JAB.
  - Scroll vertical de grilla: `(1037,316,23,508)` en captura JAB / `(692,263,19,442)` en coordenadas del nodo.
- Panel inferior:
  - `DESCRIPCION DE LA CONSULTA Varias Líneas`: `(18,795,675,82)`.
  - `EXCEPCIONES Varias Líneas`: `(738,795,675,82)`.

Consultas visibles:

| Nro | Nombre | Tipo | Ultima exportacion | Accesos |
| --- | --- | --- | --- | --- |
| 123 | Examenes Médicos Salud | Nominada | 20/08/2026 13:31 | 7 |
| 76 | Horario Administrativo a un dia | Nominada | 09/08/2026 14:58 | 7 |
| 71 | Horario Administrativo Consolidado de los Agentes | Nominada | 09/08/2026 14:58 | 5 |
| 82 | Horario Guardia Salud a un dia | Nominada | 05/01/2026 10:43 | 4 |
| 77 | Novedades Pendientes de Autorización | Nominada | 19/08/2026 10:52 | 30 |
| 4 | Novedades Por Periodo | Nominada | 20/08/2026 13:33 | 58 |
| 79 | Novedades Rechazadas | Nominada | 02/07/2026 09:19 | 10 |
| 1 | Plantel Nominado | Nominada | 20/04/2026 10:14 | 7 |

Consulta seleccionada durante el mapeo: `123 - Examenes Médicos Salud`.

- Descripcion: `Examenes Médicos para Mrio de Salud. Se exportan todos los examenes médicos, independientemente cual sea su estado y resolución.`
- Columnas/parametros visibles en el panel derecho:
  - `ORGANISMO`: Organismo / Jurisdicción.
  - `APELLIDO`: Apellido de la Persona.
  - `NOMBRE`: Nombre de la Persona.
  - `TIPO DE DOCUMENTO`: Tipo de Documento de la Persona.
  - `NÚMERO DE DOCUMENTO`: Número de Documento de la Persona.
  - `CUIT/CUIL/CDI`: Cuit/Cuil/Cdi de la Persona.
  - `CÓDIGO EXÁMEN`: Código de Exámen Médico.
  - `FECHA DEL EXAMEN`: Fecha del Examen.
  - `TIPO DE EXÁMEN`: Tipo de Exámen Médico.
  - `MODALIDAD EXÁMEN MÉDICO`: Modalidad: Digital o Presencial.

Nota operativa:

- No se presiono ningun boton `Exportar`; solo se leyo el arbol JAB y se tomo captura JAB del frame.
- Las primeras 8 filas tienen boton `Exportar` activado; las filas vacias siguientes muestran el boton sin estado `activado`.

### Exportaciones - boton `Exportar` / pedido de periodo

Prueba segura realizada sobre la fila seleccionada `123 - Examenes Médicos Salud`.

- Boton/icono `Exportar` de la primera fila: `(664,260,27,25)`, accion JAB.
- Al presionarlo abre un modal interno:
  - Frame: `PERIODO`, bounds `(267,186,435,313)`, estados `activo, modal`.
  - Campo `Fecha Desde`: `(447,271,87,27)`, editable.
  - Boton `CALENDARIO` para `Fecha Desde`: `(539,271,27,27)`, accion JAB.
  - Campo `Fecha Hasta`: `(447,325,87,26)`, editable.
  - Boton `CALENDARIO` para `Fecha Hasta`: `(539,325,27,26)`, accion JAB.
  - Boton `ACEPTAR Alt A`: `(370,439,120,27)`, accion JAB.
  - Boton `CANCELAR Alt A`: `(503,439,120,27)`, accion JAB.
- No se presiono `ACEPTAR`; se cerro con `CANCELAR Alt A`.

Calendario abierto desde `Fecha Desde`:

- Frame: `Calendario`, bounds `(133,212,199,224)`, estados `activo, modal, redimensionable`.
- Valor visible: `20-08-2026`.
- Mes/anio visible: `Agosto     2026`.
- Botones:
  - `Previous Month`: `(137,236,27,26)`, accion JAB.
  - `Next Month`: `(161,236,27,26)`, accion JAB.
  - `Previous Year`: `(277,236,27,26)`, accion JAB.
  - `Next Year`: `(303,236,26,26)`, accion JAB.
  - `OK`: `(203,402,26,27)`, accion JAB.
  - `Cancel`: `(233,402,27,27)`, accion JAB.
- Grilla visible de dias:
  - Primera fila visible: `27, 28, 29, 30, 31, 1, 2`.
  - Filas de agosto visibles: `3-9`, `10-16`, `17-23`, `24-30`.
  - Ultima fila visible: `31, 1, 2, 3, 4, 5, 6`.
- No se presiono `OK`; se cerro con `Cancel`.

## Personas - Administración

Ruta usada: menu superior `Personas ALT P` -> `Administración nemotécnico A`.

Pantalla:

- Frame interno: `Administración de Personas`, bounds `(0,79,1005,593)`.
- Busqueda superior:
  - `APELLIDO`: `(34,146,314,27)`.
  - `NOMBRE`: `(355,146,251,27)`.
  - `CUIL-CUIT-CDI`: `(614,146,106,27)`.
  - Check `Editar`: `(750,149,46,20)`, accion JAB.
  - Boton `BUSCAR`: `(840,146,120,27)`, accion JAB.
- Pestañas visibles:
  - `DATOS PERSONALES`: `(14,199,155,23)`.
  - `DOMICILIOS - CONTACTOS`: `(166,199,183,23)`.
  - `FAMILIARES`: `(346,199,121,23)`.
  - `ESTUDIOS`: `(464,199,121,23)`.
  - `CAPACITACIONES`: `(582,199,131,23)`.
  - `RELACION LABORAL`: `(710,199,147,23)`.
  - `LEGAJO DIGITAL`: `(854,199,121,23)`.
  - `CBU`: existe en el arbol JAB pero aparece fuera de bounds visibles `(-1,-1,-1,-1)`.

Pestaña `DATOS PERSONALES`:

- `NACIMIENTO`: `(130,249,87,27)`, calendario `(218,249,27,27)`.
- Combo `SEXO`: `(130,285,156,27)`.
- `GENERO`: `(130,321,124,27)`, selector `...` `(257,321,27,27)`.
- `ESTADO CIVIL`: `(130,357,124,27)`, selector `...` `(257,357,27,27)`.
- `CASAMIENTO`: `(130,396,94,26)`, calendario `(228,396,26,26)`.
- `NACIONALIDAD`: `(130,433,124,27)`, selector `...` `(257,433,27,27)`.
- Check `Naturalizado`: `(130,468,16,21)`.
- Lugar de nacimiento:
  - `PROVINCIA`: `(141,525,227,27)`, selector `...` `(372,525,26,27)`.
  - `LOCALIDAD`: `(141,564,227,26)`, selector `...` `(372,565,26,27)`.
  - `LUGAR NAC. EXTRANJERO`: `(141,597,260,27)`.
- Datos derecha:
  - `ORGANISMO`: `(556,525,366,27)`, selector `...` `(929,525,27,27)`.
  - `OBSERVACION Varias Líneas`: `(558,558,381,76)`.
- Grilla documentos:
  - `TIPO`: primera fila `(522,274,60,27)`, selector `...` `(586,274,27,27)`.
  - `NUMERO`: primera fila `(616,274,98,27)`.
  - `DESDE`: primera fila `(716,274,86,27)`, calendario `(804,274,26,27)`.
  - `HASTA`: primera fila `(833,274,87,27)`, calendario `(921,274,27,27)`.
- Grilla cambios/legajo:
  - `NUMERO`: primera fila `(504,417,66,27)`.
  - `DESDE`: primera fila `(572,417,74,27)`, calendario `(648,417,26,27)`.
  - `HASTA`: primera fila `(676,417,74,27)`, calendario `(753,417,27,27)`.
  - Combo `MOTIVO CAMBIO`: primera fila `(781,417,168,27)`.
  - Botones `AGREGAR` `(306,433,67,27)` y `ELIMINAR` `(397,433,67,27)` visibles pero sin estado `activado`.

Pestaña `DOMICILIOS - CONTACTOS`:

- `CALLE`: `(112,290,309,27)`.
- `NUMERO`: `(112,330,101,27)`.
- `TORRE`: `(274,330,46,27)`.
- `PISO`: `(373,330,47,27)`.
- `DEPTO`: `(112,370,30,27)`.
- `MANZ.`: `(188,370,30,27)`.
- `Declarado el`: `(305,369,87,27)`, calendario `(393,369,27,27)`.
- `PROVINCIA`: `(112,410,280,27)`, selector `...` `(393,410,27,27)`.
- `LOCALIDAD`: `(112,450,280,27)`.
- `OBSERVACIONES Varias Líneas`: `(44,512,355,56)`.
- Check `Preferente`: `(482,305,17,20)`.
- Contacto: `TIPO` `(521,302,133,27)`, `DETALLE` `(685,302,240,27)`.
- Boton `Otros Domicilios`: `(473,549,200,33)`, accion JAB.

Pestaña `FAMILIARES`:

- Grilla primera fila:
  - `Parentesco`: `(26,260,82,24)`, selector `...` `(112,260,24,24)`.
  - `Apellido`: `(138,260,147,24)`.
  - `Nombre`: `(288,260,146,24)`.
  - `Documento`: `(437,260,33,24)`.
  - `Fec.Nacimiento`: `(590,260,80,24)`, calendario `(674,260,24,24)`.
  - Combo `Sexo`: `(701,260,67,24)`.
  - Checks `EP` `(788,259,13,20)` y `Vive` `(817,258,13,20)`.
  - `Fec. Defunción`: `(842,260,80,24)`.

Pestaña `ESTUDIOS`:

- Grilla de estudios:
  - Combo `NIVEL`: primera fila `(36,282,106,27)`.
  - `TITULO`: primera fila `(144,282,272,27)`.
  - `ESTABLECIMIENTO EDUCATIVO`: primera fila `(418,282,368,27)`, selector `...` `(790,282,27,27)`.
  - Combo `ESTADO`: primera fila `(818,282,99,27)`.
  - Boton `VER`: primera fila `(918,282,27,27)`.
- Detalle inferior:
  - `FECHA INICIO`: `(112,584,86,26)`, calendario `(202,584,27,26)`.
  - `FECHA EGRESO`: `(330,584,87,26)`, calendario `(421,584,27,26)`.
  - `MATRICULA`: `(524,584,89,26)`.
  - `MAT.APROB.`: `(690,584,40,26)`.
  - `TOT.MAT.`: `(794,584,40,26)`.
  - `PROMEDIO`: `(906,584,40,26)`.

Pestaña `CAPACITACIONES`:

- Actividad:
  - `Denominación de la Actividad`: `(42,270,403,24)`, selector `...` `(446,270,24,24)`.
  - `Tipo Actividad`: `(472,270,194,24)`.
  - `Area Estudio`: `(668,270,164,24)`.
  - Combo `Estado`: `(834,270,106,24)`.
  - Boton `VER`: `(942,269,24,24)`.
- Detalle de actividad:
  - `Establecimiento`: `(121,372,373,22)`.
  - `Total Hs.`: `(556,372,38,21)`.
  - `Fec.Desde`: `(666,372,87,22)`, calendario `(758,372,24,22)`.
  - `Fec.Hasta`: `(845,372,77,24)`.
- Habilidades/idiomas:
  - `Denominación de la Habilidad`: `(41,452,404,24)`.
  - `Area Habilidad`: `(478,452,151,24)`.
  - `Desempeño`: `(802,452,126,24)`.
  - `Denominación del Idioma`: `(41,560,404,24)`.
  - `Nivel Oral`: `(478,560,151,24)`.
  - `Nivel Escritura`: `(660,560,136,24)`.

Pestaña `RELACION LABORAL`:

- Botones:
  - `Cargos y Carrera Administrativa`: `(54,277,200,33)`.
  - `Contratos y Convenios`: `(54,330,200,34)`.
  - `Puestos`: `(54,384,200,33)`.
  - `Datos Extranjero`: `(54,437,200,33)`.
  - `Salud`: `(54,490,200,34)`.
  - `ART`: `(281,277,200,33)`.
  - `Gremios`: `(281,330,200,34)`.
  - `Obras Sociales`: `(281,384,200,33)`.
  - `Antigüedad`: `(281,437,200,33)`.
  - `Tallas - Medidas`: `(281,490,200,34)`.
  - `Sanciones`: `(508,277,200,33)`.
  - `Sumarios`: `(508,330,200,34)`.
  - `Aptitud Psico-Física`: `(508,384,200,33)`.
  - `Menciones`: `(508,437,200,33)`.
  - `Defunción`: `(508,490,200,34)`.
  - `Situación de Revista`: `(734,277,200,33)`.
  - `Certificado de Trabajo`: `(734,330,200,34)`.
  - `DDJJ de Cargos y Actividades`: `(734,384,200,33)`.
  - `CURRICULUM VITAE`: `(734,437,200,33)`.
  - `Antecedentes Laborales`: `(734,490,200,34)`.

Pestaña `LEGAJO DIGITAL`:

- Combo `TIPO DE TRAMITE`: `(30,268,502,26)`.
- `DOCUMENTO`: `(46,332,431,26)`.
- Check `VALIDADO`: `(485,334,15,20)`.
- Boton grande `VER`: `(710,385,67,67)`.
- Boton `DESCARGAR TODOS`: `(317,601,160,29)`.
- Boton `VALIDAR`: `(650,601,100,29)`.
- Boton `DESCARGAR`: `(777,601,100,29)`.
- Boton `X`: `(940,601,29,29)`.

Nota operativa:

- Solo se seleccionaron pestañas y se leyo/capturo el arbol JAB.
- No se presionaron botones de alta, guardar, validar, descargar ni eliminar.

## Conclusiones operativas

- Para abrir RRHH y formularios, conviene usar JAB por nombre exacto de boton/menu.
- Para tabs y grillas, JAB da bounds confiables pero no siempre accion; usar bounds logicos con factor `1.5`.
- La ruta mas prometedora para francos de un dia es `Ausencias Eventuales`, usando:
  - fecha general,
  - busqueda/filtro de agente,
  - seleccion de fila,
  - combo `TIPO DE AUSENCIA`,
  - boton `ENVIAR AUSENCIAS`.
- El tipo exacto encontrado en ese combo fue `FRANCO (OPNYA)`. Hay que confirmar con el usuario si ese es el franco correcto o si debe usarse otro formulario/permiso para `FRANCO COMPENSATORIO (COMUNICACIONES)`.
