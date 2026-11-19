// src/services/legajoAutocarga.ts
// Legajo por enlace (mig 138, 18/11/2026): el agente completa sus datos del Legajo Personal desde un enlace
// único que le manda la oficina por WhatsApp. Usa el MISMO servidor público y el mismo túnel que la Agenda
// de turnos (src/publico/turnosPublicoServer.ts → /l/:token).
//
// Seguridad (igual que la Agenda): el servidor público solo lee y escribe la tabla de espera
// `legajo_autocarga` (columnas puntuales, ver scripts/crear_usuario_publico.cjs). Nunca lee `personal` ni
// escribe en legajo_*: lo que manda el agente lo revisa y aprueba la oficina, y recién ahí se carga con la
// misma lógica del importador del Formulario de Google (routes/legajoImportForm.ts), que sigue disponible.
//
// Las respuestas se guardan con los MISMOS títulos de pregunta del Formulario de Google
// (scripts/google_forms/legajo_formulario.gs): así el importador las entiende sin cambios.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../logging/logger';
import { planificar, aplicarPlan } from '../routes/legajoImportForm';
import { hoyAR, sumarDias } from './agendaTurnos';

export class LegajoEnlaceError extends Error {
  status: number;
  constructor(msg: string, status = 400) { super(msg); this.status = status; }
}

export const MAX_FAMILIARES = 8;
export const DIAS_VENCE_DEFAULT = 15;
export const CONFIG_KEY = 'legajo_autocarga';
export const PLANTILLA_DEFAULT = [
  'Hola {NOMBRE}, le escribimos de la Oficina de Personal del Hospital.',
  '',
  'Para actualizar su *Legajo Personal* complete sus datos en este enlace (puede hacerlo en varias veces, se guarda solo):',
  '{LINK}',
  '',
  'El enlace es personal. Vence el {VENCE}.',
].join('\n');

// ── Definición del formulario ───────────────────────────────────────────────
// t = título (= columna del Formulario de Google), tipo, op = opciones, req = obligatorio,
// si = [título, valores]: el campo solo aparece (y solo es obligatorio) si ese otro campo tiene uno de esos valores.

type Tipo = 'texto' | 'fecha' | 'opcion' | 'lista' | 'parrafo' | 'monto' | 'tel' | 'check';
export interface Campo { t: string; tipo: Tipo; op?: string[]; req?: boolean; ayuda?: string; si?: [string, string[]] }
export interface Paso { id: string; titulo: string; ayuda?: string; campos: Campo[]; familia?: boolean }

const SI_NO = ['Sí', 'No'];
const SIN = ' Si no corresponde, dejalo vacío.';
const NIVEL_OP = ['Completo', 'Incompleto', 'En curso', 'No tengo'];
const NIVEL_CURSO = ['Completo', 'Incompleto', 'En curso'];
export const DECLARACION = 'DECLARO, BAJO JURAMENTO, QUE LOS DATOS PRECEDENTES SON EXACTOS.';

export const CAMPOS_FAMILIAR: Campo[] = [
  { t: 'Parentesco', tipo: 'lista', req: true, op: ['Cónyuge', 'Concubina/o', 'Hija/o', 'Madre', 'Padre', 'Hermana/o', 'Otro'], ayuda: 'Qué es de vos esa persona.' },
  { t: 'Apellido y nombres', tipo: 'texto', req: true, ayuda: 'Como figuran en su DNI.' },
  { t: 'DNI', tipo: 'texto', req: true, ayuda: 'El DNI del familiar, sin puntos.' },
  { t: 'Sexo', tipo: 'opcion', req: true, op: ['Femenino', 'Masculino', 'X'] },
  { t: '¿Vive?', tipo: 'opcion', req: true, op: SI_NO, ayuda: 'Marcá No si falleció. Igual conviene declararlo si es tu padre, madre, hijo/a o cónyuge.' },
  { t: 'Fecha de nacimiento', tipo: 'fecha', req: true },
  { t: 'Situación laboral', tipo: 'opcion', req: true, op: ['No trabaja', 'Empleado', 'Jubilado o pensionado'] },
  { t: 'Empleo', tipo: 'texto', ayuda: 'Dónde y en qué trabaja (ej: comercio, Municipio de La Matanza).', si: ['Situación laboral', ['Empleado']] },
  { t: 'Jubilación o pensión', tipo: 'texto', ayuda: 'La caja que le paga (ANSES, IPS…) y el monto aproximado.', si: ['Situación laboral', ['Jubilado o pensionado']] },
];

