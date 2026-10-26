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
  txt('WhatsApp', 'Para avisarte si falta algún dato. Código de área + número, sin 0 ni 15 (ej: 1123456789)')
    .setValidation(FormApp.createTextValidation()
      .setHelpText('Solo números, sin 0 ni 15 ni espacios (ej: 1123456789)')
      .requireTextMatchesPattern('^[0-9]{10,13}$').build());

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

  ponerAyudas(form);

  Logger.log('Link para compartir con los agentes: ' + form.getPublishedUrl());
  Logger.log('Link para editar el formulario:    ' + form.getEditUrl());
  Logger.log('Planilla de respuestas:            ' + ss.getUrl());
}

// ════════════════════════════════════════════════════════════════════════════
// AYUDAS — texto gris debajo de cada pregunta/página explicando qué es cada cosa
//
// Para el formulario que YA existe (mantiene el link y las respuestas):
//   1. Pegar el link de edición del formulario (el que termina en /edit) en URL_FORMULARIO.
//   2. Elegir la función `agregarAyudas` arriba y tocar "Ejecutar".
//   Se puede volver a correr las veces que haga falta: pisa las ayudas, no toca títulos ni respuestas.
// crearFormularioLegajo ya las pone solo en los formularios nuevos.
// ════════════════════════════════════════════════════════════════════════════

const URL_FORMULARIO = 'PEGAR ACÁ EL LINK DE EDICIÓN DEL FORMULARIO';

