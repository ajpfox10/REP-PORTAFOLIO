# Mapa — Sistema Gestión de RRHH (Ministerio) · Designaciones

Relevado el 01/11/2026 sobre `https://sistemas.ms.gba.gov.ar/grh/` (versión 4.4.51), usuario Peveri,
HIGA Evita Catán. Base: manual "ManualDeUsuario-SistemaGestiónRRHH-Designaciones-22072026.pdf".

## Tecnología

- PHP **Symfony** server-rendered + jQuery 3.5.1 + Bootstrap 4.6 + select2 + SweetAlert2 + LoadingOverlay.
- Forms Symfony: nombres `designacion_pasoN[campo]`, con CSRF `designacion_pasoN[_token]` (hay que leerlo del HTML de cada paso).
- Sesión: se entra desde la Intranet (`/intranet/intranet.php` → Sistemas habilitados → "Gestion de Recursos Humanos"),
  que redirige a `/grh/?a2=...&a3=...` (SSO por query). Sin login propio.
- Wizard de 8 pasos, **cada paso se renderiza en el server** (en el DOM solo está el paso actual): para ver/llenar el paso N
  hay que guardar el N-1 con "Siguiente".

## Permisos del perfil

Menú completo: Registro de asistencia, Relojes, Personas, Vinculación, Plantillas, Planificación/Agentes, Días de guardia,
Designaciones. Con nuestro perfil **solo Designaciones** está habilitado (el resto redirige al inicio; `/grh/diasguardia/`
tira error SQL).

---

## 1. Historial de Designaciones — `GET /grh/designaciones/`

| Elemento | Tipo | name / id | Notas |
|---|---|---|---|
| Buscar | text | `q` | "Buscar por Nombre o DNI..." (form GET) |
| Estado | select | `estado` | Todos · Iniciada · Finalizada · Aceptada · Cancelada · Observada |
| Nueva Designación | link | `/grh/designaciones/nueva` | |

Columnas: DNI - Apellido y Nombre · FECHA · ESTADO · ACCIONES.

Acciones por fila (JS):
- **Descargar PDF**: `.btn-descarga-pdf` → `fetch(href)` y baja el blob (nombre en `Content-Disposition`).
- **Subir firmado** `abrirSubirArchivo(id, nombre)` → modal `#modalSubirArchivo`, form `#formSubirArchivo`,
  input file `archivo_firmado` (solo PDF, máx **2 MB**) → `POST` (FormData) a `subirArchivoUrl` con el id.
- **Ver observación** `verObservacion(id)` → `GET /grh/designaciones/{id}/observacion` → JSON `{observaciones, fecha}`
  (modal `#modalObservacion`, "Observación de Rechazo").
- **Eliminar** `confirmarEliminacion(id)` → Swal confirm → form `POST /grh/designaciones/{id}/eliminar`.

## 2. Buscar Persona — `GET /grh/designaciones/nueva`

| Campo | Tipo | name/id | Reglas |
|---|---|---|---|
| Número de Documento | text | `documento` | REQ, solo números, ≥ 7 dígitos |
| Sexo | select | `sexo` | REQ · `M` Masculino · `F` Femenino |

Flujo AJAX:
1. `POST /grh/designaciones/nueva` `{documento, sexo}` → JSON `{success, message, type, showTipoModal, redirect}`.
   Busca en la base del Ministerio y si no está valida contra RENAPER.
2. Modal "Seleccionar Tipo de Designación", select `#tipoDesignacionSelect` (REQ):
   - `1` Renovación de planta Temporaria Ley 10430
   - `2` Designación en Planta Temporaria
   - `3` Pase de Planta Temporaria a Planta Permanente
   - `4` Pase de Beca /Contrato a Planta Temporaria
   - `5` Pase de Beca a Planta Permanente (Acuerdo Paritario Actas N° 41 y 38/16)
   - `6` Designación en planta Permanente (Ley 13.559 Ex-Combatientes)
3. `POST /grh/designaciones/validar-tipo-designacion` `{tipo_designacion_id, documento}` → `{valid, message}`
   (si no coincide con la base de la Dirección Delegada: "Validación requerida").
