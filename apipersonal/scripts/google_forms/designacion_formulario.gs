/**
 * Formulario de Google — Datos para Designación (Sistema Gestión de RRHH del Ministerio)
 *
 * Junta lo que pide el wizard de Designaciones (sistemas.ms.gba.gov.ar/grh) y que NO
 * tenemos en la base: estudios, cursos, DDJJ de 17
 * preguntas, experiencia laboral, otra repartición, chofer y DDJJ de salud.
 * Las respuestas caen en una planilla de Google Sheets y se cruzan por DNI.
 * Mapa de campos del sistema: apipersonal/docs/grh_designaciones_mapa.md
 *
 * CÓMO USARLO (una sola vez):
 *   1. Entrar a https://script.google.com con la cuenta de Google que va a ser dueña del formulario.
 *   2. "Nuevo proyecto" → borrar lo que haya → pegar TODO este archivo.
 *   3. Elegir la función `crearFormularioDesignacion` arriba y tocar "Ejecutar".
 *   4. Aceptar los permisos que pide Google (Formularios y Hojas de cálculo).
 *   5. En "Registro de ejecución" aparecen los links: para compartir, para editar y la planilla.
 *
 * Lo que ya está en la base NO se pregunta (CUIL, fecha de nacimiento, sexo, nacionalidad,
 * estado civil, domicilio, ley, cargo,
 * horario en el hospital). Mail y teléfono sí, porque el sistema los exige y conviene confirmarlos.
 * La DDJJ Ley 14.783 (cupo, confidencial) queda afuera: se marca en el momento.
 * Los adjuntos (matrícula, CUD, causa penal, retiro voluntario) no se suben acá: se
 * pregunta y RRHH pide el PDF aparte (subir archivos obliga a entrar con cuenta de Google).
 *
 * Los títulos de las preguntas son las columnas de la planilla: NO cambiarlos si se va
 * a usar un importador (se pueden cambiar descripciones/ayudas sin problema).
 */

