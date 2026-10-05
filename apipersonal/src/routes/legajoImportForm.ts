// src/routes/legajoImportForm.ts
// Importa al legajo las respuestas del formulario de Google
// (scripts/google_forms/legajo_formulario.gs). El front lee el Excel/CSV bajado de la
// planilla de respuestas y manda las filas tal cual ({titulo de la pregunta: valor}).
//
//   POST /legajo/importar-formulario/preview   → qué se va a cargar por agente (no escribe)
//   POST /legajo/importar-formulario/confirmar → escribe los DNIs elegidos
//
// Reglas:
//  - La clave es el DNI. Si no existe en `personal`, la fila se informa y no se carga.
//  - Varias respuestas del mismo DNI: vale la última (marca temporal / orden de la planilla).
//  - Datos personales del legajo: completa los campos vacíos; los que ya tienen otro valor
//    solo se pisan con `pisar = true`.
//  - Datos de `personal` (apellido, nombre, CUIL): no se tocan, solo se avisa si difieren.
//    La fecha de nacimiento se completa solo si en el sistema está vacía.
//  - Familiares: se agregan los que no estén ya (mismo DNI de familiar o mismo nombre).
//  - Incompatibilidad: si no hay declaración se crea; si hay, se reemplaza solo con `pisar`.
//  - Bienes: un renglón por línea, sin repetir descripciones ya cargadas.
//  - "NC" (no corresponde) se guarda vacío.

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes, Transaction } from 'sequelize';
import { logger } from '../logging/logger';

type Fila = Record<string, any>;

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

