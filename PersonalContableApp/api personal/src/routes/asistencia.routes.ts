// src/routes/asistencia.routes.ts
// Comparador de asistencia MINISTERIO vs SIAP
//
// FLUJO:
//  GET  /asistencia/config          → directorio configurado en .env
//  GET  /asistencia/archivos        → lista los .xlsx/.xltx de EXCEL_ASISTENCIA_DIR
//  GET  /asistencia/mapeo           → devuelve el mapeo actual de novedades (del JSON en disco)
//  PUT  /asistencia/mapeo           → guarda el mapeo editado (persiste en disco)
//  DELETE /asistencia/mapeo         → restaura el mapeo por defecto
//  POST /asistencia/comparar        → compara usando los archivos del directorio
//
// El directorio se configura en .env:
//   EXCEL_ASISTENCIA_DIR=D:\Asistencia\Excel
//
// Deteccion automatica de archivos:
//   - El archivo cuyo nombre contenga "ministerio" se usa como fuente Ministerio
//   - El archivo cuyo nombre contenga "siap"       se usa como fuente SIAP
//   - Tambien se puede indicar nombre explicito en el body del POST

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { requirePermission } from '../middlewares/rbacCrud';
import { env } from '../config/env';

let ExcelJS: any;
try { ExcelJS = require('exceljs'); } catch { ExcelJS = null; }

function getMappingFilePath(): string {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR || '';
  if (!dir) return path.join(process.cwd(), 'asistencia_mapeo.json');
  return path.join(dir, 'asistencia_mapeo.json');
}

const DEFAULT_MAPEO: Record<string, string[]> = {
  '08-DESCANSO ANUAL':
    ['ANUAL'],
  '291-LICENCIA ANUAL COMPLEMENTARIA LEY 10430 Y MODIF.':
    ['ANUAL COMPLEMENTARIA', 'ANUAL COMPLEMENTARIA 10430'],
  '01-POR RAZONES DE ENFERMEDAD':
    ['ENFERMEDAD'],
  '04-POR ACCIDENTE DE TRABAJO':
    ['ACCIDENTE DE TRABAJO'],
  '05-POR ATENCION DE FAMILIAR ENFERMO':
    ['ENFERMEDAD DE FAMILIAR O NIÑO/A O ADOLESCENTE', 'ATENCION FAMILIAR ENFERMO'],
  '06-POR MATERNIDAD':
    ['MATERNIDAD'],
  '15-DUELO FAMILIAR INDIRECTO':
    ['DUELO INDIRECTO'],
  '17-POR PRE-EXAMEN':
    ['PRE-EXAMEN'],
  '18-POR EXAMEN':
    ['EXAMEN'],
  '1R-ENFERMEDAD DE RIESGO':
    ['ENFERMEDAD'],
  '22-ACTIVIDAD GREMIAL':
    ['PERMISO GREMIAL DIAS'],
  '261-POR CAUSAS PARTICULARES':
    ['CAUSAS PARTICULARES'],
  '44-PERMISO CITACIONES ORG.OFICIAL':
    ['CITACION ORG.OFICIALES'],
  '81-LICENCIA ANTERIOR DENEGADA':
    ['AUSENTE SIN AVISO'],
  'AE1-ADAPTACION ESCOLAR':
    ['COMISION'],
  'DF-EXAMEN DE PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA':
    ['PAPANICOLAU Y/O RADIOGRAFIA O ECOGRAFIA MAMARIA'],
  'PC-PREVENCION CANCER GENITO MAMARIO DE PROSTATO Y/O COLON':
    ['EX.MED.PREV.CANCER MAMARIO/PROSTATA/COLON'],
};

function loadMapeo(): Record<string, string[]> {
  try {
    const fp = getMappingFilePath();
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    }
  } catch { /* usa default */ }
  return { ...DEFAULT_MAPEO };
}

function saveMapeo(mapeo: Record<string, string[]>): void {
  fs.writeFileSync(getMappingFilePath(), JSON.stringify(mapeo, null, 2), 'utf-8');
}