export const PASOS: Paso[] = [
  {
    id: 'filiacion', titulo: 'Nacimiento y ciudadanía', ayuda: 'Como figuran en el DNI o la partida de nacimiento.',
    campos: [
      { t: 'Fecha de nacimiento', tipo: 'fecha', req: true },
      { t: 'Nacido en país', tipo: 'texto', req: true, ayuda: 'País donde naciste (ej: Argentina, Paraguay, Bolivia).' },
      { t: 'Provincia de nacimiento', tipo: 'texto', req: true, ayuda: 'Si naciste en otro país, la provincia, estado o departamento de ese país.' },
      { t: 'Partido de nacimiento', tipo: 'texto', req: true, ayuda: 'Partido o ciudad (ej: La Matanza, Morón, Capital Federal).' },
      { t: '¿Sos argentino/a naturalizado/a (tenés carta de ciudadanía)?', tipo: 'opcion', req: true, op: SI_NO, ayuda: 'Si naciste en otro país y te hiciste ciudadano/a argentino/a ante un juez federal, marcá Sí y completá los datos de la carta. Si naciste en Argentina, marcá No.' },
      { t: 'Carta de ciudadanía N°', tipo: 'texto', req: true, si: ['¿Sos argentino/a naturalizado/a (tenés carta de ciudadanía)?', ['Sí']] },
      { t: 'Carta de ciudadanía otorgada en', tipo: 'texto', req: true, ayuda: 'Ciudad del juzgado que te la dio.', si: ['¿Sos argentino/a naturalizado/a (tenés carta de ciudadanía)?', ['Sí']] },
      { t: 'Fecha de otorgamiento de la carta de ciudadanía', tipo: 'fecha', req: true, si: ['¿Sos argentino/a naturalizado/a (tenés carta de ciudadanía)?', ['Sí']] },
      { t: 'Juez federal (carta de ciudadanía)', tipo: 'texto', req: true, ayuda: 'Nombre del juez o número de juzgado federal.', si: ['¿Sos argentino/a naturalizado/a (tenés carta de ciudadanía)?', ['Sí']] },
      { t: 'Estado civil', tipo: 'opcion', req: true, op: ['Soltera/o', 'Casada/o', 'Viuda/o', 'Separada/o'], ayuda: 'El que tenés hoy legalmente. Si convivís pero no estás casada/o, marcá Soltera/o.' },
    ],
  },
  {
    id: 'identidad', titulo: 'Documentos viejos', ayuda: 'Datos que pide el legajo oficial. Si nunca tuviste alguno, dejalo vacío.',
    campos: [
      { t: 'Clase', tipo: 'texto', ayuda: 'Tu año de nacimiento como figuraba en la libreta de enrolamiento o cívica (ej: 1965).' + SIN },
      { t: 'Distrito militar', tipo: 'texto', ayuda: 'El número de distrito de la libreta de enrolamiento (solo varones con libreta).' + SIN },
      { t: 'Cédula de identidad N°', tipo: 'texto', ayuda: 'La cédula vieja de la Policía Federal o de la provincia (no es el DNI).' + SIN },
      { t: 'Cédula expedida por', tipo: 'texto', ayuda: 'Ej: Policía Federal, Policía de la Provincia de Buenos Aires.' + SIN },
    ],
  },
  {
    id: 'estudios', titulo: 'Estudios',
    ayuda: 'Completá cada nivel. Si no lo hiciste, marcá "No tengo" (en el legajo queda con guiones).',
    campos: [
      { t: 'Primario', tipo: 'opcion', req: true, op: ['Completo', 'Incompleto', 'No cursé'] },
      { t: 'Primario — escuela', tipo: 'texto', req: true, ayuda: 'Nombre o número de la escuela y dónde queda (ej: Escuela N° 12, González Catán).', si: ['Primario', ['Completo', 'Incompleto']] },
      { t: 'Secundario', tipo: 'opcion', req: true, op: NIVEL_OP, ayuda: 'Las escuelas técnicas (Técnico Químico, Maestro Mayor de Obras…) también son secundario.' },
      { t: 'Secundario — título', tipo: 'texto', req: true, ayuda: 'Como figura en el título (ej: Bachiller, Perito Mercantil, Técnico Químico).', si: ['Secundario', ['Completo']] },
      { t: 'Secundario — escuela', tipo: 'texto', req: true, ayuda: 'Nombre o número de la escuela y dónde queda.', si: ['Secundario', NIVEL_CURSO] },
      { t: 'Terciario', tipo: 'opcion', req: true, op: NIVEL_OP, ayuda: 'Carreras de un INSTITUTO (no universidad): tecnicaturas como Enfermería, Radiología, Laboratorio, Instrumentación Quirúrgica, Hemoterapia, y profesorados. Si sos técnico/a de un instituto, va acá.' },
      { t: 'Terciario — título', tipo: 'texto', req: true, ayuda: 'El título o la carrera (ej: Técnico Superior en Enfermería).', si: ['Terciario', NIVEL_CURSO] },
      { t: 'Terciario — instituto', tipo: 'texto', req: true, ayuda: 'Nombre del instituto que lo otorga (ej: Instituto Superior de Formación Técnica N° 197).', si: ['Terciario', NIVEL_CURSO] },
      { t: 'Universitario', tipo: 'opcion', req: true, op: NIVEL_OP, ayuda: 'Solo carreras de una UNIVERSIDAD (licenciaturas, Medicina, Abogacía…). Si estudiaste en un instituto, va en Terciario.' },
      { t: 'Universitario — título', tipo: 'texto', req: true, ayuda: 'Como figura en el título o la carrera (ej: Licenciada en Enfermería).', si: ['Universitario', NIVEL_CURSO] },
      { t: 'Universitario — universidad', tipo: 'texto', req: true, ayuda: 'Qué universidad lo otorga (ej: Universidad Nacional de La Matanza).', si: ['Universitario', NIVEL_CURSO] },
      { t: 'Aptitud especial por profesión u oficio', tipo: 'texto', ayuda: 'Algo que sabés hacer y puede servir (ej: electricista, idiomas, computación, chofer).' + SIN },
    ],
  },
  {
    id: 'militar', titulo: 'Servicio militar', ayuda: 'El servicio militar obligatorio terminó en 1995: esto es para quienes lo hicieron o fueron exceptuados.',
    campos: [
      { t: '¿Prestó servicios militares?', tipo: 'opcion', req: true, op: SI_NO, ayuda: 'Si hiciste la colimba o fuiste militar. Si no, marcá No.' },
      { t: 'Motivo de la excepción', tipo: 'texto', ayuda: 'Solo si te tocó y no lo hiciste (ej: número bajo, salud, sostén de familia).' + SIN, si: ['¿Prestó servicios militares?', ['No']] },
      { t: 'Arma', tipo: 'texto', req: true, ayuda: 'Ejército, Armada (Marina) o Fuerza Aérea.', si: ['¿Prestó servicios militares?', ['Sí']] },
      { t: 'Especialidad militar', tipo: 'texto', req: true, ayuda: 'Ej: infantería, sanidad, comunicaciones.', si: ['¿Prestó servicios militares?', ['Sí']] },
      { t: 'Grado', tipo: 'texto', req: true, ayuda: 'Ej: soldado, cabo.', si: ['¿Prestó servicios militares?', ['Sí']] },
      { t: 'Destino militar', tipo: 'texto', req: true, ayuda: 'Regimiento, batallón o unidad.', si: ['¿Prestó servicios militares?', ['Sí']] },
    ],
  },
  {
    id: 'familia', titulo: 'Familia', familia: true,
    ayuda: 'Cónyuge o concubino/a, hijos, y padres o hermanos que vivan con vos o estén a tu cargo.',
    campos: [{ t: '¿Tenés familiares para declarar?', tipo: 'opcion', req: true, op: SI_NO }],
  },
  {
    id: 'incomp', titulo: 'Incompatibilidad',
    ayuda: 'El Estado tiene que saber si cobrás otro sueldo público o una jubilación. Completá solo lo que te corresponde.',
    campos: [
      { t: '¿Percibe jubilación, pensión o retiro?', tipo: 'opcion', req: true, op: ['No', 'Jubilación', 'Pensión', 'Retiro'] },
      ...([
        ['Jubilación — Ley número', 'texto', 'La ley por la que te jubilaste, si la sabés.'],
        ['Jubilación — Caja', 'texto', 'Quién te la paga (ej: ANSES, IPS, Caja de Policía).'],
        ['Jubilación — Monto mensual', 'monto', 'Lo que cobrás por mes, sin puntos ni signo $.'],
        ['Jubilación — Fecha de otorgamiento', 'fecha', 'Desde cuándo la cobrás.'],
      ] as [string, Tipo, string][]).map(([t, tipo, ayuda]): Campo => ({ t, tipo, ayuda, si: ['¿Percibe jubilación, pensión o retiro?', ['Jubilación', 'Pensión', 'Retiro']] })),
      { t: '¿Desempeña algún otro cargo?', tipo: 'opcion', req: true, op: SI_NO, ayuda: 'Otro trabajo en el Estado: otro hospital, municipio, escuela, universidad. Los privados van en "Otras actividades".' },
      ...([
        ['Otro cargo — Nacional', 'texto', 'Organismo y cargo, si es nacional (ej: Hospital Posadas, enfermera).'],
        ['Otro cargo — Provincial', 'texto', 'Organismo y cargo, si es provincial.'],
        ['Otro cargo — Municipal', 'texto', 'Organismo y cargo, si es municipal (ej: Municipio de La Matanza, CAPS).'],
        ['Otro cargo — Lugar donde lo desempeña', 'texto', 'Dirección o nombre del lugar.'],
        ['Otro cargo — Horario', 'texto', 'Días y horario (ej: lunes a viernes de 14 a 20).'],
        ['Otro cargo — Monto del sueldo, comisión u honorarios', 'monto', 'Por mes, sin puntos ni signo $.'],
        ['Otro cargo — Fecha de ingreso', 'fecha', 'Cuándo empezaste en ese cargo.'],
      ] as [string, Tipo, string][]).map(([t, tipo, ayuda]): Campo => ({ t, tipo, ayuda, si: ['¿Desempeña algún otro cargo?', ['Sí']] })),
      { t: 'Otras actividades (carácter)', tipo: 'texto', ayuda: 'Trabajos privados o por tu cuenta (ej: clínica privada, consultorio, comercio).' + SIN },
      { t: 'Otras actividades — Lugar donde las desempeña', tipo: 'texto' },
      { t: 'Otras actividades — Monto del sueldo, comisión u honorarios', tipo: 'monto', ayuda: 'Por mes, sin puntos ni signo $.' },
      { t: 'Otras actividades — Fecha de ingreso', tipo: 'fecha' },
      { t: 'Incompatibilidad — Observaciones', tipo: 'parrafo', ayuda: 'Cualquier aclaración sobre lo anterior.' },
    ],
  },
  {
    id: 'bienes', titulo: 'Declaración de bienes',
    campos: [{ t: 'Bienes a declarar', tipo: 'parrafo', ayuda: 'Un bien por renglón con su VALOR FISCAL: casas, terrenos, autos, motos (ej: "Casa en González Catán — valor fiscal $ 8.500.000", "Auto Fiat Palio 2015 — valor fiscal $ 4.200.000"). El valor fiscal figura en la boleta de ARBA o de la patente. Dejalo vacío si no tenés.' }],
  },
  {
    id: 'enviar', titulo: 'Enviar',
    campos: [
      { t: 'CUIL', tipo: 'texto', ayuda: 'Figura en el recibo de sueldo. Con o sin guiones.' },
      { t: 'WhatsApp', tipo: 'tel', ayuda: 'Para avisarte si falta algún dato. Código de área + número, sin 0 ni 15 (ej: 1123456789).' },
      { t: 'Declaración', tipo: 'check', req: true, op: [DECLARACION], ayuda: 'Al tildar, declarás que lo que escribiste es verdad.' },
    ],
  },
];

