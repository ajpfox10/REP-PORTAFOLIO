// src/routes/guarderiaDdjjImportForm.ts
// Importa a la DDJJ de guardería las respuestas del formulario de Google
// (scripts/google_forms/guarderia_formulario.gs). El front lee el Excel/CSV bajado de la
// planilla de respuestas y manda las filas tal cual ({titulo de la pregunta: valor}).
//
//   POST /guarderia-ddjj/importar-formulario/preview   → qué se va a cargar por agente (no escribe)
//   POST /guarderia-ddjj/importar-formulario/confirmar → escribe los DNIs elegidos
//
// Reglas:
//  - La clave es el DNI. Si no existe en `personal`, la fila se informa y no se carga.
//  - Varias respuestas del mismo DNI: vale la última (marca temporal / orden de la planilla).
//  - El formulario solo trae lo propio de la DDJJ (niños a cargo, tutela, motivo, otro
//    progenitor, menores, lugar). Los datos del agente salen del sistema, igual que la
//    precarga del modal; la fecha de la DDJJ es la marca temporal.
//  - Si el agente no tiene DDJJ guardada, se arma sobre la precarga.
//  - Si ya tiene una, se completan los campos vacíos; los distintos y los menores ya
//    cargados solo se pisan con `pisar = true`.
//  - "NC" (no corresponde) se guarda vacío.

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../logging/logger';

type Fila = Record<string, any>;
type Ddjj = { ddjj: any; menores: any[] };

export type DdjjDeps = {
  guardada: (dni: number) => Promise<Ddjj | null>;
  precarga: (dni: number) => Promise<Ddjj | null>;
  reintegroMinisterio: (dni: number) => Promise<{ fecha: string } | null>;
  grabar: (dni: number, body: Record<string, any>, uid: number | null) => Promise<void>;
};

// Títulos normalizados: minúsculas, sin acentos ni signos
const norm = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function texto(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || /^n\.?\s*c\.?$/i.test(s) || /^no corresponde$/i.test(s)) return null;
  return s;
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

const soloDigitos = (v: any): string | null => String(v ?? '').replace(/\D/g, '') || null;
const mayus = (v: any): string | null => texto(v)?.toUpperCase() ?? null;
const siNo = (v: any): number | null => {
  const s = norm(v);
  return s === 'si' ? 1 : s === 'no' ? 0 : null;
};

const ESTADO_CIVIL: Record<string, string> = {
  'soltera o': 'SOLTERO', 'casada o': 'CASADO', 'viuda o': 'VIUDO', 'separada o': 'SEPARADO',
  'divorciada o': 'DIVORCIADO', 'union convivencial': 'UNIÓN CONVIVENCIAL',
};

// pregunta del formulario → columna de guarderia_ddjj
const MAPA: [string, string, ((v: any) => any)?][] = [
  ['Quién tiene los niños a cargo', 'ninos_a_cargo'],
  ['En caso de tutela, tenencia, guarda: condición', 'condicion_tutela'],
  ['Motivo por el cual no ingresa al jardín maternal / guardería', 'motivo_no_ingresa'],
  ['Lugar', 'lugar'],
];
const MAPA_OTRO: [string, string, ((v: any) => any)?][] = [
  ['Otro progenitor — Apellido y nombre', 'otro_apellido_nombre', mayus],
  ['Otro progenitor — Número de documento', 'otro_documento', soloDigitos],
  ['Otro progenitor — Domicilio particular', 'otro_domicilio'],
  ['Otro progenitor — Fecha de nacimiento', 'otro_fecha_nacimiento', aFecha],
  ['Otro progenitor — Estado civil', 'otro_estado_civil', v => ESTADO_CIVIL[norm(v)] ?? mayus(v)],
  ['Otro progenitor — Nacionalidad', 'otro_nacionalidad', mayus],
  ['Otro progenitor — Lugar de trabajo', 'otro_lugar_trabajo'],
];

const MAX_MENORES = 6;

