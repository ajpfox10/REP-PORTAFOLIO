// src/routes/fichajesAgentes.routes.ts
// GET /api/v1/fichajes-agentes?anio=2026&mes=10[&refresh=1]      resumen del mes, una fila por agente
// GET /api/v1/fichajes-agentes/detalle?dni=N&anio=2026&mes=10     el mes del agente día por día
// GET /api/v1/fichajes-agentes/anual?dni=N&anio=2026              resumen de los 12 meses del agente
//
// Pestaña "Fichajes" de Asistencia (solo admin): cruza las fichadas (adms_db.checkinout) con el horario que el
// agente TENÍA ese día y con lo que dice SIAPE, para detectar gente que no viene, llega tarde o se va antes.
//
// Horario: tabla horarios_historial (mig 090), una foto por agente y fecha (robot siape_horarios_historial: día 1 de
//   cada mes desde 2018, + la exportación diaria de HORARIOS.xlsx). Para el día D se usa la foto más reciente <= D;
//   si el agente no tiene ninguna anterior se usa la primera que tenga y el día queda "aprox" (horario posterior).
//   Turnos con armarTurnos (00:00–12:00 + 00:00–12:00 del día siguiente = un turno de 24 h, etc.).
// Marcas del turno: las asigna services/sinSalidaEval.ts (mismo criterio que Sin fichaje salida y el reporte por
//   servicio): guardia = sale al día siguiente, cada marca es de UN solo turno (turnos pegados no comparten marcas),
//   entrada hasta 3 h antes y salida hasta 6 h después, semana alternada (L-X-V / M-J) deducida de los fichajes.
//   Tarde / se fue antes / se fue después = más de TOLERANCIA_MIN min contra el horario (entrar antes no es falta).
//   Salida fuera de la ventana = OTRO_HORARIO (ficha otro horario).
// Día con una sola punta (solo entrada o solo salida) = INCOMPLETA: no cuenta como "fichó".
// Justificación del día (en este orden): SIAPE (tabla historial, desde 2016: licencias, FC, comisión…; no justifican
//   PRESENTE, LLEGO TARDE, AUSENTE CON/SIN AVISO ni BOLETA DE SALIDA), Salud Laboral OTORGADA, francos y Art. 26 de
//   los jefes, novedades del Ministerio (desde 2025). Feriados: tabla feriados (desde 2024).
// Bandera fuerte: PRESENTE en SIAPE pero sin ninguna fichada ese día.

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { QueryTypes, Sequelize } from 'sequelize';
import { logger } from '../logging/logger';
import { armarTurnos } from '../services/ausentismoEval';
import { evaluarAgente as evaluarTurnos, leerFichadas, HorarioSemana, Punch } from '../services/sinSalidaEval';

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const COL_DIA: Record<string, string> = {
  lunes: 'lun', martes: 'mar', miercoles: 'mie', jueves: 'jue', viernes: 'vie', sabado: 'sab', domingo: 'dom',
};
const DOW_KEYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const TOLERANCIA_MIN = 30;   // fijada con el usuario (igual que Sin fichaje salida)
const UNA_MARCA_MIN = 30;   // entrada y salida a menos de esto = una sola marca (doble toque)
const NO_JUSTIFICA = /^(PRESENTE|LLEGO TARDE|AUSENTE (SIN|CON) AVISO|BOLETA DE SALIDA)/;
const CACHE_MS = 10 * 60_000;

const normDni = (v: any) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
const enMin = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hoyIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // hora argentina
function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dowDe = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
function rangoMes(anio: number, mes: number) {
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const fin = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return { desde, hasta: `${desde.slice(0, 8)}${String(fin).padStart(2, '0')}` };
}

// ── horarios (fotos de horarios_historial) ───────────────────────────────────
interface Turno { entrada: string; salida: string; horas: number; cruza: boolean }
interface Foto { fecha: string; turnos: Record<string, Turno>; nombre: string | null; estructura: string | null; regimen: string | null }