// títulos permitidos → tipo (los de familiares van con número: "Familiar 3 — DNI")
const PERMITIDOS = new Map<string, Campo>();
for (const p of PASOS) for (const c of p.campos) PERMITIDOS.set(c.t, c);
for (let n = 1; n <= MAX_FAMILIARES; n++) for (const c of CAMPOS_FAMILIAR) PERMITIDOS.set(`Familiar ${n} — ${c.t}`, c);

const MAX_TXT = 200, MAX_PARRAFO = 2000;

/** Deja solo las preguntas conocidas, recorta largos y valida opciones. No confía en el navegador. */
export function limpiarRespuestas(raw: any): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new LegajoEnlaceError('Datos inválidos');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const c = PERMITIDOS.get(k);
    if (!c || v === null || v === undefined) continue;
    let s = String(v).replace(/\r\n/g, '\n').trim();
    if (c.tipo !== 'parrafo') s = s.replace(/\s+/g, ' ');
    s = s.slice(0, c.tipo === 'parrafo' ? MAX_PARRAFO : MAX_TXT);
    if (!s) continue;
    if (c.op && !c.op.includes(s)) continue;
    if (c.tipo === 'fecha' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
    if (c.tipo === 'monto') { s = s.replace(/[^\d]/g, ''); if (!s) continue; }
    if (c.tipo === 'tel') { s = s.replace(/\D/g, ''); if (!s) continue; }
    out[k] = s;
  }
  return out;
}

