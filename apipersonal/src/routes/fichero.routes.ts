// src/routes/fichero.routes.ts
// Módulo Fichero — reemplazo completo del exe VB.NET
//
// IMPORTANTE — Fechas:
//   El reloj biométrico guarda checktime como DATETIME en hora local sin info de zona.
//   mysql2 por defecto convierte DATETIME a Date JS (UTC), lo que puede correr las horas.
//   Usamos dateStrings:true para recibir siempre el string crudo "YYYY-MM-DD HH:mm:ss"
//   y construir los Date LOCALES a mano, evitando desfases.
//
// RUTAS:
//   GET  /fichero/config            → config actual (sin contraseñas)
//   PUT  /fichero/config            → guarda config
//   POST /fichero/iniciar           → arranca timer periódico
//   POST /fichero/detener           → detiene timer
//   POST /fichero/forzar            → ciclo inmediato (usa rangos guardados en config si los hay)
//   POST /fichero/exportar          → genera y sube un archivo con rango explícito fecha/hora
//   GET  /fichero/estado            → estado + log
//   GET  /fichero/red               → ping 8.8.8.8
//   GET  /fichero/db-preview        → inspecciona la DB: tipo columna, min/max fecha, 10 muestras

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import mysql, { RowDataPacket } from 'mysql2/promise';
import SftpClient from 'ssh2-sftp-client';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { env } from '../config/env';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FicheroConfig {
  mysqlHost:        string;
  mysqlPort:        number;
  mysqlUser:        string;
  mysqlPass:        string;
  mysqlDb:          string;
  sftpHost:         string;
  sftpPort:         number;
  sftpUser:         string;
  sftpPass:         string;
  sftpDir:          string;
  sftpLocalAddr:    string;   // IP local desde donde sale la conexión SFTP (vacío = automático)
  outputDir:        string;
  prefijo:          string;
  sufijo:           string;
  limite:           number;
  intervaloMin:     number;
  // Modo continuo: el timer siempre filtra desde una fecha fija hasta ahora
  modoContinu:      boolean;
  fechaDesdeContinu: string | null;   // "YYYY-MM-DD"
  horaDesdeContinu:  string | null;   // "HH:mm"
}

interface RangoFechas {
  fechaDesde:  string | null;   // "YYYY-MM-DD"
  fechaHasta:  string | null;   // "YYYY-MM-DD"  (inclusive)
  horaDesde:   string | null;   // "HH:mm"
  horaHasta:   string | null;   // "HH:mm"
}

interface LogEntry {
  fechaCreacion:  string;
  nombreArchivo:  string;
  fechaSubida:    string;
  exitoso:        boolean;
  error:          string;
  // opcionales, sólo en exportaciones con rango
  rangoDesde?:    string;
  rangoHasta?:    string;
  registros?:     number;
}

interface EstadoFichero {
  corriendo:           boolean;
  redCaida:            boolean;
  total:               number;
  exitosos:            number;
  fallidos:            number;
  primerArchivo:       string | null;
  ultimoArchivo:       string | null;
  ultimaSubidaExitosa: string | null;
  entradas:            LogEntry[];
}

// ─── Rutas de archivos persistidos ────────────────────────────────────────────

function getConfigPath() { return path.resolve(process.cwd(), 'fichero_config.json'); }
function getLogPath()    { return path.resolve(process.cwd(), 'fichadas_log.txt'); }

// ─── Config ───────────────────────────────────────────────────────────────────

