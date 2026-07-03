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
import net from 'net';
import mysql, { RowDataPacket } from 'mysql2/promise';
import SftpClient from 'ssh2-sftp-client';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { env } from '../config/env';
import { registerFicheroAdmsRoutes } from './ficheroAdms.routes';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface FicheroConfig {
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
  continuoModo:     'todos' | 'uno' | 'grupo';
  continuoSn:       string | null;
  continuoSns:      string[];
}

interface RangoFechas {
  fechaDesde:  string | null;   // "YYYY-MM-DD"
  fechaHasta:  string | null;   // "YYYY-MM-DD"  (inclusive)
  horaDesde:   string | null;   // "HH:mm"
  horaHasta:   string | null;   // "HH:mm"
  sn?:          string | null;   // reloj/fichero especifico; null = todos
  sns?:         string[] | null; // grupo manual de relojes/ficheros
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
  pendienteSubida?:    FicheroPendienteSubida | null;
  entradas:            LogEntry[];
}

interface FicheroPendienteSubida {
  archivo:       string;
  path:          string;
  registros:     number;
  creadoEn:      string;
  rangoDesde?:   string | null;
  rangoHasta?:   string | null;
  error?:        string | null;
}

interface FicheroEstadoPersistido {
  autoStart?: boolean;
  ultimoChecktimeSubido?: string | null;
  ultimoArchivoExitoso?: string | null;
  ultimaSubidaExitosa?: string | null;
  ultimoIntentoEn?: string | null;
  ultimoError?: string | null;
  pendienteSubida?: FicheroPendienteSubida | null;
  actualizadoEn?: string | null;
}

async function checkZkProtocol(host: string, timeoutMs = 3000): Promise<{
  online: boolean;
  latencyMs: number | null;
  error?: string | null;
}> {
  const start = Date.now();
  let device: any = null;
  try {
    const mod: any = await import('zkteco-js' as any);
    const ZKTeco = mod.default ?? mod;
    device = new ZKTeco(host, 4370, timeoutMs, timeoutMs);
    await device.createSocket();
    try {
      if (typeof device.getInfo === 'function') await device.getInfo();
    } catch {
      // La conexion por protocolo alcanza para estado; algunos firmware fallan getInfo.
    }
    return { online: true, latencyMs: Date.now() - start, error: null };
  } catch (err: any) {
    return { online: false, latencyMs: null, error: err?.message ?? String(err) };
  } finally {
    if (device && typeof device.disconnect === 'function') {
      try { await device.disconnect(); } catch { /* noop */ }
    }
  }
}

async function tcpPortOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(port, host);
  });
}

interface FicheroTxtRow {
  linea: number;
  dni: string;
  checktime: string;
  tipo: 'E' | 'S';
  nombre: string;
  raw: string;
  error?: string;
}

// ─── Rutas de archivos persistidos ────────────────────────────────────────────

function getConfigPath() { return path.resolve(process.cwd(), 'fichero_config.json'); }
function getLogPath()    { return path.resolve(process.cwd(), 'fichadas_log.txt'); }
function getStatePath()  { return path.resolve(process.cwd(), 'fichero_estado.json'); }

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
    continuoModo:      'todos',
    continuoSn:        null,
    continuoSns:       [],
    prefijo:      (env as any).FICHERO_PREFIJO       || '026',
    sufijo:       (env as any).FICHERO_SUFIJO        || '048350',
    limite:       (env as any).FICHERO_LIMITE        || 50000,
    intervaloMin: (env as any).FICHERO_INTERVALO_MIN || 50,
  };
}