4. Redirect `GET /grh/designaciones/formulario?documento=…&sexo=…&tipo_designacion=…`.

Sin parámetros, `/formulario` vuelve a la búsqueda con "Faltan datos requeridos para continuar".

## 3. Wizard (`/grh/designaciones/formulario`) — form `#designacionForm` (POST)

Pasos (iconos del stepper): 1 Datos personales · 2 DDJJ · 3 DDJJ Salud · 4 Experiencia laboral ·
5 Compatibilidad horaria (Ley 13.644) · 6 DDJJ Chofer (solo cargo Chofer) · 7 DDJJ Ley 14.783 (cupo) · 8 Generación/impresión (pasa a Finalizada, no se puede editar más).

### Paso 1 — Datos Personales y de Contacto (`designacion_paso1[...]`)

Ocultos: `designacion_paso1[_token]`, `documento`, `sexo`.

**I. Datos Personales y de Contacto**

| Campo | Tipo | name | Reglas |
|---|---|---|---|
| Apellidos | text | `apellido` | REQ, solo lectura (precargado), máx 50 |
| Nombres | text | `nombre` | REQ, RO, máx 50 |
| DNI | text | `nrodocumento` | REQ, RO, máx 8 |
| CUIL | text | `cuil` | REQ, RO, máx 11 |
| Fecha de Nacimiento | text (datepicker) | `fechanacimiento` | REQ, RO |
| Fecha de ingreso a Argentina | date | `fechaingresoarg` | solo extranjeros |
| Archivo PDF del DNI | file | `archivodni` | marcado * |
| Constancia carta de ciudadanía / vínculo | file | `archivodocextranjero` | extranjeros |
| Nacionalidad | select | `nacionalidad` | REQ · ARGENTINA, BOLIVIANA, BRASILEÑA, CHILENA, COLOMBIANA, ECUATORIANA, ESPAÑOLA, ITALIANA, MEXICANA, PARAGUAYA, PERUANA, PORTUGUESA, URUGUAYA, VENEZOLANA, OTRA |
| Estado Civil | select | `idestadocivil` | 1 SOLTERO · 2 CASADO · 3 VIUDO · 4 DIVORCIADO · 5 SEPARADO DE HECHO · 6 SEPARADO LEGAL · 7 CONVIVENCIA |
| Calle | text | `calleparticular` | máx 30 |
| Número | text | `nroparticular` | máx 10, solo dígitos |
| Piso | text | `pisoparticular` | máx 20 |
| Depto | text | `dptoparticular` | máx 10 |
| Provincia | text | `provincia` | RO (sale de `getprovincias`) |
| Localidad | select2 | `localidad` | valor = nombre de la localidad; AJAX `getLocalidades` |
| CP | text | `codigopostal` | RO, máx 7; AJAX `getCodigoPostal` |
| Teléfono | text | `telefono` | máx 10, solo dígitos |
| E-Mail | email | `email` | REQ, máx 120 |

AJAX del paso: `/grh/designaciones/getprovincias`, `/grh/designaciones/getLocalidades`, `/grh/designaciones/getCodigoPostal`.

**II. Estudios** (radios fuera del namespace Symfony)

| Campo | name | Valores |
|---|---|---|
| Secundario | `secundario_estado` | `completo` / `incompleto` |
| Título secundario | `titulo_secundario` | máx 50 |
| Universitario | `universitario_estado` | `completo` / `incompleto` |
| Título universitario | `titulo_universitario` | máx 50 |

**III. Cursos** (colección Symfony, botón `#btn-agregar-curso`, prototipo `__name__` → índice 0,1,2…)

`designacion_paso1[cursos][N][nombrecurso]` (máx 50) · `[fechadesde]` date · `[fechahasta]` date ·
`[institucion]` (máx 50) · `[canthoras]` number.

Botones: "Volver a búsqueda" · `#designacion_paso1_siguiente` (submit "Siguiente").

Al guardar: alerta verde "Datos del Paso 1 guardados correctamente" y se renderiza el paso 2 en la misma URL.

### Paso 2 — Declaración Jurada (`designacion_paso2[formulario2][...]`, form `#designacionFormPaso2`)

