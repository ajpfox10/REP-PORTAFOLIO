import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { Sequelize, QueryTypes } from 'sequelize';
import { logger } from '../../../logging/logger';

const INTRANET_SCRIPT_FILES = [
  'cargar_vacaciones_intranet.py',
  'segunda_pasada_intranet.py',
  'descargar_historial_intranet.py',
  'cargar_ausentes_intranet.py',
  'cargar_francos_siape.py',
];

function hasIntranetScripts(dir: string): boolean {
  return INTRANET_SCRIPT_FILES.every(file => fs.existsSync(path.join(dir, file)));
}

function resolveScriptDir(): string {
  const configured = process.env.INTRANET_SCRIPT_DIR?.trim();
  const candidates = [
    configured,
    path.resolve(__dirname, '../../../../scripts'),
    path.resolve(process.cwd(), 'scripts'),
    path.resolve(process.cwd(), 'apipersonal', 'scripts'),
  ].filter(Boolean) as string[];
  const found = candidates.find(hasIntranetScripts);
  if (found) return found;
  return configured || path.resolve(__dirname, '../../../../scripts');
}

const SCRIPT_DIR = resolveScriptDir();
const SCRIPT_PATH           = path.join(SCRIPT_DIR, 'cargar_vacaciones_intranet.py');
const SCRIPT_SEGUNDA_PATH   = path.join(SCRIPT_DIR, 'segunda_pasada_intranet.py');
const SCRIPT_HISTORIAL_PATH = path.join(SCRIPT_DIR, 'descargar_historial_intranet.py');
const SCRIPT_AUSENTES_PATH  = path.join(SCRIPT_DIR, 'cargar_ausentes_intranet.py');
const SCRIPT_FRANCOS_SIAPE_PATH = path.join(SCRIPT_DIR, 'cargar_francos_siape.py');
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

function normalizarDependencia(raw: any): string {
  const dep = String(raw ?? 'HOSPITAL').toUpperCase().replace(/\s+/g, ' ').trim();
  if (dep === 'UPA4' || dep === 'UPA 4') return 'UPA 4';
  if (dep === 'UPA18' || dep === 'UPA 18') return 'UPA 18';
  return dep;
}

function ausentesLogPath(depKey: string): string {
  const sufijo = SUFIJOS_EXCEL[depKey] ?? '';
  return `D:\\G\\comparacion\\resultado_carga_ausentes${sufijo}.xlsx`;
}

function historialPaths(depKey: string) {
  const sufijo = SUFIJOS_EXCEL[depKey] ?? '';
  return {
    listado: path.join(HISTORIAL_DIR, `listado${sufijo}.xlsx`),
    salida:  path.join(HISTORIAL_DIR, `historial${sufijo}.xlsx`),
  };
}