const MAX_CURSOS = 5;
const MAX_EXPERIENCIAS = 5;
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function crearFormularioDesignacion() {
  const form = FormApp.create('Designación — Datos del agente para el Ministerio');
  form.setDescription(
    'Provincia de Buenos Aires — Ministerio de Salud.\n' +
    'Completá tus datos para la designación en el Sistema de Gestión de Recursos Humanos ' +
    'del Ministerio. Los datos tienen carácter de declaración jurada.'
  );
  form.setProgressBar(true);
  form.setAllowResponseEdits(true);
  form.setConfirmationMessage('¡Gracias! Tus datos fueron enviados a Recursos Humanos.');

  const maximo = (n) => FormApp.createTextValidation()
    .setHelpText(`Máximo ${n} caracteres`).requireTextLengthLessThanOrEqualTo(n).build();
  const txt = (titulo, ayuda, obligatorio, max) => {
    const it = form.addTextItem().setTitle(titulo).setRequired(!!obligatorio);
    if (ayuda) it.setHelpText(ayuda);
    if (max) it.setValidation(maximo(max));
    return it;
  };
  const numero = (titulo, ayuda, obligatorio, digitos) => {
    const it = form.addTextItem().setTitle(titulo).setRequired(!!obligatorio)
      .setValidation(FormApp.createTextValidation()
        .setHelpText(`Solo números (hasta ${digitos})`)
        .requireTextMatchesPattern(`^[0-9]{1,${digitos}}$`).build());
    if (ayuda) it.setHelpText(ayuda);
    return it;
  };
  const fecha = (titulo, obligatorio) => form.addDateItem().setTitle(titulo).setRequired(!!obligatorio);
  const opcion = (titulo, opciones, obligatorio) =>
    form.addMultipleChoiceItem().setTitle(titulo).setChoiceValues(opciones).setRequired(!!obligatorio);
  const lista = (titulo, opciones, obligatorio) =>
    form.addListItem().setTitle(titulo).setChoiceValues(opciones).setRequired(!!obligatorio);
  const casillas = (titulo, opciones, ayuda) => {
    const it = form.addCheckboxItem().setTitle(titulo).setChoiceValues(opciones).showOtherOption(true);
    it.setHelpText(ayuda || 'Marcá lo que corresponda. Si no tenés ninguna, dejalo vacío. "Otro" para agregar.');
    return it;
  };
  const sino = (titulo, obligatorio) => form.addMultipleChoiceItem().setTitle(titulo)
    .setRequired(obligatorio !== false);
  const horario = (titulo) => form.addTextItem().setTitle(titulo)
    .setHelpText('Desde-hasta en 24 hs (ej: 08:00-14:00). Si es guardia de 24 hs agregá G (ej: 08:00-08:00 G). Vacío si no trabaja.')
    .setValidation(FormApp.createTextValidation()
      .setHelpText('Formato HH:MM-HH:MM, opcional G al final (ej: 07:00-13:00)')
      .requireTextMatchesPattern('^([01][0-9]|2[0-3]):[0-5][0-9] ?- ?([01][0-9]|2[0-3]):[0-5][0-9]( ?[Gg])?$').build());
  const SOLO_SI = 'Completar solo si respondiste Sí a la pregunta anterior.';

  // ── 1. Identificación ──────────────────────────────────────────────────────
  form.addSectionHeaderItem().setTitle('Identificación');
  txt('DNI', 'Sin puntos', true).setValidation(
    FormApp.createTextValidation().setHelpText('Ingresá el DNI sin puntos (7 a 9 números)')
      .requireTextMatchesPattern('^[0-9]{7,9}$').build());
  txt('Apellido', null, true);
  txt('Nombres', null, true);
  txt('Email', null, true).setValidation(
    FormApp.createTextValidation().setHelpText('Ingresá un mail válido').requireTextIsEmail().build());
  txt('Teléfono', 'Código de área + número, sin 0 ni 15 (ej: 1123456789)', true).setValidation(
    FormApp.createTextValidation().setHelpText('10 números, sin 0 ni 15 ni espacios')
      .requireTextMatchesPattern('^[0-9]{10}$').build());

  const preguntaExterior = sino('¿Naciste en el exterior?');

  // Nacionalidad, estado civil y domicilio NO van: salen de la base al importar
  // (personalv5/personalv3 y el listado de domicilios del Ministerio).
  const pagExtranjero = form.addPageBreakItem().setTitle('1) Extranjero/a');
  fecha('Fecha de ingreso a la Argentina', true);
  form.addSectionHeaderItem().setTitle('Tené a mano el DNI y el documento extranjero en PDF: RRHH te los va a pedir.');

  // ── 2. Estudios ───────────────────────────────────────────────────────────
  const pagEstudios = form.addPageBreakItem().setTitle('2) Estudios');
  opcion('Secundario', ['Completo', 'Incompleto', 'No cursé'], true);
  txt('Título secundario', 'Ej: Bachiller, Perito mercantil, Técnico…', false, 50);
  opcion('Universitario / terciario', ['Completo', 'Incompleto', 'No cursé'], true);
  txt('Título universitario / terciario', 'Si está incompleto, la carrera', false, 50);
  const preguntaHayCursos = sino('¿Tenés cursos o capacitaciones para declarar?');

  const paginasCurso = [];
  const preguntasOtroCurso = [];
  for (let n = 1; n <= MAX_CURSOS; n++) {
    paginasCurso.push(form.addPageBreakItem().setTitle(`Curso ${n}`));
    txt(`Curso ${n} — Nombre`, null, true, 50);
    txt(`Curso ${n} — Institución`, null, true, 50);
    fecha(`Curso ${n} — Desde`, true);
    fecha(`Curso ${n} — Hasta`, true);
    numero(`Curso ${n} — Cantidad de horas`, null, false, 4);
    if (n < MAX_CURSOS) {
      preguntasOtroCurso.push(sino(`¿Agregar otro curso? (después del curso ${n})`));
    }
  }

  // ── 5. Declaración jurada (paso 2 del sistema) ────────────────────────────
  const pagDDJJ = form.addPageBreakItem().setTitle('3) Declaración jurada')
    .setHelpText('Respondé Sí o No a cada pregunta. Los campos de detalle se completan solo si respondiste Sí.');
  const ddjj = (n, texto) => opcion(`DDJJ ${n} — ${texto}`, ['Sí', 'No'], true);
  ddjj(1, '¿Revistás en planta permanente o transitoria, o tenés una relación contractual vigente en la Administración Pública Nacional, Provincial o Municipal?');
  form.addParagraphTextItem().setTitle('DDJJ 1 — Modalidad y situación de revista').setHelpText(SOLO_SI)
    .setValidation(FormApp.createParagraphTextValidation().requireTextLengthLessThanOrEqualTo(500).build());
  ddjj(2, '¿Te comprometés a mantener la no empleabilidad pública hasta ser notificado/a de la designación?');
  ddjj(3, '¿El cargo requiere matrícula en un Colegio o Consejo profesional?');
  lista('DDJJ 3 — Entidad certificante', ['Colegio de Abogados', 'Colegio de Anestesiólogos', 'Colegio de Arquitectos',
    'Colegio de Asistentes Sociales', 'Colegio de Bioquímicos', 'Colegio de Escribanos', 'Colegio de Farmacéuticos',
    'Colegio de Fonoaudiólogos', 'Colegio de Ingenieros', 'Colegio de Ingenieros Agrónomos y Forestales',
    'Colegio de Kinesiólogos', 'Colegio de Martilleros', 'Colegio de Médicos', 'Colegio de Nutricionistas',
    'Colegio de Obstetricia', 'Colegio de Odontólogos', 'Colegio de Ópticos', 'Colegio de Psicólogos',
    'Colegio de Sociólogos', 'Colegio de Trabajadores Sociales', 'Colegio de Traductores', 'Colegio de Veterinarios',
    'Consejo de Agrimensura', 'Consejo de Ciencias Económicas', 'Consejo de Ciencias Informáticas',
    'Consejo de Ciencias Naturales', 'Consejo de Química', 'Federación Odontológica', 'SIN COLEGIACION', 'OTRO',
    'Consejo de Higiene y Seguridad en el Trabajo']).setHelpText(SOLO_SI + ' Tené la matrícula en PDF.');
  numero('DDJJ 3 — Número de matrícula', SOLO_SI, false, 9);
  ddjj(4, '¿Tenés parentesco hasta 2.º grado con el/la Gobernador/a, Vicegobernador/a, Ministros/as u otras autoridades superiores?');
  ddjj(5, '¿Desempeñás un cargo estatutario o superior, o tenés contrato, en Nación, Provincia, Municipio, CABA o sociedad del Estado?');
  txt('DDJJ 5 — Cargo que desempeña', SOLO_SI, false, 100);
  ddjj(6, '¿Solicitaste reserva de cargo en el organismo donde revistás? (responder No si en la 5 respondiste No)');
  txt('DDJJ 6 — Número de nota y/o expediente', SOLO_SI, false, 100);
  ddjj(7, '¿Estás cumpliendo condena por delito?');
  ddjj(8, '¿Tenés proceso penal pendiente, condena o procesamiento firme (art. 294 CPPN)?');
  form.addSectionHeaderItem().setTitle('Si respondiste Sí a la 8: RRHH te va a pedir la Constancia de Estado de la Causa Penal en PDF.');
  ddjj(9, '¿Tenés inhabilitación administrativa o judicial para ejercer cargos públicos?');
  ddjj(10, '¿Obtuviste un Retiro Voluntario (Nación, Provincia o Municipio)?');
  fecha('DDJJ 10 — Fecha del retiro voluntario').setHelpText(SOLO_SI + ' Tené el acto administrativo del retiro en PDF.');
  ddjj(11, '¿Sos propietario/a, dirigís o asesorás a un concesionario o proveedor del Estado?');
  ddjj(12, '¿Gestionás concesiones o adjudicaciones en la Administración Pública?');
  ddjj(13, '¿Sos proveedor/a del organismo donde vas a trabajar?');
  ddjj(14, '¿Tenés relaciones contractuales con entidades fiscalizadas por el organismo?');
  ddjj(15, '¿Sos patrocinante o apoderado/a de terceros en trámites vinculados a tus funciones?');
  ddjj(16, '¿Ejercés la abogacía o procuración contra la Provincia?');
  ddjj(17, '¿Estás inscripto/a como deudor/a alimentario/a moroso/a?');

  // ── 6. Experiencia laboral (paso 4) ───────────────────────────────────────
  const pagExperiencia = form.addPageBreakItem().setTitle('4) Experiencia laboral')
    .setHelpText('Trabajos anteriores o actuales, en el ámbito público o privado.');
  const preguntaHayExperiencia = sino('¿Tenés experiencia laboral para declarar?');

  const paginasExperiencia = [];
  const preguntasOtraExperiencia = [];
  for (let n = 1; n <= MAX_EXPERIENCIAS; n++) {
    paginasExperiencia.push(form.addPageBreakItem().setTitle(`Experiencia ${n}`));
    txt(`Experiencia ${n} — Empresa u organismo`, null, true, 50);
    txt(`Experiencia ${n} — Cargo`, null, true, 50);
    fecha(`Experiencia ${n} — Desde`, true);
    opcion(`Experiencia ${n} — ¿Trabajás actualmente ahí?`, ['Sí', 'No'], true);
    fecha(`Experiencia ${n} — Hasta`).setHelpText('Solo si ya no trabajás ahí');
    opcion(`Experiencia ${n} — Tipo de actividad`, ['Pública', 'Privada'], true);
    opcion(`Experiencia ${n} — Ámbito`, ['Municipal', 'Provincial', 'Nacional'])
      .setHelpText('Solo si la actividad es pública');
    opcion(`Experiencia ${n} — ¿Firmaste compromiso de renuncia?`, ['Sí', 'No'], true);
    if (n < MAX_EXPERIENCIAS) {
      preguntasOtraExperiencia.push(sino(`¿Agregar otra experiencia? (después de la experiencia ${n})`));
    }
  }

  // ── 7. Otra repartición (paso 5) ──────────────────────────────────────────
  const pagOtra = form.addPageBreakItem().setTitle('5) Otra repartición')
    .setHelpText('Para la planilla de compatibilidad horaria (Ley 13.644).');
  const preguntaOtra = form.addMultipleChoiceItem()
    .setTitle('¿Revistás en otra repartición además de este hospital?').setRequired(true);

  const pagMismo = form.addPageBreakItem().setTitle('5) Otra repartición — Mismo Ministerio de Salud');
  txt('Mismo ministerio — Nombre de la repartición', 'Hospital, UPA, región sanitaria…', true, 50);
  txt('Mismo ministerio — Cargo', null, true, 50);
  lista('Mismo ministerio — Agrupamiento', ['SERVICIO', 'OBRERO', 'ADMINISTRATIVO', 'TECNICO', 'PROFESIONAL'], true);
  txt('Mismo ministerio — Categoría', null, false, 20);
  numero('Mismo ministerio — Horas semanales', null, true, 2);
  DIAS.forEach(d => horario(`Mismo ministerio — Horario ${d}`));
  txt('Mismo ministerio — Observaciones', null, false, 200);

  const pagOtro = form.addPageBreakItem().setTitle('5) Otra repartición — Otro ministerio u organismo');
  txt('Otro organismo — Ministerio u organismo', null, true, 50);
  txt('Otro organismo — Nombre de la repartición', null, true, 50);
  opcion('Otro organismo — Tipo', ['Pública', 'Privada'], true);
  txt('Otro organismo — Cargo', null, true, 50);
  txt('Otro organismo — Agrupamiento', null, false, 50);
  txt('Otro organismo — Categoría', null, false, 50);
  numero('Otro organismo — Horas semanales', null, true, 2);
  DIAS.forEach(d => horario(`Otro organismo — Horario ${d}`));
  txt('Otro organismo — Observaciones', null, false, 200);

  // ── 8. Chofer (paso 6) ────────────────────────────────────────────────────
  const pagChofer = form.addPageBreakItem().setTitle('6) Chofer');
  const preguntaChofer = sino('¿Te designan en un cargo de chofer?');

  const pagChoferDatos = form.addPageBreakItem().setTitle('6) Chofer — Licencia de conducir');
  numero('Licencia nacional de conducir N°', null, true, 8);
  opcion('¿Estás inhabilitado/a para conducir?', ['Sí', 'No'], true);

  // ── 9. Salud (paso 3) ─────────────────────────────────────────────────────
  const pagSalud = form.addPageBreakItem().setTitle('7) Declaración jurada de condiciones de salud')
    .setHelpText('Marcá solo lo que corresponda. Lo que no tengas, dejalo vacío.');
  txt('Peso (kg)', 'Ej: 72', true).setValidation(FormApp.createTextValidation()
    .setHelpText('Número en kg (ej: 72 o 72.5)').requireTextMatchesPattern('^[0-9]{2,3}([.,][0-9])?$').build());
  txt('Altura (metros)', 'Ej: 1.70', true).setValidation(FormApp.createTextValidation()
    .setHelpText('En metros (ej: 1.70)').requireTextMatchesPattern('^[12][.,][0-9]{1,2}$').build());
  casillas('Alteraciones visuales', ['Miopía', 'Astigmatismo', 'Presión ocular']);
  casillas('Alteraciones auditivas', ['Zumbidos', 'Sordera', 'Otitis', 'Disminución auditiva', 'Usa audífonos']);
  txt('Antecedentes quirúrgicos', '¿Qué cirugías y cuándo? Vacío si no tuviste', false, 200);

  opcion('¿Fumás o fumaste?', ['No', 'Sí, fumo', 'Fumaba y dejé'], true);
  fecha('Fumar — Desde');
  fecha('Fumar — Hasta').setHelpText('Solo si dejaste');
  opcion('¿Tomás bebidas alcohólicas?', ['No', 'Sí', 'Tomaba y dejé'], true);
  txt('Alcohol — ¿Qué bebida?', 'Solo si respondiste Sí', false, 100);
  numero('Alcohol — Vasos por día', 'Solo si respondiste Sí', false, 2);
  fecha('Alcohol — Desde');
  fecha('Alcohol — Hasta').setHelpText('Solo si dejaste');
  opcion('¿Tomás tranquilizantes?', ['No', 'Sí', 'Tomaba y dejé'], true);
  txt('Tranquilizantes — ¿Cuál?', 'Solo si respondiste Sí', false, 100);
  fecha('Tranquilizantes — Desde');
  fecha('Tranquilizantes — Hasta').setHelpText('Solo si dejaste');

  casillas('Vacunas', ['BCG', 'Hepatitis', 'Antigripal', 'COVID', 'Doble adulto'], 'Marcá las vacunas que tenés aplicadas. "Otro" para agregar.');
  casillas('Antecedentes metabólicos', ['Diabetes', 'Colesterol', 'Gota', 'Tiroides']);
  fecha('Fecha del último análisis de sangre');
  casillas('Antecedentes clínicos', ['Gastritis', 'Úlceras', 'Cálculos', 'Hepatitis', 'Pancreatitis',
    'Infecciones urinarias', 'Hemorroides', 'Eventraciones', 'Apendicitis', 'Enfermedades renales',
    'Vesícula', 'Hernias']);
  casillas('Antecedentes cardíacos', ['Palpitaciones', 'Infartos', 'Cardiopatía congénita', 'Insuficiencia cardíaca',
    'Dolor de pecho', 'Marcapasos']);
  numero('Presión alta — valor máximo', 'Solo si tenés presión alta (ej: 150)', false, 3);
  casillas('Antecedentes respiratorios', ['Tuberculosis', 'Broncoespasmos', 'Alergias', 'Asma', 'Neumonías', 'EPOC']);
  casillas('Aparato locomotor', ['Malformaciones', 'Amputaciones', 'Hernia de disco', 'Pérdida de fuerza',
    'Prótesis', 'Desviación de columna']);
  casillas('Antecedentes neurológicos', ['Cefalea', 'ACV', 'Convulsiones', 'Epilepsia', 'Parálisis',
    'Pérdida de conocimiento']);
  casillas('Antecedentes ginecológicos', ['Control ginecológico en los últimos 2 años',
    'Familiares directos con enfermedad oncológica', 'Papanicolaou en los últimos 2 años',
    'Mamografía en los últimos 2 años', 'Embarazos', 'Presión alta durante el embarazo',
    'Diabetes durante el embarazo'], 'Solo si corresponde. "Otro" para agregar.');
  casillas('Antecedentes andrológicos', ['Dificultad para orinar', 'Dificultad para vaciar la vejiga',
    'Control prostático en el último año', 'Consulta con urología en el último año'],
    'Solo si corresponde. "Otro" para agregar.');
  opcion('Certificado Único de Discapacidad (CUD)', ['No tengo', 'Tengo CUD vigente', 'Lo estoy tramitando'], true);
  txt('CUD — Patología', 'Solo si tenés CUD o lo estás tramitando. Si lo tenés, RRHH te va a pedir la copia en PDF.', false, 100);

  // ── 10. Declaración jurada ────────────────────────────────────────────────
  form.addPageBreakItem().setTitle('Declaración jurada');
  form.addCheckboxItem().setTitle('Declaración')
    .setChoiceValues(['DECLARO, BAJO JURAMENTO, QUE LOS DATOS PRECEDENTES SON EXACTOS.'])
    .setRequired(true);

  // ── Navegación ────────────────────────────────────────────────────────────
  preguntaExterior.setChoices([
    preguntaExterior.createChoice('Sí', pagExtranjero),
    preguntaExterior.createChoice('No', pagEstudios),
  ]);
  preguntaHayCursos.setChoices([
    preguntaHayCursos.createChoice('Sí', paginasCurso[0]),
    preguntaHayCursos.createChoice('No', pagDDJJ),
  ]);
  preguntasOtroCurso.forEach((q, i) => q.setChoices([
    q.createChoice('Sí', paginasCurso[i + 1]),
    q.createChoice('No', pagDDJJ),
  ]));
  preguntaHayExperiencia.setChoices([
    preguntaHayExperiencia.createChoice('Sí', paginasExperiencia[0]),
    preguntaHayExperiencia.createChoice('No', pagOtra),
  ]);
  preguntasOtraExperiencia.forEach((q, i) => q.setChoices([
    q.createChoice('Sí', paginasExperiencia[i + 1]),
    q.createChoice('No', pagOtra),
  ]));
  preguntaOtra.setChoices([
    preguntaOtra.createChoice('No', pagChofer),
    preguntaOtra.createChoice('Sí, en el mismo Ministerio de Salud', pagMismo),
    preguntaOtra.createChoice('Sí, en otro ministerio u organismo', pagOtro),
  ]);
  // Al terminar la página "Mismo ministerio" salta la de "Otro organismo"
  pagOtro.setGoToPage(pagChofer);
  preguntaChofer.setChoices([
    preguntaChofer.createChoice('Sí', pagChoferDatos),
    preguntaChofer.createChoice('No', pagSalud),
  ]);

  // ── Planilla de respuestas ────────────────────────────────────────────────
  const ss = SpreadsheetApp.create('Designación — Respuestas');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  Logger.log('Link para compartir con los agentes: ' + form.getPublishedUrl());
  Logger.log('Link para editar el formulario:    ' + form.getEditUrl());
  Logger.log('Planilla de respuestas:            ' + ss.getUrl());
}