type Parseada = {
  fila: number;
  dni: number | null;
  marca: string | null;
  nombre: string | null;
  whatsapp: string | null;
  datos: Record<string, any>;
  menores: Record<string, any>[];
};

function parsear(fila: Fila, idx: number): Parseada {
  const f: Record<string, any> = {};
  for (const [k, v] of Object.entries(fila)) f[norm(k)] = v;
  const g = (titulo: string) => f[norm(titulo)];

  const datos: Record<string, any> = {};
  const hayOtro = siNo(g('¿Hay otro progenitor para declarar?')) !== 0;
  for (const [titulo, col, conv] of [...MAPA, ...(hayOtro ? MAPA_OTRO : [])]) {
    const v = conv ? conv(g(titulo)) : texto(g(titulo));
    if (v !== null && v !== undefined && v !== '') datos[col] = v;
  }
  const marca = aFecha(g('Marca temporal'));
  if (marca) datos.fecha = marca;

  const menores: Record<string, any>[] = [];
  for (let n = 1; n <= MAX_MENORES; n++) {
    const p = (campo: string) => g(`Menor ${n} — ${campo}`);
    const nombre = mayus(p('Apellido y nombre'));
    if (!nombre) continue;
    const patologia = siNo(p('¿Presenta patología que necesite atención especial?'));
    menores.push({
      apellido_nombre:     nombre,
      documento:           soloDigitos(p('Número de documento')),
      fecha_nacimiento:    aFecha(p('Fecha de nacimiento')),
      patologia,
      atencion_temporaria: patologia ? texto(p('Atención especial temporaria')) : null,
      atencion_permanente: patologia ? texto(p('Atención especial permanente')) : null,
    });
  }

  const dniTxt = String(g('DNI') ?? '').replace(/\D/g, '');
  return {
    fila: idx + 2,  // +2: encabezado + base 1, igual que en la planilla
    dni: dniTxt.length >= 7 && dniTxt.length <= 9 ? Number(dniTxt) : null,
    marca,
    nombre: texto(g('Apellido y nombre')),
    whatsapp: soloDigitos(g('WhatsApp')),
    datos, menores,
  };
}

const vacio = (v: any) => v === null || v === undefined || v === '';
// mismas palabras sin importar orden ni comas ("PEREZ, ANA" = "Ana Perez")
const mismoNombre = (a: any, b: any) =>
  norm(a).split(' ').sort().join(' ') === norm(b).split(' ').sort().join(' ');

