// src/routes/designacionForm.routes.ts
// Datos del agente para Designaciones del Ministerio (sistemas.ms.gba.gov.ar/grh), cargados
// desde el formulario de Google (scripts/google_forms/designacion_formulario.gs). El front lee
// el Excel bajado de la planilla de respuestas y manda las filas tal cual ({titulo: valor}).
// Tablas: mig 103 (designacion_form_*); las columnas se llaman como los campos del sistema
// del Ministerio (docs/grh_designaciones_mapa.md).
//
//   GET  /designaciones-form                           → agentes con datos importados
//   GET  /designaciones-form/:dni                      → todo lo de un agente
//   POST /designaciones-form/importar-formulario/preview   → qué se va a cargar (no escribe)
//   POST /designaciones-form/importar-formulario/confirmar → escribe los DNIs elegidos
//   GET  /designaciones-form/script                    → baja el .gs que crea el formulario
//   GET/PUT /designaciones-form/config                 → link publicado + texto del WhatsApp
//   GET  /designaciones-form/whatsapp?tanda=           → agentes de la tanda: celular, envíos, si respondió
//   POST /designaciones-form/whatsapp/envio            → registra un intento de envío
//
// Reglas del importador (igual que el del legajo):
//  - La clave es el DNI; si no está en `personal`, la fila se informa y no se carga.
//  - Varias respuestas del mismo DNI: vale la última.
//  - Datos y salud: completa lo vacío; lo que ya tiene otro valor solo se pisa con `pisar`.
//    La banda horaria de la otra repartición se reemplaza cuando se graba la otra repartición.
//  - Cursos y experiencias: se agregan los que no estén (mismo nombre / misma empresa+desde).

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes, Transaction } from 'sequelize';
import fs from 'fs';
import path from 'path';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { celularDe } from './licenciasMedicasControl.routes';

type Fila = Record<string, any>;

const norm = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function texto(v: any, max?: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || /^n\.?\s*c\.?$/i.test(s) || /^no corresponde$/i.test(s)) return null;
  return max ? s.slice(0, max) : s;
}

