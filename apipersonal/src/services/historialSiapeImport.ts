// src/services/historialSiapeImport.ts
// Importa los exports del SIAPE a la tabla `historial`.
//
// Fuente: EXCEL_ASISTENCIA_DIR\historialsiape*.xlsx (D:\G\comparacion).
// Formato esperado: el export completo del SIAPE (23 columnas, NRO_DOCUMENTO).
//
// Dos modos:
//   'agregar'    → sólo INSERT IGNORE. No borra nada. El índice único
//                  uq_historial__novedad (dni, novedad, fecha_desde, fecha_hasta)
//                  hace que lo ya cargado se saltee solo.
//   'reemplazar' → borra de la tabla las novedades cuya fecha_desde cae DENTRO
//                  del rango que cubren los archivos, y carga los archivos
//                  encima. Lo que los archivos NO cubren se conserva: si un
//                  tramo falta en el export (p. ej. 01/01/2022 → 08/08/2022),
//                  esas filas quedan intactas en vez de perderse.
//
// Los DNI que no existen en personal ∩ agentes se saltean (FK) y se reportan.

import fs from 'fs';
import path from 'path';
import { QueryTypes, Sequelize } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../logging/logger';

let XLSX: any;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

const BATCH = 2000;
const PATRON = /^historialsiape.*\.xls[xm]?$/i;

export interface ResultadoArchivo {
  archivo: string;
  filas: number;
  insertadas: number;
  duplicadas: number;
  sinFk: number;
  sinFecha: number;
  desde: string | null;
  hasta: string | null;
  error?: string;
}

export type ModoImport = 'agregar' | 'reemplazar';

export interface ResultadoImport {
  modo: ModoImport;
  rangosCubiertos: { desde: string; hasta: string }[];
  borradas: number;
  archivos: ResultadoArchivo[];
  totales: { filas: number; insertadas: number; duplicadas: number; sinFk: number; sinFecha: number };
  dnisRechazados: { dni: number; nombre: string; filas: number }[];
  posiblesCorrecciones: { dni: number; novedad: string; fechas: string[] }[];
  porAnio: { anio: number | null; filas: number }[];
  advertencias: string[];
}

const txt = (v: any, max: number): string | null => {
  const s = String(v ?? '').trim();
  if (!s || s === '-') return null;
  return s.slice(0, max);
};

