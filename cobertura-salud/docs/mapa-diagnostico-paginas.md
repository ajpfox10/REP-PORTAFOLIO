# Mapa de diagnostico por pagina

Fecha: 2026-08-15

Este mapa define que debe reconocer la automatizacion cuando abre cada fuente.
No intenta resolver captchas, logins ni validaciones anti-bot: los detecta, deja
registro y le indica al operador que hacer.

Modo operativo implementado: automatico asistido. La app carga DNI/CUIL, deja
el captcha o login para intervencion humana cuando corresponde, espera la accion
del operador y luego extrae automaticamente el resultado visible.

## Diagnosticos posibles

- `captcha_detectado`: hay campo/imagen/iframe de captcha o texto equivalente.
- `login_detectado`: hay formulario de usuario/clave o ingreso institucional.
- `bloqueo_validacion_sitio`: el sitio muestra proteccion, validacion o anti-bot.
- `error_fuente`: HTTP 4xx/5xx, ruta caida, error visible, sitio inaccesible o pagina vacia.
- `formulario_listo_requiere_operador`: el formulario esta visible, pero la fuente requiere intervencion.
- `formulario_disponible`: el formulario esta visible y no se detecto resultado final.
- `posible_cobertura_detectada`: hay texto compatible con cobertura/afiliacion/aportes.
- `sin_cobertura_detectada`: hay texto de no registro, no posee o sin cobertura.
- `sin_resultado_detectable`: la pagina cargo, pero no coincide con un estado conocido.

## SSS - Padron de beneficiarios

- URL: `https://www.sssalud.gob.ar/?page=bus650`
- URL vista en vivo: `https://www.sssalud.gob.ar/index.php?b_publica=Acceso+Público&user=GRAL&page=bus650`
- Formulario esperado: `cuil_b`, `nro_doc`, `code`.
- Relevamiento en vivo: llenar campo CUIL y/o `Numero de documento`, completar el captcha visible en `Codigo Mostrado` y apretar `Consultar`.
- Captcha: `input[name='code']`, imagen de captcha o texto `Codigo Mostrado`.
- Resultado positivo: `obra social`, `OS ORIGEN`, `OS DESTINO`, `beneficiario`, `monotributo`.
- Resultado negativo: `no registra`, `sin cobertura`, `no se encontraron`.
- Accion: completar captcha en la ventana abierta y presionar `Consultar`.

## SSS - Acceso Restringido HPGD (Ventanilla Electronica)

- Diagnostico esperado al abrir: `login_detectado`.
- URL de login: `https://seguro.sssalud.gob.ar/login.php?b_publica=Acceso+Restringido+para+Hospitales&opc=bus650&user=HPGD`
- Es el ingreso institucional de los Hospitales (HPGD). Lleva luego a la consulta de padron `opc=bus650` en modo restringido.
- Formulario de login (POST a la misma URL):
  - Usuario: `input[name='_user_name_']` (text).
  - Clave: `input[name='_pass_word_']` (password).
  - Enviar: `input[name='submitbtn']` (value `Ingresar`).
- Credenciales: institucionales, guardadas en `backend/.env.development` como `SSS_USERNAME` / `SSS_PASSWORD` (no se escriben en este doc). El operador tipea la clave.
- Captcha en el login: no se detecto imagen/campo de captcha en la pantalla de ingreso.
- Texto de la pantalla: `Bienvenido al Acceso a Consultas On Line`, `Usuario:`, `Clave:`, `solo podra acceder si es usuario previamente registrado`.
- Post-login (opc=bus650), MAPEADO en vivo con sesion HPGD:
  - Campos: `input[name='cuil_b']` (CUIL), `input[name='nro_doc']` (Numero de documento).
  - Boton: `input[name='B1']` value `Consultar` (o `input[type=submit][value*='Consultar']`).
  - SIN captcha (a diferencia del padron publico, que ademas pide `code`).
  - Formulario POST a `index.php?page=bus650&user=...&cat=consultas`.
- Automatizacion implementada en la app: login automatico + prellenado de `cuil_b`/`nro_doc` + click automatico en `Consultar`. El operador no interviene.

## ARCA - Aportes en linea

- URL: `https://serviciossegsoc.afip.gob.ar/MisAportes/app/basica.aspx`
- Formulario esperado: campos de `txtCuil`, `txtDocumento`, `txtApellido`.
- Relevamiento en vivo: llenar CUIL, tildar `No soy un robot`, apretar `CONTINUAR`.
- Resultado a extraer: primera linea/resumen que aparece al continuar y primera fila de la tabla.
- Ejemplo visto: `En el curso del ultimo año, Usted se encuentra registrado por un empleador.`
- Primera fila vista: periodo `08/2025`, `Incluido en declaracion jurada = SI`, `Aportes de seguridad social = INFORMATIVO`, `Aportes de obra social = INFORMATIVO`, `Contribucion patronal de obra social = INFORMATIVO`.
- Login/bloqueo: `clave fiscal`, `CUIT/CUIL/CDI`, formulario de password.
- Resultado positivo: `Incluido en declaracion jurada`, `Aportes de Obra Social`, `periodo`.
- Resultado negativo: `no registra aportes`, `no se encontraron registros`.
- Accion: controlar ultimos 12 meses, declaracion jurada y aportes de obra social.

