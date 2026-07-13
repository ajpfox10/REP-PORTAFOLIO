import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';

const SCRIPT_PATH         = 'C:\\apps\\personaldev\\apipersonal\\scripts\\cargar_vacaciones_intranet.py';
const SCRIPT_SEGUNDA_PATH = 'C:\\apps\\personaldev\\apipersonal\\scripts\\segunda_pasada_intranet.py';
const PYTHON              = 'python';

const SUFIJOS_EXCEL: Record<string, string> = {
  'HOSPITAL': '',
  'UPA 4':    '_upa4',
  'UPA 18':   '_upa18',
};

function logPath(depKey: string): string {
  const sufijo = SUFIJOS_EXCEL[depKey] ?? '';
  return `D:\\G\\comparacion\\resultado_carga${sufijo}.xlsx`;
}

function lanzarCMD(titulo: string, scriptPath: string, args: string[]) {
  const argStr = args.map(a => `"${a}"`).join(' ');
  const cmd = `start "${titulo}" cmd /k chcp 65001 & ${PYTHON} "${scriptPath}" ${argStr}`;
  exec(cmd, { shell: 'cmd.exe' });
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
  }));
  return { filas, existe: true };
}

export function buildIntranetRouter(): Router {
  const router = Router();

  // GET /intranet/resultado?dep=HOSPITAL|UPA+4|UPA+18
  router.get('/resultado', (req: Request, res: Response) => {
    const dep    = String(req.query.dep ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dep.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    try {
      const { filas, existe } = leerLog(logPath(depKey));
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

  return router;
}