function aMonto(v: any): number | null {
  const s = texto(v);
  if (!s) return null;
  const n = Number(s.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const siNo = (v: any): number | null => {
  const s = norm(v);
  return s === 'si' ? 1 : s === 'no' ? 0 : null;
};

const ESTADO_CIVIL: Record<string, string> = {
  'soltera o': 'SOLTERO', 'casada o': 'CASADO', 'viuda o': 'VIUDO', 'separada o': 'SEPARADO',
};
const NIVEL: Record<string, string> = {
  'primario': 'PRIMARIO', 'secundario o tecnico': 'SECUNDARIO', 'universitario': 'UNIVERSITARIO',
};
const SEXO: Record<string, string> = { 'femenino': 'F', 'masculino': 'M', 'x': 'X' };

// pregunta del formulario → columna de legajo_datos_personales
const MAPA_DATOS: [string, string, ((v: any) => any)?][] = [
  ['Nacido en país', 'nac_pais'],
  ['Provincia de nacimiento', 'nac_provincia'],
  ['Partido de nacimiento', 'nac_partido'],
  ['Estado civil', 'estado_civil', v => ESTADO_CIVIL[norm(v)] ?? null],
  ['Clase', 'clase'],
  ['Distrito militar', 'dist_militar'],
  ['Cédula de identidad N°', 'cedula_nro'],
  ['Cédula expedida por', 'cedula_expedida_por'],
  ['Carta de ciudadanía N°', 'carta_ciudadania'],
  ['Carta de ciudadanía otorgada en', 'carta_otorgada_en'],
  ['Fecha de otorgamiento de la carta de ciudadanía', 'carta_fecha', aFecha],
  ['Juez federal (carta de ciudadanía)', 'carta_juez_federal'],
  ['Nivel de estudios cursados', 'estudios_nivel', v => NIVEL[norm(v)] ?? null],
  ['Detalle de estudios', 'estudios_detalle'],
  ['Título secundario o técnico', 'titulo_secundario'],
  ['Título secundario otorgado por', 'titulo_secundario_otorgado'],
  ['Título universitario', 'titulo_universitario'],
  ['Título universitario otorgado por', 'titulo_universitario_otorgado'],
  ['Aptitud especial por profesión u oficio', 'aptitud_especial'],
  ['¿Prestó servicios militares?', 'mil_presto', siNo],
  ['Arma', 'mil_arma'],
  ['Especialidad militar', 'mil_especialidad'],
  ['Grado', 'mil_grado'],
  ['Destino militar', 'mil_destino'],
  ['Motivo de la excepción', 'mil_motivo_excepcion'],
];

const MAX_FAMILIARES = 8;

type Parseada = {
  fila: number;
  dni: number | null;
  marca: string | null;
  apellido: string | null;
  nombres: string | null;
  cuil: string | null;
  fechaNac: string | null;
  datos: Record<string, any>;
  familia: Record<string, any>[];
  incomp: Record<string, any> | null;
  bienes: string[];
};

function parsear(fila: Fila, idx: number): Parseada {
  const f: Record<string, any> = {};
  for (const [k, v] of Object.entries(fila)) f[norm(k)] = v;
  const g = (titulo: string) => f[norm(titulo)];

  const dniTxt = String(g('DNI') ?? '').replace(/\D/g, '');
  const datos: Record<string, any> = {};
  for (const [titulo, col, conv] of MAPA_DATOS) {
    const v = conv ? conv(g(titulo)) : texto(g(titulo));
    if (v !== null && v !== undefined && v !== '') datos[col] = v;
  }

  const familia: Record<string, any>[] = [];
  for (let n = 1; n <= MAX_FAMILIARES; n++) {
    const p = (campo: string) => g(`Familiar ${n} — ${campo}`);
    const nombre = texto(p('Apellido y nombres'));
    if (!nombre) continue;
    const situacion = norm(p('Situación laboral'));
    familia.push({
      parentesco:       texto(p('Parentesco'))?.toUpperCase() ?? null,
      apellido_nombres: nombre.toUpperCase(),
      dni_familiar:     String(p('DNI') ?? '').replace(/\D/g, '') || null,
      sexo:             SEXO[norm(p('Sexo'))] ?? null,
      vive:             siNo(p('¿Vive?')),
      fecha_nacimiento: aFecha(p('Fecha de nacimiento')),
      es_empleado:      situacion === 'empleado' ? (texto(p('Empleo')) ?? 'SI') : texto(p('Empleo')),
      es_jubilado:      situacion.startsWith('jubilado') ? (texto(p('Jubilación o pensión')) ?? 'SI') : texto(p('Jubilación o pensión')),
    });
  }

  let incomp: Record<string, any> | null = null;
  const jub = norm(g('¿Percibe jubilación, pensión o retiro?'));
  const otro = siNo(g('¿Desempeña algún otro cargo?'));
  if (jub || otro !== null) {
    incomp = {
      tiene_jubilacion:          jub ? (jub === 'no' ? 0 : 1) : null,
      jubilacion_tipo:           jub && jub !== 'no' ? jub.toUpperCase() : null,
      jubilacion_ley:            texto(g('Jubilación — Ley número')),
      jubilacion_caja:           texto(g('Jubilación — Caja')),
      jubilacion_monto:          aMonto(g('Jubilación — Monto mensual')),
      jubilacion_fecha:          aFecha(g('Jubilación — Fecha de otorgamiento')),
      otro_cargo:                otro,
      cargo_nacional:            texto(g('Otro cargo — Nacional')),
      cargo_provincial:          texto(g('Otro cargo — Provincial')),
      cargo_municipal:           texto(g('Otro cargo — Municipal')),
      otro_cargo_lugar:          texto(g('Otro cargo — Lugar donde lo desempeña')),
      otro_cargo_horario:        texto(g('Otro cargo — Horario')),
      otro_cargo_monto:          aMonto(g('Otro cargo — Monto del sueldo, comisión u honorarios')),
      otro_cargo_fecha_ingreso:  aFecha(g('Otro cargo — Fecha de ingreso')),
      otras_actividades:         texto(g('Otras actividades (carácter)')),
      otras_actividades_lugar:   texto(g('Otras actividades — Lugar donde las desempeña')),
      otras_actividades_monto:   aMonto(g('Otras actividades — Monto del sueldo, comisión u honorarios')),
      otras_actividades_fecha:   aFecha(g('Otras actividades — Fecha de ingreso')),
      observaciones:             texto(g('Incompatibilidad — Observaciones')),
    };
  }

  const bienes = String(texto(g('Bienes a declarar')) ?? '')
    .split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(n\.?c\.?|no corresponde|ninguno)$/i.test(l));

  return {
    fila: idx + 2,  // +2: encabezado + base 1, igual que en la planilla
    dni: dniTxt.length >= 7 && dniTxt.length <= 9 ? Number(dniTxt) : null,
    marca: aFecha(g('Marca temporal')),
    apellido: texto(g('Apellido')),
    nombres: texto(g('Nombres')),
    cuil: texto(g('CUIL')),
    fechaNac: aFecha(g('Fecha de nacimiento')),
    datos, familia, incomp, bienes,
  };
}

const igual = (a: any, b: any) => norm(a) === norm(b);

// Arma el plan por respuesta: estado + qué cambia (lo usan preview y confirmar)
async function planificar(sequelize: Sequelize, filas: Fila[]) {
  const parseadas = filas.map(parsear);

  // última respuesta por DNI
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
  const [personas, datosLeg, fams, incs, bienes] = await Promise.all([
    porDni(`SELECT dni, apellido, nombre, cuil, fecha_nacimiento FROM personal WHERE dni IN (:dnis)`),
    porDni(`SELECT * FROM legajo_datos_personales WHERE dni IN (:dnis)`),
    porDni(`SELECT dni, apellido_nombres, dni_familiar FROM legajo_familia WHERE dni IN (:dnis) AND deleted_at IS NULL`),
    porDni(`SELECT dni, id FROM legajo_incompatibilidad WHERE dni IN (:dnis) AND deleted_at IS NULL`),
    porDni(`SELECT dni, descripcion FROM legajo_declaracion_bienes WHERE dni IN (:dnis) AND deleted_at IS NULL`),
  ]);
  const idx = <T extends { dni: any }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    rows.forEach(r => { const k = Number(r.dni); m.set(k, [...(m.get(k) ?? []), r]); });
    return m;
  };
  const mPers = idx(personas), mDatos = idx(datosLeg), mFam = idx(fams), mInc = idx(incs), mBien = idx(bienes);

  return parseadas.map(p => {
    const base = {
      fila: p.fila, dni: p.dni, marca: p.marca,
      nombreFormulario: [p.apellido, p.nombres].filter(Boolean).join(', '),
    };
    if (!p.dni) return { ...base, estado: 'DNI_INVALIDO' as const };
    if (ultima.get(p.dni) !== p) return { ...base, estado: 'REEMPLAZADA' as const };
    const pers = mPers.get(p.dni)?.[0];
    if (!pers) return { ...base, estado: 'NO_EXISTE' as const };

    const avisos: string[] = [];
    if (p.apellido && !igual(p.apellido, pers.apellido)) avisos.push(`Apellido distinto al del sistema (${pers.apellido})`);
    if (p.nombres && !igual(p.nombres, pers.nombre)) avisos.push(`Nombres distintos a los del sistema (${pers.nombre})`);
    if (p.cuil && pers.cuil && p.cuil.replace(/\D/g, '') !== String(pers.cuil).replace(/\D/g, ''))
      avisos.push(`CUIL distinto al del sistema (${pers.cuil})`);
    const sysNac = pers.fecha_nacimiento ? String(pers.fecha_nacimiento).slice(0, 10) : null;
    const completarNacimiento = !!p.fechaNac && !sysNac;
    if (p.fechaNac && sysNac && p.fechaNac !== sysNac)
      avisos.push(`Fecha de nacimiento distinta a la del sistema (${sysNac}); se deja la del sistema`);

    const actual = mDatos.get(p.dni)?.[0] ?? {};
    const datosNuevos: Record<string, any> = {};
    const conflictos: { campo: string; actual: any; nuevo: any }[] = [];
    for (const [campo, nuevo] of Object.entries(p.datos)) {
      const act = (actual as any)[campo];
      const actNorm = act instanceof Date ? act.toISOString().slice(0, 10) : act;
      if (actNorm === null || actNorm === undefined || actNorm === '') datosNuevos[campo] = nuevo;
      else if (!igual(String(actNorm).slice(0, campo.endsWith('fecha') ? 10 : undefined), nuevo))
        conflictos.push({ campo, actual: actNorm, nuevo });
    }

    const famActual = mFam.get(p.dni) ?? [];
    const familiaNueva = p.familia.filter(f => !famActual.some((a: any) =>
      (f.dni_familiar && a.dni_familiar && String(a.dni_familiar) === f.dni_familiar) ||
      igual(a.apellido_nombres, f.apellido_nombres)));

    const bienesActuales = (mBien.get(p.dni) ?? []).map((b: any) => norm(b.descripcion));
    const bienesNuevos = p.bienes.filter(b => !bienesActuales.includes(norm(b)));

    return {
      ...base,
      estado: 'OK' as const,
      nombreSistema: `${pers.apellido}, ${pers.nombre}`,
      avisos,
      completarNacimiento: completarNacimiento ? p.fechaNac : null,
      datosNuevos, conflictos,
      familiaNueva, familiaYaCargada: p.familia.length - familiaNueva.length,
      incompatibilidad: p.incomp ? (mInc.get(p.dni)?.length ? 'EXISTE' : 'NUEVA') : null,
      incompDatos: p.incomp,
      bienesNuevos,
      fechaDeclaracion: p.marca,
    };
  });
}