// Los defaults se toman del .env; la UI puede sobreescribirlos y se persisten en fichero_config.json
function buildDefaultConfig(): FicheroConfig {
  return {
    mysqlHost:    (env as any).FICHERO_MYSQL_HOST    || '127.0.0.1',
    mysqlPort:    (env as any).FICHERO_MYSQL_PORT    || 3306,
    mysqlUser:    (env as any).FICHERO_MYSQL_USER    || 'root',
    mysqlPass:    (env as any).FICHERO_MYSQL_PASS    || '',
    mysqlDb:      (env as any).FICHERO_MYSQL_DB      || 'adms_db',
    sftpHost:        (env as any).FICHERO_SFTP_HOST      || '',
    sftpPort:        (env as any).FICHERO_SFTP_PORT      || 22,
    sftpUser:        (env as any).FICHERO_SFTP_USER      || '',
    sftpPass:        (env as any).FICHERO_SFTP_PASS      || '',
    sftpDir:         (env as any).FICHERO_SFTP_DIR       || '/fichadas',
    sftpLocalAddr:     (env as any).FICHERO_SFTP_LOCAL_ADDR || '',
    outputDir:         (env as any).FICHERO_OUTPUT_DIR    || './fichadas',
    modoContinu:       false,
    fechaDesdeContinu: null,
    horaDesdeContinu:  null,
    prefijo:      (env as any).FICHERO_PREFIJO       || '026',
    sufijo:       (env as any).FICHERO_SUFIJO        || '048350',
    limite:       (env as any).FICHERO_LIMITE        || 50000,
    intervaloMin: (env as any).FICHERO_INTERVALO_MIN || 50,
  };
}

function cargarConfig(): FicheroConfig {
  // Prioridad: fichero_config.json (editado desde la UI) > variables de .env
  const defaults = buildDefaultConfig();
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) return { ...defaults, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
  } catch { /* usa defaults del env */ }
  return defaults;
}

function guardarConfig(cfg: FicheroConfig): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

// ─── Log ──────────────────────────────────────────────────────────────────────

function parsearLog(): LogEntry[] {
  const p = getLogPath();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('FechaCreacion'))
    .map(l => {
      const [fechaCreacion, nombreArchivo, fechaSubida, exitoso, rangoDesde, rangoHasta, registros, ...rest] = l.split('|');
      return {
        fechaCreacion:  fechaCreacion?.trim()  ?? '',
        nombreArchivo:  nombreArchivo?.trim()  ?? '',
        fechaSubida:    fechaSubida?.trim()    ?? '',
        exitoso:        exitoso?.trim().toUpperCase() === 'SI',
        rangoDesde:     rangoDesde?.trim()     || undefined,
        rangoHasta:     rangoHasta?.trim()     || undefined,
        registros:      registros ? Number(registros.trim()) : undefined,
        error:          rest.join('|').trim(),
      };
    })
    .filter(e => e.fechaCreacion !== '');
}

function escribirLog(entry: LogEntry): void {
  const p = getLogPath();
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p,
      'FechaCreacion|NombreArchivo|FechaSubida|Exitoso|RangoDesde|RangoHasta|Registros|Error\n',
      'utf-8');
  }
  const linea =
    `${entry.fechaCreacion}|${entry.nombreArchivo}|${entry.fechaSubida}|` +
    `${entry.exitoso ? 'SI' : 'NO'}|${entry.rangoDesde ?? ''}|${entry.rangoHasta ?? ''}|` +
    `${entry.registros ?? ''}|${(entry.error ?? '').replace(/\|/g, '-')}\n`;
  fs.appendFileSync(p, linea, 'utf-8');
}

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

// Crea conexión mysql2 con dateStrings:true para recibir "YYYY-MM-DD HH:mm:ss" sin conversión tz
async function conectarMySQL(cfg: FicheroConfig) {
  return mysql.createConnection({
    host:           cfg.mysqlHost,
    port:           cfg.mysqlPort,
    user:           cfg.mysqlUser,
    password:       cfg.mysqlPass,
    database:       cfg.mysqlDb,
    connectTimeout: 10_000,
    dateStrings:    true,   // ← crítico: recibimos string crudo, sin conversión de zona horaria
  });
}