// 'YYYY-MM-DD[...]' o 'D/M/YYYY[ hh:mm]' → 'YYYY-MM-DD'
function aFecha(v: any): string | null {
  const s = texto(v);
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const aEntero = (v: any): number | null => {
  const s = texto(v)?.replace(/\D/g, '');
  return s ? Number(s) : null;
};

// 'Sí' / 'Sí, fumo' → 1 · 'No' → 0
const siNo = (v: any): number | null => {
  const s = norm(v);
  return s.startsWith('si') ? 1 : s === 'no' ? 0 : null;
};

const ESTUDIO: Record<string, string> = { 'completo': 'completo', 'incompleto': 'incompleto', 'no curse': 'no_curso' };

// Mismo orden que el select refEntidadCertificante del Ministerio: posición + 1 = id
const ENTIDADES = ['Colegio de Abogados', 'Colegio de Anestesiólogos', 'Colegio de Arquitectos',
  'Colegio de Asistentes Sociales', 'Colegio de Bioquímicos', 'Colegio de Escribanos', 'Colegio de Farmacéuticos',
  'Colegio de Fonoaudiólogos', 'Colegio de Ingenieros', 'Colegio de Ingenieros Agrónomos y Forestales',
  'Colegio de Kinesiólogos', 'Colegio de Martilleros', 'Colegio de Médicos', 'Colegio de Nutricionistas',
  'Colegio de Obstetricia', 'Colegio de Odontólogos', 'Colegio de Ópticos', 'Colegio de Psicólogos',
  'Colegio de Sociólogos', 'Colegio de Trabajadores Sociales', 'Colegio de Traductores', 'Colegio de Veterinarios',
  'Consejo de Agrimensura', 'Consejo de Ciencias Económicas', 'Consejo de Ciencias Informáticas',
  'Consejo de Ciencias Naturales', 'Consejo de Química', 'Federación Odontológica', 'SIN COLEGIACION', 'OTRO',
  'Consejo de Higiene y Seguridad en el Trabajo'].map(norm);

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Preguntas de casillas del formulario → columnas de salud (opción → columna) + columna de "Otro"
const CASILLAS: [string, Record<string, string>, string | null][] = [
  ['Alteraciones visuales', { 'Miopía': 'AVMiopia', 'Astigmatismo': 'AVAstigmatismo', 'Presión ocular': 'AVPresionocular' }, 'AVOtras'],
  ['Alteraciones auditivas', { 'Zumbidos': 'AAZumbidos', 'Sordera': 'AASordera', 'Otitis': 'AAOtitis',
    'Disminución auditiva': 'AADisminucion', 'Usa audífonos': 'AAAudifonos' }, 'AAOtras'],
  ['Vacunas', { 'BCG': 'VBcg', 'Hepatitis': 'VHepatitis', 'Antigripal': 'VAntigripal', 'COVID': 'VCovid',
    'Doble adulto': 'VDobleadulto' }, 'VOtras'],
  ['Antecedentes metabólicos', { 'Diabetes': 'AmDiabetes', 'Colesterol': 'AmColesterol', 'Gota': 'AmGota',
    'Tiroides': 'AmTiroides' }, null],
  ['Antecedentes clínicos', { 'Gastritis': 'AcGastritis', 'Úlceras': 'AcUlceras', 'Cálculos': 'AcCalculos',
    'Hepatitis': 'AcHepatitis', 'Pancreatitis': 'AcPancreatitis', 'Infecciones urinarias': 'AcInfUrinarias',
    'Hemorroides': 'AcHemorroides', 'Eventraciones': 'AcEventraciones', 'Apendicitis': 'AcApendicitis',
    'Enfermedades renales': 'AcEnfRenales', 'Vesícula': 'AcVesicula', 'Hernias': 'AcHernias' }, 'AcOtras'],
  ['Antecedentes cardíacos', { 'Palpitaciones': 'AcaPalpitaciones', 'Infartos': 'AcaInfartos',
    'Cardiopatía congénita': 'AcaCCongenita', 'Insuficiencia cardíaca': 'AcaInsuficiencia',
    'Dolor de pecho': 'AcaDolor', 'Marcapasos': 'AcaMarcapasos' }, 'AcaOtras'],
  ['Antecedentes respiratorios', { 'Tuberculosis': 'Artuberculosis', 'Broncoespasmos': 'ArBroncoespasmos',
    'Alergias': 'ArAlergias', 'Asma': 'ArAsma', 'Neumonías': 'ArNeumonias', 'EPOC': 'ArEPOC' }, 'ArOtras'],
  ['Aparato locomotor', { 'Malformaciones': 'AalMalformaciones', 'Amputaciones': 'AalAmputaciones',
    'Hernia de disco': 'AalHernia', 'Pérdida de fuerza': 'AalPerdidaFuerza', 'Prótesis': 'AalProtesis',
    'Desviación de columna': 'AalDesviacioncolumna' }, 'AalOtras'],
  ['Antecedentes neurológicos', { 'Cefalea': 'ANcefalea', 'ACV': 'AnACV', 'Convulsiones': 'AnConvulsiones',
    'Epilepsia': 'AnEpilepsia', 'Parálisis': 'AnParalisis', 'Pérdida de conocimiento': 'AnPerdidaconocimiento' }, 'AnOtras'],
  ['Antecedentes ginecológicos', { 'Control ginecológico en los últimos 2 años': 'AGControlGineco2anos',
    'Familiares directos con enfermedad oncológica': 'AGFamDirectosEnfOnco',
    'Papanicolaou en los últimos 2 años': 'AGPapanicolao2anos', 'Mamografía en los últimos 2 años': 'AGMamografia2anos',
    'Embarazos': 'AGEmbarazos', 'Presión alta durante el embarazo': 'AGPresionduranteembarazo',
    'Diabetes durante el embarazo': 'AGDiabetesduranteembarazo' }, 'AGOtras'],
  ['Antecedentes andrológicos', { 'Dificultad para orinar': 'AANDificultadOrinar',
    'Dificultad para vaciar la vejiga': 'AANDificultadOrinaCompleta',
    'Control prostático en el último año': 'AANCtrolProstatico1ano',
    'Consulta con urología en el último año': 'AANUrologia1ano' }, 'AANOtras'],
];

// '08:00-14:00 G' → { desde, hasta, guardia }
function aBanda(v: any) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(g)?$/i.exec(texto(v) ?? '');
  if (!m) return null;
  const hm = (h: string, mi: string) => `${h.padStart(2, '0')}:${mi}:00`;
  return { desde: hm(m[1], m[2]), hasta: hm(m[3], m[4]), guardia: m[5] ? 1 : 0 };
}

type Parseada = {
  fila: number;
  dni: number | null;
  marca: string | null;
  apellido: string | null;
  nombres: string | null;
  datos: Record<string, any>;
  banda: { dia: number; desde: string; hasta: string; guardia: number }[];
  cursos: Record<string, any>[];
  experiencias: Record<string, any>[];
  salud: Record<string, any>;
  avisos: string[];
};

