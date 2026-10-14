/**
 * Formulario de Google — DDJJ Reintegro de Guardería y/o Jardín Maternal
 * (IF-2024-18854671-GDEBA — PBA / Ministerio de Salud)
 *
 * Crea un Google Form con los datos que declara el agente para la DDJJ de guardería,
 * y una planilla de Google Sheets donde caen las respuestas (después se importan a las
 * tablas guarderia_ddjj / guarderia_ddjj_menores del sistema, usando el DNI como clave,
 * y desde la página Guardería se imprime sobre el PDF oficial).
 *
 * CÓMO USARLO (una sola vez):
 *   1. Entrar a https://script.google.com con la cuenta de Google que va a ser dueña del formulario.
 *   2. "Nuevo proyecto" → borrar lo que haya → pegar TODO este archivo.
 *   3. Elegir la función `crearFormularioGuarderia` arriba y tocar "Ejecutar".
 *   4. Aceptar los permisos que pide Google (Formularios y Hojas de cálculo).
 *   5. En "Registro de ejecución" aparecen los links: para compartir, para editar y la planilla.
 *
 * Los títulos de las preguntas son las columnas de la planilla: NO cambiarlos si se va
 * a usar el importador al sistema (se pueden cambiar descripciones/ayudas sin problema).
 *
 * Los datos del agente NO se preguntan: salen del sistema al importar (repartición,
 * fecha de nacimiento, legajo, cargo, horario desde personalv5; estado civil y
 * nacionalidad desde personalv3.personal; domicilio desde el listado de domicilios del
 * Ministerio en D:\G\EQUIPO; fecha de reintegro desde el anual del Ministerio).
 * Tampoco la certificación de firma (la completa RRHH). La fecha sale de la marca temporal.
 */

const MAX_MENORES = 6;