function lanzarCMD(titulo: string, scriptPath: string, args: string[]) {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script intranet no encontrado: ${scriptPath}`);
  }
  const argStr = args.map(a => `"${a}"`).join(' ');
  const cmd = `start "${titulo}" cmd /k ${PYTHON} "${scriptPath}" ${argStr}`;
  exec(cmd, { shell: 'cmd.exe', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
}

// "07/08/2025" (Intranet) → "2025-08-07" | null
function parseFechaBaja(v: any): string | null {
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function leerHistorialExcel(salida: string) {
  const wb  = XLSX.readFile(salida);
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
  return raw.map((r: any) => ({
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
}

// Importa el Excel del scraper a la tabla historial_estructura (migración 036),
// reemplazando lo que hubiera para esa dependencia. Los DNI que no existen en
// personal (filas basura del bot: DNI 0, timeouts) se saltean y se cuentan.
async function importarHistorialEstructura(sequelize: Sequelize, depKey: string) {
  const { salida } = historialPaths(depKey);
  if (!fs.existsSync(salida)) throw new Error(`No existe el Excel del scraper: ${salida}`);

  const filas = leerHistorialExcel(salida);
  const dnisPersonal = new Set(
    (await sequelize.query<{ dni: number }>(
      'SELECT dni FROM personal WHERE deleted_at IS NULL',
      { type: QueryTypes.SELECT },
    )).map(r => Number(r.dni)),
  );

  const t = (v: any, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
  const registros: any[] = [];
  let sinFk = 0;
  for (const f of filas) {
    const dni = Number(String(f.dni).replace(/[^0-9]/g, ''));
    if (!dni || !dnisPersonal.has(dni)) { sinFk++; continue; }
    registros.push({
      dni,
      origen: t(f.origen, 10),
      legajo: t(f.legajo, 30),
      nombre: t(f.nombre, 150),
      apellido_nombre: t(f.apellido, 150),
      parte: t(f.parte, 150),
      plantel: t(f.plantel, 60),
      fecha_baja: parseFechaBaja(f.fecha_baja),
      cargo: t(f.cargo, 500),
      estado: t(f.estado, 10),
      detalle: t(f.detalle, 500),
      dependencia: depKey,
      archivo_origen: path.basename(salida),
    });
  }

  await sequelize.transaction(async (tx) => {
    await sequelize.query('DELETE FROM historial_estructura WHERE dependencia = :dep',
      { replacements: { dep: depKey }, transaction: tx });
    for (let i = 0; i < registros.length; i += 2000) {
      await sequelize.getQueryInterface().bulkInsert('historial_estructura', registros.slice(i, i + 2000), { transaction: tx });
    }
  });

  return { leidas: filas.length, importadas: registros.length, salteadasSinFk: sinFk, archivo: path.basename(salida) };
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
    if (!(depKey in SUFIJOS_EXCEL)) {
      res.status(400).json({ error: 'Elegí una dependencia (HOSPITAL / UPA 4 / UPA 18) en el filtro antes de exportar' }); return;
    }
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
      if (fs.existsSync(excelPath)) fs.unlinkSync(excelPath);
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

    // La clave NO va por línea de comandos (visible en el CMD): el script la lee
    // de INTRANET_PASS heredada del env del proceso.
    try {
      if (fs.existsSync(lPath)) fs.unlinkSync(lPath);
      lanzarCMD(`Carga ${depKey}`, SCRIPT_PATH, ['--excel', excelPath, '--dependencia', depKey, '--log', lPath]);
      res.json({ ok: true, msg: `Script iniciado para ${depKey}`, script: SCRIPT_PATH });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
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

    const depKey = normalizarDependencia(req.body?.dependencia);
    if (!(depKey in SUFIJOS_EXCEL)) {
      res.status(400).json({ error: 'Dependencia inválida: HOSPITAL / UPA 4 / UPA 18' }); return;
    }
    const sufijo = SUFIJOS_EXCEL[depKey] ?? '';
    const excelPath = path.join(excelDir, `segunda_pasada${sufijo}_temp.xlsx`);
    const lPath    = logPath(depKey);

    try {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(filas);
      XLSX.utils.book_append_sheet(wb, ws, 'Pasada');
      if (fs.existsSync(excelPath)) fs.unlinkSync(excelPath);
      XLSX.writeFile(wb, excelPath);
    } catch (e: any) {
      res.status(500).json({ error: e?.message }); return;
    }

    try {
      lanzarCMD(`Segunda Pasada ${depKey}`, SCRIPT_SEGUNDA_PATH,
        ['--excel', excelPath, '--dependencia', depKey, '--log', lPath]);
      res.json({ ok: true, msg: `Segunda pasada iniciada (${depKey}, ${filas.length} filas visibles)`, script: SCRIPT_SEGUNDA_PATH, excel: excelPath, log: lPath });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // GET /intranet/resultado-ausentes?dep=HOSPITAL|UPA+4|UPA+18
  router.get('/resultado-ausentes', async (req: Request, res: Response) => {
    const dep = String(req.query.dep ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dep.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    try {
      const { filas, existe } = leerLog(ausentesLogPath(depKey));
      res.json({ ok: true, filas, existe });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /intranet/cargar-francos-siape — abre SiAPe y carga reconocimientos pendientes como francos
  router.post('/cargar-francos-siape', (req: Request, res: Response) => {
    const user = process.env.SIAPE_USER?.trim();
    const pass = process.env.SIAPE_PASS?.trim();
    if (!user) { res.status(500).json({ error: 'SIAPE_USER no configurado' }); return; }
    if (!pass) { res.status(500).json({ error: 'SIAPE_PASS no configurado' }); return; }

    const args: string[] = [];
    const id = req.body?.id;
    const limit = req.body?.limit;
    if (id !== undefined && id !== null && String(id).trim()) args.push('--id', String(id));
    if (limit !== undefined && limit !== null && String(limit).trim()) args.push('--limit', String(limit));

    try {
      lanzarCMD('Carga Francos SiAPe', SCRIPT_FRANCOS_SIAPE_PATH, args);
      res.json({ ok: true, msg: 'Carga de francos en SiAPe iniciada', script: SCRIPT_FRANCOS_SIAPE_PATH });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /intranet/cargar-ausentes: lee directo D:\G\comparacion\SIAPE\SIAPE.xlsx y abre CMD visible
  router.post('/cargar-ausentes', (req: Request, res: Response) => {
    const pass = process.env.INTRANET_PASS;
    if (!pass) { res.status(500).json({ error: 'INTRANET_PASS no configurado' }); return; }

    const excelDir = process.env.LICENCIAS_PDF_DIR || 'D:\\G\\comparacion';
    const siapePath = path.join(excelDir, 'SIAPE', 'SIAPE.xlsx');
    if (!fs.existsSync(siapePath)) {
      res.status(400).json({ error: `No existe: ${siapePath}` }); return;
    }

    const dependencia = (req.body?.dependencia ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dependencia.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    if (!(depKey in SUFIJOS_EXCEL)) {
      res.status(400).json({ error: 'Dependencia inválida: HOSPITAL / UPA 4 / UPA 18' }); return;
    }

    const lPath = ausentesLogPath(depKey);
    const args = ['--siape', siapePath, '--dependencia', depKey, '--log', lPath];
    if (process.env.INTRANET_AUSENTE_LABEL) args.push('--label', process.env.INTRANET_AUSENTE_LABEL);

    try {
      if (fs.existsSync(lPath)) fs.unlinkSync(lPath);
      lanzarCMD(`Carga Ausentes ${depKey}`, SCRIPT_AUSENTES_PATH, args);
      res.json({ ok: true, msg: `Script de ausentes iniciado para ${depKey}`, script: SCRIPT_AUSENTES_PATH });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
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
                MAX(CASE WHEN a.estado_empleo = 'ACTIVO' THEN (
                  SELECT dep_serv.nombre
                  FROM agentes_servicios ags_dep
                  LEFT JOIN servicios s_dep ON s_dep.id = ags_dep.servicio_id AND s_dep.deleted_at IS NULL
                  LEFT JOIN reparticiones r_dep ON r_dep.id = s_dep.reparticion_id AND r_dep.deleted_at IS NULL
                  LEFT JOIN dependencias dep_serv ON dep_serv.id = r_dep.dependencia_id AND dep_serv.deleted_at IS NULL
                  WHERE ags_dep.dni = p.dni AND ags_dep.deleted_at IS NULL AND ags_dep.fecha_hasta IS NULL
                  ORDER BY ags_dep.fecha_desde DESC, ags_dep.id DESC LIMIT 1
                ) END) AS dep_nombre
           FROM personal p
           LEFT JOIN agentes a      ON a.dni = p.dni AND a.deleted_at IS NULL
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

      // La clave queda en INTRANET_PASS heredada por el proceso hijo; no se expone en el CMD.
      lanzarCMD(`Historial ${depKey}`, SCRIPT_HISTORIAL_PATH,
        ['--excel', listado, '--dependencia', depKey, '--out', salida]);

      const activos   = filas.filter(f => f.Origen === 'ACTIVO').length;
      const inactivos = filas.length - activos;
      res.json({ ok: true, msg: `Script iniciado para ${depKey} (${filas.length} DNIs: ${activos} activos, ${inactivos} inactivos)`, total: filas.length });
    } catch (e: any) {
      logger.error({ msg: '[intranet] historial-estructura generar error', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // GET /intranet/historial-estructura/resultado?dep=HOSPITAL|UPA+4|UPA+18
  // Lee de la tabla historial_estructura; si todavía no se importó nada para
  // esa dependencia, cae al Excel del scraper (comportamiento anterior).
  router.get('/historial-estructura/resultado', async (req: Request, res: Response) => {
    const dep    = String(req.query.dep ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dep.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    const { salida } = historialPaths(depKey);
    try {
      if (sequelize) {
        try {
          const rows = await sequelize.query<any>(`
            SELECT dni, nombre, origen, legajo, apellido_nombre, parte, plantel,
                   fecha_baja, cargo, estado, detalle
            FROM historial_estructura
            WHERE dependencia = :dep
            ORDER BY apellido_nombre, nombre, dni, id
          `, { replacements: { dep: depKey }, type: QueryTypes.SELECT });
          if (rows.length) {
            const filas = rows.map((r: any) => ({
              dni:        String(r.dni ?? ''),
              nombre:     String(r.nombre ?? ''),
              origen:     String(r.origen ?? ''),
              legajo:     String(r.legajo ?? ''),
              apellido:   String(r.apellido_nombre ?? ''),
              parte:      String(r.parte ?? ''),
              plantel:    String(r.plantel ?? ''),
              fecha_baja: r.fecha_baja ? String(r.fecha_baja).slice(0, 10).split('-').reverse().join('/') : '',
              cargo:      String(r.cargo ?? ''),
              estado:     String(r.estado ?? ''),
              detalle:    String(r.detalle ?? ''),
            }));
            res.json({ ok: true, filas, existe: true, fuente: 'db' });
            return;
          }
        } catch (dbErr: any) {
          logger.warn({ msg: '[intranet] historial_estructura DB falló, cayendo a Excel', err: dbErr?.message });
        }
      }

      if (!fs.existsSync(salida)) { res.json({ ok: true, filas: [], existe: false }); return; }
      const filas = leerHistorialExcel(salida);
      res.json({ ok: true, filas, existe: true, path: salida, fuente: 'excel' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /intranet/historial-estructura/importar — pasa el Excel del scraper a
  // la tabla historial_estructura (reemplaza lo anterior de esa dependencia)
  router.post('/historial-estructura/importar', async (req: Request, res: Response) => {
    if (!sequelize) { res.status(500).json({ error: 'DB no disponible' }); return; }
    const dependencia = (req.body?.dependencia ?? 'HOSPITAL').toUpperCase().trim();
    const depKey = dependencia.replace('UPA4', 'UPA 4').replace('UPA18', 'UPA 18');
    try {
      const r = await importarHistorialEstructura(sequelize, depKey);
      res.json({ ok: true, ...r, msg: `${depKey}: ${r.importadas} filas importadas de ${r.leidas} (${r.salteadasSinFk} salteadas sin FK)` });
    } catch (e: any) {
      logger.error({ msg: '[intranet] historial-estructura importar error', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}