function parsear(fila: Fila, idx: number): Parseada {
  const f: Record<string, any> = {};
  for (const [k, v] of Object.entries(fila)) f[norm(k)] = v;
  const g = (titulo: string) => f[norm(titulo)];
  const avisos: string[] = [];
  const dniTxt = String(g('DNI') ?? '').replace(/\D/g, '');

  const datos: Record<string, any> = {
    fecha_formulario: aFecha(g('Marca temporal')),
    email: texto(g('Email'), 120),
    telefono: texto(g('Teléfono'))?.replace(/\D/g, '').slice(-10) || null,
    fechaingresoarg: siNo(g('¿Naciste en el exterior?')) === 1 ? aFecha(g('Fecha de ingreso a la Argentina')) : null,
    secundario_estado: ESTUDIO[norm(g('Secundario'))] ?? null,
    titulo_secundario: texto(g('Título secundario'), 50),
    universitario_estado: ESTUDIO[norm(g('Universitario / terciario'))] ?? null,
    titulo_universitario: texto(g('Título universitario / terciario'), 50),
  };

  // DDJJ: la pregunta es la columna "DDJJ n — ¿…?"; los detalles tienen títulos fijos
  const DETALLES: Record<string, [string, (v: any) => any][]> = {
    1: [['DDJJ 1 — Modalidad y situación de revista', v => texto(v, 500)]],
    3: [['DDJJ 3 — Entidad certificante', v => { const i = ENTIDADES.indexOf(norm(v)); return i >= 0 ? i + 1 : null; }],
        ['DDJJ 3 — Número de matrícula', v => texto(v)?.replace(/\D/g, '').slice(0, 9) || null]],
    5: [['DDJJ 5 — Cargo que desempeña', v => texto(v, 100)]],
    6: [['DDJJ 6 — Número de nota y/o expediente', v => texto(v, 100)]],
    10: [['DDJJ 10 — Fecha del retiro voluntario', aFecha]],
  };
  const COL_DETALLE: Record<string, string> = {
    'DDJJ 1 — Modalidad y situación de revista': 'descripcioncargo',
    'DDJJ 3 — Entidad certificante': 'refEntidadCertificante', 'DDJJ 3 — Número de matrícula': 'nromatricula',
    'DDJJ 5 — Cargo que desempeña': 'cargodesempena', 'DDJJ 6 — Número de nota y/o expediente': 'expedienterespaldo',
    'DDJJ 10 — Fecha del retiro voluntario': 'fretirovoluntario',
  };
  const titulosDetalle = new Set(Object.keys(COL_DETALLE).map(norm));
  for (let n = 1; n <= 17; n++) {
    const clave = Object.keys(f).find(k => k.startsWith(`ddjj ${n} `) && !titulosDetalle.has(k));
    const resp = clave ? siNo(f[clave]) : null;
    datos[`f2p${n}`] = resp;
    for (const [titulo, conv] of DETALLES[n] ?? []) {
      const v = resp === 1 ? conv(g(titulo)) : null;
      datos[COL_DETALLE[titulo]] = v;
      if (resp === 1 && v === null) avisos.push(`DDJJ ${n} en Sí sin "${titulo.split('— ')[1]}"`);
    }
  }
  // en el sistema la 6 solo existe si la 5 es Sí
  if (datos.f2p5 !== 1) { datos.f2p6 = null; datos.expedienterespaldo = null; }

  // Otra repartición
  const otra = norm(g('¿Revistás en otra repartición además de este hospital?'));
  const banda: Parseada['banda'] = [];
  datos.revista_otra_reparticion = otra === 'no' ? 'no'
    : otra.includes('mismo') ? 'mismo_ministerio' : otra.includes('otro') ? 'otro_ministerio' : null;
  if (datos.revista_otra_reparticion === 'mismo_ministerio' || datos.revista_otra_reparticion === 'otro_ministerio') {
    const mismo = datos.revista_otra_reparticion === 'mismo_ministerio';
    const p = (c: string) => g(`${mismo ? 'Mismo ministerio' : 'Otro organismo'} — ${c}`);
    Object.assign(datos, {
      nombre_reparticion_otra: texto(p('Nombre de la repartición'), 50),
      ministerio_organismo_otro: mismo ? null : texto(p('Ministerio u organismo'), 50),
      tipo_reparticion: mismo ? null : ({ 'publica': 'publica', 'privada': 'privada' } as any)[norm(p('Tipo'))] ?? null,
      cargo_otra: texto(p('Cargo'), 50),
      agrupamiento_otra: texto(p('Agrupamiento'), 50),
      categoria_otra: texto(p('Categoría'), 50),
      regimen_horario_otra: aEntero(p('Horas semanales')),
      observaciones_otra: texto(p('Observaciones'), 200),
    });
    DIAS.forEach((d, i) => {
      const crudo = texto(p(`Horario ${d}`));
      const b = aBanda(crudo);
      if (b) banda.push({ dia: i + 1, ...b });
      else if (crudo) avisos.push(`Horario del ${d} ilegible ("${crudo}")`);
    });
  }

  // Chofer
  datos.es_chofer = siNo(g('¿Te designan en un cargo de chofer?'));
  datos.nro_licencia = datos.es_chofer === 1 ? (texto(g('Licencia nacional de conducir N°'))?.replace(/\D/g, '').slice(0, 8) || null) : null;
  datos.inhabilitado_conducir = datos.es_chofer === 1 ? siNo(g('¿Estás inhabilitado/a para conducir?')) : null;
  if (datos.inhabilitado_conducir === 1) avisos.push('Declara estar inhabilitado/a para conducir: el sistema no deja avanzar');

  // Cursos
  const cursos: Record<string, any>[] = [];
  for (let n = 1; n <= 5; n++) {
    const p = (c: string) => g(`Curso ${n} — ${c}`);
    const nombre = texto(p('Nombre'), 50);
    if (!nombre) continue;
    cursos.push({ nombrecurso: nombre, institucion: texto(p('Institución'), 50),
      fechadesde: aFecha(p('Desde')), fechahasta: aFecha(p('Hasta')), canthoras: aEntero(p('Cantidad de horas')) });
  }

  // Experiencias
  const experiencias: Record<string, any>[] = [];
  for (let n = 1; n <= 5; n++) {
    const p = (c: string) => g(`Experiencia ${n} — ${c}`);
    const empresa = texto(p('Empresa u organismo'), 50);
    if (!empresa) continue;
    const actual = siNo(p('¿Trabajás actualmente ahí?'));
    const tipo = norm(p('Tipo de actividad'));
    const publica = tipo === 'publica';
    experiencias.push({
      empresa, cargo: texto(p('Cargo'), 50),
      fechadesde: aFecha(p('Desde')),
      fechahasta: actual === 1 ? null : aFecha(p('Hasta')),
      trabajo_actualmente: actual,
      reftipoactividad: publica ? 1 : tipo === 'privada' ? 2 : null,
      refambito: publica ? ({ 'municipal': 1, 'provincial': 2, 'nacional': 3 } as any)[norm(p('Ámbito'))] ?? null : null,
      nomarchivocomprenuncia: siNo(p('¿Firmaste compromiso de renuncia?')),
    });
  }

  // Salud: si la respuesta trae la sección, lo no marcado queda en 0
  const salud: Record<string, any> = {};
  const respondioSalud = texto(g('Peso (kg)')) !== null || texto(g('Certificado Único de Discapacidad (CUD)')) !== null;
  if (respondioSalud) {
    salud.DCpeso = texto(g('Peso (kg)'))?.replace(',', '.').slice(0, 6) ?? null;
    salud.DCaltura = texto(g('Altura (metros)'))?.replace(',', '.').slice(0, 4) ?? null;
    salud.AQCirugias = texto(g('Antecedentes quirúrgicos'), 200);
    for (const [titulo, opciones, colOtras] of CASILLAS) {
      const marcadas = String(g(titulo) ?? '').split(/,\s*/).map(s => s.trim()).filter(Boolean);
      const porNorm = new Map(Object.entries(opciones).map(([op, col]) => [norm(op), col]));
      Object.values(opciones).forEach(col => { salud[col] = 0; });
      const otras: string[] = [];
      marcadas.forEach(m => { const col = porNorm.get(norm(m)); col ? (salud[col] = 1) : otras.push(m); });
      if (colOtras) salud[colOtras] = otras.length ? otras.join(', ').slice(0, colOtras === 'AVOtras' || colOtras === 'AAOtras' ? 200 : 100) : null;
      else if (otras.length) avisos.push(`${titulo}: "${otras.join(', ')}" no tiene campo en el sistema`);
    }
    salud.Fechauas = aFecha(g('Fecha del último análisis de sangre'));
    salud.AcaPresionAlta = aEntero(g('Presión alta — valor máximo'))?.toString().slice(0, 3) ?? null;

    const fumo = norm(g('¿Fumás o fumaste?'));
    salud.HFumo = fumo ? (fumo === 'no' ? 0 : 1) : null;
    salud.HFumofinicio = salud.HFumo ? aFecha(g('Fumar — Desde')) : null;
    salud.HFumofcese = salud.HFumo ? aFecha(g('Fumar — Hasta')) : null;
    const bebe = norm(g('¿Tomás bebidas alcohólicas?'));
    salud.HBebeSi = bebe ? (bebe === 'no' ? 0 : 1) : null;
    salud.HBebe = salud.HBebeSi ? texto(g('Alcohol — ¿Qué bebida?'), 100) : null;
    salud.HBebeVasos = salud.HBebeSi ? aEntero(g('Alcohol — Vasos por día')) : null;
    salud.HBebefinicio = salud.HBebeSi ? aFecha(g('Alcohol — Desde')) : null;
    salud.HBebefcese = salud.HBebeSi ? aFecha(g('Alcohol — Hasta')) : null;
    if (salud.HBebeSi && (!salud.HBebe || salud.HBebeVasos === null))
      avisos.push('Alcohol en Sí sin bebida o vasos por día (el sistema los exige)');
    const consume = norm(g('¿Tomás tranquilizantes?'));
    salud.HConsumeSi = consume ? (consume === 'no' ? 0 : 1) : null;
    salud.HConsume = salud.HConsumeSi ? texto(g('Tranquilizantes — ¿Cuál?'), 100) : null;
    salud.HConsumefinicio = salud.HConsumeSi ? aFecha(g('Tranquilizantes — Desde')) : null;
    salud.HConsumefcese = salud.HConsumeSi ? aFecha(g('Tranquilizantes — Hasta')) : null;

    const cud = norm(g('Certificado Único de Discapacidad (CUD)'));
    salud.CUD = cud ? (cud.startsWith('tengo') ? 1 : 0) : null;
    salud.CUDtramite = cud ? (cud.includes('tramitando') ? 1 : 0) : null;
    salud.CUDPatologia = salud.CUD || salud.CUDtramite ? texto(g('CUD — Patología'), 100) : null;
    if (salud.CUD) avisos.push('Tiene CUD: pedirle la copia en PDF');
  }

  // sin valor no se escribe (así "completar vacíos" no compara contra null)
  const limpio = (o: Record<string, any>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));

  return {
    fila: idx + 2,
    dni: dniTxt.length >= 7 && dniTxt.length <= 9 ? Number(dniTxt) : null,
    marca: texto(g('Marca temporal')),
    apellido: texto(g('Apellido')),
    nombres: texto(g('Nombres')),
    datos: limpio(datos), banda, cursos, experiencias, salud: limpio(salud), avisos,
  };
}