/** Serial de Excel, Date o texto DD-MM-AAAA → 'YYYY-MM-DD'. */
function aFecha(v: any): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date((v - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const normEstructura = (s: any) =>
  String(s ?? '').toUpperCase().normalize('NFD').replace(new RegExp('[\u0300-\u036f]', 'g'), '');

/** Misma regla que el loader y el backend: UPA por E5/E6, si no HOSPITAL. */
function resolveDependencia(e5raw: any, e6raw: any): string {
  const e6 = normEstructura(e6raw), e5 = normEstructura(e5raw);
  const m6 = e6.match(/UPA\s*(\d+)/) ?? e6.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (m6) return `UPA ${m6[1]}`;
  const m5 = e5.match(/UPA\s*(\d+)/) ?? e5.match(/UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)/);
  if (m5) return `UPA ${m5[1]}`;
  return 'HOSPITAL';
}

export function listarArchivos(): { dir: string | null; archivos: string[] } {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR;
  if (!dir || !fs.existsSync(dir)) return { dir: dir || null, archivos: [] };
  return {
    dir,
    archivos: fs.readdirSync(dir).filter((f: string) => PATRON.test(f) && !f.startsWith('~$')).sort(),
  };
}

/** Une intervalos [desde,hasta] solapados o pegados en la menor cantidad de tramos. */
function unirRangos(rangos: { desde: string; hasta: string }[]): { desde: string; hasta: string }[] {
  const orden = rangos.filter(r => r.desde && r.hasta).sort((a, b) => a.desde.localeCompare(b.desde));
  const out: { desde: string; hasta: string }[] = [];
  for (const r of orden) {
    const ult = out[out.length - 1];
    if (ult && r.desde <= ult.hasta) { if (r.hasta > ult.hasta) ult.hasta = r.hasta; }
    else out.push({ ...r });
  }
  return out;
}

/**
 * Lee un archivo y devuelve cuántas filas tiene POR MES.
 *
 * No alcanza con el mínimo y el máximo de fecha_desde: los exports del SIAPE
 * traen filas sueltas de arrastre fuera de su período real (el export de 2023
 * tiene un puñado de filas de agosto 2022, el de 2025 alguna de febrero 2024).
 * Si se borra por min–max se vacían meses que el archivo no repone. Por eso el
 * borrado se decide mes a mes, y sólo donde el archivo aporta datos de verdad.
 */
function mesesDeArchivo(fp: string): Map<string, number> {
  const out = new Map<string, number>();
  const wb = XLSX.readFile(fp, { cellDates: false });
  const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  if (!rows.length) return out;
  const hdr: Record<string, number> = {};
  rows[0].forEach((h, i) => { hdr[String(h).toUpperCase().trim()] = i; });
  const iD = hdr['FECHA_DESDE'] ?? -1;
  if (iD < 0) return out;
  for (let i = 1; i < rows.length; i++) {
    const d = aFecha(rows[i]?.[iD]);
    if (!d) continue;
    const mes = d.slice(0, 7);
    out.set(mes, (out.get(mes) || 0) + 1);
  }
  return out;
}

/** Un mes se considera cubierto si el archivo aporta al menos esta proporción
 *  de lo que ya hay en la tabla para ese mes (y un piso absoluto de filas). */
const COBERTURA_MINIMA = 0.5;
const PISO_FILAS = 100;

export async function importarHistorialSiape(
  sequelize: Sequelize,
  modo: ModoImport = 'agregar',
): Promise<ResultadoImport> {
  const advertencias: string[] = [];
  const res: ResultadoImport = {
    modo,
    rangosCubiertos: [],
    borradas: 0,
    archivos: [],
    totales: { filas: 0, insertadas: 0, duplicadas: 0, sinFk: 0, sinFecha: 0 },
    dnisRechazados: [], posiblesCorrecciones: [], porAnio: [], advertencias,
  };

  if (!XLSX) { advertencias.push('Falta la dependencia xlsx'); return res; }
  const { dir, archivos } = listarArchivos();
  if (!dir) { advertencias.push('EXCEL_ASISTENCIA_DIR no configurado o inexistente'); return res; }
  if (!archivos.length) {
    advertencias.push(`No hay archivos historialsiape*.xlsx en ${dir}`);
    return res;
  }

  // ── modo reemplazar: borrar sólo lo que los archivos van a cubrir ──
  // Se hace ANTES de leer las claves existentes, para que el dedupe posterior
  // trabaje sobre el estado real de la tabla.
  if (modo === 'reemplazar') {
    // 1) cuántas filas aporta cada archivo por mes
    const aporte = new Map<string, number>();
    for (const archivo of archivos) {
      const fp = path.join(dir, archivo);
      try {
        if (fs.statSync(fp).size < 4096) continue;
        for (const [mes, n] of mesesDeArchivo(fp)) aporte.set(mes, (aporte.get(mes) || 0) + n);
      } catch (e: any) {
        logger.warn({ msg: 'historialSiapeImport: no pude leer los meses', archivo, error: e?.message });
      }
    }

    // 2) cuántas hay hoy en la tabla por mes
    const enTabla = new Map<string, number>();
    const mesesTabla: any[] = await sequelize.query(
      "SELECT DATE_FORMAT(fecha_desde,'%Y-%m') AS mes, COUNT(*) AS filas FROM historial GROUP BY mes",
      { type: QueryTypes.SELECT },
    );
    for (const r of mesesTabla) if (r.mes) enTabla.set(r.mes, Number(r.filas));

    // 3) borrar sólo los meses que el archivo repone de verdad
    const aBorrar: string[] = [];
    const salteados: string[] = [];
    for (const [mes, n] of aporte) {
      const actual = enTabla.get(mes) || 0;
      if (n >= PISO_FILAS && n >= actual * COBERTURA_MINIMA) aBorrar.push(mes);
      else if (actual > 0) salteados.push(`${mes} (archivo ${n} vs tabla ${actual})`);
    }
    aBorrar.sort();

    for (const mes of aBorrar) {
      const [meta]: any = await sequelize.query(
        "DELETE FROM historial WHERE DATE_FORMAT(fecha_desde,'%Y-%m') = :mes",
        { replacements: { mes } },
      );
      res.borradas += Number(meta?.affectedRows ?? 0);
    }

    res.rangosCubiertos = unirRangos(aBorrar.map(m => ({ desde: `${m}-01`, hasta: `${m}-31` })));
    advertencias.push(
      `Modo reemplazar: borradas ${res.borradas} fila(s) en ${aBorrar.length} mes(es). ` +
      'Sólo se borran los meses que los archivos reponen de verdad.',
    );
    if (salteados.length) {
      advertencias.push(
        `No se tocaron ${salteados.length} mes(es) donde el archivo trae muy pocas filas ` +
        `respecto de lo ya cargado: ${salteados.slice(0, 12).join(', ')}` +
        `${salteados.length > 12 ? '…' : ''}. Son filas de arrastre, no el período real del export.`,
      );
    }
  }

  // DNIs válidos para la FK
  const dniRows: any[] = await sequelize.query(
    'SELECT DISTINCT p.dni FROM personal p JOIN agentes a ON a.dni = p.dni',
    { type: QueryTypes.SELECT },
  );
  const validDnis = new Set(dniRows.map(r => Number(r.dni)));

  // claves ya presentes: evita mandar a la base lo que ya está
  const oldKeys: any[] = await sequelize.query(
    "SELECT CONCAT(dni,'|',novedad,'|',IFNULL(fecha_desde,''),'|',IFNULL(fecha_hasta,'')) AS k FROM historial",
    { type: QueryTypes.SELECT },
  );
  const vistas = new Set<string>(oldKeys.map(r => r.k));

  // para detectar correcciones: qué fechas tiene ya cada dni+novedad
  const porNovedad = new Map<string, Set<string>>();
  for (const k of vistas) {
    const [dni, novedad, d1, d2] = k.split('|');
    const kk = `${dni}|${novedad}`;
    if (!porNovedad.has(kk)) porNovedad.set(kk, new Set());
    porNovedad.get(kk)!.add(`${d1}→${d2}`);
  }

  const rechazadas = new Map<number, { nombre: string; filas: number }>();
  const correcciones = new Map<string, Set<string>>();

  for (const archivo of archivos) {
    const fp = path.join(dir, archivo);
    const r: ResultadoArchivo = {
      archivo, filas: 0, insertadas: 0, duplicadas: 0, sinFk: 0, sinFecha: 0, desde: null, hasta: null,
    };
    try {
      if (fs.statSync(fp).size < 4096) {
        r.error = `sólo ${fs.statSync(fp).size} bytes, no es un export válido (¿falló la descarga?)`;
        res.archivos.push(r);
        continue;
      }
      const wb = XLSX.readFile(fp, { cellDates: false });
      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      if (!rows.length) { r.error = 'archivo vacío'; res.archivos.push(r); continue; }

      const hdr: Record<string, number> = {};
      rows[0].forEach((h, i) => { hdr[String(h).toUpperCase().trim()] = i; });
      const col = (n: string) => (hdr[n] ?? -1);
      const iDni = col('NRO_DOCUMENTO');
      if (iDni < 0) {
        r.error = `sin columna NRO_DOCUMENTO (headers: ${rows[0].slice(0, 6).join(', ')}…)`;
        res.archivos.push(r);
        continue;
      }

      let batch: any[][] = [];
      const flush = async () => {
        if (!batch.length) return;
        await sequelize.query(
          `INSERT IGNORE INTO historial
             (dni, legajo, apellido, nombre, sexo, regimen_estatutario, planta, agrupamiento,
              categoria_salarial, novedad, fecha_desde, fecha_hasta, justificado,
              estructura_servicio, dependencia, archivo_origen)
           VALUES ?`,
          { replacements: [batch], type: QueryTypes.INSERT },
        );
        batch = [];
      };

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.length) continue;
        r.filas++;

        const dni = Number(String(row[iDni] ?? '').replace(/[^0-9]/g, ''));
        const novedad = txt(row[col('NOVEDAD')], 160);
        const fdesde = aFecha(row[col('FECHA_DESDE')]);
        const fhasta = aFecha(row[col('FECHA_HASTA')]) ?? fdesde;

        if (!fdesde || !novedad) { r.sinFecha++; continue; }
        if (!r.desde || fdesde < r.desde) r.desde = fdesde;
        if (!r.hasta || fdesde > r.hasta) r.hasta = fdesde;

        if (!validDnis.has(dni)) {
          r.sinFk++;
          const nom = `${txt(row[col('APELLIDO')], 120) || ''} ${txt(row[col('NOMBRE')], 120) || ''}`.trim();
          const prev = rechazadas.get(dni);
          if (prev) prev.filas++;
          else rechazadas.set(dni, { nombre: nom || '(sin nombre)', filas: 1 });
          continue;
        }

        const clave = `${dni}|${novedad}|${fdesde}|${fhasta}`;
        if (vistas.has(clave)) { r.duplicadas++; continue; }

        // ¿es una corrección de una novedad ya cargada?
        // Ojo: que el agente tenga la misma novedad con otras fechas NO alcanza
        // — son licencias distintas (cuatro enfermedades en el año son cuatro
        // novedades). Sólo cuenta como posible corrección si los rangos SE
        // SOLAPAN de verdad, y ni siquiera entonces es seguro: las carpetas
        // largas vienen partidas en tramos que comparten el día de empalme.
        const kk = `${dni}|${novedad}`;
        const yaTiene = porNovedad.get(kk);
        if (yaTiene && yaTiene.size && !yaTiene.has(`${fdesde}→${fhasta}`)) {
          const fin = fhasta ?? fdesde;
          const solapa = [...yaTiene].some(rango => {
            const [d1, d2] = rango.split('→');
            // solape estricto: comparten más que el día de empalme
            return d1 < fin && fdesde < d2;
          });
          if (solapa) {
            if (!correcciones.has(kk)) correcciones.set(kk, new Set(yaTiene));
            correcciones.get(kk)!.add(`${fdesde}→${fhasta}`);
          }
        }

        vistas.add(clave);
        if (!porNovedad.has(kk)) porNovedad.set(kk, new Set());
        porNovedad.get(kk)!.add(`${fdesde}→${fhasta}`);

        batch.push([
          dni,
          txt(row[col('LEGAJO')], 30),
          txt(row[col('APELLIDO')], 120),
          txt(row[col('NOMBRE')], 120),
          txt(row[col('SEXO')], 5),
          txt(row[col('REGIMEN_ESTATUTARIO')], 120),
          txt(row[col('PLANTA')], 60),
          txt(row[col('AGRUPAMIENTO')], 80),
          txt(row[col('CATEGORIA_SALARIAL')], 30),
          novedad,
          fdesde,
          fhasta,
          txt(row[col('JUSTIFICADO')], 5),
          txt(row[col('ESTRUCTURA_SERVICIO')], 255),
          resolveDependencia(row[col('E5')], row[col('E6')]),
          archivo,
        ]);
        r.insertadas++;
        if (batch.length >= BATCH) await flush();
      }
      await flush();
    } catch (e: any) {
      r.error = e?.message || 'error desconocido';
      logger.error({ msg: 'historialSiapeImport', archivo, error: e?.message });
    }
    res.archivos.push(r);
  }

  for (const a of res.archivos) {
    res.totales.filas += a.filas;
    res.totales.insertadas += a.insertadas;
    res.totales.duplicadas += a.duplicadas;
    res.totales.sinFk += a.sinFk;
    res.totales.sinFecha += a.sinFecha;
  }

  res.dnisRechazados = [...rechazadas.entries()]
    .map(([dni, i]) => ({ dni, nombre: i.nombre, filas: i.filas }))
    .sort((a, b) => b.filas - a.filas)
    .slice(0, 200);

  res.posiblesCorrecciones = [...correcciones.entries()]
    .map(([k, fechas]) => {
      const [dni, novedad] = k.split('|');
      return { dni: Number(dni), novedad, fechas: [...fechas].sort() };
    })
    .slice(0, 200);

  const anios: any[] = await sequelize.query(
    'SELECT YEAR(fecha_desde) AS anio, COUNT(*) AS filas FROM historial GROUP BY YEAR(fecha_desde) ORDER BY anio',
    { type: QueryTypes.SELECT },
  );
  res.porAnio = anios.map(a => ({ anio: a.anio == null ? null : Number(a.anio), filas: Number(a.filas) }));

  if (res.posiblesCorrecciones.length) {
    advertencias.push(
      `${correcciones.size} novedad(es) se solapan con otra ya cargada del mismo agente. ` +
      'Puede ser una corrección del SIAPE, o una carpeta larga partida en tramos. ' +
      'No se borró nada: revisalas antes de tocar.',
    );
  }
  if (res.totales.sinFk) {
    advertencias.push(`${res.totales.sinFk} fila(s) salteadas: el DNI no existe en personal + agentes.`);
  }

  return res;
}
