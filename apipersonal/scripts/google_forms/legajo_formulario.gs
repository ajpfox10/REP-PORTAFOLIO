/**
 * Formulario de Google — Precarga del Legajo Personal (PBA / Ministerio de Salud)
 *
 * Crea un Google Form con los datos que declara el agente para su legajo, y una
 * planilla de Google Sheets donde caen las respuestas (después se importan a las
 * tablas legajo_* del sistema, usando el DNI como clave).
 *
 * CÓMO USARLO (una sola vez):
 *   1. Entrar a https://script.google.com con la cuenta de Google que va a ser dueña del formulario.
 *   2. "Nuevo proyecto" → borrar lo que haya → pegar TODO este archivo.
 *   3. Elegir la función `crearFormularioLegajo` arriba y tocar "Ejecutar".
 *   4. Aceptar los permisos que pide Google (Formularios y Hojas de cálculo).
 *   5. En "Registro de ejecución" aparecen los links: para compartir, para editar y la planilla.
 *
 * Obligatorio: hoja 1 (datos personales) y familia. El domicilio NO va: se toma de
 * otra fuente (domicilios de internet). Carta de ciudadanía,
 * títulos y servicio militar se preguntan con Sí/No (o nivel de estudios) y, si
 * corresponden, sus datos son obligatorios. Lo que no aplica se responde "NC".
 *
 * Los títulos de las preguntas son las columnas de la planilla: NO cambiarlos si se va
 * a usar el importador al sistema (se pueden cambiar descripciones/ayudas sin problema).
 *
 * Se dejan afuera las hojas que completa RRHH (foja de servicios, bonificaciones,
 * licencias, 55/80, concepto, penas, embargos): el agente no tiene esos datos.
 */

const MAX_FAMILIARES = 8;