Cabecera de solo lectura "DATOS DEL/DE LA DECLARANTE" (nombre, DNI, CUIT, domicilio, email del paso 1).
Oculto: `designacion_paso2[_token]`. Las 17 preguntas son radios REQ con **`1` = Sí, `0` = No**
(ids `designacion_paso2_formulario2_f2pN_0` = Sí, `_1` = No).

| # | name | Pregunta (resumida) | Campo que se habilita con Sí |
|---|---|---|---|
| 1 | `f2p1` | Revista en planta permanente/transitoria o relación contractual vigente en la Adm. Pública (Nac./Prov./Mun.) | `descripcioncargo` textarea "Modalidad y situación de revista" (máx 500) |
| 2 | `f2p2` | Se compromete a mantener la no empleabilidad pública hasta ser notificado | — |
| 3 | `f2p3` | El cargo requiere matrícula en Colegio/Consejo profesional | `refEntidadCertificante` select (ver abajo) · `nromatricula` (máx 9) · `archivomatricula` file |
| 4 | `f2p4` | Parentesco hasta 2.º grado con Gobernador/a, Vice, Ministros… | — |
| 5 | `f2p5` | Cargo estatutario/superior o contrato en Nación/Prov./Mun./CABA o sociedad estatal | `cargodesempena` (máx 100) |
| 6 | `f2p6` | Solicitó reserva de cargo en el organismo de revista | `expedienterespaldo` "Número de Nota y/o expediente" (máx 100) |
| 7 | `f2p7` | En cumplimiento de condena por delito | — |
| 8 | `f2p8` | Proceso penal pendiente / condenado / procesamiento firme (art. 294 CPPN) | file `archivo_ecp` "Constancia de Estado de la Causa Penal" (fuera del namespace) |
| 9 | `f2p9` | Inhabilitación administrativa o judicial para cargos públicos | — |
| 10 | `f2p10` | Obtuvo Retiro Voluntario (Nac./Prov./Mun.) | `fretirovoluntario` date · file `archivo_arv` "Acto Administrativo de Retiro Voluntario" |
| 11 | `f2p11` | Propietario/dirige/asesora a concesionario o proveedor del Estado | — |
| 12 | `f2p12` | Gestiona concesiones/adjudicaciones en la Adm. Pública | — |
| 13 | `f2p13` | Proveedor del organismo donde trabajará | — |
| 14 | `f2p14` | Relaciones contractuales con entidades fiscalizadas por el organismo | — |
| 15 | `f2p15` | Patrocinante/apoderado de terceros en trámites vinculados a sus funciones | — |
| 16 | `f2p16` | Ejerce abogacía/procuración contra la Provincia | — |
| 17 | `f2p17` | Deudor alimentario moroso | — |

**Comportamiento condicional verificado** (marcando Sí una por una):
- Los campos extra están siempre en el DOM, ocultos; con Sí se muestran.
- p1 Sí → `descripcioncargo`. p3 Sí → `refEntidadCertificante` + `nromatricula` + `archivomatricula`.
  p5 Sí → `cargodesempena` y **habilita la p6** (con p5 = No la p6 queda `disabled` y no se envía).
  p6 Sí → `expedienterespaldo` (arranca `disabled`). p8 Sí → `archivo_ecp`. p10 Sí → `fretirovoluntario` + `archivo_arv`.
- Resto (2, 4, 7, 9, 11–17): sin campos extra.
- Caso "todo No": se envían 16 radios en `0` (p6 no viaja).

`refEntidadCertificante`: 1 Col. Abogados · 2 Anestesiólogos · 3 Arquitectos · 4 Asistentes Sociales · 5 Bioquímicos ·
6 Escribanos · 7 Farmacéuticos · 8 Fonoaudiólogos · 9 Ingenieros · 10 Ing. Agrónomos y Forestales · 11 Kinesiólogos ·
12 Martilleros · 13 **Médicos** · 14 Nutricionistas · 15 Obstetricia · 16 Odontólogos · 17 Ópticos · 18 Psicólogos ·
19 Sociólogos · 20 Trabajadores Sociales · 21 Traductores · 22 Veterinarios · 23 Cons. Agrimensura · 24 Cons. Cs. Económicas ·
25 Cons. Cs. Informáticas · 26 Cons. Cs. Naturales · 27 Cons. Química · 28 Federación Odontológica · 29 **SIN COLEGIACION** ·
30 OTRO · 31 Cons. Higiene y Seguridad en el Trabajo.