const igual = (a: any, b: any) => norm(a) === norm(b);
// fechas de la base (Date o 'YYYY-MM-DD hh:mm:ss') → 'YYYY-MM-DD' para comparar con el formulario
const aTexto = (v: any) => v instanceof Date ? v.toISOString().slice(0, 10)
  : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;

// Compara lo nuevo con la fila actual: qué completa y qué difiere
function comparar(actual: Record<string, any>, nuevo: Record<string, any>, ignorar: string[] = []) {
  const nuevos: Record<string, any> = {};
  const conflictos: { campo: string; actual: any; nuevo: any }[] = [];
  for (const [campo, v] of Object.entries(nuevo)) {
    const act = aTexto(actual[campo]);
    if (act === null || act === undefined || act === '') nuevos[campo] = v;
    else if (!ignorar.includes(campo) && !igual(act, v))
      conflictos.push({ campo, actual: act, nuevo: v });
  }
  return { nuevos, conflictos };
}

async function planificar(sequelize: Sequelize, filas: Fila[]) {
  const parseadas = filas.map(parsear);
  const ultima = new Map<number, Parseada>();
  for (const p of parseadas) {
    if (!p.dni) continue;
    const prev = ultima.get(p.dni);
    if (!prev || (p.marca ?? '') >= (prev.marca ?? '')) ultima.set(p.dni, p);
  }

  const dnis = [...ultima.keys()];
  const porDni = async (sql: string) => dnis.length
    ? (await sequelize.query(sql, { replacements: { dnis }, type: QueryTypes.SELECT })) as any[]
    : [];
  const [personas, datosAct, saludAct, cursosAct, expAct] = await Promise.all([
    porDni(`SELECT dni, apellido, nombre FROM personal WHERE dni IN (:dnis)`),
    porDni(`SELECT * FROM designacion_form_datos WHERE dni IN (:dnis)`),
    porDni(`SELECT * FROM designacion_form_salud WHERE dni IN (:dnis)`),
    porDni(`SELECT dni, nombrecurso FROM designacion_form_cursos WHERE dni IN (:dnis)`),
    porDni(`SELECT dni, empresa, fechadesde FROM designacion_form_experiencias WHERE dni IN (:dnis)`),
  ]);
  const idx = (rows: any[]) => {
    const m = new Map<number, any[]>();
    rows.forEach(r => { const k = Number(r.dni); m.set(k, [...(m.get(k) ?? []), r]); });
    return m;
  };
  const mPers = idx(personas), mDatos = idx(datosAct), mSalud = idx(saludAct), mCur = idx(cursosAct), mExp = idx(expAct);

  return parseadas.map(p => {
    const base = { fila: p.fila, dni: p.dni, marca: p.marca, nombreFormulario: [p.apellido, p.nombres].filter(Boolean).join(', ') };
    if (!p.dni) return { ...base, estado: 'DNI_INVALIDO' as const };
    if (ultima.get(p.dni) !== p) return { ...base, estado: 'REEMPLAZADA' as const };
    const pers = mPers.get(p.dni)?.[0];
    if (!pers) return { ...base, estado: 'NO_EXISTE' as const };

    const avisos = [...p.avisos];
    if (p.apellido && !igual(p.apellido, pers.apellido)) avisos.push(`Apellido distinto al del sistema (${pers.apellido})`);
    if (p.nombres && !igual(p.nombres, pers.nombre)) avisos.push(`Nombres distintos a los del sistema (${pers.nombre})`);

    // la fecha del formulario siempre se actualiza: no cuenta como conflicto
    const d = comparar(mDatos.get(p.dni)?.[0] ?? {}, p.datos, ['fecha_formulario']);
    const s = comparar(mSalud.get(p.dni)?.[0] ?? {}, p.salud);
    const curAct = (mCur.get(p.dni) ?? []).map((c: any) => norm(c.nombrecurso));
    const cursosNuevos = p.cursos.filter(c => !curAct.includes(norm(c.nombrecurso)));
    const expAct = mExp.get(p.dni) ?? [];
    const experienciasNuevas = p.experiencias.filter(e => !expAct.some((a: any) =>
      igual(a.empresa, e.empresa) && (aTexto(a.fechadesde) ?? '') === (e.fechadesde ?? '')));

    return {
      ...base,
      estado: 'OK' as const,
      nombreSistema: `${pers.apellido}, ${pers.nombre}`,
      avisos,
      datosNuevos: d.nuevos, conflictos: [...d.conflictos, ...s.conflictos.map(c => ({ ...c, salud: true }))],
      saludNuevos: s.nuevos,
      banda: p.banda,
      cursosNuevos, cursosYaCargados: p.cursos.length - cursosNuevos.length,
      experienciasNuevas, experienciasYaCargadas: p.experiencias.length - experienciasNuevas.length,
      fechaFormulario: p.datos.fecha_formulario ?? null,
    };
  });
}