const visible = (c: Campo, r: Record<string, string>, pref = '') =>
  !c.si || c.si[1].includes(r[pref + c.si[0]] ?? '');

/** Estudios incoherentes: no se puede tener un nivel sin haber terminado el anterior
 *  (primario → secundario → terciario / universitario). Devuelve [pregunta, motivo]. Misma regla en legajoPagina.ts. */
export function estudiosIncoherentes(r: Record<string, string>): [string, string][] {
  const out: [string, string][] = [];
  const tiene = (k: string) => !!r[k] && r[k] !== 'No tengo';
  if (r['Primario'] && r['Primario'] !== 'Completo' && tiene('Secundario'))
    out.push(['Secundario', 'Si no terminaste el primario, en Secundario marcá "No tengo".']);
  if (r['Secundario'] && r['Secundario'] !== 'Completo') {
    if (tiene('Terciario')) out.push(['Terciario', 'Si no terminaste el secundario, en Terciario marcá "No tengo".']);
    if (tiene('Universitario')) out.push(['Universitario', 'Si no terminaste el secundario, en Universitario marcá "No tengo".']);
  }
  return out;
}

/** Faltantes para poder enviar (lista de "Paso: pregunta"). */
export function faltantes(r: Record<string, string>): string[] {
  const out: string[] = [];
  for (const p of PASOS) {
    for (const c of p.campos) if (c.req && visible(c, r) && !r[c.t]) out.push(`${p.titulo}: ${c.t}`);
    if (p.familia && r['¿Tenés familiares para declarar?'] === 'Sí') {
      let alguno = false;
      for (let n = 1; n <= MAX_FAMILIARES; n++) {
        const pref = `Familiar ${n} — `;
        const usado = CAMPOS_FAMILIAR.some(c => r[pref + c.t]);
        if (!usado) continue;
        alguno = true;
        for (const c of CAMPOS_FAMILIAR) if (c.req && visible(c, r, pref) && !r[pref + c.t]) out.push(`Familia: familiar ${n} — ${c.t}`);
      }
      if (!alguno) out.push('Familia: cargá al menos un familiar (o marcá que no tenés)');
    }
  }
  for (const [, m] of estudiosIncoherentes(r)) out.push(`Estudios: ${m}`);
  const tel = r['WhatsApp'];
  if (tel && !/^\d{10,13}$/.test(tel)) out.push('Enviar: el WhatsApp tiene que tener código de área + número (10 a 13 números)');
  for (let n = 1; n <= MAX_FAMILIARES; n++) {
    const d = r[`Familiar ${n} — DNI`];
    if (d && !/^\d{6,9}$/.test(d.replace(/\D/g, ''))) out.push(`Familia: el DNI del familiar ${n} no es válido`);
  }
  return out;
}