Botones: `designacion_paso2[anterior]` (submit "Anterior") · `designacion_paso2[siguiente]` (submit "Siguiente").
Ojo: "Anterior" también es submit → el server distingue por el nombre del botón.

### Paso 3 — DDJJ Condiciones de Salud (`designacion_paso3[salud][...]`, form `#designacionForm`)

Ocultos: `documento`, `sexo`, `paso`, `designacion_paso3[_token]`. Todos los checks son `value=1` (sin marcar = no viaja).
Los checks "Otras"/"¿Fumó?" etc. **sin name** (`#xx_checkbox`) son solo de UI: muestran el campo de texto asociado.
Para el agente masculino se ven **también** los ginecológicos (no filtra por sexo).

| Sección | Campos (name → etiqueta) | Checks de UI → campos que muestran |
|---|---|---|
| Datos clínicos | `DCpeso` (máx 6) · `DCaltura` metros (máx 4) | — |
| Alt. visuales | `AVMiopia` · `AVAstigmatismo` · `AVPresionocular` | `#av_otras_checkbox` → `AVOtras` (200) |
| Alt. auditivas | `AAZumbidos` · `AASordera` · `AAOtitis` · `AADisminucion` · `AAAudifonos` | `#aa_otras_checkbox` → `AAOtras` (200) |
| Ant. quirúrgicos | — | `#cirugias_checkbox` → `AQCirugias` "¿Cuáles y cuándo?" (200) |
| Hábitos | — | `#fumo_checkbox` → `HFumofinicio`, `HFumofcese` (date) · `#bebe_checkbox` → `HBebefinicio`, `HBebefcese`, `HBebe`* (100), `HBebeVasos`* (number) · `#consume_checkbox` (tranquilizantes) → `HConsume` (100), `HConsumefinicio`, `HConsumefcese` |
| Vacunas | `VBcg` · `VHepatitis` · `VAntigripal` · `VCovid` · `VDobleadulto` | `#v_otras_checkbox` → `VOtras` (100) |
| Ant. metabólicos | `AmDiabetes` · `AmColesterol` · `AmGota` · `AmTiroides` · `Fechauas` (date, último análisis de sangre) | — |
| Ant. clínicos | `AcGastritis` · `AcUlceras` · `AcCalculos` · `AcHepatitis` · `AcPancreatitis` · `AcInfUrinarias` · `AcHemorroides` · `AcEventraciones` · `AcApendicitis` · `AcEnfRenales` · `AcVesicula` · `AcHernias` | `#ac_otras_checkbox` → `AcOtras` (100) |
| Ant. cardíacos | `AcaPalpitaciones` · `AcaInfartos` · `AcaCCongenita` · `AcaInsuficiencia` · `AcaDolor` · `AcaMarcapasos` | `#aca_presion_checkbox` → `AcaPresionAlta` (máx 3) · `#aca_otras_checkbox` → `AcaOtras` (100) |
| Ant. respiratorios | `Artuberculosis` · `ArBroncoespasmos` · `ArAlergias` · `ArAsma` · `ArNeumonias` · `ArEPOC` | `#ar_otras_checkbox` → `ArOtras` (100) |
| Aparato locomotor | `AalMalformaciones` · `AalAmputaciones` · `AalHernia` · `AalPerdidaFuerza` · `AalProtesis` · `AalDesviacioncolumna` | `#aal_otras_checkbox` → `AalOtras` (100) |
| Neurológicos | `ANcefalea` · `AnACV` · `AnConvulsiones` · `AnEpilepsia` · `AnParalisis` · `AnPerdidaconocimiento` | `#an_otras_checkbox` → `AnOtras` (100) |
| Ginecológicos | `AGControlGineco2anos` · `AGFamDirectosEnfOnco` · `AGPapanicolao2anos` · `AGMamografia2anos` · `AGEmbarazos` · `AGPresionduranteembarazo` · `AGDiabetesduranteembarazo` | `#ag_otras_checkbox` → `AGOtras` (100) |
| Andrológicos | `AANDificultadOrinar` · `AANDificultadOrinaCompleta` · `AANCtrolProstatico1ano` · `AANUrologia1ano` | `#aan_otras_checkbox` → `AANOtras` (100) |
| Discapacidad | `CUD` (posee) → muestra `CUDPatologia` + file `archivo_cud` "copia del CUD vigente *" · `CUDtramite` (en trámite) → `CUDPatologia` (100) · oculto `#cud_ya_cargado` | — |