async function leerFotos(sequelize: Sequelize, desde: string, hasta: string, dni?: string) {
  // foto base = la carga más reciente <= desde; si no hay ninguna, la primera que exista (días "aprox")
  const [base] = await sequelize.query<any>(
    `SELECT COALESCE(
        (SELECT DATE_FORMAT(MAX(fecha),'%Y-%m-%d') FROM horarios_historial_cargas WHERE filas > 0 AND fecha <= ?),
        (SELECT DATE_FORMAT(MIN(fecha),'%Y-%m-%d') FROM horarios_historial_cargas WHERE filas > 0)) AS f`,
    { replacements: [desde], type: QueryTypes.SELECT },
  );
  const porDni = new Map<string, Foto[]>();
  if (!base?.f) return { porDni, base: null as string | null };
  const tope = base.f > hasta ? base.f : hasta;
  const rows = await sequelize.query<any>(
    `SELECT *, DATE_FORMAT(fecha,'%Y-%m-%d') AS f FROM horarios_historial
      WHERE fecha BETWEEN ? AND ? ${dni ? 'AND dni = ?' : ''} ORDER BY fecha`,
    { replacements: dni ? [base.f, tope, dni] : [base.f, tope], type: QueryTypes.SELECT },
  );
  for (const r of rows) {
    const raw: Record<string, { e: string | null; s: string | null }> = {};
    for (const d of DIAS) raw[d] = { e: r[`${COL_DIA[d]}_e`] || null, s: r[`${COL_DIA[d]}_s`] || null };
    const turnos: Record<string, Turno> = {};
    for (const t of armarTurnos(raw)) turnos[t.dia] = { entrada: t.entrada, salida: t.salida, horas: t.horas, cruza: t.cruza };
    const k = normDni(r.dni);
    if (!porDni.has(k)) porDni.set(k, []);
    porDni.get(k)!.push({ fecha: r.f, turnos, nombre: r.apellido_nombre, estructura: r.estructura, regimen: r.regimen });
  }
  return { porDni, base: base.f as string };
}
function fotoDel(fotos: Foto[] | undefined, f: string): { foto: Foto; aprox: boolean } | null {
  if (!fotos?.length) return null;
  let elegida: Foto | null = null;
  for (const x of fotos) { if (x.fecha <= f) elegida = x; else break; }
  return elegida ? { foto: elegida, aprox: false } : { foto: fotos[0], aprox: true };
}

// ── fichadas (adms_db) ───────────────────────────────────────────────────────
type Tipo = 'E' | 'S' | null;
interface Marca { m: number; t: Tipo }   // minutos del día + entrada/salida según el reloj
const tipoDe = (ct: any): Tipo => (String(ct) === '0' ? 'E' : String(ct) === '1' ? 'S' : null);

const CFG_ADMS = () => path.resolve(process.cwd(), 'fichero_config.json');
function conectarAdms() {
  const cfg = JSON.parse(fs.readFileSync(CFG_ADMS(), 'utf-8'));
  return mysql.createConnection({
    host: cfg.mysqlHost || '127.0.0.1', port: cfg.mysqlPort || 3306,
    user: cfg.mysqlUser || 'root', password: cfg.mysqlPass || '',
    database: cfg.mysqlDb || 'adms_db', connectTimeout: 10_000, dateStrings: true,
  });
}