let tablasListas: Promise<void> | null = null;
// Crea las tablas si faltan (DDL canónica en scripts/migrations/103 y 104)
const MIGRACIONES = ['103__designacion_formulario.sql', '104__designacion_formulario_whatsapp.sql'];
function asegurarTablas(sequelize: Sequelize): Promise<void> {
  if (!tablasListas) {
    tablasListas = (async () => {
      for (const nombre of MIGRACIONES) {
        const archivo = path.resolve(process.cwd(), 'scripts/migrations', nombre);
        if (!fs.existsSync(archivo)) { logger.warn({ msg: 'designacion_form: falta la migración', archivo }); continue; }
        const sentencias = fs.readFileSync(archivo, 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
          .split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
        for (const sql of sentencias) {
          try { await sequelize.query(sql); } catch (e: any) { logger.error({ msg: 'designacion_form: DDL', error: e?.message }); }
        }
      }
    })();
  }
  return tablasListas;
}

// Link del formulario publicado y texto del WhatsApp: compartidos por todas las PCs
const CONFIG_KEY = 'designacion_formulario';
const PLANTILLA_DEFAULT = [
  'Buenos días {NOMBRE}, le escribimos de la Oficina de Personal del Hospital.',
  '',
  'Para su trámite de designación en el Ministerio necesitamos que complete este formulario (tiene carácter de declaración jurada):',
  '{LINK}',
  '',
  'Si tiene matrícula, CUD, o documentación de un retiro voluntario o causa penal, envíenos además el PDF por este medio.',
  'Cualquier duda, ¡consúltenos por este medio!',
].join('\n');
const SCRIPT = path.resolve(process.cwd(), 'scripts/google_forms/designacion_formulario.gs');

const upsert = async (q: (sql: string, r: any[]) => Promise<any>, tabla: string, dni: number,
  datos: Record<string, any>, uid: number | null) => {
  const cols = Object.keys(datos);
  if (!cols.length) return 0;
  await q(
    `INSERT INTO ${tabla} (dni, ${cols.map(c => `\`${c}\``).join(', ')}, created_by, updated_by)
     VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)
     ON DUPLICATE KEY UPDATE ${cols.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')}, updated_by = VALUES(updated_by)`,
    [dni, ...cols.map(c => datos[c]), uid, uid]);
  return cols.length;
};