Botones: `designacion_paso3[anterior]` · `designacion_paso3[siguiente]`.

### Paso 4 — Experiencia Laboral (`designacion_paso4[antecedentes][N][...]`, form `#designacionFormPaso4`)

Al entrar: alerta "Datos de salud guardados correctamente". Cabecera de solo lectura con los datos del declarante.
Tabla-colección Symfony: arranca con **una fila vacía en índice 1**; `#btn-agregar-experiencia` clona el prototipo `__name__`.
Botón rojo de basura por fila para quitarla.

| Columna | name `[antecedentes][N][…]` | Tipo | Reglas / comportamiento |
|---|---|---|---|
| Organismo | `empresa` | text | máx 50 |
| Cargo | `cargo` | text | máx 50 |
| Fecha desde | `fechadesde` | date | |
| Fecha hasta | `fechahasta` | date | se deshabilita al marcar "actualidad" |
| Actualidad | `trabajo_actualmente` | checkbox | "Marque el casillero si trabaja allí actualmente (deja la fecha hasta en blanco)" |
| Tipo de actividad | `reftipoactividad` | select | `1` PUBLICA · `2` PRIVADA |
| Ámbito | `refambito` | select | `1` Municipal · `2` Provincial · `3` Nacional — **solo habilitado si tipo = PUBLICA** |
| Compromiso de Renuncia | `nomarchivocomprenuncia` | checkbox | |

Botones: `designacion_paso4[anterior]` · `designacion_paso4[siguiente]` · token `designacion_paso4[_token]`.

### Paso 5 — Planilla de Compatibilidad Horaria Ley 13.644 (`designacion_paso5[...]`, form `#designacionFormPaso5`)

Al entrar: alerta "Datos de Curriculum Vitae guardados correctamente". Enter está bloqueado en los inputs (no hace submit).
`#siguiente` arranca **deshabilitado** y se habilita apenas haya algún desde/hasta cargado en la banda de revista
(`verificarBandaRevista`); las sumas de horas se validan después (mensajes de `actualizarInfoBandaHoraria`).

**I. Datos de revista actual** (para completar por el agente)

| Campo | name | Tipo | Reglas / comportamiento |
|---|---|---|---|
| Ministerio/Organismo de revista | `ministerio_organismo_revista` | text | máx 50; precarga "Ministerio de Salud" |
| Repartición/dependencia | `nombre_reparticion_revista` | text | máx 50; precarga "HOSP.Z.G.A. SIMPLEMENTE EVITA" |
| Dirección | `direccion_revista` | text | máx 50 |
| Partido | `partido_revista` | select2 | valor = nombre del partido |
| Localidad | `localidad_revista` | select2 | valor = nombre; precarga GONZALEZ CATAN |
| Provincia | `provincia_revista` | text | RO |
| Ley | `ley_revista` | select | **`1` Ley 10430 · `9` Ley 10471** |
| Agrupamiento | `agrupamiento_revista` | select | AJAX por ley. 10430: `1` SERVICIO · `2` OBRERO · `3` ADMINISTRATIVO · `4` TECNICO · `5` PROFESIONAL. 10471: `19` PROFESIONAL |
| Cargo de revista | `cargo_revista` | select | AJAX por ley+agrup; **valor = nombre del cargo** (texto). Deshabilitado hasta elegir ley y agrup. Cantidades: 10430 → 57 / 77 / 28 / 130 / 103 · 10471 → 297 |
| Categoría | `categoria_revista` | text | RO, se autocompleta por ley+agrup (no por cargo). Ej.: 10430 adm. → 5, 10430 prof. → 8, 10471 → 1 |
| Es guardia | `guardia_revista` | select | `no` / `si`; **solo visible con Ley 10471**; con `si` se habilitan los checks "Guardia" por día |
| Horas semanales | `regimen_horario_revista` | text | máx 2. **Ley 10430 → 48 fijo y RO**; Ley 10471 → editable y vacío |
| Banda horaria (7 días) | `banda_horaria_semanal_revista[dia_N_desde]`, `[dia_N_hasta]` (time), `[dia_N_guardia]` (checkbox) | N = 1 Lunes … 7 Domingo |
| Observaciones | `observaciones_revista_actual` | textarea | máx 200 |
| ¿Revista en otra repartición? | `revista_otra_reparticion` | radio | `no` · `mismo_ministerio` · `otro_ministerio` |