/** Última marca del agente en el reloj (sin límite de fechas). */
async function ultimaMarca(dni: string): Promise<{ fecha: string; hora: string; tipo: Tipo } | null> {
  if (!fs.existsSync(CFG_ADMS())) return null;
  let conn: mysql.Connection | null = null;
  try {
    conn = await conectarAdms();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ci.checktime, '%Y-%m-%d %H:%i') AS t, ci.checktype AS ct
         FROM checkinout ci INNER JOIN userinfo ui ON ci.userid = ui.userid
        WHERE ui.badgenumber = ? ORDER BY ci.checktime DESC LIMIT 1`, [dni]);
    if (!rows.length) return null;
    const t = String(rows[0].t);
    return { fecha: t.slice(0, 10), hora: t.slice(11, 16), tipo: tipoDe(rows[0].ct) };
  } catch (e: any) {
    logger.warn({ msg: 'fichajes-agentes: error leyendo última marca', error: e?.message });
    return null;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

async function leerMarcas(desde: string, hasta: string, dni?: string): Promise<{ marcas: Map<string, Marca[]>; enReloj: Set<string>; error: string | null }> {
  const marcas = new Map<string, Marca[]>();   // dni|fecha → marcas del día, ordenadas
  const enReloj = new Set<string>();            // DNIs dados de alta en la base biométrica
  if (!fs.existsSync(CFG_ADMS())) return { marcas, enReloj, error: 'No se encontró fichero_config.json (base biométrica)' };
  let conn: mysql.Connection | null = null;
  try {
    conn = await conectarAdms();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ui.badgenumber AS dni, DATE_FORMAT(ci.checktime, '%Y-%m-%d %H:%i') AS t, ci.checktype AS ct
         FROM checkinout ci
         INNER JOIN userinfo ui ON ci.userid = ui.userid
        WHERE ci.checktime >= ? AND ci.checktime < ? ${dni ? 'AND ui.badgenumber = ?' : ''}`,
      dni ? [`${sumarDias(desde, -2)} 00:00:00`, `${sumarDias(hasta, 3)} 00:00:00`, dni]
          : [`${sumarDias(desde, -2)} 00:00:00`, `${sumarDias(hasta, 3)} 00:00:00`],   // ±2 días: turnos que cruzan la medianoche
    );
    for (const r of rows) {
      const t = String(r.t);
      const k = `${normDni(r.dni)}|${t.slice(0, 10)}`;
      if (!marcas.has(k)) marcas.set(k, []);
      marcas.get(k)!.push({ m: enMin(t.slice(11, 16)), t: tipoDe(r.ct) });
    }
    for (const v of marcas.values()) v.sort((a, b) => a.m - b.m);
    const [us] = await conn.query<RowDataPacket[]>(
      `SELECT badgenumber FROM userinfo ${dni ? 'WHERE badgenumber = ?' : ''}`, dni ? [dni] : []);
    for (const u of us) enReloj.add(normDni(u.badgenumber));
    return { marcas, enReloj, error: null };
  } catch (e: any) {
    logger.warn({ msg: 'fichajes-agentes: error leyendo fichadas', error: e?.message });
    return { marcas, enReloj, error: 'No se pudo leer la base biométrica' };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

// ── novedades (SIAPE + cargas locales + Ministerio) ──────────────────────────
interface Nov { desde: string; hasta: string; texto: string; tipo: 'SIAPE' | 'LOCAL' }
async function leerNovedades(sequelize: Sequelize, desde: string, hasta: string, dni?: string) {
  const porDni = new Map<string, Nov[]>();
  const add = (d: any, n: Nov) => { const k = normDni(d); if (!porDni.has(k)) porDni.set(k, []); porDni.get(k)!.push(n); };
  const filtroDni = dni ? 'AND dni = ?' : '';
  const rep = (extra: any[] = []) => [hasta, desde, ...(dni ? [dni] : []), ...extra];
  const q = (sql: string) => sequelize.query<any>(sql, { replacements: rep(), type: QueryTypes.SELECT });

  for (const r of await q(
    `SELECT dni, novedad, DATE_FORMAT(fecha_desde,'%Y-%m-%d') d, DATE_FORMAT(COALESCE(fecha_hasta, fecha_desde),'%Y-%m-%d') h
       FROM historial WHERE fecha_desde <= ? AND COALESCE(fecha_hasta, fecha_desde) >= ? ${filtroDni}`))
    add(r.dni, { desde: r.d, hasta: r.h, texto: String(r.novedad).trim(), tipo: 'SIAPE' });
  for (const r of await q(
    `SELECT dni, tipo, DATE_FORMAT(fecha_desde,'%Y-%m-%d') d, DATE_FORMAT(fecha_hasta,'%Y-%m-%d') h
       FROM reconocimientos_medicos WHERE deleted_at IS NULL AND resultado = 'OTORGADA'
        AND fecha_desde <= ? AND fecha_hasta >= ? ${filtroDni}`))
    add(r.dni, { desde: r.d, hasta: r.h, texto: `Salud Laboral ${r.tipo || ''}`.trim(), tipo: 'LOCAL' });
  for (const r of await q(
    `SELECT dni, DATE_FORMAT(fecha_franco,'%Y-%m-%d') d FROM francos_compensatorios
      WHERE deleted_at IS NULL AND fecha_franco <= ? AND fecha_franco >= ? ${filtroDni}`))
    add(r.dni, { desde: r.d, hasta: r.d, texto: 'FRANCO COMPENSATORIO (jefe)', tipo: 'LOCAL' });
  for (const r of await q(
    `SELECT dni, DATE_FORMAT(fecha,'%Y-%m-%d') d,
            DATE_FORMAT(DATE_ADD(fecha, INTERVAL GREATEST(COALESCE(dias,1),1) - 1 DAY),'%Y-%m-%d') h
       FROM articulo_26 WHERE deleted_at IS NULL AND COALESCE(estado,'') <> 'ANULADO'
        AND fecha <= ? AND DATE_ADD(fecha, INTERVAL GREATEST(COALESCE(dias,1),1) - 1 DAY) >= ? ${filtroDni}`))
    add(r.dni, { desde: r.d, hasta: r.h, texto: 'ART. 26 (jefe)', tipo: 'LOCAL' });
  for (const r of await q(
    `SELECT dni, novedad, codigo, DATE_FORMAT(fecha_desde,'%Y-%m-%d') d, DATE_FORMAT(fecha_hasta,'%Y-%m-%d') h
       FROM ministerio_novedades_anual WHERE fecha_desde <= ? AND fecha_hasta >= ? ${filtroDni}`))
    add(r.dni, { desde: r.d, hasta: r.h, texto: `Ministerio: ${String(r.novedad || r.codigo).trim()}`, tipo: 'LOCAL' });

  return (k: string, f: string) => {
    const vs = (porDni.get(k) || []).filter(n => n.desde <= f && n.hasta >= f);
    const siape = vs.filter(n => n.tipo === 'SIAPE').map(n => n.texto);
    const just = vs.find(n => n.tipo === 'SIAPE' && !NO_JUSTIFICA.test(n.texto)) || vs.find(n => n.tipo === 'LOCAL') || null;
    return { siape, justifica: just?.texto ?? null };
  };
}

async function leerFeriados(sequelize: Sequelize, desde: string, hasta: string) {
  const rows = await sequelize.query<any>(
    `SELECT DATE_FORMAT(fecha,'%Y-%m-%d') AS f, nombre FROM feriados WHERE fecha BETWEEN ? AND ?`,
    { replacements: [desde, hasta], type: QueryTypes.SELECT },
  );
  return new Map<string, string>(rows.map((r: any) => [r.f, r.nombre]));
}

// ── evaluación día por día ───────────────────────────────────────────────────
type Estado = 'OK' | 'TARDE' | 'ANTES' | 'TARDE_ANTES' | 'DESPUES' | 'OTRO_HORARIO' | 'INCOMPLETA' | 'FALTA' | 'LICENCIA'
  | 'FERIADO' | 'EXTRA' | 'NO_TRABAJA' | 'HOY';
interface Dia {
  fecha: string; dow: number; horario: string | null; aprox: boolean;
  marcas: { h: string; t: Tipo }[]; entrada: string | null; salida: string | null;
  tardeMin: number; antesMin: number; despuesMin: number; motivos: string[]; estado: Estado;
  justifica: string | null; siape: string[]; feriado: string | null;
  presenteSinFichar: boolean; fichoConLicencia: boolean;
}
interface Resumen {
  debia: number; trabajados: number; incompletas: number; faltas: number; presenteSinFichar: number; tarde: number;
  minTarde: number; antes: number; despues: number; otroHorario: number; sinSalida: number; sinEntrada: number;
  licencias: number; extra: number; fichoConLicencia: number; diasAprox: number;
}
const resumenVacio = (): Resumen => ({
  debia: 0, trabajados: 0, incompletas: 0, faltas: 0, presenteSinFichar: 0, tarde: 0, minTarde: 0, antes: 0, despues: 0, otroHorario: 0,
  sinSalida: 0, sinEntrada: 0, licencias: 0, extra: 0, fichoConLicencia: 0, diasAprox: 0,
});

interface Fuentes {
  fotos: Map<string, Foto[]>;
  marcas: Map<string, Marca[]>;
  novedad: (dni: string, f: string) => { siape: string[]; justifica: string | null };
  feriados: Map<string, string>;
  punches: Record<string, Punch[]>;                       // fichadas con reloj (para sinSalidaEval)
  lector: Record<string, 'ENT' | 'SAL' | 'BIDI'>;
}

function evaluarAgente(dni: string, desde: string, hasta: string, src: Fuentes): Dia[] {
  const hoy = hoyIso();
  const fechas: string[] = [];
  for (let f = desde; f <= hasta && f <= hoy; f = sumarDias(f, 1)) fechas.push(f);
  if (!fechas.length) return [];
  const fotos = src.fotos.get(dni);
  // horario de cada fecha = la foto vigente ese día (armarTurnos ya une 08–00 + 00–12, etc.)
  const horarioDe = (f: string): HorarioSemana | null => {
    const fv = fotoDel(fotos, f);
    if (!fv) return null;
    const h: HorarioSemana = {};
    for (const [k, t] of Object.entries(fv.foto.turnos)) h[k] = { e: t.entrada, s: t.salida, cruza: t.cruza };
    return h;
  };
  // mismo criterio que Sin fichaje salida: cada marca es de un solo turno, guardia = sale al día
  // siguiente, tolerancia 30 min (entrar antes no es falta), semana alternada deducida de los fichajes
  const ev = evaluarTurnos(horarioDe, src.punches[dni] || [], src.lector, fechas);
  const porFecha = new Map(ev.turnos.map(t => [t.fecha, t]));
  const fueraSemana = new Map(ev.fueraSemana.map(x => [x.fecha, x]));
  const minutos = (ms: number) => Math.round(ms / 60000);

  const dias: Dia[] = [];
  for (const f of fechas) {
    const dow = dowDe(f);
    const fv = fotoDel(fotos, f);
    const t = fv?.foto.turnos[DOW_KEYS[dow]] || null;
    const nov = src.novedad(dni, f);
    const feriado = src.feriados.get(f) ?? null;
    const d: Dia = {
      fecha: f, dow, horario: t ? `${t.entrada}–${t.salida}${t.cruza ? ' (+1)' : ''}` : null, aprox: !!(t && fv?.aprox),
      marcas: (src.marcas.get(`${dni}|${f}`) || []).map(x => ({ h: fmt(x.m), t: x.t })), entrada: null, salida: null,
      tardeMin: 0, antesMin: 0, despuesMin: 0, motivos: [],
      estado: 'NO_TRABAJA', justifica: nov.justifica, siape: nov.siape, feriado, presenteSinFichar: false, fichoConLicencia: false,
    };
    dias.push(d);
    if (!t) continue;                                     // "fichó sin horario" se decide al final
    if (ev.noToca.includes(f)) {                          // semana alternada: esta semana no le toca
      d.motivos.push(`esta semana no le toca (alterna ${ev.alterna?.semanaA} / ${ev.alterna?.semanaB})`);
      continue;
    }
    if (ev.enCurso.includes(f)) { d.estado = 'HOY'; continue; }   // el turno todavía no terminó
    const te = porFecha.get(f);
    if (!te) continue;
    d.entrada = te.entrada;
    d.salida = te.estado === 'SIN_SALIDA' ? null : te.salida;
    d.motivos = te.motivos;

    if (te.estado === 'SIN_FICHAJE') {
      if (nov.justifica) d.estado = 'LICENCIA';
      else if (feriado) d.estado = 'FERIADO';
      else {
        d.estado = 'FALTA';
        d.presenteSinFichar = nov.siape.includes('PRESENTE');
      }
      continue;
    }
    d.fichoConLicencia = !!nov.justifica;
    if (te.estado === 'SIN_SALIDA' || te.estado === 'SOLO_SALIDA') { d.estado = 'INCOMPLETA'; continue; }
    if (te.estado === 'REVISAR_HORARIO') { d.estado = 'OTRO_HORARIO'; continue; }
    if (te.entradaTs != null && te.entradaTs > te.progEntTs + TOLERANCIA_MIN * 60000) d.tardeMin = minutos(te.entradaTs - te.progEntTs);
    if (te.salidaTs != null && te.salidaTs < te.progSalTs - TOLERANCIA_MIN * 60000) d.antesMin = minutos(te.progSalTs - te.salidaTs);
    if (te.salidaTs != null && te.salidaTs > te.progSalTs + TOLERANCIA_MIN * 60000) d.despuesMin = minutos(te.salidaTs - te.progSalTs);
    d.estado = d.tardeMin && d.antesMin ? 'TARDE_ANTES' : d.tardeMin ? 'TARDE' : d.antesMin ? 'ANTES' : d.despuesMin ? 'DESPUES' : 'OK';
  }
  // marcas que no son de ningún turno, en días sin turno = fichó sin horario
  const libres = new Map<string, number[]>();
  for (const p of ev.libres) {
    const dt = new Date(p.ts);
    const f = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (!libres.has(f)) libres.set(f, []);
    libres.get(f)!.push(dt.getHours() * 60 + dt.getMinutes());
  }
  for (const d of dias) {
    if (d.estado !== 'NO_TRABAJA') continue;
    const ls = (libres.get(d.fecha) || []).sort((a, b) => a - b);
    if (!ls.length) continue;
    d.estado = 'EXTRA';
    d.entrada = fmt(ls[0]);
    if (ls[ls.length - 1] - ls[0] >= UNA_MARCA_MIN) d.salida = fmt(ls[ls.length - 1]);
    const fsem = fueraSemana.get(d.fecha);
    if (fsem) d.motivos = fsem.motivos;
  }
  return dias;
}

function resumir(dias: Dia[]): Resumen {
  const r = resumenVacio();
  for (const d of dias) {
    if (d.estado === 'EXTRA') { r.extra++; continue; }
    if (d.estado === 'NO_TRABAJA' || d.estado === 'HOY') continue;
    r.debia++;
    if (d.aprox) r.diasAprox++;
    if (d.estado === 'LICENCIA') { r.licencias++; continue; }
    if (d.estado === 'FERIADO') continue;
    if (d.estado === 'FALTA') { r.faltas++; if (d.presenteSinFichar) r.presenteSinFichar++; continue; }
    if (d.estado === 'INCOMPLETA') {
      r.incompletas++;
      if (d.entrada) r.sinSalida++; else r.sinEntrada++;
    } else r.trabajados++;
    if (d.fichoConLicencia) r.fichoConLicencia++;
    if (d.tardeMin) { r.tarde++; r.minTarde += d.tardeMin; }
    if (d.antesMin) r.antes++;
    if (d.despuesMin) r.despues++;
    if (d.estado === 'OTRO_HORARIO') r.otroHorario++;
  }
  return r;
}

async function cargarFuentes(sequelize: Sequelize, desde: string, hasta: string, dni?: string) {
  const [fot, mar, novedad, feriados] = await Promise.all([
    leerFotos(sequelize, desde, hasta, dni),
    leerMarcas(desde, hasta, dni),
    leerNovedades(sequelize, desde, hasta, dni),
    leerFeriados(sequelize, desde, hasta),
  ]);
  // universo: todos los que tienen horario o ficharon en el período
  const dnis = new Set<string>(dni ? [dni] : fot.porDni.keys());
  if (!dni) for (const k of mar.marcas.keys()) { const [d, f] = k.split('|'); if (f >= desde && f <= hasta) dnis.add(d); }
  dnis.delete('');
  const fich = await leerFichadas([...dnis], desde, hasta);
  const src: Fuentes = {
    fotos: fot.porDni, marcas: mar.marcas, novedad, feriados,
    punches: 'error' in fich ? {} : fich.punches, lector: 'error' in fich ? {} : fich.lector,
  };
  return { src, dnis: [...dnis], enReloj: mar.enReloj, error: mar.error || ('error' in fich ? fich.error : null), horariosDesde: fot.base };
}

async function infoHorarios(sequelize: Sequelize) {
  const [r] = await sequelize.query<any>(
    `SELECT COUNT(*) AS fotos, DATE_FORMAT(MIN(fecha),'%Y-%m-%d') AS primera, DATE_FORMAT(MAX(fecha),'%Y-%m-%d') AS ultima
       FROM horarios_historial_cargas WHERE filas > 0`,
    { type: QueryTypes.SELECT },
  );
  return r;
}

const parseAnioMes = (req: Request) => {
  const anio = Number(req.query.anio), mes = Number(req.query.mes);
  if (!Number.isInteger(anio) || anio < 2016 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return { anio, mes };
};

export function buildFichajesAgentesRouter(sequelize: Sequelize) {
  const router = Router();
  const cache = new Map<string, { ts: number; data: any }>();

  router.get('/', async (req: Request, res: Response) => {
    const am = parseAnioMes(req);
    if (!am) return res.status(400).json({ ok: false, error: 'anio/mes inválidos' });
    const clave = `${am.anio}-${am.mes}`;
    const c = cache.get(clave);
    if (c && Date.now() - c.ts < CACHE_MS && req.query.refresh !== '1') return res.json(c.data);
    try {
      const { desde, hasta } = rangoMes(am.anio, am.mes);
      const { src, dnis: lista, enReloj, error } = await cargarFuentes(sequelize, desde, hasta);
      const personas = lista.length ? await sequelize.query<any>(
        `SELECT p.dni, CONCAT_WS(' ', p.apellido, p.nombre) AS nombre, s.nombre AS servicio
           FROM personal p
           LEFT JOIN agentes_servicios ags ON ags.dni = p.dni AND ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL
           LEFT JOIN servicios s ON s.id = ags.servicio_id
          WHERE p.dni IN (?)`,
        { replacements: [lista], type: QueryTypes.SELECT },
      ) : [];
      const pers = new Map<string, { nombre: string; servicio: string | null }>();
      for (const p of personas) { const k = normDni(p.dni); if (!pers.has(k)) pers.set(k, { nombre: p.nombre, servicio: p.servicio }); }

      const agentes = lista.map(dni => {
        const dias = evaluarAgente(dni, desde, hasta, src);
        const fotos = src.fotos.get(dni);
        const ult = fotos?.[fotos.length - 1];
        return {
          dni,
          nombre: ult?.nombre || pers.get(dni)?.nombre || '(sin datos)',
          servicio: pers.get(dni)?.servicio ?? null,
          estructura: ult?.estructura ?? null,
          regimen: ult?.regimen ?? null,
          sinHorario: !fotos?.length,
          enReloj: enReloj.has(dni),
          ...resumir(dias),
        };
      }).filter(a => a.debia || a.extra);
      const data = { ok: true, desde, hasta, tolerancia: TOLERANCIA_MIN, errorFichadas: error, horarios: await infoHorarios(sequelize), agentes };
      cache.set(clave, { ts: Date.now(), data });
      res.json(data);
    } catch (e: any) {
      logger.error({ msg: 'fichajes-agentes: error', error: e?.message });
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  router.get('/detalle', async (req: Request, res: Response) => {
    const am = parseAnioMes(req);
    const dni = normDni(req.query.dni);
    if (!am || !dni) return res.status(400).json({ ok: false, error: 'dni/anio/mes inválidos' });
    try {
      const { desde, hasta } = rangoMes(am.anio, am.mes);
      const { src, enReloj, error } = await cargarFuentes(sequelize, desde, hasta, dni);
      const dias = evaluarAgente(dni, desde, hasta, src);
      res.json({ ok: true, dni, desde, hasta, tolerancia: TOLERANCIA_MIN, enReloj: enReloj.has(dni), errorFichadas: error, resumen: resumir(dias), dias });
    } catch (e: any) {
      logger.error({ msg: 'fichajes-agentes/detalle: error', error: e?.message });
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  router.get('/anual', async (req: Request, res: Response) => {
    const anio = Number(req.query.anio);
    const dni = normDni(req.query.dni);
    if (!dni || !Number.isInteger(anio) || anio < 2016 || anio > 2100) return res.status(400).json({ ok: false, error: 'dni/anio inválidos' });
    try {
      const { src, error } = await cargarFuentes(sequelize, `${anio}-01-01`, `${anio}-12-31`, dni);
      const meses = Array.from({ length: 12 }, (_, i) => {
        const { desde, hasta } = rangoMes(anio, i + 1);
        return { mes: i + 1, ...resumir(evaluarAgente(dni, desde, hasta, src)) };
      });
      res.json({ ok: true, dni, anio, errorFichadas: error, meses });
    } catch (e: any) {
      logger.error({ msg: 'fichajes-agentes/anual: error', error: e?.message });
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  return router;
}

// GET /api/v1/fichajes-agentes/reciente?dni=N — para la ficha del agente en Gestión (cualquier usuario logueado):
// horario vigente, hoy, última marca y los últimos 7 días. Se evalúan 35 días para que se deduzca la semana
// alternada, pero se devuelven solo los últimos 7.
export function buildFichajesRecienteRouter(sequelize: Sequelize) {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const dni = normDni(req.query.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'dni inválido' });
    try {
      const hoy = hoyIso();
      const desde = sumarDias(hoy, -34);
      const [{ src, enReloj, error }, ultima] = await Promise.all([cargarFuentes(sequelize, desde, hoy, dni), ultimaMarca(dni)]);
      const dias = evaluarAgente(dni, desde, hoy, src);
      const fv = fotoDel(src.fotos.get(dni), hoy);
      const horario = fv
        ? [1, 2, 3, 4, 5, 6, 0].map(dow => {
            const t = fv.foto.turnos[DOW_KEYS[dow]];
            return { dow, entrada: t?.entrada ?? null, salida: t?.salida ?? null, cruza: !!t?.cruza, horas: t?.horas ?? null };
          })
        : null;
      res.json({
        ok: true, dni, hoy, tolerancia: TOLERANCIA_MIN, enReloj: enReloj.has(dni), errorFichadas: error,
        horario, horarioFoto: fv?.foto.fecha ?? null, regimen: fv?.foto.regimen ?? null,
        ultima, dias: dias.slice(-7).reverse(),
      });
    } catch (e: any) {
      logger.error({ msg: 'fichajes-agentes/reciente: error', error: e?.message });
      res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });
  return router;
}