/** Si dijo "No" a familiares, se borran los familiares que haya cargado antes. Lo oculto por condición no se guarda. */
function podar(r: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const sinFamilia = r['¿Tenés familiares para declarar?'] === 'No';
  for (const [k, v] of Object.entries(r)) {
    const m = /^Familiar (\d+) — (.+)$/.exec(k);
    if (m) {
      if (sinFamilia) continue;
      const c = PERMITIDOS.get(k)!;
      if (!visible(c, r, `Familiar ${m[1]} — `)) continue;
    } else {
      const c = PERMITIDOS.get(k);
      if (c && !visible(c, r)) continue;
    }
    out[k] = v;
  }
  return out;
}

// ── Tabla ───────────────────────────────────────────────────────────────────

const publicas = new WeakSet<Sequelize>();
export function marcarConexionPublicaLegajo(sq: Sequelize) { publicas.add(sq); }
const listas = new WeakMap<Sequelize, Promise<void>>();

export function ensureAutocargaTabla(sq: Sequelize): Promise<void> {
  if (publicas.has(sq)) return Promise.resolve();   // el usuario público no toca el esquema
  let p = listas.get(sq);
  if (!p) {
    p = (async () => {
      const cands = [
        path.resolve(process.cwd(), 'scripts/migrations/138__legajo_autocarga.sql'),
        path.resolve(__dirname, '../../scripts/migrations/138__legajo_autocarga.sql'),
      ];
      const f = cands.find(x => fs.existsSync(x));
      if (!f) throw new Error('No se encontró scripts/migrations/138__legajo_autocarga.sql');
      const sql = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n');
      for (const s of sql.split(/;\s*(?:\n|$)/).map(x => x.trim()).filter(Boolean)) await sq.query(s);
    })();
    p.catch(err => { listas.delete(sq); logger.error({ msg: 'legajo_autocarga ensure', error: err?.message }); });
    listas.set(sq, p);
  }
  return p;
}