Reglas de la banda (texto del propio sistema):
- **Ley 10430**: exactamente **48 hs** semanales en un máximo de **6 días**.
- **Ley 10471 sin guardia**: exactamente **36 hs** semanales.
- **Ley 10471 con guardia**: 36 hs en total; los días marcados "guardia" suman exactamente **24 hs**; las 12 restantes en
  máximo 3 días separados de la guardia (no el día siguiente): 1×12, 2×6 o 3×4. No puede haber dos días seguidos con guardia.

**Otra repartición del mismo ministerio** (`revista_otra_reparticion = mismo_ministerio`):
`nombre_reparticion_mismo_ministerio` (50) · `cargo_revista_mismo_ministerio` (50, texto libre) · `agrupamiento_mismo_ministerio` (select, mismos valores) ·
`regimen_horario_mismo_ministerio` (2) · `categoria_mismo_ministerio` (select, AJAX) · `banda_horaria_mismo_ministerio[dia_N_desde|hasta|guardia]` · `observaciones_mismo_ministerio` (200).

**II. Otro ministerio/organismo** (`revista_otra_reparticion = otro_ministerio`):
`ministerio_organismo_otro` (50) · `nombre_reparticion_otro_ministerio` (50) · `tipo_reparticion` radio `publica`/`privada` ·
`cargo_revista_otro_ministerio` (50) · `agrupamiento_otro_ministerio` (select) · `regimen_horario_otro_ministerio` (2) ·
`categoria_otro_ministerio` (50, texto) · `banda_horaria_semanal_otro_ministerio[dia_N_…]` · `observaciones_otro_ministerio` (200).

AJAX (GET, JSON):
- `/grh/designaciones/getAgrupamientos?idRegimenEstatutario={ley}` → `[{IdAgrupamiento, Agrupamiento}]`
- `/grh/designaciones/getCargos?idRegimenEstatutario={ley}&idAgrupamiento={agrup}` → `[{Cargo}]`
- `/grh/designaciones/getCategorias?idRegimenEstatutario={ley}&idAgrupamiento={agrup}` → `[{Categoria}]`
- además `getLocalidades`/partidos para la dirección.

Botones: `designacion_paso5[anterior]` · `designacion_paso5[siguiente]` · token `designacion_paso5[_token]`.

### Paso 6 — DDJJ Chofer (`designacion_paso6[...]`, form `#designacionFormPaso6`)
El paso **siempre aparece**; muestra cabecera de solo lectura (apellido y nombres, DNI, CUIT, domicilio real, email).
El JS decide con `cargoRevista.toLowerCase().includes('chofer')` (sobre el cargo del paso 5): si no es chofer,
oculta `.seccion-form`, **deshabilita los campos** (no viajan) y muestra el cartel "solo disponible cuando el cargo es Chofer".
Para cargos no chofer el paso se pasa con Siguiente sin datos.

| name | tipo | notas |
|---|---|---|
| `designacion_paso6[nro_licencia]` | text, maxlength 8 | "LICENCIA NACIONAL DE CONDUCIR Nº"; solo dígitos (keypress/input limpian) |
| `designacion_paso6[inhabilitado_conducir]` | radio REQ `si`/`no` | `si` → deshabilita Siguiente y bloquea el submit ("No puede avanzar … inhabilitado para conducir") |

Botones: `designacion_paso6[anterior]` · `designacion_paso6[siguiente]` · token `designacion_paso6[_token]`.
Al llegar muestra el flash "Datos de Compatibilidad Horaria guardados correctamente" (confirma el POST del paso 5).