export function buildDesignacionFormRouter(sequelize: Sequelize): Router {
  const router = Router();
  const read = requirePermission('crud:*:read');
  const write = requirePermission('crud:*:*');
  const ready = asegurarTablas(sequelize);
  const userId = (req: Request): number | null => {
    const a = (req as any).auth;
    return a?.principalType === 'user' ? Number(a.principalId) || null : null;
  };
  const filasDe = (req: Request): Fila[] | null => {
    const filas = (req.body as any)?.filas;
    return Array.isArray(filas) && filas.length <= 5000 ? filas : null;
  };

  router.get('/', read, async (_req: Request, res: Response) => {
    try {
      await ready;
      const rows = await sequelize.query(
        `SELECT d.dni, p.apellido, p.nombre, d.fecha_formulario, d.revista_otra_reparticion, d.es_chofer,
                d.f2p3, d.nromatricula, s.CUD, s.CUDtramite, (s.dni IS NOT NULL) AS tiene_salud,
                (SELECT COUNT(*) FROM designacion_form_cursos c WHERE c.dni = d.dni) AS cursos,
                (SELECT COUNT(*) FROM designacion_form_experiencias e WHERE e.dni = d.dni) AS experiencias,
                d.updated_at
           FROM designacion_form_datos d
           JOIN personal p ON p.dni = d.dni
           LEFT JOIN designacion_form_salud s ON s.dni = d.dni
          ORDER BY d.updated_at DESC`, { type: QueryTypes.SELECT });
      return res.json({ ok: true, data: rows });
    } catch (err: any) {
      logger.error({ msg: 'designacion_form list', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.get('/:dni(\\d+)', read, async (req: Request, res: Response) => {
    try {
      await ready;
      const dni = Number(req.params.dni);
      const q = (sql: string) => sequelize.query(sql, { replacements: { dni }, type: QueryTypes.SELECT }) as Promise<any[]>;
      const [datos, banda, cursos, experiencias, salud] = await Promise.all([
        q(`SELECT d.*, p.apellido, p.nombre FROM designacion_form_datos d JOIN personal p ON p.dni = d.dni WHERE d.dni = :dni`),
        q(`SELECT dia, desde, hasta, guardia FROM designacion_form_otra_banda WHERE dni = :dni ORDER BY dia`),
        q(`SELECT * FROM designacion_form_cursos WHERE dni = :dni ORDER BY fechadesde, id`),
        q(`SELECT * FROM designacion_form_experiencias WHERE dni = :dni ORDER BY fechadesde, id`),
        q(`SELECT * FROM designacion_form_salud WHERE dni = :dni`),
      ]);
      if (!datos[0] && !salud[0]) return res.status(404).json({ ok: false, error: 'Sin datos de designación para ese DNI' });
      return res.json({ ok: true, data: { datos: datos[0] ?? null, banda, cursos, experiencias, salud: salud[0] ?? null } });
    } catch (err: any) {
      logger.error({ msg: 'designacion_form get', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── Formulario: script para crearlo, link publicado y envío por WhatsApp a una tanda ──

  router.get('/script', read, (_req: Request, res: Response) => {
    if (!fs.existsSync(SCRIPT)) return res.status(404).json({ ok: false, error: 'No está el script del formulario en el servidor' });
    return res.download(SCRIPT, 'designacion_formulario.gs');
  });

  router.get('/config', read, async (_req: Request, res: Response) => {
    try {
      await ready;
      const row = await sequelize.query<any>(
        `SELECT config_json FROM app_runtime_config WHERE config_key = :k`,
        { replacements: { k: CONFIG_KEY }, type: QueryTypes.SELECT, plain: true }).catch(() => null);
      const cfg = row?.config_json ? (typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json) : {};
      return res.json({ ok: true, data: { link: cfg.link ?? '', plantilla: cfg.plantilla || PLANTILLA_DEFAULT, plantillaDefault: PLANTILLA_DEFAULT } });
    } catch (err: any) {
      logger.error({ msg: 'designacion_form config get', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.put('/config', write, async (req: Request, res: Response) => {
    try {
      await ready;
      const link = String((req.body as any)?.link ?? '').trim();
      const plantilla = String((req.body as any)?.plantilla ?? '').trim();
      if (link && !/^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/i.test(link))
        return res.status(400).json({ ok: false, error: 'El link tiene que ser de Google Forms (docs.google.com/forms/… o forms.gle/…)' });
      if (plantilla && !plantilla.includes('{LINK}'))
        return res.status(400).json({ ok: false, error: 'El mensaje tiene que tener {LINK}' });
      await sequelize.query(
        `INSERT INTO app_runtime_config (config_key, config_json, updated_by, created_at, updated_at)
         VALUES (:k, :j, :u, NOW(), NOW())
         ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
        { replacements: { k: CONFIG_KEY, j: JSON.stringify({ link, plantilla: plantilla || PLANTILLA_DEFAULT }), u: userId(req) } });
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: 'designacion_form config put', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // Agentes de la tanda con su celular, el último envío real y si ya respondió el formulario
  router.get('/whatsapp', write, async (req: Request, res: Response) => {
    try {
      await ready;
      const tanda = String(req.query.tanda ?? '').trim();
      if (!tanda) return res.status(400).json({ ok: false, error: 'Falta la tanda' });
      const rows = await sequelize.query<any>(
        `SELECT t.dni, p.apellido, p.nombre, p.telefono, d.fecha_formulario,
                e.estado AS ultimo_estado, e.destino AS ultimo_destino, e.created_at AS ultimo_envio,
                (SELECT COUNT(*) FROM designacion_form_whatsapp w WHERE w.dni = t.dni AND w.prueba = 0 AND w.estado = 'ENVIADO') AS enviados
           FROM tramites_tanda_interinos t
           JOIN personal p ON p.dni = t.dni
           LEFT JOIN designacion_form_datos d ON d.dni = t.dni
           LEFT JOIN designacion_form_whatsapp e ON e.id = (
             SELECT MAX(w.id) FROM designacion_form_whatsapp w WHERE w.dni = t.dni AND w.prueba = 0)
          WHERE t.tanda = :tanda
          ORDER BY p.apellido, p.nombre`,
        { replacements: { tanda }, type: QueryTypes.SELECT });
      return res.json({
        ok: true,
        data: rows.map(r => ({
          dni: Number(r.dni), apellido: r.apellido ?? '', nombre: r.nombre ?? '', telefono: r.telefono ?? '',
          ...celularDe(r.telefono),
          respondio: r.fecha_formulario ? String(r.fecha_formulario).slice(0, 10) : null,
          ultimoEstado: r.ultimo_estado ?? null, ultimoDestino: r.ultimo_destino ?? null,
          ultimoEnvio: r.ultimo_envio ? new Date(r.ultimo_envio).toISOString() : null,
          enviados: Number(r.enviados) || 0,
        })),
      });
    } catch (err: any) {
      logger.error({ msg: 'designacion_form whatsapp list', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post('/whatsapp/envio', write, async (req: Request, res: Response) => {
    try {
      await ready;
      const b = (req.body ?? {}) as any;
      const dni = Number(b.dni);
      const estado = String(b.estado ?? '').toUpperCase();
      if (!Number.isInteger(dni) || dni <= 0) return res.status(400).json({ ok: false, error: 'DNI inválido' });
      if (!['ENVIADO', 'NO_ENCONTRADO', 'SIN_WHATSAPP', 'ERROR'].includes(estado))
        return res.status(400).json({ ok: false, error: 'Estado inválido' });
      await sequelize.query(
        `INSERT INTO designacion_form_whatsapp (dni, tanda, destino, modo, estado, detalle, prueba, mensaje, enviado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        { replacements: [dni, texto(b.tanda, 120), texto(b.destino, 60), texto(b.modo, 20), estado,
          texto(b.detalle, 255), b.prueba ? 1 : 0, texto(b.mensaje), userId(req)] });
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: 'designacion_form whatsapp envio', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post('/importar-formulario/preview', write, async (req: Request, res: Response) => {
    try {
      await ready;
      const filas = filasDe(req);
      if (!filas) return res.status(400).json({ ok: false, error: 'Mandá las filas de la planilla (máx. 5000)' });
      return res.json({ ok: true, data: await planificar(sequelize, filas) });
    } catch (err: any) {
      logger.error({ msg: 'designacion_form import preview', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post('/importar-formulario/confirmar', write, async (req: Request, res: Response) => {
    try {
      await ready;
      const filas = filasDe(req);
      const elegidos = new Set<number>(((req.body as any)?.dnis ?? []).map(Number));
      const pisar = !!(req.body as any)?.pisar;
      if (!filas || !elegidos.size) return res.status(400).json({ ok: false, error: 'Faltan filas o DNIs a importar' });
      const uid = userId(req);
      // se vuelve a planificar en el servidor: no se confía en lo que devolvió el preview
      const plan = (await planificar(sequelize, filas)).filter((r: any) => r.estado === 'OK' && elegidos.has(r.dni));

      const resumen = { agentes: 0, datos: 0, salud: 0, cursos: 0, experiencias: 0 };
      for (const r of plan as any[]) {
        await sequelize.transaction(async (t: Transaction) => {
          const q = (sql: string, replacements: any[]) => sequelize.query(sql, { replacements, transaction: t });
          const datos = { ...r.datosNuevos };
          const salud = { ...r.saludNuevos };
          if (pisar) r.conflictos.forEach((c: any) => { (c.salud ? salud : datos)[c.campo] = c.nuevo; });
          if (r.fechaFormulario) datos.fecha_formulario = r.fechaFormulario;
          // la fila de datos siempre existe (la banda cuelga de ella)
          resumen.datos += await upsert(q, 'designacion_form_datos', r.dni, datos, uid);
          await q(`INSERT IGNORE INTO designacion_form_datos (dni, created_by, updated_by) VALUES (?, ?, ?)`, [r.dni, uid, uid]);
          resumen.salud += await upsert(q, 'designacion_form_salud', r.dni, salud, uid);

          if (datos.revista_otra_reparticion || pisar) {
            await q(`DELETE FROM designacion_form_otra_banda WHERE dni = ?`, [r.dni]);
            for (const b of r.banda) {
              await q(`INSERT INTO designacion_form_otra_banda (dni, dia, desde, hasta, guardia) VALUES (?, ?, ?, ?, ?)`,
                [r.dni, b.dia, b.desde, b.hasta, b.guardia]);
            }
          }
          for (const c of r.cursosNuevos) {
            await q(`INSERT INTO designacion_form_cursos (dni, nombrecurso, institucion, fechadesde, fechahasta, canthoras, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [r.dni, c.nombrecurso, c.institucion, c.fechadesde, c.fechahasta, c.canthoras, uid]);
            resumen.cursos++;
          }
          for (const e of r.experienciasNuevas) {
            await q(`INSERT INTO designacion_form_experiencias (dni, empresa, cargo, fechadesde, fechahasta, trabajo_actualmente,
                       reftipoactividad, refambito, nomarchivocomprenuncia, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [r.dni, e.empresa, e.cargo, e.fechadesde, e.fechahasta, e.trabajo_actualmente,
               e.reftipoactividad, e.refambito, e.nomarchivocomprenuncia, uid]);
            resumen.experiencias++;
          }
        });
        resumen.agentes++;
      }
      return res.json({ ok: true, data: resumen });
    } catch (err: any) {
      logger.error({ msg: 'designacion_form import confirmar', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}