function crearFormularioGuarderia() {
  const form = FormApp.create('DDJJ Reintegro de Guardería y/o Jardín Maternal');
  form.setDescription(
    'Provincia de Buenos Aires — Ministerio de Salud.\n' +
    'Completá tus datos para la Declaración Jurada de Reintegro de Guardería y/o Jardín Maternal. ' +
    'Los datos tienen carácter de declaración jurada. Si un dato no corresponde, escribí NC.'
  );
  form.setProgressBar(true);
  form.setAllowResponseEdits(true);
  form.setConfirmationMessage('¡Gracias! Tus datos fueron enviados a Recursos Humanos. ' +
    'Te avisamos cuando la DDJJ esté lista para firmar.');

  const txt = (titulo, ayuda, obligatorio) => {
    const it = form.addTextItem().setTitle(titulo).setRequired(!!obligatorio);
    if (ayuda) it.setHelpText(ayuda);
    return it;
  };
  const fecha = (titulo, obligatorio) => form.addDateItem().setTitle(titulo).setRequired(!!obligatorio);
  const opcion = (titulo, opciones, obligatorio) =>
    form.addMultipleChoiceItem().setTitle(titulo).setChoiceValues(opciones).setRequired(!!obligatorio);
  const dniValido = (ayuda) => FormApp.createTextValidation()
    .setHelpText(ayuda || 'Ingresá el DNI sin puntos (7 a 9 números)')
    .requireTextMatchesPattern('^[0-9]{7,9}$').build();
  const ESTADO_CIVIL = ['Soltera/o', 'Casada/o', 'Viuda/o', 'Separada/o', 'Divorciada/o', 'Unión convivencial'];
  const NC = 'Si no corresponde, escribí NC';

  // ── 1. Identificación ──────────────────────────────────────────────────────
  form.addSectionHeaderItem().setTitle('Identificación');
  txt('DNI', 'Sin puntos', true).setValidation(dniValido());
  txt('Apellido y nombre', null, true);
  txt('WhatsApp', 'Para avisarte si falta algún dato. Código de área + número, sin 0 ni 15 (ej: 1123456789)')
    .setValidation(FormApp.createTextValidation()
      .setHelpText('Solo números, sin 0 ni 15 ni espacios (ej: 1123456789)')
      .requireTextMatchesPattern('^[0-9]{10,13}$').build());

  // ── 2. Situación de los niños ─────────────────────────────────────────────
  form.addPageBreakItem().setTitle('Situación de los niños');
  txt('Quién tiene los niños a cargo', 'Ej: la agente, ambos progenitores…', true);
  txt('En caso de tutela, tenencia, guarda: condición', NC, true);
  form.addParagraphTextItem().setTitle('Motivo por el cual no ingresa al jardín maternal / guardería')
    .setHelpText('Hasta 300 caracteres').setRequired(true)
    .setValidation(FormApp.createParagraphTextValidation()
      .setHelpText('Máximo 300 caracteres').requireTextLengthLessThanOrEqualTo(300).build());

  // ── 3. Otro progenitor ────────────────────────────────────────────────────
  const preguntaOtro = form.addMultipleChoiceItem()
    .setTitle('¿Hay otro progenitor para declarar?').setRequired(true);

  const pagOtro = form.addPageBreakItem().setTitle('Datos del otro progenitor');
  txt('Otro progenitor — Apellido y nombre', null, true);
  txt('Otro progenitor — Número de documento', 'Sin puntos', true).setValidation(dniValido());
  txt('Otro progenitor — Domicilio particular', null, true);
  fecha('Otro progenitor — Fecha de nacimiento', true);
  opcion('Otro progenitor — Estado civil', ESTADO_CIVIL, true);
  txt('Otro progenitor — Nacionalidad', null, true);
  txt('Otro progenitor — Lugar de trabajo', 'Si no trabaja, escribí NO TRABAJA', true);

  // ── 4. Menores hasta 4 años (se agregan de a uno) ─────────────────────────
  const paginasMenor = [];
  const preguntasOtroMenor = [];
  for (let n = 1; n <= MAX_MENORES; n++) {
    const pag = form.addPageBreakItem().setTitle(`Menor ${n} (hasta 4 años)`);
    if (n === 1) pag.setHelpText('Cargá los hijos/as de hasta 4 años por los que pedís el reintegro.');
    paginasMenor.push(pag);
    txt(`Menor ${n} — Apellido y nombre`, null, true);
    txt(`Menor ${n} — Número de documento`, 'Sin puntos', true).setValidation(dniValido());
    fecha(`Menor ${n} — Fecha de nacimiento`, true);
    opcion(`Menor ${n} — ¿Presenta patología que necesite atención especial?`, ['Sí', 'No'], true);
    txt(`Menor ${n} — Atención especial temporaria`, 'Solo si presenta patología');
    txt(`Menor ${n} — Atención especial permanente`, 'Solo si presenta patología');
    if (n < MAX_MENORES) {
      preguntasOtroMenor.push(form.addMultipleChoiceItem()
        .setTitle(`¿Agregar otro menor? (después del menor ${n})`).setRequired(true));
    }
  }

  // ── 5. Declaración jurada ─────────────────────────────────────────────────
  const pagDdjj = form.addPageBreakItem().setTitle('Declaración jurada');
  txt('Lugar', 'Ciudad donde firmás (ej: González Catán)', true);
  form.addCheckboxItem().setTitle('Declaración')
    .setChoiceValues(['DECLARO, BAJO JURAMENTO, QUE LOS DATOS PRECEDENTES SON EXACTOS.'])
    .setRequired(true);

  // ── Navegación ────────────────────────────────────────────────────────────
  preguntaOtro.setChoices([
    preguntaOtro.createChoice('Sí', pagOtro),
    preguntaOtro.createChoice('No', paginasMenor[0]),
  ]);
  preguntasOtroMenor.forEach((q, i) => q.setChoices([
    q.createChoice('Sí', paginasMenor[i + 1]),
    q.createChoice('No', pagDdjj),
  ]));

  // ── Planilla de respuestas ────────────────────────────────────────────────
  const ss = SpreadsheetApp.create('DDJJ Guardería — Respuestas');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  Logger.log('Link para compartir con los agentes: ' + form.getPublishedUrl());
  Logger.log('Link para editar el formulario:    ' + form.getEditUrl());
  Logger.log('Planilla de respuestas:            ' + ss.getUrl());
}