export function registrarImportFormulario(
  router: Router, sequelize: Sequelize, ready: Promise<void>,
  write: any, userId: (req: Request) => number | null,
) {
  const filasDe = (req: Request): Fila[] | null => {
    const filas = (req.body as any)?.filas;
    return Array.isArray(filas) && filas.length <= 5000 ? filas : null;
  };

  router.post('/importar-formulario/preview', write, async (req: Request, res: Response) => {
    try {
      await ready;
      const filas = filasDe(req);
      if (!filas) return res.status(400).json({ ok: false, error: 'Mandá las filas de la planilla (máx. 5000)' });
      const plan = await planificar(sequelize, filas);
      // para la vista no hace falta mandar el detalle completo de incompatibilidad
      return res.json({ ok: true, data: plan.map(({ incompDatos, ...r }: any) => r) });
    } catch (err: any) {
      logger.error({ msg: 'legajo import preview', error: err?.message });
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

      const resumen = { agentes: 0, datos: 0, familiares: 0, incompatibilidad: 0, bienes: 0, nacimiento: 0 };
      for (const r of plan as any[]) {
        await sequelize.transaction(async (t: Transaction) => {
          const q = (sql: string, replacements: any) => sequelize.query(sql, { replacements, transaction: t });

          const datos = { ...r.datosNuevos };
          if (pisar) r.conflictos.forEach((c: any) => { datos[c.campo] = c.nuevo; });
          const cols = Object.keys(datos);
          if (cols.length) {
            await q(
              `INSERT INTO legajo_datos_personales (dni, ${cols.map(c => `\`${c}\``).join(', ')}, created_by, updated_by)
               VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)
               ON DUPLICATE KEY UPDATE ${cols.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')}, updated_by = VALUES(updated_by)`,
              [r.dni, ...cols.map(c => datos[c]), uid, uid]);
            resumen.datos += cols.length;
          }

          if (r.completarNacimiento) {
            await q(`UPDATE personal SET fecha_nacimiento = ?, updated_by = ? WHERE dni = ? AND fecha_nacimiento IS NULL`,
              [r.completarNacimiento, uid, r.dni]);
            resumen.nacimiento++;
          }

          for (const f of r.familiaNueva) {
            await q(
              `INSERT INTO legajo_familia (dni, parentesco, apellido_nombres, dni_familiar, sexo, vive,
                 fecha_nacimiento, es_empleado, es_jubilado, observaciones, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Formulario Google', ?)`,
              [r.dni, f.parentesco, f.apellido_nombres, f.dni_familiar, f.sexo, f.vive,
               f.fecha_nacimiento, f.es_empleado, f.es_jubilado, uid]);
            resumen.familiares++;
          }

          if (r.incompatibilidad === 'NUEVA' || (r.incompatibilidad === 'EXISTE' && pisar)) {
            const inc = { ...r.incompDatos, fecha_declaracion: r.fechaDeclaracion };
            const icols = Object.keys(inc);
            if (r.incompatibilidad === 'EXISTE') {
              await q(`UPDATE legajo_incompatibilidad SET deleted_at = NOW(), updated_by = ? WHERE dni = ? AND deleted_at IS NULL`,
                [uid, r.dni]);
            }
            await q(
              `INSERT INTO legajo_incompatibilidad (dni, ${icols.map(c => `\`${c}\``).join(', ')}, created_by)
               VALUES (?, ${icols.map(() => '?').join(', ')}, ?)`,
              [r.dni, ...icols.map(c => inc[c]), uid]);
            resumen.incompatibilidad++;
          }

          for (const b of r.bienesNuevos) {
            await q(`INSERT INTO legajo_declaracion_bienes (dni, descripcion, fecha, created_by) VALUES (?, ?, ?, ?)`,
              [r.dni, b, r.fechaDeclaracion, uid]);
            resumen.bienes++;
          }
        });
        resumen.agentes++;
      }
      return res.json({ ok: true, data: resumen });
    } catch (err: any) {
      logger.error({ msg: 'legajo import confirmar', error: err?.message });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });
}