## ANSES - CODEM

- URL: `https://servicioswww.anses.gob.ar/ooss2/`
- Formulario esperado: primer campo de texto visible si la pantalla lo permite.
- Relevamiento en vivo: llenar el campo `INGRESA TU DOCUMENTO O CUIL` con CUIL y apretar `CONTINUAR`.
- Resultado a extraer: el mensaje que aparece debajo de los botones despues de continuar.
- Ejemplo negativo visto: `La consulta no arrojo resultados.`
- Captcha/bloqueo: reCAPTCHA, `no soy un robot`, Incapsula, Access Denied.
- Login: `Mi ANSES`, `clave de la seguridad social`, inicio de sesion.
- Resultado positivo: `CODEM`, `comprobante de empadronamiento`, `obra social`.
- Resultado negativo: `La consulta no arrojo resultados.`
- Accion: intervenir manualmente si ANSES pide validacion vigente.

## SISA / PUCO

- DECISION (2026-08-19): se automatiza por el FORMULARIO WEB (webview), NO por el WS.
  La CONSULTA de PUCO es publica: NO pide login ni captcha (confirmado en vivo:
  devuelve resultado con "Ingresar" visible, o sea sin sesion). El reCAPTCHA/login
  que aparece en el DOM es del boton "Ingresar" general de SISA, NO de la consulta.
- URL: `https://sisa.msal.gov.ar/sisa/#sisa` (GWT, una sola pagina, sin URL propia del modulo).
- Flujo app (fuente `spa` en renderer.js): abrir menu REGISTROS -> "Consulta de
  Cobertura de Salud (PUCO)" -> cargar DNI en "Ingrese el valor" -> apretar Buscar
  -> leer grilla. Todo con sondeo (GWT no recarga pagina). Requiere afinar en vivo.
- --- WEB SERVICE (marcado por las dudas, NO se usa por ahora) ---
- Servicio web oficial encontrado: `WS131 - Consulta nominal de PUCO`.
- Acceso WS: restringido, requiere usuario y clave.
- REST WS: `POST https://sisa.msal.gov.ar/sisa/services/rest/puco/{nrodoc}` con JSON `{"usuario":"xxxxxx","clave":"xxxx"}`.
- SOAP WS: `https://sisa.msal.gov.ar/sisa/services/pucoService`, metodo `getPuco`.
- Datos WS: `resultado`, `tipodoc`, `nrodoc`, `coberturaSocial`, `denominacion`, `rnos`.
- --- FIN WEB SERVICE ---
- Formulario esperado: login institucional o campos visibles del modulo.
- Relevamiento en vivo: desde la pantalla principal abrir la tarjeta `Consulta de Cobertura de Salud (PUCO)`.
- Busqueda PUCO: selector `Buscar por` = `NroDoc`, condicion `igual a`, llenar DNI y apretar `Buscar`.
- Resultado a extraer: primera fila de la grilla con columnas `TipoDoc`, `NroDoc`, `Sexo`, `Cobertura Social`, `Denominacion`.
- Ejemplo visto: `TipoDoc = DNI`, `NroDoc = 28305607`, `Sexo = M`, `Cobertura Social = O.S.P. BUENOS AIRES (IOMA)`, `Denominacion = PEVERI ALEJANDRO JAVIER`.
- Login: `usuario`, `contraseña`, `ingresar`, `iniciar sesion`.
- Resultado positivo: `PUCO`, `cobertura`, `paciente`, `DNI`.
- Resultado negativo: `no registra cobertura`, `sin cobertura`.
- Accion: ingresar con sesion institucional y buscar DNI/CUIL.

## IOMA - Padron de afiliados

- URL: `https://sistemas.ioma.gba.gov.ar/sistemas/buscador/buscador.html`
- Estado de relevamiento: pendiente.
- Formulario esperado: campo de texto, boton o submit visible.
- Error/ruta: `404`, `not found`, `no se puede acceder`, `service unavailable`.
- Resultado positivo: `afiliado`, `IOMA`, `nro afiliado`, `estado`.
- Resultado negativo: `no se encontraron`, `no registra`, `inexistente`.
- Accion: completar la pantalla vigente si pide sexo, DNI o numero de afiliado.

## PAMI / INSSJP - Padron de afiliados

- URL: `https://prestadores.pami.org.ar/result.php?c=6-2&vm=2`
- Formulario esperado: campo de texto, boton o submit visible.
- Resultado positivo: `numero de afiliado`, `estado de afiliacion`, `credencial vigente`, `constancia de afiliacion`.
- Resultado negativo: `no se encontraron`, `no registra`, `sin afiliacion`.
- Accion: confirmar alta efectiva, UGL/agencia y estado de afiliacion.

## SSS - Pagos de Servicio Domestico

- URL: `https://seguro.sssalud.gob.ar/index.php?cat=consultas&page=mono_pagos_sd`
- Formulario esperado: `nro_cuil`, `code`.
- Captcha: `input[name='code']`, imagen de captcha o texto de codigo mostrado.
- Resultado positivo: `periodo`, `importe`, `aporte`, `servicio domestico`.
- Resultado negativo: `no registra`, `no se encontraron`, `sin pagos`.
- Accion: completar captcha y presionar `Buscar` para ver pagos.