export const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
export const tokenValido = (t: any) => /^[A-Za-z0-9_-]{43}$/.test(String(t ?? ''));
const tc = (s: string) => String(s || '').toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
const parseJson = (v: any) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

// ── Lado PÚBLICO (conexión restringida) ─────────────────────────────────────

async function filaPorToken(sq: Sequelize, token: string) {
  if (!tokenValido(token)) throw new LegajoEnlaceError('Enlace inválido', 404);
  const r = await sq.query<any>(
    `SELECT id, estado, DATE_FORMAT(vence_el, '%Y-%m-%d') AS vence_el, nombre_mostrar, respuestas, devolucion_motivo,
            DATE_FORMAT(enviado_at, '%Y-%m-%d %H:%i') AS enviado_at
       FROM legajo_autocarga WHERE token = :token`, { replacements: { token }, type: QueryTypes.SELECT });
  if (!r[0]) throw new LegajoEnlaceError('Enlace inválido', 404);
  const f = r[0];
  const vencido = (f.estado === 'HABILITADO' || f.estado === 'DEVUELTO') && f.vence_el < hoyAR();
  return { ...f, estado: vencido ? 'VENCIDO' : f.estado, editable: !vencido && (f.estado === 'HABILITADO' || f.estado === 'DEVUELTO') };
}

export async function estadoPublico(sq: Sequelize, token: string) {
  const f = await filaPorToken(sq, token);
  return {
    nombre: f.nombre_mostrar, estado: f.estado, editable: f.editable, vence_el: f.vence_el, enviado_at: f.enviado_at,
    devolucion_motivo: f.estado === 'DEVUELTO' ? f.devolucion_motivo : null,
    respuestas: f.editable ? (parseJson(f.respuestas) ?? {}) : {},   // ya enviado: no se vuelven a mostrar los datos
    pasos: PASOS, familiar: CAMPOS_FAMILIAR, max_familiares: MAX_FAMILIARES,
  };
}

export async function guardarPublico(sq: Sequelize, token: string, raw: any) {
  const f = await filaPorToken(sq, token);
  if (!f.editable) throw new LegajoEnlaceError('Este enlace ya no se puede modificar', 409);
  const r = limpiarRespuestas(raw);
  await sq.query(
    `UPDATE legajo_autocarga SET respuestas = :r, guardado_at = NOW()
      WHERE token = :token AND estado IN ('HABILITADO','DEVUELTO') AND vence_el >= :hoy`,
    { replacements: { r: JSON.stringify(r), token, hoy: hoyAR() } });
  return { guardado: true };
}

export async function enviarPublico(sq: Sequelize, token: string, raw: any) {
  const f = await filaPorToken(sq, token);
  if (!f.editable) throw new LegajoEnlaceError('Este enlace ya no se puede modificar', 409);
  const r = podar(limpiarRespuestas(raw));
  const faltan = faltantes(r);
  if (faltan.length) {
    const e = new LegajoEnlaceError(`Faltan datos: ${faltan.slice(0, 5).join(' · ')}${faltan.length > 5 ? ` (y ${faltan.length - 5} más)` : ''}`);
    (e as any).faltan = faltan;
    throw e;
  }
  const [, n]: any = await sq.query(
    `UPDATE legajo_autocarga SET respuestas = :r, guardado_at = NOW(), estado = 'ENVIADO', enviado_at = NOW(), telefono = :tel
      WHERE token = :token AND estado IN ('HABILITADO','DEVUELTO') AND vence_el >= :hoy`,
    { replacements: { r: JSON.stringify(r), tel: r['WhatsApp'] || null, token, hoy: hoyAR() }, type: QueryTypes.UPDATE });
  if (!Number(n)) throw new LegajoEnlaceError('Este enlace ya no se puede modificar', 409);
  return { enviado: true };
}

// ── Lado de la OFICINA (API interna) ────────────────────────────────────────

export async function vencer(sq: Sequelize) {
  await ensureAutocargaTabla(sq);
  await sq.query(`UPDATE legajo_autocarga SET estado = 'VENCIDO' WHERE estado IN ('HABILITADO','DEVUELTO') AND vence_el < :hoy`,
    { replacements: { hoy: hoyAR() } });
}