function crearFormularioLegajo() {
  const form = FormApp.create('Legajo Personal — Precarga de datos del agente');
  form.setDescription(
    'Provincia de Buenos Aires — Ministerio de Salud.\n' +
    'Completá tus datos para actualizar tu Legajo Personal. Los datos tienen carácter de ' +
    'declaración jurada. Si un dato no corresponde, dejalo en blanco.'
  );
  form.setProgressBar(true);
  form.setAllowResponseEdits(true);
  form.setConfirmationMessage('¡Gracias! Tus datos fueron enviados a Recursos Humanos.');

  const txt = (titulo, ayuda, obligatorio) => {
    const it = form.addTextItem().setTitle(titulo).setRequired(!!obligatorio);
    if (ayuda) it.setHelpText(ayuda);
    return it;
  };
  const fecha = (titulo, obligatorio) => form.addDateItem().setTitle(titulo).setRequired(!!obligatorio);
  const opcion = (titulo, opciones, obligatorio) =>
    form.addMultipleChoiceItem().setTitle(titulo).setChoiceValues(opciones).setRequired(!!obligatorio);
  const lista = (titulo, opciones) => form.addListItem().setTitle(titulo).setChoiceValues(opciones);
  const montoValido = FormApp.createTextValidation()
    .setHelpText('Solo números, sin puntos ni signo $ (ej: 150000)')
    .requireNumber().build();

  // ── 1. Identificación ──────────────────────────────────────────────────────
  form.addSectionHeaderItem().setTitle('Identificación');
  txt('DNI', 'Sin puntos', true).setValidation(
    FormApp.createTextValidation().setHelpText('Ingresá el DNI sin puntos (7 a 9 números)')
      .requireTextMatchesPattern('^[0-9]{7,9}$').build());
  txt('Apellido', null, true);
  txt('Nombres', null, true);
  txt('CUIL', 'Con o sin guiones');
  txt('Correo electrónico', 'Para avisarte si falta algún dato').setValidation(
    FormApp.createTextValidation().requireTextIsEmail().build());

  // Hoja 1 (datos personales) y familia son OBLIGATORIOS. Lo que no aplica a
  // todos se pregunta con Sí/No y, si corresponde, su página también es obligatoria.
  const NC = 'Si no corresponde, escribí NC';

  // ── 2. Filiación ──────────────────────────────────────────────────────────
  form.addPageBreakItem().setTitle('1) Datos personales — a) Filiación');
  fecha('Fecha de nacimiento', true);
  txt('Nacido en país', null, true);
  txt('Provincia de nacimiento', 'Si nació en el exterior, escribí la provincia/estado de ese país', true);
  txt('Partido de nacimiento', 'Partido, departamento o ciudad', true);
  opcion('Estado civil', ['Soltera/o', 'Casada/o', 'Viuda/o', 'Separada/o'], true);

  // ── 3. Identidad ──────────────────────────────────────────────────────────
  form.addPageBreakItem().setTitle('b) Identidad');
  txt('Clase', 'Año de clase que figura en la libreta/DNI (ej: 1980). ' + NC, true);
  txt('Distrito militar', NC, true);
  txt('Cédula de identidad N°', NC, true);
  txt('Cédula expedida por', NC, true);
  const preguntaCarta = form.addMultipleChoiceItem()
    .setTitle('¿Sos argentino/a naturalizado/a (tenés carta de ciudadanía)?').setRequired(true);

  const pagCarta = form.addPageBreakItem().setTitle('b) Identidad — Carta de ciudadanía');
  txt('Carta de ciudadanía N°', null, true);
  txt('Carta de ciudadanía otorgada en', null, true);
  fecha('Fecha de otorgamiento de la carta de ciudadanía', true);
  txt('Juez federal (carta de ciudadanía)', null, true);

  // ── 4. Aptitud ────────────────────────────────────────────────────────────
  const pagAptitud = form.addPageBreakItem().setTitle('c) Aptitud — Estudios');
  txt('Detalle de estudios', 'Ej: secundario completo, universitario incompleto, posgrado…', true);
  txt('Aptitud especial por profesión u oficio', NC, true);
  const preguntaNivel = form.addMultipleChoiceItem()
    .setTitle('Nivel de estudios cursados').setRequired(true);

  // Universitario pasa por las dos páginas de títulos; secundario solo por la segunda
  const pagTitUniv = form.addPageBreakItem().setTitle('c) Aptitud — Título universitario');
  txt('Título universitario', null, true);
  txt('Título universitario otorgado por', 'Universidad / instituto', true);

  const pagTitSec = form.addPageBreakItem().setTitle('c) Aptitud — Título secundario o técnico');
  txt('Título secundario o técnico', null, true);
  txt('Título secundario otorgado por', 'Escuela / institución', true);

  // ── 5. Servicio militar ───────────────────────────────────────────────────
  const pagMilitar = form.addPageBreakItem().setTitle('d) Servicios militares');
  txt('Motivo de la excepción', 'Solo si fuiste exceptuado del servicio militar obligatorio');
  const preguntaMilitar = form.addMultipleChoiceItem()
    .setTitle('¿Prestó servicios militares?').setRequired(true);

  const pagMilDatos = form.addPageBreakItem().setTitle('d) Servicios militares — Datos');
  txt('Arma', null, true);
  txt('Especialidad militar', null, true);
  txt('Grado', null, true);
  txt('Destino militar', null, true);

  // ── 7. Familia (navegación: se agregan familiares de a uno) ───────────────
  const pagFamilia = form.addPageBreakItem().setTitle('2) Familia')
    .setHelpText('Cónyuge, hijos, padres y demás familiares a cargo o convivientes.');
  const preguntaHayFamilia = form.addMultipleChoiceItem()
    .setTitle('¿Tenés familiares para declarar?').setRequired(true);

  const paginasFamiliar = [];
  const preguntasOtro = [];
  for (let n = 1; n <= MAX_FAMILIARES; n++) {
    paginasFamiliar.push(form.addPageBreakItem().setTitle(`Familiar ${n}`));
    lista(`Familiar ${n} — Parentesco`,
      ['Cónyuge', 'Concubina/o', 'Hija/o', 'Madre', 'Padre', 'Hermana/o', 'Otro']).setRequired(true);
    txt(`Familiar ${n} — Apellido y nombres`, null, true);
    txt(`Familiar ${n} — DNI`, 'Sin puntos', true);
    opcion(`Familiar ${n} — Sexo`, ['Femenino', 'Masculino', 'X'], true);
    opcion(`Familiar ${n} — ¿Vive?`, ['Sí', 'No'], true);
    fecha(`Familiar ${n} — Fecha de nacimiento`, true);
    opcion(`Familiar ${n} — Situación laboral`, ['No trabaja', 'Empleado', 'Jubilado o pensionado'], true);
    txt(`Familiar ${n} — Empleo`, 'Si trabaja: dónde y en qué');
    txt(`Familiar ${n} — Jubilación o pensión`, 'Si es jubilado/pensionado: caja y monto');
    if (n < MAX_FAMILIARES) {
      preguntasOtro.push(form.addMultipleChoiceItem()
        .setTitle(`¿Agregar otro familiar? (después del familiar ${n})`).setRequired(true));
    }
  }

  // ── 8. Incompatibilidad ───────────────────────────────────────────────────
  const pagIncomp = form.addPageBreakItem().setTitle('10) Incompatibilidad');
  opcion('¿Percibe jubilación, pensión o retiro?', ['No', 'Jubilación', 'Pensión', 'Retiro'], true);
  txt('Jubilación — Ley número');
  txt('Jubilación — Caja');
  txt('Jubilación — Monto mensual').setValidation(montoValido);
  fecha('Jubilación — Fecha de otorgamiento');
  opcion('¿Desempeña algún otro cargo?', ['Sí', 'No'], true);
  txt('Otro cargo — Nacional', 'Organismo y cargo, si es nacional');
  txt('Otro cargo — Provincial', 'Organismo y cargo, si es provincial');
  txt('Otro cargo — Municipal', 'Organismo y cargo, si es municipal');
  txt('Otro cargo — Lugar donde lo desempeña');
  txt('Otro cargo — Horario');
  txt('Otro cargo — Monto del sueldo, comisión u honorarios').setValidation(montoValido);
  fecha('Otro cargo — Fecha de ingreso');
  txt('Otras actividades (carácter)');
  txt('Otras actividades — Lugar donde las desempeña');
  txt('Otras actividades — Monto del sueldo, comisión u honorarios').setValidation(montoValido);
  fecha('Otras actividades — Fecha de ingreso');
  form.addParagraphTextItem().setTitle('Incompatibilidad — Observaciones');

  // ── 9. Declaración de bienes ──────────────────────────────────────────────
  form.addPageBreakItem().setTitle('12) Declaración de bienes');
  form.addParagraphTextItem().setTitle('Bienes a declarar')
    .setHelpText('Un bien por renglón (inmuebles, vehículos, etc.). Dejar en blanco si no corresponde.');

  // ── 10. Declaración jurada ────────────────────────────────────────────────
  form.addPageBreakItem().setTitle('Declaración jurada');
  form.addCheckboxItem().setTitle('Declaración')
    .setChoiceValues(['DECLARO, BAJO JURAMENTO, QUE LOS DATOS PRECEDENTES SON EXACTOS.'])
    .setRequired(true);

  // ── Navegación ────────────────────────────────────────────────────────────
  preguntaCarta.setChoices([
    preguntaCarta.createChoice('Sí', pagCarta),
    preguntaCarta.createChoice('No', pagAptitud),
  ]);
  preguntaNivel.setChoices([
    preguntaNivel.createChoice('Primario', pagMilitar),
    preguntaNivel.createChoice('Secundario o técnico', pagTitSec),
    preguntaNivel.createChoice('Universitario', pagTitUniv),
  ]);
  preguntaMilitar.setChoices([
    preguntaMilitar.createChoice('Sí', pagMilDatos),
    preguntaMilitar.createChoice('No', pagFamilia),
  ]);
  preguntaHayFamilia.setChoices([
    preguntaHayFamilia.createChoice('Sí', paginasFamiliar[0]),
    preguntaHayFamilia.createChoice('No', pagIncomp),
  ]);
  preguntasOtro.forEach((q, i) => q.setChoices([
    q.createChoice('Sí', paginasFamiliar[i + 1]),
    q.createChoice('No', pagIncomp),
  ]));

  // ── Planilla de respuestas ────────────────────────────────────────────────
  const ss = SpreadsheetApp.create('Legajo Personal — Respuestas');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  Logger.log('Link para compartir con los agentes: ' + form.getPublishedUrl());
  Logger.log('Link para editar el formulario:    ' + form.getEditUrl());
  Logger.log('Planilla de respuestas:            ' + ss.getUrl());
}
