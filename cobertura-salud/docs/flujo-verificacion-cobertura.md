# Verificacion de cobertura de salud

Fuente base: `C:\Users\Administrator\Desktop\Procedimiento Verificación de cobertura de salud.pdf`

Fecha de relevamiento: 2026-08-15

## Objetivo de la automatizacion

Abrir las paginas oficiales necesarias para verificar si un paciente tiene cobertura,
prellenar los datos posibles, guiar al operador cuando haya captcha/login, guardar la
evidencia consultada y devolver una decision operativa para actualizar HSI/facturacion.

La automatizacion no debe intentar saltear captchas ni controles de sesion. En esos
casos debe abrir la pagina correcta, cargar el dato del paciente si el sitio lo permite,
esperar intervencion del operador y registrar el resultado ingresado o capturado.

## Datos minimos del paciente

- DNI, sin puntos.
- CUIL, idealmente con formato `XX-XXXXXXXX-X`.
- Apellido, necesario para ARCA consulta basica si se busca por documento.
- Sexo/genero, util para IOMA si el padron lo solicita.
- Fecha de prestacion, necesaria para decidir OS ORIGEN / OS DESTINO desde 2025-01-01.
- Tipo de atencion: guardia, consultorio externo, practica ambulatoria o internacion.

## Momento en que se ejecuta

Se ejecuta en admision, antes de registrar/finalizar la atencion facturable:

- Guardia.
- Consultorios externos.
- Practicas ambulatorias.
- Internacion.

Tambien debe poder ejecutarse como reproceso administrativo cuando una cobertura en HSI
este incompleta, vencida o contradiga un padron oficial.

## Regla general de decision

1. Consultar primero SSS.
2. Si SSS informa cobertura nacional, verificar aportes en ARCA.
3. Si SSS no informa cobertura o informa baja, consultar PUCO/SISA y padrones especificos.
4. Si el paciente es jubilado/pensionado o aparece indicio de INSSJP, consultar PAMI.
5. Si aparece IOMA o indicio provincial, consultar padron IOMA.
6. Si hay discrepancia entre HSI y sistemas externos, actualizar HSI con la ultima cobertura vigente.
7. Si hay discrepancia entre fuentes, priorizar la cobertura vigente en SSS para obras sociales nacionales.

## Flujo por sistema

### 1. SSS - Padron de beneficiarios

Pagina que abre:

- `https://www.sssalud.gob.ar/?page=bus650`

Cuando se usa:

- Siempre como primer paso.
- Sirve para obras sociales nacionales y para definir cobertura vigente segun SSS.

Que se llena:

- `cuil_b`: CUIL con formato `XX-XXXXXXXX-X`, si esta disponible.
- `nro_doc`: DNI, si no se usa CUIL o como respaldo.
- `code`: captcha visible.
- Boton: `Consultar`.

Que lee la automatizacion:

- Si hay cobertura activa.
- Obra social informada.
- Estado/alta/baja si aparece.
- OS ORIGEN / OS DESTINO cuando corresponda.

Decision:

- Si hay cobertura vigente, continuar con ARCA para validar aportes.
- Si no hay cobertura o figura baja, pasar a PUCO/SISA, IOMA/PAMI o padrones especiales segun caso.
- Desde prestaciones del 2025-01-01, facturar a OS DESTINO. Prestaciones anteriores, OS ORIGEN.

Automatizable:

- Abrir pagina.
- Completar CUIL/DNI.
- Dejar foco en captcha.
- Esperar que el operador complete captcha y consulte.
- Capturar resultado/screenshot y pedir clasificacion: vigente, baja, sin datos, error.

### 2. ARCA / ex AFIP - Aportes en Linea

Pagina inicial:

- `https://www.afip.gob.ar/aportesenlinea/`

Pagina de consulta basica sin clave fiscal:

- `https://serviciossegsoc.afip.gob.ar/MisAportes/app/basica.aspx`

Cuando se usa:

- Cuando SSS muestra cobertura nacional y hay que confirmar aportes.
- Cuando SSS no muestra cobertura pero el caso puede tener relacion de dependencia,
  monotributo o casas particulares.

Que se llena:

- Tipo de consulta por CUIL o por documento/apellido.
- Si es por CUIL: campo de CUIL.
- Si es por DNI: documento y apellido.
- Boton: `CONTINUAR`.

Que se controla:

- Columna `Incluido en declaracion jurada`.
- Columna `Aportes de Obra Social`.
- Ultimos 12 meses visibles en consulta basica.

Decision:

- Relacion de dependencia: si hay ultimo periodo declarado por empleador, la cobertura
  se considera obligatoria mientras continue la relacion laboral.
- Si finalizo la relacion laboral, contemplar extension legal de 3 meses.
- Si el aporte esta ausente o hay inconsistencias, marcar para revision administrativa.

Automatizable:

- Abrir consulta sin clave fiscal.
- Completar CUIL o DNI/apellido.
- Avanzar hasta donde el sitio permita.
- Extraer o capturar tabla de aportes.

Observacion:

- La consulta con clave fiscal no se automatiza sin credenciales institucionales y permiso explicito.

### 3. ANSES - CODEM

Pagina que abre:

- `https://servicioswww.anses.gob.ar/ooss2/`

Cuando se usa:

- Para verificar comprobante de empadronamiento y obra social asociada.
- Especialmente util en jubilados/pensionados, grupo familiar o dudas de derivacion.

Que se llena:

- Segun pantalla vigente de ANSES: normalmente CUIL/DNI y validaciones del sitio.

Que se lee:

- Obra social informada en CODEM.
- Relacion titular/familiar si figura.

Decision:

- Si CODEM confirma cobertura, guardar como evidencia complementaria.
- Si contradice SSS, marcar discrepancia; para SSS nacional prevalece SSS como fuente operativa.

Automatizable:

- Abrir pagina.
- Llevar el dato del paciente listo.
- El sitio esta protegido, por lo que puede requerir intervencion manual.

### 4. SISA / PUCO

Pagina que abre:

- `https://sisa.msal.gov.ar/sisa/#sisa`

Cuando se usa:

- Si SSS no arroja cobertura.
- Como respaldo para consultar informacion sanitaria y coberturas registradas.
- En conjunto con IOMA/PAMI para mejorar precision.

Que se llena:

- Requiere acceso al sistema.
- Busqueda por DNI/CUIL del paciente dentro del modulo correspondiente.

Que se lee:

- Cobertura registrada.
- Datos identificatorios del paciente.
- Fecha/estado si el modulo lo informa.

Decision:

- Si PUCO/SISA informa cobertura que no esta en HSI, proponer actualizacion.
- Si no informa cobertura, continuar padrones especificos o dejar sin cobertura hasta nueva identificacion.

Automatizable:

- Abrir SISA.
- Si hay sesion institucional, navegar al modulo y buscar paciente.
- Si hay login o sesion vencida, pedir intervencion.

### 5. IOMA - Padron de afiliados

Pagina indicada por el PDF:

- `http://sistemasl.ioma.gba.gov.ar/sistemas/consulta_padron_afiliados/consulta_afiliados.php`

Entrada institucional actual detectada:

- `https://sistemas.ioma.gba.gov.ar/sistemas/buscador/buscador.html`

Cuando se usa:

- Si el paciente declara IOMA.
- Si SSS no arroja cobertura nacional pero puede tener obra social provincial.
- Si CODEM/PUCO sugieren cobertura provincial.

Que se llena:

- Padron IOMA puede pedir DNI y genero/sexo, o numero de afiliado, segun version vigente.

Que se lee:

- Estado afiliatorio.
- Numero de afiliado.
- Tipo de afiliado/directo/familiar si lo informa.

Decision:

- Si IOMA figura activo, asignar IOMA como cobertura provincial.
- Si no figura, continuar otras fuentes o dejar pendiente/sin cobertura segun caso.

Automatizable:

- Abrir ruta vigente.
- Prellenar DNI y sexo si el formulario esta disponible.
- Capturar resultado.

Riesgo:

- La ruta vieja del PDF puede responder 404/no conectar desde algunos entornos. La automatizacion debe tener URLs alternativas y monitoreo de cambio.

### 6. PAMI / INSSJP - Padron de afiliados

Pagina que abre:

- `https://prestadores.pami.org.ar/result.php?c=6-2&vm=2`

Entrada general:

- `https://prestadores.pami.org.ar/`

Cuando se usa:

- Pacientes jubilados o pensionados.
- Cuando ANSES/CODEM indique INSSJP/PAMI.
- Cuando por edad o declaracion del paciente haya indicio de PAMI.

Que se llena:

- Segun pantalla vigente: busqueda por DNI, numero de beneficio o datos de afiliacion.

Que se lee:

- Estado de afiliacion.
- Constancia/credencial si esta disponible.
- UGL/agencia u observaciones si el sistema las muestra.

Decision:

- Si esta activo y con alta efectiva, asignar PAMI.
- Importante: el PDF aclara que el registro ANSES como jubilado/pensionado no alcanza para facturar si no realizo el tramite de alta efectiva en PAMI.

Automatizable:

- Abrir la pagina exacta de padron.
- Prellenar datos si el formulario esta disponible.
- Registrar screenshot/resultado.

### 7. Servicio domestico / casas particulares

Pagina que abre:

- `https://seguro.sssalud.gob.ar/index.php?cat=consultas&page=mono_pagos_sd`

Cuando se usa:

- Si el paciente figura o declara regimen de trabajadoras/es de casas particulares.
- Si SSS/ARCA no cierran y hay indicio de ese regimen.

Que se llena:

- `nro_cuil`: CUIL con formato `XX-XXXXXXXX-X`.
- `code`: captcha visible.
- Boton: `Buscar`.

Que se lee:

- Pagos correspondientes a los ultimos 12 periodos.
- Ultimo periodo en curso.
- Monto del aporte.

Decision:

- Cobertura vigente si tiene pago del ultimo periodo en curso y aporte completo.
- Pierde cobertura con un periodo impago o pago incompleto.
- Segun PDF, controlar monto minimo indicado para casas particulares.

Automatizable:

- Abrir pagina.
- Completar CUIL.
- Esperar captcha/consulta manual.
- Capturar resultado.

### 8. Monotributo

Pagina base:

- SSS, cuando el resultado indique monotributo.
- ARCA/Aportes en linea, para validar pagos.

Cuando se usa:

- Si SSS informa regimen simplificado o monotributo social.
- Si ARCA muestra aportes vinculados a monotributo.

Que se controla:

- Regimen simplificado: periodos pagos/impagos.
- Monotributo social: ambos conceptos pagos.

Decision:

- Pierde cobertura con 3 periodos consecutivos impagos o 5 no consecutivos impagos.
- Monotributo social reempadronado desde 2024-10-01 debe tener abonado el 50% por afiliado.

Automatizable:

- Abrir las fuentes.
- Extraer tabla de periodos si se puede.
- Calcular regla de mora y devolver vigente/no vigente/revision.

## Estados internos recomendados

- `pendiente`: creado pero sin consultar.
- `requiere_operador`: hay captcha, login o bloqueo.
- `consultando`: navegador abierto y flujo en curso.
- `vigente`: cobertura valida detectada.
- `sin_cobertura`: no se detecto cobertura en fuentes consultadas.
- `baja`: padron informa baja.
- `discrepancia`: fuentes no coinciden.
- `error_fuente`: sitio caido, ruta cambiada o bloqueo tecnico.

## Campos a guardar por consulta

- Paciente: DNI, CUIL, apellido, nombre si existe.
- Fuente consultada: SSS, ARCA, ANSES, SISA, IOMA, PAMI, Servicio Domestico.
- URL abierta.
- Fecha/hora de consulta.
- Resultado normalizado.
- Texto o tabla capturada.
- Screenshot/ruta de evidencia.
- Usuario operador que resolvio captcha o cargo resultado manual.
- Decision final para HSI/facturacion.
- Observaciones.

## Flujo de pantalla sugerido

1. El operador carga DNI/CUIL/apellido/fecha de prestacion.
2. Presiona `Verificar cobertura`.
3. El sistema abre SSS y prellena CUIL/DNI.
4. Si hay captcha, muestra `Completar captcha en navegador`.
5. Al volver, guarda resultado de SSS.
6. Si SSS da cobertura, abre ARCA para aportes.
7. Si SSS no da cobertura, abre PUCO/SISA y luego IOMA/PAMI segun indicios.
8. El sistema arma un resumen:
   - cobertura recomendada,
   - fuente principal,
   - evidencia,
   - accion HSI: alta, baja, modificar o sin cambio.

## Reglas especiales

- Recién nacidos sin DNI: hasta 30-45 dias se verifican con documento de los padres.
- Extranjeros sin DNI: controlar seguro contratado y pasaporte.
- NN/no identificado: se considera sin cobertura hasta identificar.
- Prepagas: tener especial atencion porque pueden no figurar en SSS o HSI.
- Jubilados/pensionados: ANSES puede indicar PAMI, pero para facturacion debe haber alta efectiva en PAMI.