export interface ResultadoHabilitar { dni: number; ok: boolean; id?: number; token?: string; existente?: boolean; estado?: string; vence_el?: string; motivo?: string; apellido?: string; nombre?: string }

/** Habilita a cada DNI. Si ya tiene un enlace abierto (sin aprobar) devuelve ese. */
export async function habilitar(sq: Sequelize, dnis: number[], userId: number | null, dias: number, observacion: string | null): Promise<ResultadoHabilitar[]> {
  await vencer(sq);
  const vence = sumarDias(hoyAR(), Math.min(90, Math.max(1, Math.round(dias) || DIAS_VENCE_DEFAULT)));
  const out: ResultadoHabilitar[] = [];
  for (const dni of [...new Set(dnis.filter(d => Number.isInteger(d) && d > 0))]) {
    const [p] = await sq.query<any>(
      `SELECT p.dni, p.apellido, p.nombre,
              EXISTS(SELECT 1 FROM agentes a WHERE a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO') AS activo
         FROM personal p WHERE p.dni = :dni AND p.deleted_at IS NULL`, { replacements: { dni }, type: QueryTypes.SELECT });
    if (!p) { out.push({ dni, ok: false, motivo: 'No está en el sistema' }); continue; }
    const base = { dni, apellido: p.apellido, nombre: p.nombre };
    if (!Number(p.activo)) { out.push({ ...base, ok: false, motivo: 'No es agente activo' }); continue; }
    const [ab] = await sq.query<any>(
      `SELECT id, token, estado, DATE_FORMAT(vence_el, '%Y-%m-%d') AS vence_el FROM legajo_autocarga WHERE abierto_dni = :dni`,
      { replacements: { dni }, type: QueryTypes.SELECT });
    if (ab) { out.push({ ...base, ok: true, id: ab.id, token: ab.token, estado: ab.estado, vence_el: ab.vence_el, existente: true }); continue; }
    const token = nuevoToken();
    try {
      const [id] = await sq.query(
        `INSERT INTO legajo_autocarga (dni, token, nombre_mostrar, vence_el, observacion, created_by)
         VALUES (:dni, :token, :nom, :vence, :obs, :u)`,
        { replacements: { dni, token, nom: `${tc(p.nombre)} ${tc(p.apellido)}`.trim().slice(0, 160), vence, obs: observacion, u: userId } });
      out.push({ ...base, ok: true, id: Number(id), token, estado: 'HABILITADO', vence_el: vence });
    } catch (err: any) {
      if (err?.original?.code === 'ER_DUP_ENTRY') out.push({ ...base, ok: false, motivo: 'Ya tenía un enlace (otro usuario al mismo tiempo)' });
      else throw err;
    }
  }
  return out;
}

export async function anular(sq: Sequelize, id: number, userId: number | null) {
  const [, n]: any = await sq.query(
    `UPDATE legajo_autocarga SET estado = 'ANULADO', anulado_at = NOW(), anulado_by = :u
      WHERE id = :id AND estado IN ('HABILITADO','DEVUELTO','ENVIADO')`, { replacements: { id, u: userId }, type: QueryTypes.UPDATE });
  if (!Number(n)) throw new LegajoEnlaceError('Ese enlace ya está cerrado', 409);
}

/** Lo enviado vuelve al agente para corregir (mismo enlace, con lo que había cargado). */
export async function devolver(sq: Sequelize, id: number, motivo: any, userId: number | null, dias: number) {
  const m = String(motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!m) throw new LegajoEnlaceError('Escribí qué tiene que corregir');
  const vence = sumarDias(hoyAR(), Math.min(90, Math.max(1, Math.round(dias) || 7)));
  const [, n]: any = await sq.query(
    `UPDATE legajo_autocarga SET estado = 'DEVUELTO', devolucion_motivo = :m, revisado_at = NOW(), revisado_by = :u,
            vence_el = GREATEST(vence_el, :vence)
      WHERE id = :id AND estado = 'ENVIADO'`, { replacements: { id, m, u: userId, vence }, type: QueryTypes.UPDATE });
  if (!Number(n)) throw new LegajoEnlaceError('Solo se puede devolver algo enviado y sin aprobar', 409);
}

/** Respuestas → fila con los títulos del Formulario de Google, para planificar/aplicar del importador. */
/** Estudios por nivel (paso nuevo) → preguntas que entiende el importador. "No tengo" → "—" en título y escuela.
 *  Si las respuestas son del formato viejo (un solo nivel), quedan como están. */