function listExcelFiles(): { name: string; size: number; modified: string; role: string }[] {
  const dir = (env as any).EXCEL_ASISTENCIA_DIR || '';
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(xlsx|xltx|xls)$/i.test(f))
    .map(f => {
      const stat = fs.statSync(path.join(dir, f));
      const nl = f.toLowerCase();
      return {
        name: f,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        role: nl.includes('ministerio') ? 'MINISTERIO' : nl.includes('siap') ? 'SIAP' : 'DESCONOCIDO',
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const months: Record<string, number> = {
      JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
      ENE:0,ABR:3,AGO:7,SET:8,DIC:11,
    };
    const m1 = val.match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})$/i);
    if (m1) {
      return new Date(
        parseInt(m1[3]) + (m1[3].length === 2 ? 2000 : 0),
        months[m1[2].toUpperCase()] ?? 0,
        parseInt(m1[1])
      );
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const dateToStr = (d: Date | null) => d ? d.toISOString().slice(0, 10) : '';
const overlap   = (s1: Date, e1: Date, s2: Date, e2: Date) => s1 <= e2 && s2 <= e1;

async function parseMinisterio(fp: string): Promise<any[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const rows: any[] = [];
  wb.worksheets[0].eachRow((row: any, i: number) => {
    if (i === 1) return;
    const v = row.values as any[];
    const dni = v[2]; const nombre = v[3];
    if (!dni && !nombre) return;
    rows.push({
      legajo: v[1],
      dni:     String(dni    || '').replace(/\D/g, ''),
      nombre:  String(nombre || '').trim(),
      novedad: String(v[5]   || '').trim(),
      desde:   parseDate(v[6]),
      hasta:   parseDate(v[7]),
    });
  });
  return rows;
}

async function parseSiap(fp: string): Promise<any[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fp);
  const rows: any[] = [];
  wb.worksheets[0].eachRow((row: any, i: number) => {
    if (i === 1) return;
    const v = row.values as any[];
    if (!v[5]) return;
    rows.push({
      apellido: String(v[2]  || '').trim(),
      nombre:   String(v[3]  || '').trim(),
      dni:      String(v[5]  || '').replace(/\D/g, ''),
      novedad:  String(v[12] || '').trim(),
      desde:    parseDate(v[13]),
      hasta:    parseDate(v[14]),
    });
  });
  return rows;
}

// Invierte el mapeo: los valores SIAP pasan a ser las claves, y las claves MIN los valores
function invertMapeo(mapeo: Record<string, string[]>): Record<string, string[]> {
  const inv: Record<string, string[]> = {};
  for (const [minNov, siapEquivs] of Object.entries(mapeo)) {
    for (const siapNov of siapEquivs) {
      if (!inv[siapNov]) inv[siapNov] = [];
      inv[siapNov].push(minNov);
    }
  }
  return inv;
}

function compareRows(
  ministerio: any[],
  siap: any[],
  mapeo: Record<string, string[]>,
  skipNovedades: string[],
): any[] {
  const siapByDni: Record<string, any[]> = {};
  for (const s of siap) {
    (siapByDni[s.dni] = siapByDni[s.dni] || []).push(s);
  }
  return ministerio.map(min => {
    const nov = min.novedad;
    if (skipNovedades.some(sk => nov.toUpperCase().includes(sk.toUpperCase()))) {
      return {
        dni: min.dni, nombre: min.nombre,
        novedad_ministerio: nov,
        fecha_desde_ministerio: dateToStr(min.desde),
        fecha_hasta_ministerio: dateToStr(min.hasta),
        novedad_siap: '—', fecha_desde_siap: '—', fecha_hasta_siap: '—',
        estado: 'OMITIDO',
      };
    }
    const equivs = mapeo[nov] || [];
    const match = (siapByDni[min.dni] || []).find((s: any) => {
      if (!equivs.some(eq => s.novedad.toUpperCase() === eq.toUpperCase())) return false;
      if (!min.desde || !min.hasta || !s.desde || !s.hasta) return true;
      return overlap(min.desde, min.hasta, s.desde, s.hasta);
    });
    return {
      dni: min.dni, nombre: min.nombre,
      novedad_ministerio: nov,
      fecha_desde_ministerio: dateToStr(min.desde),
      fecha_hasta_ministerio: dateToStr(min.hasta),
      novedad_siap:     match ? match.novedad        : (equivs.length === 0 ? '(sin mapeo)' : '—'),
      fecha_desde_siap: match ? dateToStr(match.desde) : '—',
      fecha_hasta_siap: match ? dateToStr(match.hasta) : '—',
      estado: match ? 'COINCIDENTE' : 'NO COINCIDENTE',
    };
  });
}