export function cargarConfig(): FicheroConfig {
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

function cargarEstadoPersistido(): FicheroEstadoPersistido {
  const p = getStatePath();
  try {
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e: any) {
    logger.warn({ msg: 'fichero: no se pudo leer estado persistido', error: e?.message ?? String(e) });
    return {};
  }
}

function guardarEstadoPersistido(patch: FicheroEstadoPersistido): void {
  const actual = cargarEstadoPersistido();
  const nuevo: FicheroEstadoPersistido = {
    ...actual,
    ...patch,
    actualizadoEn: patch.actualizadoEn ?? fmtIso(new Date()),
  };
  const p = getStatePath();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(nuevo, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

async function subirArchivoSftp(cfg: FicheroConfig, filePath: string, nombreArchivo: string): Promise<string> {
  const sftp  = new SftpClient();
  const sftpConnOpts: any = {
    host:              cfg.sftpHost,
    port:              cfg.sftpPort,
    username:          cfg.sftpUser,
    password:          cfg.sftpPass,
    readyTimeout:      20_000,
    retries:           1,
    retry_minTimeout:  3000,
    // Renci.SshNet (VB.NET) no verifica host key por defecto, replicamos ese comportamiento.
    hostVerifier:      () => true,
    algorithms: {
      serverHostKey: ['ssh-rsa', 'ssh-dss', 'rsa-sha2-512', 'rsa-sha2-256',
                      'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ssh-ed25519'],
      cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr',
               'aes128-cbc', 'aes256-cbc', '3des-cbc',
               'aes128-gcm', 'aes256-gcm'],
      hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1', 'hmac-md5'],
      kex: ['diffie-hellman-group14-sha1',
            'diffie-hellman-group-exchange-sha1',
            'diffie-hellman-group-exchange-sha256',
            'diffie-hellman-group1-sha1',
            'diffie-hellman-group14-sha256',
            'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521'],
      compress: ['none', 'zlib@openssh.com', 'zlib'],
    },
  };
  if (cfg.sftpLocalAddr) sftpConnOpts.localAddress = cfg.sftpLocalAddr;

  const remotePath = `${cfg.sftpDir}/${nombreArchivo}.txt`.replace(/\/\//g, '/');
  try {
    await sftp.connect(sftpConnOpts);
    try { await sftp.mkdir(cfg.sftpDir, true); } catch { /* ya existe */ }
    await sftp.put(filePath, remotePath);
    const existe = await sftp.exists(remotePath);
    if (!existe) throw new Error('Archivo no encontrado en el servidor tras la subida');
    return remotePath;
  } finally {
    try { await sftp.end(); } catch { /* conexion ya cerrada */ }
  }
}

function normalizarChecktime(value: unknown): string | null {
  const s = String(value ?? '').trim().slice(0, 19);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s : null;
}

function inicioContinuoCfg(cfg: FicheroConfig): string | null {
  if (!cfg.modoContinu || !cfg.fechaDesdeContinu) return null;
  const hora = cfg.horaDesdeContinu || '00:00';
  return `${cfg.fechaDesdeContinu} ${hora}:00`;
}

function restarMinutosChecktime(checktime: string, minutos: number): string {
  const d = parsearDateLocal(checktime);
  d.setMinutes(d.getMinutes() - minutos);
  return fmtIso(d);
}

function rangoDesdeChecktime(
  checktime: string,
  cfg: FicheroConfig,
): Pick<RangoFechas, 'fechaDesde' | 'horaDesde' | 'fechaHasta' | 'horaHasta' | 'sn' | 'sns'> {
  return {
    fechaDesde: checktime.slice(0, 10),
    horaDesde: checktime.slice(11, 16),
    fechaHasta: null,
    horaHasta: null,
    sn: cfg.continuoModo === 'uno' ? cfg.continuoSn : null,
    sns: cfg.continuoModo === 'grupo' ? cfg.continuoSns : null,
  };
}

function detectarCursorDesdeUltimoArchivoExitoso(cfg: FicheroConfig): { checktime: string; archivo: string } | null {
  const entradas = parsearLog();
  const dir = outputDirAbs(cfg);

  for (let i = entradas.length - 1; i >= 0; i--) {
    const e = entradas[i];
    if (!e.exitoso || !e.nombreArchivo) continue;
    const fileName = safeFicheroName(e.nombreArchivo.endsWith('.txt') ? e.nombreArchivo : `${e.nombreArchivo}.txt`);
    if (!fileName) continue;
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) continue;

    try {
      const rows = parseFicheroTxt(fs.readFileSync(filePath, 'utf-8'));
      const max = rows
        .map(row => normalizarChecktime(row.checktime))
        .filter((v): v is string => !!v)
        .sort()
        .pop();
      if (max) return { checktime: max, archivo: e.nombreArchivo };
    } catch (err: any) {
      logger.warn({ msg: 'fichero: no se pudo reconstruir cursor desde archivo', archivo: filePath, error: err?.message ?? String(err) });
    }
  }

  return null;
}

function crearRangoAutomatico(cfg: FicheroConfig): RangoFechas | null {
  const estado = cargarEstadoPersistido();
  let cursor = normalizarChecktime(estado.ultimoChecktimeSubido);

  if (!cursor) {
    const detectado = detectarCursorDesdeUltimoArchivoExitoso(cfg);
    if (detectado) {
      cursor = detectado.checktime;
      guardarEstadoPersistido({
        ultimoChecktimeSubido: detectado.checktime,
        ultimoArchivoExitoso: detectado.archivo,
        ultimoError: null,
      });
      logger.info({ msg: 'fichero: cursor reconstruido desde ultimo archivo exitoso', archivo: detectado.archivo, checktime: detectado.checktime });
    }
  }

  const inicioContinuo = inicioContinuoCfg(cfg);
  let desde = cursor
    ? restarMinutosChecktime(cursor, Number((env as any).FICHERO_CURSOR_OVERLAP_MIN || 10))
    : inicioContinuo;

  if (inicioContinuo && desde && desde < inicioContinuo) desde = inicioContinuo;
  if (!desde) return null;

  return rangoDesdeChecktime(desde, cfg);
}

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

// Crea conexión mysql2 con dateStrings:true para recibir "YYYY-MM-DD HH:mm:ss" sin conversión tz
export async function conectarMySQL(cfg: FicheroConfig) {
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
export function parsearDateLocal(s: string): Date {
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

function commandForDeviceFichero(command: string, pushVersion: unknown): string {
  const v = Number(pushVersion ?? 0);
  if (Number.isFinite(v) && v < 2) {
    return command
      .replace('DATA UPDATE USERINFO', 'DATA USER')
      .replace('DATA UPDATE FINGERTMP', 'DATA FP')
      .replace('DATA UPDATE SMS', 'DATA SMS');
  }
  return command;
}

async function appendDeviceCommandFichero(
  conn: Awaited<ReturnType<typeof conectarMySQL>>,
  sn: string,
  command: string,
  pushVersion?: unknown,
): Promise<number> {
  const content = commandForDeviceFichero(command, pushVersion);
  const [pending] = await conn.query<RowDataPacket[]>(
    `SELECT id
       FROM devcmds
      WHERE SN_id = ? AND CmdContent = ? AND CmdOverTime IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    [sn, content],
  );
  if (pending[0]?.id) return Number(pending[0].id);
  const [result] = await conn.query<any>(
    `INSERT INTO devcmds (SN_id, CmdContent, CmdCommitTime)
     VALUES (?, ?, ?)`,
    [sn, content, fmtIso(new Date())],
  );
  return Number(result?.insertId ?? 0);
}

function marcarRedCaida(): void {
  redCaida = true;
  if (!redCaidaDesdeMs) redCaidaDesdeMs = Date.now();
}

function detectarRedCaidaDesdeLogMs(): number | null {
  const entradas = parsearLog();
  let desde: number | null = null;
  for (let i = entradas.length - 1; i >= 0; i--) {
    const e = entradas[i];
    if (e.exitoso) break;
    if (!/Red no disponible|timeout|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|handshake/i.test(e.error)) break;
    const ts = new Date(e.fechaCreacion.replace(' ', 'T')).getTime();
    if (!Number.isNaN(ts)) desde = ts;
  }
  return desde;
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

  if (Array.isArray(rango.sns) && rango.sns.length > 0) {
    const unique = [...new Set(rango.sns.map(sn => String(sn).trim()).filter(Boolean))];
    if (unique.length) {
      conds.push(`ci.SN IN (${unique.map(() => '?').join(', ')})`);
      params.push(...unique);
    }
  } else if (rango.sn) {
    conds.push('ci.SN = ?');
    params.push(rango.sn);
  }

  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  return { where, params };
}

function safeNamePart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 40);
}

function outputDirAbs(cfg: FicheroConfig): string {
  return path.isAbsolute(cfg.outputDir)
    ? cfg.outputDir
    : path.resolve(process.cwd(), cfg.outputDir);
}

function safeFicheroName(value: unknown): string {
  return path.basename(String(value ?? '').trim()).replace(/[^a-zA-Z0-9._-]/g, '');
}

function parseFicheroFecha(value: string): string | null {
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function parseFicheroTxt(content: string): FicheroTxtRow[] {
  return content
    .split(/\r?\n/)
    .map((raw, idx) => {
      const line = raw.trimEnd();
      if (!line.trim()) return null;
      const parts = line.split(',');
      const dni = String(parts[0] ?? '').replace(/^DNI/i, '').trim().replace(/\D/g, '');
      const checktime = parseFicheroFecha(String(parts[1] ?? ''));
      const tipoRaw = String(parts[2] ?? '').trim().toUpperCase();
      const tipo = tipoRaw === 'S' ? 'S' : 'E';
      const nombre = String(parts[4] ?? '').trim();
      const row: FicheroTxtRow = {
        linea: idx + 1,
        dni,
        checktime: checktime || '',
        tipo,
        nombre,
        raw: line,
      };
      if (!dni || !checktime || !['E', 'S'].includes(tipoRaw)) row.error = 'Linea no parseable';
      return row;
    })
    .filter((row): row is FicheroTxtRow => !!row);
}

function ficheroDbKey(dni: unknown, checktime: unknown, checktype: unknown): string {
  const tipo = String(checktype) === '0' ? 'E' : 'S';
  return `${normalizeDniForFichero(dni)}|${String(checktime ?? '').slice(0, 19)}|${tipo}`;
}

function normalizeDniForFichero(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

// ─── Motor principal ──────────────────────────────────────────────────────────

let timer:            ReturnType<typeof setInterval> | null = null;
let corriendo       = false;
let redCaida        = false;
let enEjecucion     = false;
let redCaidaDesdeMs: number | null = null;
let recuperacionEnCurso = false;
let ultimaEjecucionMs: number | null = null;   // timestamp epoch de la última vez que arrancó un ciclo

async function verificarRed(): Promise<boolean> {
  // Verifica conectividad TCP al host SFTP usando la misma interfaz local que usará la conexión SFTP.
  // Esto es crítico cuando el servidor tiene múltiples interfaces: la conexión TCP de test
  // debe salir por la misma IP que la conexión SFTP real, para un diagnóstico preciso.
  const cfg = cargarConfig();
  const host = cfg.sftpHost || '8.8.8.8';
  const port = cfg.sftpPort || 22;
  const localAddr = cfg.sftpLocalAddr || undefined;

  return new Promise((resolve) => {
    import('net').then(({ default: net }) => {
      const sock = new net.Socket();
      const timeout = 5000;
      sock.setTimeout(timeout);
      // Si hay IP local configurada, salir desde esa interfaz (igual que hará SFTP)
      if (localAddr) {
        (sock as any).connect({ port, host, localAddress: localAddr }, () => { sock.destroy(); resolve(true); });
      } else {
        sock.connect(port, host, () => { sock.destroy(); resolve(true); });
      }
      sock.on('error', () => { sock.destroy(); resolve(false); });
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
    }).catch(() => resolve(false));
  });
}

async function encolarRelecturaPorCaida(
  conn: Awaited<ReturnType<typeof conectarMySQL>>,
  cfg: FicheroConfig,
  desdeMs: number,
  hastaMs: number,
): Promise<{ dispositivos: number; comandos: number; desde: string; hasta: string }> {
  const desde = fmtIso(new Date(Math.max(0, desdeMs - 10 * 60_000)));
  const hasta = fmtIso(new Date(hastaMs));
  let sql = `SELECT SN, PushVersion
               FROM iclock
              WHERE (DelTag IS NULL OR DelTag = 0)
                AND (State IS NULL OR State <> 0)`;
  let params: string[] = [];

  if (cfg.continuoModo === 'uno' && cfg.continuoSn) {
    sql += ' AND SN = ?';
    params = [cfg.continuoSn];
  } else if (cfg.continuoModo === 'grupo' && Array.isArray(cfg.continuoSns) && cfg.continuoSns.length > 0) {
    const sns = [...new Set(cfg.continuoSns.map(sn => String(sn).trim()).filter(Boolean))];
    if (sns.length > 0) {
      sql += ` AND SN IN (${sns.map(() => '?').join(', ')})`;
      params = sns;
    }
  }

  const [devices] = await conn.query<RowDataPacket[]>(sql, params);
  let comandos = 0;
  for (const d of devices) {
    const sn = String(d.SN || '').trim();
    if (!sn) continue;
    const command = `DATA QUERY ATTLOG StartTime=${desde}\tEndTime=${hasta}`;
    const id = await appendDeviceCommandFichero(conn, sn, command, d.PushVersion);
    if (id) comandos++;
  }
  return { dispositivos: devices.length, comandos, desde, hasta };
}

// rango = null → el ciclo automático del timer, sin filtro de fecha (trae los últimos N)
// rango con valores → exportación manual por rango
async function ejecutarCiclo(rango: RangoFechas | null = null, opciones: { automatico?: boolean } = {}): Promise<{
  ok: boolean; registros: number; archivo: string; error?: string; sn?: string | null; alias?: string | null;
}> {
  if (enEjecucion) return { ok: false, registros: 0, archivo: '', error: 'Ya hay un ciclo en ejecución' };
  enEjecucion = true;
  ultimaEjecucionMs = Date.now();   // registrar cuándo arrancó este ciclo

  const cfg           = cargarConfig();
  const fechaCreacion = new Date();
  let filtroReloj: { sn: string | null; alias: string } | null = null;
  const nombreArchivoBase = `${cfg.prefijo}_Fichadas_${fmtNombreArchivo(fechaCreacion)}`;
  let   exitoso       = false;
  let   errorMsg      = '';
  let   fechaSubida   = new Date();
  let   totalRegistros = 0;
  let   nombreArchivo = `${nombreArchivoBase}_${cfg.sufijo}`;
  let   maxChecktimeSubido: string | null = null;
  let   archivoLocalGenerado: string | null = null;

  try {
    // 1. Verificar red
    const hayRed = await verificarRed();
    if (!hayRed) { marcarRedCaida(); throw new Error('Red no disponible (sin conectividad)'); }
    const recuperarDesdeMs = redCaidaDesdeMs ?? detectarRedCaidaDesdeLogMs();
    const debeRecuperarCaida = recuperarDesdeMs != null;
    redCaida = false;
    redCaidaDesdeMs = null;

    // 2. Conectar MySQL (dateStrings: true)
    const conn = await conectarMySQL(cfg);

    if (debeRecuperarCaida && recuperarDesdeMs && !recuperacionEnCurso) {
      recuperacionEnCurso = true;
      try {
        const rec = await encolarRelecturaPorCaida(conn, cfg, recuperarDesdeMs, Date.now());
        logger.info({ msg: 'fichero: relectura ADMS encolada tras recuperar red', ...rec });
      } catch (e: any) {
        redCaidaDesdeMs = recuperarDesdeMs;
        logger.warn({ msg: 'fichero: no se pudo encolar relectura tras recuperar red', error: e?.message ?? String(e) });
      } finally {
        recuperacionEnCurso = false;
      }
    }

    const grupoSns = Array.isArray(rango?.sns)
      ? [...new Set(rango!.sns!.map(sn => String(sn).trim()).filter(Boolean))]
      : [];

    if (grupoSns.length > 0) {
      const placeholders = grupoSns.map(() => '?').join(', ');
      const [devices] = await conn.query<RowDataPacket[]>(
        `SELECT SN, Alias FROM iclock WHERE SN IN (${placeholders}) AND (DelTag IS NULL OR DelTag = 0)`,
        grupoSns
      );
      if (devices.length !== grupoSns.length) {
        const found = new Set(devices.map(d => String(d.SN)));
        const missing = grupoSns.filter(sn => !found.has(sn));
        throw new Error(`Reloj(es) no encontrado(s): ${missing.join(', ')}`);
      }
      filtroReloj = { sn: null, alias: `grupo_${devices.length}_relojes` };
      nombreArchivo = `${nombreArchivoBase}_${safeNamePart(filtroReloj.alias)}_${cfg.sufijo}`;
    } else if (rango?.sn) {
      const [devices] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias FROM iclock WHERE SN = ? AND (DelTag IS NULL OR DelTag = 0) LIMIT 1',
        [rango.sn]
      );
      if (!devices.length) throw new Error(`Reloj ${rango.sn} no encontrado`);
      filtroReloj = { sn: String(devices[0].SN), alias: String(devices[0].Alias || devices[0].SN) };
      nombreArchivo = `${nombreArchivoBase}_${safeNamePart(filtroReloj.alias || filtroReloj.sn)}_${cfg.sufijo}`;
    }

    // 3. Armar query con o sin filtro de rango
    let query: string;
    let queryParams: (string | number)[];

    if (rango && (rango.fechaDesde || rango.fechaHasta)) {
      const { where, params } = buildWhereRango(rango);
      query = `SELECT ui.badgenumber, ci.checktime, ci.checktype, ui.name
                 FROM checkinout ci
                 INNER JOIN userinfo ui ON ci.userid = ui.userid
                 ${where}
                 ORDER BY ci.checktime DESC`;
      queryParams = params;
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
    maxChecktimeSubido = rows
      .map(row => normalizarChecktime(row.checktime))
      .filter((v): v is string => !!v)
      .sort()
      .pop() ?? null;

    // 4. Generar archivo local
    const dir = path.isAbsolute(cfg.outputDir)
      ? cfg.outputDir
      : path.resolve(process.cwd(), cfg.outputDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${nombreArchivo}.txt`);
    archivoLocalGenerado = filePath;
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
        serverHostKey: ['ssh-rsa', 'ssh-dss', 'rsa-sha2-512', 'rsa-sha2-256',
                        'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ssh-ed25519'],
        cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr',
                 'aes128-cbc', 'aes256-cbc', '3des-cbc',
                 'aes128-gcm', 'aes256-gcm'],
        hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1', 'hmac-md5'],
        // OpenSSH 5.3 (servidor remoto) no soporta ECDH ni group14-sha256.
        // Con diffie-hellman-group-exchange-sha256, ese servidor envía un primo de 1024 bits
        // que ssh2 v1.x rechaza silenciosamente, causando timeout de handshake.
        // Solución: group14-sha1 primero (grupo fijo 2048 bits, compatible con OpenSSH 3.x+).
        kex: ['diffie-hellman-group14-sha1',
              'diffie-hellman-group-exchange-sha1',
              'diffie-hellman-group-exchange-sha256',
              'diffie-hellman-group1-sha1',
              'diffie-hellman-group14-sha256',
              'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521'],
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
    if (/timeout|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|handshake/i.test(errorMsg)) marcarRedCaida();
    logger.warn({ msg: 'fichero: error en ciclo', error: errorMsg });
  } finally {
    enEjecucion = false;
    const rangoDesdeLog = rango?.fechaDesde && rango?.horaDesde
      ? `${rango.fechaDesde} ${rango.horaDesde}`
      : (rango?.fechaDesde ?? undefined);
    const rangoHastaLog = rango?.fechaHasta && rango?.horaHasta
      ? `${rango.fechaHasta} ${rango.horaHasta}`
      : (rango?.fechaHasta ?? undefined);
    escribirLog({
      fechaCreacion:  fmtIso(fechaCreacion),
      nombreArchivo,
      fechaSubida:    fmtIso(fechaSubida),
      exitoso,
      registros:      totalRegistros,
      rangoDesde:     rangoDesdeLog,
      rangoHasta:     rangoHastaLog,
      error: errorMsg,
    });
    if (opciones.automatico) {
      if (exitoso && maxChecktimeSubido) {
        guardarEstadoPersistido({
          autoStart: true,
          ultimoChecktimeSubido: maxChecktimeSubido,
          ultimoArchivoExitoso: nombreArchivo,
          ultimaSubidaExitosa: fmtIso(fechaSubida),
          ultimoIntentoEn: fmtIso(fechaCreacion),
          ultimoError: null,
          pendienteSubida: null,
        });
      } else {
        guardarEstadoPersistido({
          autoStart: true,
          ultimoIntentoEn: fmtIso(fechaCreacion),
          ultimoError: exitoso ? null : errorMsg,
          pendienteSubida: !exitoso && totalRegistros > 0 && archivoLocalGenerado
            ? {
                archivo: nombreArchivo,
                path: archivoLocalGenerado,
                registros: totalRegistros,
                creadoEn: fmtIso(fechaCreacion),
                rangoDesde: rangoDesdeLog ?? null,
                rangoHasta: rangoHastaLog ?? null,
                error: errorMsg || null,
              }
            : cargarEstadoPersistido().pendienteSubida ?? null,
        });
      }
    }
  }

  return { ok: exitoso, registros: totalRegistros, archivo: nombreArchivo, error: errorMsg || undefined, sn: filtroReloj?.sn ?? null, alias: filtroReloj?.alias ?? null };
}

async function reintentarSubidaPendiente(cfg: FicheroConfig): Promise<boolean> {
  const estado = cargarEstadoPersistido();
  const pendiente = estado.pendienteSubida;
  if (!pendiente?.archivo || !pendiente.path) return false;

  const fechaIntento = new Date();
  if (!fs.existsSync(pendiente.path)) {
    const error = `Archivo pendiente no encontrado: ${pendiente.path}`;
    guardarEstadoPersistido({
      autoStart: true,
      ultimoIntentoEn: fmtIso(fechaIntento),
      ultimoError: error,
      pendienteSubida: { ...pendiente, error },
    });
    logger.warn({ msg: 'fichero: pendiente sin archivo local', archivo: pendiente.archivo, path: pendiente.path });
    return true;
  }

  try {
    const remotePath = await subirArchivoSftp(cfg, pendiente.path, pendiente.archivo);
    const rows = parseFicheroTxt(fs.readFileSync(pendiente.path, 'utf-8'));
    const maxChecktimeSubido = rows
      .map(row => normalizarChecktime(row.checktime))
      .filter((v): v is string => !!v)
      .sort()
      .pop() ?? estado.ultimoChecktimeSubido ?? null;
    const fechaSubidaOk = fmtIso(new Date());

    escribirLog({
      fechaCreacion: fmtIso(fechaIntento),
      nombreArchivo: pendiente.archivo,
      fechaSubida: fechaSubidaOk,
      exitoso: true,
      registros: pendiente.registros,
      rangoDesde: pendiente.rangoDesde ?? undefined,
      rangoHasta: pendiente.rangoHasta ?? undefined,
      error: 'Reintento de pendiente OK',
    });
    guardarEstadoPersistido({
      autoStart: true,
      ultimoChecktimeSubido: maxChecktimeSubido,
      ultimoArchivoExitoso: pendiente.archivo,
      ultimaSubidaExitosa: fechaSubidaOk,
      ultimoIntentoEn: fmtIso(fechaIntento),
      ultimoError: null,
      pendienteSubida: null,
    });
    logger.info({ msg: 'fichero: pendiente subido OK', remotePath, registros: pendiente.registros });
  } catch (err: any) {
    const error = err?.message ?? String(err);
    if (/timeout|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|handshake/i.test(error)) marcarRedCaida();
    escribirLog({
      fechaCreacion: fmtIso(fechaIntento),
      nombreArchivo: pendiente.archivo,
      fechaSubida: fmtIso(new Date()),
      exitoso: false,
      registros: pendiente.registros,
      rangoDesde: pendiente.rangoDesde ?? undefined,
      rangoHasta: pendiente.rangoHasta ?? undefined,
      error: `Reintento de pendiente: ${error}`,
    });
    guardarEstadoPersistido({
      autoStart: true,
      ultimoIntentoEn: fmtIso(fechaIntento),
      ultimoError: error,
      pendienteSubida: { ...pendiente, error },
    });
    logger.warn({ msg: 'fichero: pendiente sigue sin subir', archivo: pendiente.archivo, error });
  }

  return true;
}

function ejecutarCicloAutomatico(): void {
  const c = cargarConfig();
  reintentarSubidaPendiente(c).then(intentado => {
    if (!intentado) ejecutarCiclo(crearRangoAutomatico(c), { automatico: true });
  }).catch((err: any) => {
    logger.warn({ msg: 'fichero: error reintentando pendiente', error: err?.message ?? String(err) });
  });
}

function iniciarTimer(options: { persistirAutoStart?: boolean; ejecutarAhora?: boolean; motivo?: string } = {}): void {
  if (timer) clearInterval(timer);
  const cfg = cargarConfig();
  corriendo = true;
  redCaida  = false;
  redCaidaDesdeMs = null;
  if (options.persistirAutoStart !== false) {
    guardarEstadoPersistido({ autoStart: true, ultimoError: null });
  }
  ultimaEjecucionMs = Date.now();   // permite mostrar el countdown desde el primer momento
  timer = setInterval(() => {
    ejecutarCicloAutomatico();
    return;
    // Relee config en cada tick para respetar cambios de modo sin reiniciar el timer
    const c = cargarConfig();
    let rango: RangoFechas | null = null;
    if (c.modoContinu && c.fechaDesdeContinu) {
      rango = {
        fechaDesde: c.fechaDesdeContinu,
        horaDesde:  c.horaDesdeContinu ?? null,
        fechaHasta: null,   // hasta ahora (sin límite de fecha)
        horaHasta:  null,
        sn: c.continuoModo === 'uno' ? c.continuoSn : null,
        sns: c.continuoModo === 'grupo' ? c.continuoSns : null,
      };
    }
    ejecutarCiclo(rango);
  }, cfg.intervaloMin * 60 * 1000);
  if (options.ejecutarAhora) {
    setTimeout(() => ejecutarCicloAutomatico(), 1000);
  }
  logger.info({ msg: 'fichero: timer iniciado', intervaloMin: cfg.intervaloMin, modoContinu: cfg.modoContinu, motivo: options.motivo ?? 'manual' });
}

function detenerTimer(options: { persistirAutoStart?: boolean } = {}): void {
  if (timer) { clearInterval(timer); timer = null; }
  corriendo = false;
  if (options.persistirAutoStart !== false) {
    guardarEstadoPersistido({ autoStart: false });
  }
  logger.info({ msg: 'fichero: timer detenido' });
}

// ─── Router ───────────────────────────────────────────────────────────────────

let autoArranqueEvaluado = false;

function programarAutoArranqueFichero(): void {
  if (autoArranqueEvaluado) return;
  autoArranqueEvaluado = true;

  const cfg = cargarConfig();
  const estado = cargarEstadoPersistido();
  const debeArrancar = estado.autoStart ?? Boolean(cfg.modoContinu && cfg.fechaDesdeContinu);

  if (!debeArrancar) {
    logger.info({ msg: 'fichero: autoarranque omitido', razon: 'autoStart deshabilitado' });
    return;
  }

  setTimeout(() => {
    if (!corriendo) {
      iniciarTimer({ persistirAutoStart: true, ejecutarAhora: true, motivo: 'autoarranque' });
    }
  }, 1000);
}

export function buildFicheroRouter(): Router {
  const router = Router();
  const admin  = requirePermission('crud:*:*');
  programarAutoArranqueFichero();

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
    iniciarTimer({ ejecutarAhora: true, motivo: 'manual' });
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
  // Body: { fechaDesde, fechaHasta, horaDesde, horaHasta, sn?, sns? }
  router.post('/exportar', admin, async (req: Request, res: Response) => {
    const { fechaDesde, fechaHasta, horaDesde, horaHasta } = req.body as RangoFechas;
    const sn = String((req.body as any)?.sn ?? '').trim() || null;
    const snsRaw = Array.isArray((req.body as any)?.sns) ? (req.body as any).sns : [];
    const sns: string[] = [...new Set(snsRaw.map((v: unknown) => String(v ?? '').trim()).filter(Boolean) as string[])];

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

    const result = await ejecutarCiclo({
      fechaDesde: fechaDesde ?? null,
      fechaHasta: fechaHasta ?? null,
      horaDesde: horaDesde ?? null,
      horaHasta: horaHasta ?? null,
      sn: sns.length ? null : sn,
      sns: sns.length ? sns : null,
    });
    return res.json({ ok: result.ok, registros: result.registros, archivo: result.archivo, error: result.error, sn: result.sn ?? null, alias: result.alias ?? null });
  });

  // GET /fichero/estado
  router.get('/estado', admin, (_req: Request, res: Response) => {
    const entradas   = parsearLog();
    const exitosos   = entradas.filter(e => e.exitoso).length;
    const fallidos   = entradas.length - exitosos;

    // redCaidaLog: solo se activa si las últimas 3 entradas son RECIENTES (< 2 horas)
    // y todas fallaron con errores de conectividad.
    // Usamos errores específicos de red, NO "connect" genérico (evita falso positivo con EADDRNOTAVAIL).
    const ultimas3  = entradas.slice(-3);
    const ahoraMs   = Date.now();
    const dosHorasMs = 2 * 60 * 60 * 1000;
    const redCaidaLog = ultimas3.length >= 3 && ultimas3.every(e => {
      if (e.exitoso) return false;
      const ts = new Date(e.fechaCreacion.replace(' ', 'T')).getTime();
      if (isNaN(ts) || ahoraMs - ts > dosHorasMs) return false;
      return /Red no disponible|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT/i.test(e.error);
    });

    const ultimaExitosa = [...entradas].reverse().find(e => e.exitoso) ?? null;

    const cfg2 = cargarConfig();
    const estadoPersistido = cargarEstadoPersistido();
    // próxima ejecución = última ejecución + intervalo (solo tiene sentido si el timer está corriendo)
    const proximaEjecucionMs: number | null =
      corriendo && ultimaEjecucionMs
        ? ultimaEjecucionMs + cfg2.intervaloMin * 60_000
        : null;

    res.json({
      ok: true,
      data: {
        corriendo,
        redCaida: redCaida || redCaidaLog,
        total:    entradas.length,
        exitosos,
        fallidos,
        primerArchivo:        entradas.length > 0 ? entradas[0].fechaCreacion : null,
        ultimoArchivo:        entradas.length > 0 ? entradas[entradas.length - 1].fechaCreacion : null,
        ultimaSubidaExitosa:  ultimaExitosa?.fechaSubida ?? null,
        pendienteSubida:      estadoPersistido.pendienteSubida ?? null,
        intervaloMin:         cfg2.intervaloMin,
        proximaEjecucionMs,   // epoch ms — el front hace el countdown desde acá
        entradas:             [...entradas].reverse(),
      } as EstadoFichero,
    });
  });

  // POST /fichero/resetear — limpia el flag de redCaida en memoria (útil tras corregir config)
  router.post('/resetear', admin, (_req: Request, res: Response) => {
    redCaida = false;
    redCaidaDesdeMs = null;
    res.json({ ok: true, msg: 'Estado de red reseteado' });
  });

  // GET /fichero/red
  router.get('/red', admin, async (_req: Request, res: Response) => {
    const hayRed = await verificarRed();
    res.json({ ok: true, red: hayRed ? 'activa' : 'caida' });
  });

  // GET /fichero/dispositivos
  // Consulta iclock y verifica estado real por protocolo ZK TCP 4370.
  // LastActivity queda como estado ADMS/PUSH, no como unica prueba de vida.
  router.get('/dispositivos', admin, async (_req: Request, res: Response) => {
    const cfg = cargarConfig();
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT SN, Alias, LastActivity, State, IPAddress
           FROM iclock
           WHERE DelTag IS NULL OR DelTag = 0
           ORDER BY Alias, SN`
      );
      await conn.end();

      const now = Date.now();
      const protocolResults = await Promise.all(rows.map(async (r) => {
        const ip = String(r.IPAddress || '').trim();
        if (!ip || ip === '::1' || ip === '127.0.0.1') {
          return { sn: String(r.SN), online: null as boolean | null, latencyMs: null as number | null, error: null as string | null, portOpen: null as boolean | null };
        }
        const result = await checkZkProtocol(ip, 1500);
        const portOpen = result.online ? true : await tcpPortOpen(ip, 4370, 800);
        return { sn: String(r.SN), online: result.online, latencyMs: result.latencyMs, error: result.error ?? null, portOpen };
      }));
      const protocolBySn = new Map(protocolResults.map(r => [r.sn, r]));

      const data = rows.map(r => {
        // LastActivity llega como string "YYYY-MM-DD HH:mm:ss" por dateStrings:true
        const la = r.LastActivity ? parsearDateLocal(r.LastActivity as string).getTime() : null;
        const segundos = la ? Math.floor((now - la) / 1000) : null;
        const admsEstado = la && segundos != null && segundos <= 300 ? 'online' : 'offline';
        const protocol = protocolBySn.get(String(r.SN));
        const protocolOnline = protocol?.online ?? null;
        let estado: 'online' | 'offline' | 'pausado';
        if (r.State === 0)                       estado = 'pausado';
        else if (protocolOnline === true)         estado = 'online';
        else                                      estado = admsEstado;
        return {
          sn:                r.SN,
          alias:             r.Alias || r.SN,
          lastActivity:      r.LastActivity || null,
          segundosSinActividad: segundos,
          estado,
          admsEstado,
          protocolOnline,
          protocolLatencyMs: protocol?.latencyMs ?? null,
          protocolError: protocol?.error ?? null,
          portOpen: protocol?.portOpen ?? null,
          tcpOnline: protocolOnline,
          tcpLatencyMs: protocol?.latencyMs ?? null,
          ip:                r.IPAddress || null,
        };
      });

      return res.json({ ok: true, data });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      // Si la tabla iclock no existe aún, devolver lista vacía en lugar de error 500
      return res.json({ ok: true, data: [], warning: err?.message ?? String(err) });
    }
  });

  // GET /fichero/archivos
  // Lista los .txt generados localmente para poder inspeccionar que hay dentro.
  router.get('/archivos', admin, (_req: Request, res: Response) => {
    const cfg = cargarConfig();
    const dir = outputDirAbs(cfg);
    if (!fs.existsSync(dir)) return res.json({ ok: true, dir, data: [] });

    const data = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
      .map(entry => {
        const fullPath = path.join(dir, entry.name);
        const stat = fs.statSync(fullPath);
        return {
          nombre: entry.name,
          size: stat.size,
          modificado: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modificado.localeCompare(a.modificado));

    return res.json({ ok: true, dir, data });
  });

  // GET /fichero/archivo-diagnostico?archivo=...
  // Lee un fichero local, parsea sus marcas y compara contra checkinout.
  router.get('/archivo-diagnostico', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const archivo = safeFicheroName(req.query.archivo);
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit ?? 200)));
    if (!archivo) return res.status(400).json({ ok: false, error: 'archivo es requerido' });

    const dir = outputDirAbs(cfg);
    const filePath = path.join(dir, archivo);
    if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: `Archivo ${archivo} no encontrado` });
    }

    const rows = parseFicheroTxt(fs.readFileSync(filePath, 'utf8'));
    const validRows = rows.filter(row => !row.error);
    const invalidRows = rows.filter(row => row.error);
    const minTime = validRows.reduce<string | null>((acc, row) => !acc || row.checktime < acc ? row.checktime : acc, null);
    const maxTime = validRows.reduce<string | null>((acc, row) => !acc || row.checktime > acc ? row.checktime : acc, null);
    const dniList = [...new Set(validRows.map(row => row.dni).filter(Boolean))];
    const dbKeys = new Set<string>();

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      if (minTime && maxTime && dniList.length) {
        conn = await conectarMySQL(cfg);
        for (let i = 0; i < dniList.length; i += 500) {
          const chunk = dniList.slice(i, i + 500);
          const placeholders = chunk.map(() => '?').join(',');
          const [dbRows] = await conn.query<RowDataPacket[]>(
            `SELECT ui.badgenumber, ci.checktime, ci.checktype
               FROM checkinout ci
               INNER JOIN userinfo ui ON ci.userid = ui.userid
              WHERE ci.checktime >= ?
                AND ci.checktime <= ?
                AND ui.badgenumber IN (${placeholders})`,
            [minTime, maxTime, ...chunk]
          );
          for (const row of dbRows) dbKeys.add(ficheroDbKey(row.badgenumber, row.checktime, row.checktype));
        }
        await conn.end();
        conn = null;
      }

      const faltantes = validRows.filter(row => !dbKeys.has(`${normalizeDniForFichero(row.dni)}|${row.checktime}|${row.tipo}`));
      const presentes = validRows.length - faltantes.length;

      return res.json({
        ok: true,
        archivo,
        rango: { desde: minTime, hasta: maxTime },
        resumen: {
          lineas: rows.length,
          parseables: validRows.length,
          noParseables: invalidRows.length,
          presentes,
          faltantes: faltantes.length,
        },
        faltantes: faltantes.slice(0, limit),
        noParseables: invalidRows.slice(0, limit),
        muestras: rows.slice(0, Math.min(limit, 50)),
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
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

  // ADMS moderno (solo lectura, rutas nuevas).
  registerFicheroAdmsRoutes(router, { admin, cargarConfig, conectarMySQL, parsearDateLocal });
  return router;
}