export function estudiosAlImportador(r: Record<string, string>): Record<string, string> {
  if (!r['Primario'] && !r['Secundario'] && !r['Terciario'] && !r['Universitario']) return r;
  const out = { ...r };
  const cursa = (v?: string) => !!v && NIVEL_CURSO.includes(v);
  const est = (v?: string) => (v === 'Completo' ? '' : v === 'En curso' ? ' (en curso)' : ' (incompleto)');
  const nivel = cursa(r['Universitario']) ? 'Universitario' : cursa(r['Terciario']) ? 'Terciario'
    : cursa(r['Secundario']) ? 'Secundario' : cursa(r['Primario']) ? 'Primario' : '';
  if (nivel) out['Nivel de estudios cursados'] = nivel;
  const partes: string[] = [];
  for (const n of ['Primario', 'Secundario', 'Terciario', 'Universitario']) {
    const v = r[n];
    if (!v) continue;
    partes.push(v === 'No tengo' || v === 'No cursé' ? `${n}: no tiene` : `${n} ${v.toLowerCase()}`);
  }
  if (partes.length) out['Detalle de estudios'] = partes.join(' · ').slice(0, 250);
  const nivelTitulo = (n: string, campoTit: string, campoInst: string, kTit: string, kInst: string, otro?: string) => {
    const v = r[n];
    if (!v) return;
    if (v === 'No tengo') { out[kTit] = '—'; out[kInst] = '—'; return; }
    const tit = r[campoTit] || otro || `${n}${est(v)}`;
    out[kTit] = (r[campoTit] ? tit + est(v) : tit).slice(0, 200);
    if (r[campoInst]) out[kInst] = r[campoInst].slice(0, 200);
  };
  nivelTitulo('Secundario', 'Secundario — título', 'Secundario — escuela', 'Título secundario o técnico', 'Título secundario otorgado por');
  nivelTitulo('Terciario', 'Terciario — título', 'Terciario — instituto', 'Título terciario', 'Título terciario otorgado por');
  nivelTitulo('Universitario', 'Universitario — título', 'Universitario — universidad', 'Título universitario', 'Título universitario otorgado por');
  return out;
}

async function filaImportador(sq: Sequelize, row: any) {
  const [p] = await sq.query<any>(`SELECT apellido, nombre FROM personal WHERE dni = :dni`, { replacements: { dni: row.dni }, type: QueryTypes.SELECT });
  return {
    ...estudiosAlImportador(parseJson(row.respuestas) ?? {}),
    'Marca temporal': row.enviado_at ? String(row.enviado_at).slice(0, 10) : hoyAR(),
    DNI: String(row.dni), Apellido: p?.apellido ?? '', Nombres: p?.nombre ?? '',
  };
}

async function getRow(sq: Sequelize, id: number) {
  const [r] = await sq.query<any>(
    `SELECT id, dni, estado, respuestas, DATE_FORMAT(enviado_at, '%Y-%m-%d %H:%i:%s') AS enviado_at FROM legajo_autocarga WHERE id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT });
  if (!r) throw new LegajoEnlaceError('No existe', 404);
  return r;
}

/** Vista previa de lo que se cargaría al aprobar (mismo plan que el importador). */
export async function previa(sq: Sequelize, id: number) {
  const row = await getRow(sq, id);
  const [plan] = await planificar(sq, [await filaImportador(sq, row)]);
  const { incompDatos, ...resto } = plan as any;
  return { plan: resto, respuestas: parseJson(row.respuestas) ?? {} };
}

export async function aprobar(sq: Sequelize, id: number, pisar: boolean, userId: number | null) {
  const row = await getRow(sq, id);
  if (row.estado !== 'ENVIADO') throw new LegajoEnlaceError('Solo se aprueba lo enviado y sin aprobar', 409);
  const plan = (await planificar(sq, [await filaImportador(sq, row)])).filter((r: any) => r.estado === 'OK');
  if (!plan.length) throw new LegajoEnlaceError('El agente ya no está en el sistema', 409);
  const resumen = await aplicarPlan(sq, plan, pisar, userId, 'Enlace del legajo');
  await sq.query(
    `UPDATE legajo_autocarga SET estado = 'APROBADO', revisado_at = NOW(), revisado_by = :u, resumen = :res WHERE id = :id AND estado = 'ENVIADO'`,
    { replacements: { id, u: userId, res: JSON.stringify({ ...resumen, pisar }) } });
  return resumen;
}