### Paso 7 — DDJJ Ley Provincial 14.783 (`designacion_paso7[...]`, form `#designacionFormPaso7`)
Cupo laboral travesti-trans (confidencial). Misma cabecera de solo lectura del declarante que el paso 6.

| name | tipo | notas |
|---|---|---|
| `designacion_paso7[confirma_declaracion_confidencial]` | checkbox value `1`, **no obligatorio** | "Encuadra en Ley 14.783"; sin tildar = no encuadra (no se envía) |

Botón "Ley N° 14.783" (UI): abre `#overlayLey14783` con el texto de la ley; no envía nada. Sin otro JS propio del paso.
Botones: `designacion_paso7[anterior]` · `designacion_paso7[siguiente]` · token `designacion_paso7[_token]`.
Flash al llegar: "Declaración Jurada Chofer guardada correctamente." (el paso 6 se postea aunque esté deshabilitado).

### Paso 8 — Revisión y Generación (form `#designacionFormPaso8`, POST)
Pantalla "GENERACION E IMPRESION DE LOS FORMULARIOS": cabecera del declarante + aviso de presentar todo por expediente GDEBA
al departamento según el régimen estatutario. Botones: `designacion_paso8[anterior]` (submit normal) y
`designacion_paso8[finalizar]` (el JS le hace `preventDefault` y abre el modal). Token `designacion_paso8[_token]`.

**Modal `#modalExpedienteGDEBA`** (backdrop estático) — formato `EX - AÑO - NÚMERO - GDEBA - REPARTICIÓN`:
Visto en pantalla (01/11, abierto por el usuario): título verde "Número de Expediente GDEBA", texto "Ingrese el número de expediente GDEBA que comunicará al Departamento correspondiente"; placeholders `2026` / `Ej: 12345` / `Ej: MSGP`; vista previa "EX [ … ]" con "Complete los campos"; aviso amarillo de descarga automática a Descargas; botones gris **Cancelar** y verde **Confirmar y Finalizar**. Al apretar Finalizar el JS vacía los 3 campos cada vez. No se puede cerrar con clic afuera ni Esc (`data-backdrop=static`, `data-keyboard=false`): solo Cancelar.


| id/name | regla |
|---|---|
| `gdeba_anio` | REQ, exactamente 4 dígitos |
| `gdeba_numero` | REQ, 1 a 8 dígitos |
| `gdeba_reparticion` | REQ, solo letras (con acentos/Ñ), máx 20, se pasa a MAYÚSCULAS |
| `gdeba_preview` | readonly, solo UI: `anio - numero - GDEBA - REPARTICION` |

`#btnCancelarModal` cierra; `#btnConfirmarFinalizar` valida y hace:
```
POST /grh/designaciones/finalizar-designacion/{dni}/{sexo}     (ej. /42726390/M)
Header X-Requested-With: XMLHttpRequest
Body (urlencoded): _token=<designacion_paso8[_token]>, gdeba_anio, gdeba_numero, gdeba_reparticion
→ respuesta = el PDF (blob); nombre en Content-Disposition, default "paquete_designacion.pdf"
```
El navegador lo descarga, muestra "¡Designación finalizada!" y vuelve a `/grh/designaciones/`.
**Irreversible**: la designación pasa a Finalizada y no admite más cambios (no se probó; la de prueba NO se finalizó).
Notar que el endpoint va por dni+sexo, no por id de designación.
- **8 Generación e impresión**: genera el PDF único, pasa a **Finalizada** y bloquea la edición.

## Estado de la prueba

Designación de prueba de ARCE ALEX DANIEL (42726390, M, tipo 2 "Designación en Planta Temporaria") con **pasos 1 a 7 guardados** (paso 2 todo "No", paso 3 sin marcar, paso 4 sin experiencias, paso 5 con cargo inventado "ADMINISTRADOR DE SEGURIDAD DE SOFTWARE DE BASE"; enviados por el usuario). Está parada en el paso 8 sin finalizar
(nacionalidad Argentina, estado civil SOLTERO y secundario completo cargados como relleno, no son datos reales).
Queda en "Iniciada" en el historial; borrar con la acción Eliminar cuando no se use más.