// Arma el plan por respuesta: estado + qué cambia (lo usan preview y confirmar)
async function planificar(sequelize: Sequelize, deps: DdjjDeps, filas: Fila[]) {
  const parseadas = filas.map(parsear);

  const ultima = new Map<number, Parseada>();
  for (const p of parseadas) {
    if (!p.dni) continue;
    const prev = ultima.get(p.dni);
    if (!prev || (p.marca ?? '') >= (prev.marca ?? '')) ultima.set(p.dni, p);
  }
  const dnis = [...ultima.keys()];
  const personas = dnis.length
    ? await sequelize.query<any>(
        `SELECT dni, apellido, nombre FROM personal WHERE dni IN (:dnis) AND deleted_at IS NULL`,
        { replacements: { dnis }, type: QueryTypes.SELECT })
    : [];
  const mPers = new Map(personas.map(p => [Number(p.dni), p]));

  const plan: any[] = [];
  for (const p of parseadas) {
    const base = { fila: p.fila, dni: p.dni, marca: p.marca, nombreFormulario: p.nombre, whatsapp: p.whatsapp };
    if (!p.dni) { plan.push({ ...base, estado: 'DNI_INVALIDO' }); continue; }
    if (ultima.get(p.dni) !== p) { plan.push({ ...base, estado: 'REEMPLAZADA' }); continue; }
    const pers = mPers.get(p.dni);
    if (!pers) { plan.push({ ...base, estado: 'NO_EXISTE' }); continue; }

    const g = await deps.guardada(p.dni);
    let actual = g;
    if (!actual) {
      actual = await deps.precarga(p.dni);
      const r = await deps.reintegroMinisterio(p.dni);
      if (actual && r) actual.ddjj.fecha_reintegro = r.fecha;
    }
    if (!actual) { plan.push({ ...base, estado: 'NO_EXISTE' }); continue; }

    const nombreSistema = `${pers.apellido}, ${pers.nombre}`;
    const avisos: string[] = [];
    if (p.nombre && !mismoNombre(p.nombre, nombreSistema)) avisos.push(`Nombre distinto al del sistema (${p.nombre})`);
    if (!p.menores.length) avisos.push('No declaró menores');

    // sin DDJJ guardada todo lo del formulario entra; con DDJJ, lo distinto es conflicto
    const datosNuevos: Record<string, any> = {};
    const conflictos: { campo: string; actual: any; nuevo: any }[] = [];
    for (const [campo, nuevo] of Object.entries(p.datos)) {
      const act = actual.ddjj[campo];
      if (!g || vacio(act)) datosNuevos[campo] = nuevo;
      else if (norm(act) !== norm(nuevo)) conflictos.push({ campo, actual: act, nuevo });
    }

    const menoresActuales = g ? g.menores : [];
    plan.push({
      ...base,
      estado: 'OK',
      nombreSistema,
      tieneDdjj: !!g,
      avisos,
      datosNuevos, conflictos,
      menoresFormulario: p.menores,
      menoresAccion: !p.menores.length ? null : menoresActuales.length ? 'EXISTEN' : 'NUEVOS',
      _actual: actual,
    });
  }
  return plan;
}

export function registrarImportFormularioDdjj(router: Router, sequelize: Sequelize, write: any, deps: DdjjDeps) {
  const filasDe = (req: Request): Fila[] | null => {
    const filas = (req.body as any)?.filas;
    return Array.isArray(filas) && filas.length <= 5000 ? filas : null;
  };

  router.post('/importar-formulario/preview', write, async (req: Request, res: Response) => {
    try {
      const filas = filasDe(req);
      if (!filas) return res.status(400).json({ ok: false, error: 'Mandá las filas de la planilla (máx. 5000)' });
      const plan = await planificar(sequelize, deps, filas);
      return res.json({ ok: true, data: plan.map(({ _actual, ...r }) => r) });
    } catch (err: any) {
      logger.error({ msg: 'guarderia-ddjj import preview', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post('/importar-formulario/confirmar', write, async (req: Request, res: Response) => {
    try {
      const filas = filasDe(req);
      const elegidos = new Set<number>(((req.body as any)?.dnis ?? []).map(Number));
      const pisar = !!(req.body as any)?.pisar;
      if (!filas || !elegidos.size) return res.status(400).json({ ok: false, error: 'Faltan filas o DNIs a importar' });
      const uid = (req as any).user?.id ?? null;
      // se vuelve a planificar en el servidor: no se confía en lo que devolvió el preview
      const plan = (await planificar(sequelize, deps, filas)).filter(r => r.estado === 'OK' && elegidos.has(r.dni));

      const resumen = { agentes: 0, nuevas: 0, actualizadas: 0, menores: 0 };
      for (const r of plan) {
        const body: Record<string, any> = { ...r._actual.ddjj, ...r.datosNuevos };
        if (pisar) r.conflictos.forEach((c: any) => { body[c.campo] = c.nuevo; });
        const usarForm = r.menoresAccion === 'NUEVOS' || (r.menoresAccion === 'EXISTEN' && pisar);
        body.menores = usarForm ? r.menoresFormulario : r._actual.menores;
        await deps.grabar(r.dni, body, uid);
        resumen.agentes++;
        r.tieneDdjj ? resumen.actualizadas++ : resumen.nuevas++;
        if (usarForm) resumen.menores += r.menoresFormulario.length;
      }
      return res.json({ ok: true, data: resumen });
    } catch (err: any) {
      logger.error({ msg: 'guarderia-ddjj import confirmar', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });
}