// "YYYY-MM-DD HH:mm:ss" → Date local (sin conversión UTC)
function parsearDateLocal(s: string): Date {
  // new Date("YYYY-MM-DD HH:mm:ss") en algunos motores interpreta como UTC.
  // Parseamos manualmente para asegurar hora local.
  const [datePart, timePart] = s.split(' ');
  const [y, mo, d]  = datePart.split('-').map(Number);
  const [h, mi, se] = (timePart ?? '00:00:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, se);
}

// Date → "dd/MM/yyyy HH:mm:ss"
function fmtFichadaDDMMYYYY(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Date → "YYMMDD_HHmm"  (nombre de archivo)
function fmtNombreArchivo(d: Date): string {
  const p  = (n: number) => String(n).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${yy}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// Date → "YYYY-MM-DD HH:mm:ss"
function fmtIso(d: Date): string {
  const p  = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Construye el WHERE y parámetros para filtrar por rango fecha/hora
// checktime se compara como string "YYYY-MM-DD HH:mm:ss" gracias a dateStrings:true
function buildWhereRango(rango: RangoFechas): { where: string; params: (string | number)[] } {
  const conds: string[] = [];
  const params: (string | number)[] = [];

  if (rango.fechaDesde) {
    const horaD = rango.horaDesde ?? '00:00';
    conds.push('ci.checktime >= ?');
    params.push(`${rango.fechaDesde} ${horaD}:00`);
  }

  if (rango.fechaHasta) {
    // Incluimos el día completo hasta hasta las horaHasta (o fin del día)
    const horaH = rango.horaHasta ?? '23:59';
    conds.push('ci.checktime <= ?');
    params.push(`${rango.fechaHasta} ${horaH}:59`);
  }

  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  return { where, params };
}

// ─── Motor principal ──────────────────────────────────────────────────────────

let timer:      ReturnType<typeof setInterval> | null = null;
let corriendo   = false;
let redCaida    = false;
let enEjecucion = false;

async function verificarRed(): Promise<boolean> {
  // Verifica conectividad TCP al host SFTP directamente (más preciso que ping a 8.8.8.8)
  const cfg = cargarConfig();
  const host = cfg.sftpHost || '8.8.8.8';
  const port = cfg.sftpPort || 22;

  return new Promise((resolve) => {
    import('net').then(({ default: net }) => {
      const sock = new net.Socket();
      const timeout = 5000;
      sock.setTimeout(timeout);
      sock.connect(port, host, () => { sock.destroy(); resolve(true); });
      sock.on('error', () => { sock.destroy(); resolve(false); });
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
    }).catch(() => resolve(false));
  });
}

// rango = null → el ciclo automático del timer, sin filtro de fecha (trae los últimos N)
// rango con valores → exportación manual por rango
async function ejecutarCiclo(rango: RangoFechas | null = null): Promise<{
  ok: boolean; registros: number; archivo: string; error?: string;
}> {
  if (enEjecucion) return { ok: false, registros: 0, archivo: '', error: 'Ya hay un ciclo en ejecución' };
  enEjecucion = true;

  const cfg           = cargarConfig();
  const fechaCreacion = new Date();
  const nombreArchivo = `${cfg.prefijo}_Fichadas_${fmtNombreArchivo(fechaCreacion)}_${cfg.sufijo}`;
  let   exitoso       = false;
  let   errorMsg      = '';
  let   fechaSubida   = new Date();
  let   totalRegistros = 0;

  try {
    // 1. Verificar red
    const hayRed = await verificarRed();
    if (!hayRed) { redCaida = true; throw new Error('Red no disponible (sin conectividad)'); }
    redCaida = false;

    // 2. Conectar MySQL (dateStrings: true)
    const conn = await conectarMySQL(cfg);

    // 3. Armar query con o sin filtro de rango
    let query: string;
    let queryParams: (string | number)[];

    if (rango && (rango.fechaDesde || rango.fechaHasta)) {
      const { where, params } = buildWhereRango(rango);
      query = `SELECT ui.badgenumber, ci.checktime, ci.checktype, ui.name
                 FROM checkinout ci
                 INNER JOIN userinfo ui ON ci.userid = ui.userid
                 ${where}
                 ORDER BY ci.checktime DESC
                 LIMIT ?`;
      queryParams = [...params, cfg.limite];
    } else {
      query = `SELECT ui.badgenumber, ci.checktime, ci.checktype, ui.name
                 FROM checkinout ci
                 INNER JOIN userinfo ui ON ci.userid = ui.userid
                 ORDER BY ci.checktime DESC
                 LIMIT ?`;
      queryParams = [cfg.limite];
    }

    const [rows] = await conn.query<RowDataPacket[]>(query, queryParams);
    await conn.end();
    totalRegistros = rows.length;

    // 4. Generar archivo local
    const dir = path.isAbsolute(cfg.outputDir)
      ? cfg.outputDir
      : path.resolve(process.cwd(), cfg.outputDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${nombreArchivo}.txt`);
    const lines: string[] = [];

    for (const row of rows) {
      // checktime llega como string "YYYY-MM-DD HH:mm:ss" (dateStrings:true)
      const dt     = parsearDateLocal(String(row.checktime));
      const dni    = `DNI${row.badgenumber}`.padEnd(14);
      const fecha  = fmtFichadaDDMMYYYY(dt).padEnd(19);
      const estado = row.checktype === 0 || row.checktype === '0' ? 'E' : 'S';
      const nombre = String(row.name ?? '').padEnd(32);
      lines.push(`${dni},${fecha},${estado},1,${nombre},`);
    }

    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    logger.info({ msg: 'fichero: archivo generado', archivo: filePath, registros: rows.length });

    // 5. Subir por SFTP
    fechaSubida = new Date();
    const sftp  = new SftpClient();
    const sftpConnOpts: any = {
      host:              cfg.sftpHost,
      port:              cfg.sftpPort,
      username:          cfg.sftpUser,
      password:          cfg.sftpPass,
      readyTimeout:      20_000,
      retries:           1,
      retry_minTimeout:  3000,
      // Renci.SshNet (VB.NET) no verifica host key por defecto — replicamos ese comportamiento
      hostVerifier:      () => true,
      algorithms: {
        serverHostKey: ['ssh-rsa', 'rsa-sha2-512', 'rsa-sha2-256',
                        'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ssh-ed25519'],
        cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr',
                 'aes128-cbc', 'aes256-cbc', '3des-cbc',
                 'aes128-gcm', 'aes256-gcm'],
        hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1', 'hmac-md5'],
        kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
              'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1',
              'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group1-sha1'],
        compress: ['none', 'zlib@openssh.com', 'zlib'],
      },
    };
    // Si se configuró IP local de salida, forzarla (para máquinas con múltiples interfaces)
    if (cfg.sftpLocalAddr) sftpConnOpts.localAddress = cfg.sftpLocalAddr;

    await sftp.connect(sftpConnOpts);

    const remotePath = `${cfg.sftpDir}/${nombreArchivo}.txt`.replace(/\/\//g, '/');
    try { await sftp.mkdir(cfg.sftpDir, true); } catch { /* ya existe */ }
    await sftp.put(filePath, remotePath);
    const existe = await sftp.exists(remotePath);
    await sftp.end();

    if (existe) {
      exitoso = true;
      logger.info({ msg: 'fichero: subido OK', remotePath, registros: totalRegistros });
    } else {
      errorMsg = 'Archivo no encontrado en el servidor tras la subida';
    }

  } catch (err: any) {
    errorMsg = err?.message ?? String(err);
    // redCaida solo si es problema de conectividad (timeout, ECONNREFUSED, ENETUNREACH)
    // NO si son credenciales incorrectas (AuthenticationFailed, etc.)
    if (/timeout|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|handshake/i.test(errorMsg)) redCaida = true;
    logger.warn({ msg: 'fichero: error en ciclo', error: errorMsg });
  } finally {
    enEjecucion = false;
    escribirLog({
      fechaCreacion:  fmtIso(fechaCreacion),
      nombreArchivo,
      fechaSubida:    fmtIso(fechaSubida),
      exitoso,
      registros:      totalRegistros,
      rangoDesde:     rango?.fechaDesde && rango?.horaDesde
                        ? `${rango.fechaDesde} ${rango.horaDesde}`
                        : (rango?.fechaDesde ?? undefined),
      rangoHasta:     rango?.fechaHasta && rango?.horaHasta
                        ? `${rango.fechaHasta} ${rango.horaHasta}`
                        : (rango?.fechaHasta ?? undefined),
      error: errorMsg,
    });
  }

  return { ok: exitoso, registros: totalRegistros, archivo: nombreArchivo, error: errorMsg || undefined };
}

function iniciarTimer(): void {
  if (timer) clearInterval(timer);
  const cfg = cargarConfig();
  corriendo = true;
  redCaida  = false;
  timer = setInterval(() => {
    // Relee config en cada tick para respetar cambios de modo sin reiniciar el timer
    const c = cargarConfig();
    let rango: RangoFechas | null = null;
    if (c.modoContinu && c.fechaDesdeContinu) {
      rango = {
        fechaDesde: c.fechaDesdeContinu,
        horaDesde:  c.horaDesdeContinu ?? null,
        fechaHasta: null,   // hasta ahora (sin límite de fecha)
        horaHasta:  null,
      };
    }
    ejecutarCiclo(rango);
  }, cfg.intervaloMin * 60 * 1000);
  logger.info({ msg: 'fichero: timer iniciado', intervaloMin: cfg.intervaloMin, modoContinu: cfg.modoContinu });
}

function detenerTimer(): void {
  if (timer) { clearInterval(timer); timer = null; }
  corriendo = false;
  logger.info({ msg: 'fichero: timer detenido' });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function buildFicheroRouter(): Router {
  const router = Router();
  const admin  = requirePermission('crud:*:*');

  // GET /fichero/config
  router.get('/config', admin, (_req: Request, res: Response) => {
    const cfg = cargarConfig();
    res.json({
      ok: true,
      data: { ...cfg, mysqlPass: cfg.mysqlPass ? '••••••' : '', sftpPass: cfg.sftpPass ? '••••••' : '' },
    });
  });

  // PUT /fichero/config
  router.put('/config', admin, (req: Request, res: Response) => {
    const actual = cargarConfig();
    const body   = req.body as Partial<FicheroConfig>;
    const nueva: FicheroConfig = {
      ...actual, ...body,
      mysqlPass: body.mysqlPass && body.mysqlPass !== '••••••' ? body.mysqlPass : actual.mysqlPass,
      sftpPass:  body.sftpPass  && body.sftpPass  !== '••••••' ? body.sftpPass  : actual.sftpPass,
    };
    guardarConfig(nueva);
    if (corriendo) iniciarTimer();
    res.json({ ok: true });
  });

  // POST /fichero/iniciar
  router.post('/iniciar', admin, (_req: Request, res: Response) => {
    iniciarTimer();
    res.json({ ok: true, msg: `Timer iniciado (cada ${cargarConfig().intervaloMin} min)` });
  });

  // POST /fichero/detener
  router.post('/detener', admin, (_req: Request, res: Response) => {
    detenerTimer();
    res.json({ ok: true, msg: 'Timer detenido' });
  });

  // POST /fichero/forzar — ciclo inmediato sin filtro de fecha
  router.post('/forzar', admin, (_req: Request, res: Response) => {
    ejecutarCiclo(null);
    res.json({ ok: true, msg: 'Ciclo iniciado en segundo plano' });
  });

  // POST /fichero/exportar — exportar rango explícito de fecha/hora
  // Body: { fechaDesde, fechaHasta, horaDesde, horaHasta }
  router.post('/exportar', admin, async (req: Request, res: Response) => {
    const { fechaDesde, fechaHasta, horaDesde, horaHasta } = req.body as RangoFechas;

    if (!fechaDesde && !fechaHasta) {
      return res.status(400).json({ ok: false, error: 'Indicar al menos fechaDesde o fechaHasta' });
    }

    // Validar formatos básicos
    const reFecha = /^\d{4}-\d{2}-\d{2}$/;
    const reHora  = /^\d{2}:\d{2}$/;
    if (fechaDesde && !reFecha.test(fechaDesde)) return res.status(400).json({ ok: false, error: 'fechaDesde debe ser YYYY-MM-DD' });
    if (fechaHasta && !reFecha.test(fechaHasta)) return res.status(400).json({ ok: false, error: 'fechaHasta debe ser YYYY-MM-DD' });
    if (horaDesde  && !reHora.test(horaDesde))   return res.status(400).json({ ok: false, error: 'horaDesde debe ser HH:mm' });
    if (horaHasta  && !reHora.test(horaHasta))   return res.status(400).json({ ok: false, error: 'horaHasta debe ser HH:mm' });

    const result = await ejecutarCiclo({ fechaDesde: fechaDesde ?? null, fechaHasta: fechaHasta ?? null, horaDesde: horaDesde ?? null, horaHasta: horaHasta ?? null });
    return res.json({ ok: result.ok, registros: result.registros, archivo: result.archivo, error: result.error });
  });

  // GET /fichero/estado
  router.get('/estado', admin, (_req: Request, res: Response) => {
    const entradas   = parsearLog();
    const exitosos   = entradas.filter(e => e.exitoso).length;
    const fallidos   = entradas.length - exitosos;
    const ultimas3   = entradas.slice(-3);
    const redCaidaLog = ultimas3.length > 0 && ultimas3.every(e => !e.exitoso && /red|sftp|network|connect/i.test(e.error));
    const ultimaExitosa = [...entradas].reverse().find(e => e.exitoso) ?? null;

    res.json({
      ok: true,
      data: {
        corriendo,
        redCaida: redCaida || redCaidaLog,
        total:    entradas.length,
        exitosos,
        fallidos,
        primerArchivo:       entradas.length > 0 ? entradas[0].fechaCreacion : null,
        ultimoArchivo:       entradas.length > 0 ? entradas[entradas.length - 1].fechaCreacion : null,
        ultimaSubidaExitosa: ultimaExitosa?.fechaSubida ?? null,
        entradas:            [...entradas].reverse(),
      } as EstadoFichero,
    });
  });

  // GET /fichero/red
  router.get('/red', admin, async (_req: Request, res: Response) => {
    const hayRed = await verificarRed();
    res.json({ ok: true, red: hayRed ? 'activa' : 'caida' });
  });

  // GET /fichero/db-preview
  // Conecta a la DB del reloj y devuelve: tipo columna, min/max fecha, 10 registros de muestra.
  // Permite al usuario confirmar el formato real de las fechas antes de filtrar.
  router.get('/db-preview', admin, async (_req: Request, res: Response) => {
    const cfg = cargarConfig();
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);

      // Tipo de columna checktime
      const [cols] = await conn.query<RowDataPacket[]>(
        `SELECT COLUMN_TYPE, COLUMN_NAME, EXTRA
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'checkinout' AND COLUMN_NAME = 'checktime'`,
        [cfg.mysqlDb]
      );

      // Min / Max fecha
      const [minmax] = await conn.query<RowDataPacket[]>(
        `SELECT MIN(checktime) AS minFecha, MAX(checktime) AS maxFecha FROM checkinout`
      );

      // 10 registros más recientes (string crudo)
      const [muestras] = await conn.query<RowDataPacket[]>(
        `SELECT ui.badgenumber, ci.checktime, ci.checktype, ui.name
           FROM checkinout ci
           INNER JOIN userinfo ui ON ci.userid = ui.userid
           ORDER BY ci.checktime DESC
           LIMIT 10`
      );

      await conn.end();

      return res.json({
        ok: true,
        columna:   cols[0] ?? null,
        minFecha:  minmax[0]?.minFecha ?? null,
        maxFecha:  minmax[0]?.maxFecha ?? null,
        muestras:  muestras.map(r => ({
          badgenumber: r.badgenumber,
          checktime:   r.checktime,   // string crudo "YYYY-MM-DD HH:mm:ss"
          checktype:   r.checktype,
          name:        r.name,
        })),
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  return router;
}