// Clave = título de la pregunta o de la página. Las de los familiares van sin el número
// ("Familiar — DNI" vale para Familiar 1 — DNI, Familiar 2 — DNI, …).
const AYUDAS = {
  // Identificación
  'DNI': 'Tu número de documento, sin puntos (ej: 28123456).',
  'Apellido': 'Como figura en el DNI.',
  'Nombres': 'Todos tus nombres, como figuran en el DNI.',
  'CUIL': 'Figura en el recibo de sueldo y en el dorso del DNI nuevo. Con o sin guiones.',

  // a) Filiación
  '1) Datos personales — a) Filiación': 'Datos de tu nacimiento, como figuran en el DNI o la partida de nacimiento.',
  'Nacido en país': 'País donde naciste (ej: Argentina, Paraguay, Bolivia).',
  'Provincia de nacimiento': 'Provincia donde naciste. Si naciste en otro país, la provincia, estado o departamento de ese país.',
  'Partido de nacimiento': 'Partido o ciudad donde naciste (ej: La Matanza, Morón, Capital Federal).',
  'Estado civil': 'El que tenés hoy legalmente. Si convivís pero no estás casada/o, marcá Soltera/o.',

  // b) Identidad
  'b) Identidad': 'Documentos viejos que pide el legajo oficial. Si no tuviste alguno, escribí NC (no corresponde).',
  'Clase': 'Es tu año de nacimiento, como figuraba en la libreta de enrolamiento o libreta cívica (ej: 1965). ' +
    'Si siempre tuviste DNI y nunca libreta, escribí NC.',
  'Distrito militar': 'El número de distrito militar que figura en la libreta de enrolamiento ' +
    '(solo varones con libreta). Si no tenés libreta, escribí NC.',
  'Cédula de identidad N°': 'La cédula vieja de la Policía Federal o de la provincia, que es distinta del DNI. ' +
    'Si nunca la tuviste, escribí NC.',
  'Cédula expedida por': 'Quién te dio la cédula (ej: Policía Federal, Policía de la Provincia de Buenos Aires). ' +
    'Si no tuviste cédula, escribí NC.',
  '¿Sos argentino/a naturalizado/a (tenés carta de ciudadanía)?':
    'Solo si naciste en otro país y te hiciste ciudadano/a argentino/a ante un juez. ' +
    'Si naciste en Argentina, marcá No.',
  'b) Identidad — Carta de ciudadanía': 'Datos del documento que te dio el juzgado cuando te hiciste ciudadano/a argentino/a.',
  'Carta de ciudadanía N°': 'El número que figura en la carta de ciudadanía.',
  'Carta de ciudadanía otorgada en': 'Ciudad donde está el juzgado que te la dio.',
  'Fecha de otorgamiento de la carta de ciudadanía': 'La fecha que figura en la carta.',
  'Juez federal (carta de ciudadanía)': 'Nombre del juez o número de juzgado federal que la firmó.',

  // c) Aptitud
  'c) Aptitud — Estudios': 'Tus estudios y lo que sabés hacer.',
  'Detalle de estudios': 'Hasta dónde llegaste y si está completo (ej: secundario completo, ' +
    'enfermería universitaria incompleta, posgrado en terapia intensiva).',
  'Aptitud especial por profesión u oficio': 'Algo que sabés hacer y puede servir en el trabajo aunque no sea tu puesto ' +
    '(ej: electricista, idiomas, computación, chofer, cocina). Si no, escribí NC.',
  'Nivel de estudios cursados': 'El nivel más alto al que llegaste, aunque no lo hayas terminado.',
  'c) Aptitud — Título universitario': 'Solo si tenés un título universitario o terciario terminado.',
  'Título universitario': 'Como figura en el título (ej: Licenciada en Enfermería, Médico).',
  'Título universitario otorgado por': 'Universidad o instituto que te dio el título.',
  'c) Aptitud — Título secundario o técnico': 'El título del secundario o de la escuela técnica.',
  'Título secundario o técnico': 'Como figura en el título (ej: Bachiller, Perito Mercantil, Técnico Químico).',
  'Título secundario otorgado por': 'Nombre y número de la escuela.',

  // d) Servicios militares
  'd) Servicios militares': 'El servicio militar obligatorio (la "colimba") terminó en 1995: ' +
    'esto es para quienes lo hicieron o fueron exceptuados.',
  'Motivo de la excepción': 'Solo si te tocó y no lo hiciste: el motivo que figura en la libreta ' +
    '(ej: número bajo en el sorteo, salud, sostén de familia). Si no corresponde, dejalo en blanco.',
  '¿Prestó servicios militares?': 'Si hiciste la colimba o fuiste militar. Si no, marcá No.',
  'd) Servicios militares — Datos': 'Datos que figuran en la libreta de enrolamiento.',
  'Arma': 'Ejército, Armada (Marina) o Fuerza Aérea.',
  'Especialidad militar': 'Lo que hacías (ej: infantería, sanidad, comunicaciones).',
  'Grado': 'El grado con el que terminaste (ej: soldado, cabo).',
  'Destino militar': 'El regimiento, batallón o unidad donde estuviste.',

  // 2) Familia
  '¿Tenés familiares para declarar?': 'Cónyuge o concubino/a, hijos, y padres o hermanos que vivan con vos o estén a tu cargo.',
  'Familiar — Parentesco': 'Qué es de vos esa persona.',
  'Familiar — Apellido y nombres': 'Como figuran en su DNI.',
  'Familiar — DNI': 'El DNI del familiar, sin puntos.',
  'Familiar — ¿Vive?': 'Marcá No si falleció. Igual conviene declararlo si es tu padre, madre, hijo/a o cónyuge.',
  'Familiar — Fecha de nacimiento': 'La fecha de nacimiento del familiar.',
  'Familiar — Situación laboral': 'Si trabaja, si está jubilado/a o pensionado/a, o si no trabaja.',
  'Familiar — Empleo': 'Si trabaja: dónde y en qué (ej: comercio, Municipio de La Matanza).',
  'Familiar — Jubilación o pensión': 'Si es jubilado/a o pensionado/a: la caja que le paga (ANSES, IPS…) y el monto aproximado.',

  // 10) Incompatibilidad
  '10) Incompatibilidad': 'El Estado tiene que saber si cobrás otro sueldo público o una jubilación, ' +
    'para controlar que los horarios y cargos sean compatibles. Completá solo lo que te corresponde.',
  '¿Percibe jubilación, pensión o retiro?': 'Si ya cobrás una jubilación, una pensión (ej: por viudez) o un retiro ' +
    '(policial o militar). Si no, marcá No y salteá las preguntas de jubilación.',
  'Jubilación — Ley número': 'La ley por la que te jubilaste, si la sabés (figura en la resolución).',
  'Jubilación — Caja': 'Quién te la paga (ej: ANSES, IPS, Caja de Policía).',
  'Jubilación — Monto mensual': 'Lo que cobrás por mes, sin puntos ni signo $.',
  'Jubilación — Fecha de otorgamiento': 'Desde cuándo la cobrás.',
  '¿Desempeña algún otro cargo?': 'Si tenés otro trabajo en el Estado: otro hospital, municipio, escuela, ' +
    'universidad, etc. Los trabajos privados van en "Otras actividades".',
  'Otro cargo — Nacional': 'Organismo y cargo, si es del Estado nacional (ej: Hospital Posadas, enfermera).',
  'Otro cargo — Provincial': 'Organismo y cargo, si es de la Provincia (ej: otro hospital provincial, docente).',
  'Otro cargo — Municipal': 'Organismo y cargo, si es de un municipio (ej: Municipio de La Matanza, UPA, CAPS).',
  'Otro cargo — Lugar donde lo desempeña': 'Dirección o nombre del lugar.',
  'Otro cargo — Horario': 'Días y horario de ese otro cargo (ej: lunes a viernes de 14 a 20).',
  'Otro cargo — Monto del sueldo, comisión u honorarios': 'Lo que cobrás por mes en ese cargo, sin puntos ni signo $.',
  'Otro cargo — Fecha de ingreso': 'Cuándo empezaste en ese cargo.',
  'Otras actividades (carácter)': 'Trabajos privados o por tu cuenta (ej: clínica privada, consultorio, comercio). ' +
    'Si no tenés, dejalo en blanco.',
  'Otras actividades — Lugar donde las desempeña': 'Nombre o dirección del lugar.',
  'Otras actividades — Monto del sueldo, comisión u honorarios': 'Lo que cobrás por mes, sin puntos ni signo $.',
  'Otras actividades — Fecha de ingreso': 'Desde cuándo lo hacés.',
  'Incompatibilidad — Observaciones': 'Cualquier aclaración sobre lo anterior.',

  // 12) Bienes y declaración jurada
  'Bienes a declarar': 'Un bien por renglón: casas, terrenos, autos, motos (ej: "Casa en González Catán", ' +
    '"Auto Fiat Palio 2015"). Dejalo en blanco si no corresponde.',
  'Declaración': 'Al tildar, declarás que lo que escribiste es verdad. Es obligatorio para enviar el formulario.',
};

function agregarAyudas() {
  if (!/\/edit/.test(URL_FORMULARIO)) throw new Error('Pegá el link de edición del formulario en URL_FORMULARIO');
  ponerAyudas(FormApp.openByUrl(URL_FORMULARIO));
}

function ponerAyudas(form) {
  let puestas = 0;
  const faltan = new Set(Object.keys(AYUDAS));
  form.getItems().forEach(item => {
    const clave = item.getTitle().replace(/^Familiar \d+ — /, 'Familiar — ');
    if (!(clave in AYUDAS)) return;
    item.setHelpText(AYUDAS[clave]);
    faltan.delete(clave);
    puestas++;
  });
  Logger.log(`Ayudas puestas: ${puestas}`);
  if (faltan.size) Logger.log('No se encontró la pregunta: ' + [...faltan].join(' | '));
}
