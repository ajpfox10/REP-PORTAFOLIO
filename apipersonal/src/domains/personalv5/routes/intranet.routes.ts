import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../../../logging/logger';

const SCRIPT_PATH           = 'C:\\apps\\personaldev\\apipersonal\\scripts\\cargar_vacaciones_intranet.py';
const SCRIPT_SEGUNDA_PATH   = 'C:\\apps\\personaldev\\apipersonal\\scripts\\segunda_pasada_intranet.py';
const SCRIPT_HISTORIAL_PATH = 'C:\\apps\\personaldev\\apipersonal\\scripts\\descargar_historial_intranet.py';
const PYTHON              = 'python';

const HISTORIAL_DIR = 'D:\\G\\HISTORIAL ESTRUCTURA';

const SUFIJOS_EXCEL: Record<string, string> = {
  'HOSPITAL': '',
  'UPA 4':    '_upa4',
  'UPA 18':   '_upa18',
};

function logPath(depKey: string): string {
  const sufijo = SUFIJOS_EXCEL[depKey] ?? '';
  return `D:\\G\\comparacion\\resultado_carga${sufijo}.xlsx`;
}

function historialPaths(depKey: string) {
  const sufijo = SUFIJOS_EXCEL[depKey] ?? '';
  return {
    listado: path.join(HISTORIAL_DIR, `listado${sufijo}.xlsx`),
    salida:  path.join(HISTORIAL_DIR, `historial${sufijo}.xlsx`),
  };
}