export function buildAsistenciaRouter() {
  const router = Router();

  router.get('/config', requirePermission('api:access'), (_req: Request, res: Response) => {
    const dir = (env as any).EXCEL_ASISTENCIA_DIR || '';
    res.json({ ok: true, data: { dir, exists: dir ? fs.existsSync(dir) : false, configured: !!dir } });
  });

  router.get('/archivos', requirePermission('api:access'), (_req: Request, res: Response) => {
    const dir = (env as any).EXCEL_ASISTENCIA_DIR || '';
    if (!dir) return res.status(400).json({ ok: false, error: 'EXCEL_ASISTENCIA_DIR no configurado en el .env' });
    if (!fs.existsSync(dir)) return res.status(404).json({ ok: false, error: `Directorio no existe: ${dir}`, dir });
    res.json({ ok: true, data: listExcelFiles(), dir });
  });

  router.get('/mapeo', requirePermission('api:access'), (_req: Request, res: Response) => {
    const mapeo = loadMapeo();
    const fp = getMappingFilePath();
    res.json({ ok: true, data: mapeo, fromDisk: fs.existsSync(fp), mappingFile: fp });
  });

  router.put('/mapeo', requirePermission('api:access'), (req: Request, res: Response) => {
    try {
      const mapeo = req.body;
      if (typeof mapeo !== 'object' || Array.isArray(mapeo)) {
        return res.status(400).json({ ok: false, error: 'Body debe ser objeto { novedad_min: [equiv_siap] }' });
      }
      saveMapeo(mapeo);
      res.json({ ok: true, message: 'Mapeo guardado', mappingFile: getMappingFilePath() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.delete('/mapeo', requirePermission('api:access'), (_req: Request, res: Response) => {
    try {
      const fp = getMappingFilePath();
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      res.json({ ok: true, message: 'Mapeo restaurado al default', data: DEFAULT_MAPEO });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post('/comparar', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      if (!ExcelJS) throw new Error('ExcelJS no disponible — instalar: npm i exceljs');
      const dir = (env as any).EXCEL_ASISTENCIA_DIR || '';
      if (!dir) return res.status(400).json({ ok: false, error: 'EXCEL_ASISTENCIA_DIR no configurado en .env' });
      if (!fs.existsSync(dir)) return res.status(404).json({ ok: false, error: `Directorio no existe: ${dir}` });

      const skip: string[] = (req.body?.skipNovedades || '')
        .split(',').map((s: string) => s.trim()).filter(Boolean);
      const direccion: string = req.body?.direccion || 'MIN_VS_SIAP';

      const files = listExcelFiles();
      const minF = req.body?.ministerioFile
        ? files.find(f => f.name === req.body.ministerioFile)
        : files.find(f => f.role === 'MINISTERIO');
      const siapF = req.body?.siapFile
        ? files.find(f => f.name === req.body.siapFile)
        : files.find(f => f.role === 'SIAP');

      if (!minF) return res.status(400).json({ ok: false, error: 'No se encontró archivo MINISTERIO. El nombre debe contener "ministerio".', archivos: files.map(f => f.name) });
      if (!siapF) return res.status(400).json({ ok: false, error: 'No se encontró archivo SIAP. El nombre debe contener "siap".', archivos: files.map(f => f.name) });

      const mapeo = loadMapeo();
      const [ministerio, siap] = await Promise.all([
        parseMinisterio(path.join(dir, minF.name)),
        parseSiap(path.join(dir, siapF.name)),
      ]);
      const results = direccion === 'SIAP_VS_MIN'
        ? compareRows(siap, ministerio, invertMapeo(mapeo), skip)
        : compareRows(ministerio, siap, mapeo, skip);

      return res.json({
        ok: true, data: results,
        meta: {
          total: results.length,
          coincidentes:    results.filter(r => r.estado === 'COINCIDENTE').length,
          noCoincidentes:  results.filter(r => r.estado === 'NO COINCIDENTE').length,
          omitidos:        results.filter(r => r.estado === 'OMITIDO').length,
          ministerioRows:  ministerio.length,
          siapRows:        siap.length,
          ministerioFile:  minF.name,
          siapFile:        siapF.name,
          direccion,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error al procesar' });
    }
  });

  return router;
}