function lanzarCMD(titulo: string, scriptPath: string, args: string[]) {
  const argStr = args.map(a => `"${a}"`).join(' ');
  const cmd = `start "${titulo}" cmd /k ${PYTHON} "${scriptPath}" ${argStr}`;
  exec(cmd, { shell: 'cmd.exe', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
}

function leerLog(xlsxPath: string) {
  if (!fs.existsSync(xlsxPath)) return { filas: [], existe: false };
  const wb  = XLSX.readFile(xlsxPath);
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
  const filas = raw.map((r: any) => ({
    nombre:  String(r['Nombre']  ?? ''),
    dni:     String(r['DNI']     ?? ''),
    novedad: String(r['Novedad'] ?? ''),
    desde:   String(r['Desde']   ?? ''),
    hasta:   String(r['Hasta']   ?? ''),
    estado:  String(r['Estado']  ?? ''),
    detalle: String(r['Detalle'] ?? ''),
    ley:     '',
  }));
  return { filas, existe: true };
}

export function buildIntranetRouter(sequelize?: Sequelize): Router {
  const router = Router();

  // GET /intranet/resultado?dep=HOSPITAL|UPA+4|UPA+18
  router.get('/resultado', async (req: Request, res: Response) => {
    const dep    = String(req.query.dep ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dep.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    try {
      const { filas, existe } = leerLog(logPath(depKey));

      // Enriquecer con ley desde DB — best-effort, NUNCA bloquea la respuesta
      if (sequelize && filas.length) {
        try {
          const dnis = [...new Set(filas.map(f => f.dni).filter(Boolean))];
          if (dnis.length) {
            const rows = await sequelize.query<{ dni: string; ley: any }>(
              `SELECT a.dni, l.nombre AS ley
                 FROM agentes a
                 LEFT JOIN ley l ON a.ley_id = l.id
                WHERE a.dni IN (:dnis) AND a.deleted_at IS NULL
                ORDER BY a.id DESC`,
              { replacements: { dnis }, type: QueryTypes.SELECT }
            );
            const leyMap: Record<string, string> = {};
            for (const r of rows) {
              const k = String(r.dni);
              if (!(k in leyMap)) leyMap[k] = String(r.ley ?? '');  // primera = más reciente
            }
            for (const f of filas) f.ley = leyMap[f.dni] ?? '';
          }
        } catch (dbErr: any) {
          logger.warn({ msg: 'No se pudo enriquecer ley desde DB', err: dbErr?.message });
        }
      }

      res.json({ ok: true, filas, existe });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /intranet/exportar-pendientes
  router.post('/exportar-pendientes', (req: Request, res: Response) => {
    const excelDir = process.env.LICENCIAS_PDF_DIR;
    if (!excelDir) { res.status(500).json({ error: 'LICENCIAS_PDF_DIR no configurado' }); return; }

    const dependencia = (req.body?.dependencia ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dependencia.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    const sufijo = SUFIJOS_EXCEL[depKey] ?? '';
    const excelPath = path.join(excelDir, `errores_siape${sufijo}.xlsx`);

    const filas: any[] = req.body?.filas ?? [];
    if (!Array.isArray(filas) || filas.length === 0) {
      res.status(400).json({ error: 'No hay filas para exportar' }); return;
    }
    try {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(filas);
      XLSX.utils.book_append_sheet(wb, ws, 'Pendientes');
      XLSX.writeFile(wb, excelPath);
      res.json({ ok: true, path: excelPath, filas: filas.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /intranet/cargar-novedades — abre CMD visible
  router.post('/cargar-novedades', (req: Request, res: Response) => {
    const pass = process.env.INTRANET_PASS;
    if (!pass) { res.status(500).json({ error: 'INTRANET_PASS no configurado' }); return; }

    const excelDir = process.env.LICENCIAS_PDF_DIR;
    if (!excelDir) { res.status(500).json({ error: 'LICENCIAS_PDF_DIR no configurado' }); return; }

    const dependencia = (req.body?.dependencia ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dependencia.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    const sufijo = SUFIJOS_EXCEL[depKey] ?? '';
    const excelPath = path.join(excelDir, `errores_siape${sufijo}.xlsx`);
    const lPath    = logPath(depKey);

    if (!fs.existsSync(excelPath)) {
      res.status(400).json({ error: `No existe: ${excelPath}` }); return;
    }

    lanzarCMD(`Carga ${depKey}`, SCRIPT_PATH, ['--pass', pass, '--excel', excelPath, '--log', lPath]);
    res.json({ ok: true, msg: `Script iniciado para ${depKey}` });
  });

  // POST /intranet/segunda-pasada — guarda Excel temporal y abre CMD
  router.post('/segunda-pasada', (req: Request, res: Response) => {
    const pass = process.env.INTRANET_PASS;
    if (!pass) { res.status(500).json({ error: 'INTRANET_PASS no configurado' }); return; }

    const excelDir = process.env.LICENCIAS_PDF_DIR;
    if (!excelDir) { res.status(500).json({ error: 'LICENCIAS_PDF_DIR no configurado' }); return; }

    const filas: any[] = req.body?.filas ?? [];
    if (!Array.isArray(filas) || filas.length === 0) {
      res.status(400).json({ error: 'No hay filas' }); return;
    }

    const dependencia = (req.body?.dependencia ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dependencia.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    const sufijo = SUFIJOS_EXCEL[depKey] ?? '';
    const excelPath = path.join(excelDir, `segunda_pasada${sufijo}_temp.xlsx`);
    const lPath    = logPath(depKey);

    try {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(filas);
      XLSX.utils.book_append_sheet(wb, ws, 'Pasada');
      XLSX.writeFile(wb, excelPath);
    } catch (e: any) {
      res.status(500).json({ error: e?.message }); return;
    }

    lanzarCMD(`Segunda Pasada ${depKey}`, SCRIPT_SEGUNDA_PATH,
      ['--pass', pass, '--excel', excelPath, '--dependencia', dependencia, '--log', lPath]);
    res.json({ ok: true, msg: `Segunda pasada iniciada (${depKey}, ${filas.length} filas)` });
  });

  // POST /intranet/historial-estructura/generar — arma el listado desde la DB y lanza el scraper
  router.post('/historial-estructura/generar', async (req: Request, res: Response) => {
    const pass = process.env.INTRANET_PASS;
    if (!pass) { res.status(500).json({ error: 'INTRANET_PASS no configurado' }); return; }
    if (!sequelize) { res.status(500).json({ error: 'DB no disponible' }); return; }

    const dependencia = (req.body?.dependencia ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dependencia.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    const { listado, salida } = historialPaths(depKey);

    try {
      // Una fila por persona: activo si tiene al menos una fila ACTIVO en agentes,
      // con la dependencia de esa fila activa (UPA 4 / UPA 18 / resto = hospital)
      const rows = await sequelize.query<{ dni: number; nombre: string; activo: number; dep_nombre: string | null }>(
        `SELECT p.dni,
                CONCAT(p.apellido, ', ', p.nombre) AS nombre,
                MAX(CASE WHEN a.estado_empleo = 'ACTIVO' THEN 1 ELSE 0 END) AS activo,
                MAX(CASE WHEN a.estado_empleo = 'ACTIVO' THEN d.nombre END) AS dep_nombre
           FROM personal p
           LEFT JOIN agentes a      ON a.dni = p.dni AND a.deleted_at IS NULL
           LEFT JOIN dependencias d ON d.id = a.dependencia_id
          WHERE p.deleted_at IS NULL
          GROUP BY p.dni, p.apellido, p.nombre
          ORDER BY p.apellido, p.nombre`,
        { type: QueryTypes.SELECT }
      );

      // HOSPITAL = activos no-UPA (incluye dependencia NULL) + inactivos; UPA = solo sus activos
      const esUpa = (n: string | null) => (n ?? '').toUpperCase().startsWith('UPA');
      let filas: { DNI: number; Nombre: string; Origen: string }[];
      if (depKey === 'UPA 4' || depKey === 'UPA 18') {
        filas = rows
          .filter(r => Number(r.activo) === 1 && (r.dep_nombre ?? '').toUpperCase() === depKey)
          .map(r => ({ DNI: r.dni, Nombre: r.nombre, Origen: 'ACTIVO' }));
      } else {
        filas = rows
          .filter(r => Number(r.activo) === 0 || !esUpa(r.dep_nombre))
          .map(r => ({
            DNI: r.dni, Nombre: r.nombre,
            Origen: Number(r.activo) === 1 ? 'ACTIVO' : 'INACTIVO',
          }));
      }

      if (!filas.length) { res.status(400).json({ error: `Sin agentes para ${depKey}` }); return; }

      fs.mkdirSync(HISTORIAL_DIR, { recursive: true });
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(filas);
      XLSX.utils.book_append_sheet(wb, ws, 'Listado');
      XLSX.writeFile(wb, listado);

      lanzarCMD(`Historial ${depKey}`, SCRIPT_HISTORIAL_PATH,
        ['--pass', pass, '--excel', listado, '--dependencia', depKey, '--out', salida]);

      const activos   = filas.filter(f => f.Origen === 'ACTIVO').length;
      const inactivos = filas.length - activos;
      res.json({ ok: true, msg: `Script iniciado para ${depKey} (${filas.length} DNIs: ${activos} activos, ${inactivos} inactivos)`, total: filas.length });
    } catch (e: any) {
      logger.error({ msg: '[intranet] historial-estructura generar error', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // GET /intranet/historial-estructura/resultado?dep=HOSPITAL|UPA+4|UPA+18
  router.get('/historial-estructura/resultado', (req: Request, res: Response) => {
    const dep    = String(req.query.dep ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dep.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    const { salida } = historialPaths(depKey);
    try {
      if (!fs.existsSync(salida)) { res.json({ ok: true, filas: [], existe: false }); return; }
      const wb  = XLSX.readFile(salida);
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
      const filas = raw.map((r: any) => ({
        dni:        String(r['DNI'] ?? ''),
        nombre:     String(r['Nombre'] ?? ''),
        origen:     String(r['Origen'] ?? ''),
        legajo:     String(r['Legajo'] ?? ''),
        apellido:   String(r['Apellido y Nombre'] ?? ''),
        parte:      String(r['Parte'] ?? ''),
        plantel:    String(r['Plantel -> Serv.'] ?? ''),
        fecha_baja: String(r['Fecha baja'] ?? ''),
        cargo:      String(r['Cargo'] ?? ''),
        estado:     String(r['Estado'] ?? ''),
        detalle:    String(r['Detalle'] ?? ''),
      }));
      res.json({ ok: true, filas, existe: true, path: salida });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}
