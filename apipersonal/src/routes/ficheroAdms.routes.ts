import { Router, Request, Response, RequestHandler } from 'express';
import { Connection, RowDataPacket } from 'mysql2/promise';
import { QueryTypes } from 'sequelize';
import fs from 'fs';
import path from 'path';
import net from 'net';
import multer from 'multer';
import { sequelize } from '../db/sequelize';
import { trackAction } from '../logging/track';
import { getAdmsRuntimeEvents } from '../services/admsRuntime';
import {
  addAdmsAudioFile,
  allowedAudio,
  audioFilePath,
  deleteAdmsAudioRule,
  getAdmsAttendanceAudioEvents,
  readAdmsAudioConfig,
  upsertAdmsAudioRule,
} from '../services/admsAudio';

interface FicheroAdmsConfig {
  mysqlHost: string;
  mysqlPort: number;
  mysqlUser: string;
  mysqlPass: string;
  mysqlDb: string;
}

interface FicheroAdmsDeps<TConfig extends FicheroAdmsConfig> {
  admin: RequestHandler;
  cargarConfig: () => TConfig;
  conectarMySQL: (cfg: TConfig) => Promise<Connection>;
  parsearDateLocal: (value: string) => Date;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function asStringOrNull(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s ? s : null;
}

function parseDateParam(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseDateTimeParam(value: unknown, endOfDay = false): string | null {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} ${endOfDay ? '23:59:59' : '00:00:00'}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s.replace('T', ' ')}:${endOfDay ? '59' : '00'}`;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.length === 16 ? `${s}:00` : s;
  return null;
}

function normalizeDni(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

function admsEstadoFromLastActivity(value: unknown, parsearDateLocal: (value: string) => Date): {
  estado: 'online' | 'offline' | 'pausado';
  segundosSinActividad: number | null;
} {
  const raw = value ? String(value) : '';
  const last = raw ? parsearDateLocal(raw).getTime() : null;
  const segundosSinActividad = last ? Math.floor((Date.now() - last) / 1000) : null;
  if (last && segundosSinActividad != null && segundosSinActividad <= 300) {
    return { estado: 'online', segundosSinActividad };
  }
  return { estado: 'offline', segundosSinActividad };
}

function mysqlNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ─── Protocolo ZK TCP 4370 ────────────────────────────────────────────────────
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
      // Conectar por el protocolo ya alcanza para saber que el reloj esta vivo.
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

// ─── biotemplate table ────────────────────────────────────────────────────────
// BioType: 1=huella, 9=cara, 10=palma (palm visible)
async function ensureBiotemplateTable(conn: Connection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS biotemplate (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      userid     INT NOT NULL,
      BioType    TINYINT NOT NULL DEFAULT 10,
      FingerID   TINYINT NOT NULL DEFAULT 0,
      Valid      TINYINT NOT NULL DEFAULT 1,
      Duress     TINYINT NOT NULL DEFAULT 0,
      Format     TINYINT NOT NULL DEFAULT 0,
      MajorVer   TINYINT NOT NULL DEFAULT 0,
      MinorVer   TINYINT NOT NULL DEFAULT 0,
      Template   MEDIUMTEXT,
      SN         VARCHAR(20),
      UTime      DATETIME,
      DelTag     TINYINT NOT NULL DEFAULT 0,
      UNIQUE KEY uk_userid_biotype_slot (userid, BioType, FingerID)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

const BIOTYPE_NAMES: Record<number, string> = {
  1: 'huella', 2: 'huella', 3: 'huella', 4: 'huella',
  5: 'huella', 6: 'huella', 7: 'huella', 8: 'huella',
  9: 'cara',   10: 'palma',
};

export function commandForDevice(command: string, pushVersion: unknown): string {
  const v = Number(pushVersion ?? 0);
  if (Number.isFinite(v) && v < 2) {
    return command
      .replace('DATA UPDATE USERINFO', 'DATA USER')
      .replace('DATA UPDATE FINGERTMP', 'DATA FP')
      .replace('DATA DELETE USERINFO', 'DATA DEL_USER')
      .replace('DATA DELETE FINGERTMP', 'DATA DEL_FP');
  }
  return command;
}

async function appendDeviceCommand(
  conn: Connection,
  sn: string,
  command: string,
  pushVersion?: unknown
): Promise<number> {
  const content = commandForDevice(command, pushVersion);
  const [pending] = await conn.query<RowDataPacket[]>(
    `SELECT id
       FROM devcmds
      WHERE SN_id = ? AND CmdContent = ? AND CmdOverTime IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    [sn, content]
  );
  if (pending[0]?.id) return Number(pending[0].id);
  const [result] = await conn.query<any>(
    `INSERT INTO devcmds (SN_id, CmdContent, CmdCommitTime)
     VALUES (?, ?, ?)`,
    [sn, content, mysqlNow()]
  );
  return Number(result?.insertId ?? 0);
}

function userInfoCommand(row: RowDataPacket): string {
  return [
    `DATA UPDATE USERINFO PIN=${row.badgenumber}`,
    `Name=${row.name || ''}`,
    `Passwd=${row.Password || ''}`,
    `Grp=${row.AccGroup || 1}`,
    `Card=${row.Card || ''}`,
    `TZ=${row.TimeZones || ''}`,
    `Pri=${row.Privilege ?? 0}`,
  ].join('\t');
}

function bioDataCommand(dni: string, row: RowDataPacket): string {
  const tmp = String(row.Template || '').replace(/\r?\n/g, '');
  const bioType = Number(row.BioType ?? 10) || 10;
  const index = Number(row.FingerID ?? 0) || 0;
  return [
    `DATA UPDATE BIODATA PIN=${dni}`,
    `No=${index}`,
    `Index=${index}`,
    `Valid=${Number(row.Valid ?? 1) || 1}`,
    `Duress=${Number(row.Duress ?? 0) || 0}`,
    `Type=${bioType}`,
    `BioType=${bioType}`,
    `Size=${tmp.length}`,
    `Format=${Number(row.Format ?? 0) || 0}`,
    `MajorVer=${Number(row.MajorVer ?? 0) || 0}`,
    `MinorVer=${Number(row.MinorVer ?? 0) || 0}`,
    `Tmp=${tmp}`,
  ].join('\t');
}

function bioQueryCommands(dni: string, bioType: number | null): string[] {
  const typeFilter = bioType != null ? `Type=${bioType}\tBioType=${bioType}` : '';
  const tableFilter = bioType != null ? `Type=${bioType}\tPin=${dni}` : `Pin=${dni}`;
  const commands = [
    `DATA QUERY USERINFO PIN=${dni}`,
    `DATA QUERY FINGERTMP PIN=${dni}`,
    bioType != null ? `DATA QUERY BIODATA PIN=${dni}\t${typeFilter}` : `DATA QUERY BIODATA PIN=${dni}`,
    bioType != null ? `DATA QUERY BIOTEMPLATE PIN=${dni}\t${typeFilter}` : `DATA QUERY BIOTEMPLATE PIN=${dni}`,
    `DATA QUERY tablename=biodata,fielddesc=*,filter=${tableFilter}`,
    `DATA QUERY tablename=biotemplate,fielddesc=*,filter=${tableFilter}`,
  ];
  return [...new Set(commands)];
}

function personalToAdmsName(row: { apellido: string | null; nombre: string | null }): string {
  return [row.apellido, row.nombre].filter(Boolean).join(', ').trim();
}

function normalizedText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

interface PersonalSyncRow {
  dni: number | string;
  apellido: string | null;
  nombre: string | null;
  legajo?: number | string | null;
  estado_empleo?: string | null;
  servicio_id?: number | null;
  servicio_nombre?: string | null;
}

interface FicheroUserRow {
  userid: number | null;
  dni: string;
  nombre: string;
  sn: string;
  alias: string;
}

interface DirectFicheroUserRow extends FicheroUserRow {
  tarjeta: string | null;
  privilegio: number | null;
}

interface DirectFicheroMessageUser {
  uid: number | null;
  dni: string;
  nombre: string;
}

interface DirectFicheroTemplateRow {
  uid: number;
  dni: string;
  nombre: string;
  slot: number;
  valid: number;
  size: number;
  version: string;
  sn: string;
  alias: string;
}

interface DirectFicheroReadResult {
  reloj: { sn: string; alias: string; ip: string };
  usuarios: DirectFicheroUserRow[];
  templates: DirectFicheroTemplateRow[];
  bytesTemplates: number;
}

const DIRECT_ZK_TEMPLATE_REQUEST = Buffer.from([0x01, 0x09, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function directTemplateVersion(buf: Buffer, offset: number, size: number): string {
  if (offset + size < offset + 12) return '';
  const marker = buf.subarray(offset + 8, Math.min(offset + 12, offset + size))
    .toString('ascii')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
  return marker || 'binario';
}

function parseDirectZkTemplates(
  payload: Buffer,
  usersByUid: Map<number, DirectFicheroUserRow>,
  sn: string,
  alias: string
): DirectFicheroTemplateRow[] {
  const rows: DirectFicheroTemplateRow[] = [];
  if (payload.length < 10) return rows;
  let offset = 4;
  while (offset + 6 <= payload.length) {
    const size = payload.readUInt16LE(offset);
    if (!size || size > 10_000 || offset + size > payload.length) break;
    const uid = payload.readUInt16LE(offset + 2);
    const slot = payload.readUInt8(offset + 4);
    const valid = payload.readUInt8(offset + 5);
    const user = usersByUid.get(uid);
    rows.push({
      uid,
      dni: user?.dni || String(uid),
      nombre: user?.nombre || '',
      slot,
      valid,
      size,
      version: directTemplateVersion(payload, offset, size),
      sn,
      alias,
    });
    offset += size;
  }
  return rows;
}

async function readDirectFicheroBiometrics(ZKTeco: any, rowDevice: RowDataPacket): Promise<DirectFicheroReadResult> {
  const sn = String(rowDevice.SN);
  const alias = String(rowDevice.Alias || rowDevice.SN);
  const ip = String(rowDevice.IPAddress || '').trim();
  if (!ip) throw new Error(`El reloj ${alias} no tiene IP registrada`);

  const device = new ZKTeco(ip, 4370, 20_000, 8_000);
  try {
    await device.createSocket();
    const usersResult = await device.getUsers();
    const rawUsers = Array.isArray(usersResult?.data) ? usersResult.data : [];
    const usuarios: DirectFicheroUserRow[] = rawUsers
      .map((user: any) => ({
        userid: Number.isFinite(Number(user?.uid)) ? Number(user.uid) : null,
        dni: normalizeDni(user?.userId ?? user?.uid),
        nombre: String(user?.name ?? '').trim(),
        tarjeta: user?.cardno == null || Number(user.cardno) === 0 ? null : String(user.cardno),
        privilegio: user?.role == null ? null : Number(user.role),
        sn,
        alias,
      }))
      .filter((user: DirectFicheroUserRow) => !!user.dni);

    const usersByUid = new Map<number, DirectFicheroUserRow>();
    for (const user of usuarios) {
      if (user.userid != null) usersByUid.set(user.userid, user);
    }

    const tcp = device.ztcp;
    if (!tcp?.readWithBuffer) throw new Error('El driver TCP no permite leer templates directos');
    try { await tcp.freeData?.(); } catch { /* noop */ }
    const templatesResult = await tcp.readWithBuffer(DIRECT_ZK_TEMPLATE_REQUEST);
    try { await tcp.freeData?.(); } catch { /* noop */ }
    const payload = Buffer.from(templatesResult?.data || []);
    const templates = parseDirectZkTemplates(payload, usersByUid, sn, alias);

    return {
      reloj: { sn, alias, ip },
      usuarios,
      templates,
      bytesTemplates: payload.length,
    };
  } finally {
    try { await device.disconnect(); } catch { /* noop */ }
  }
}

async function readDirectFicheroMessageUser(rowDevice: RowDataPacket, dni: string): Promise<DirectFicheroMessageUser> {
  const alias = String(rowDevice.Alias || rowDevice.SN);
  const ip = String(rowDevice.IPAddress || '').trim();
  if (!ip) throw new Error(`El reloj ${alias} no tiene IP registrada`);
  const mod: any = await import('zkteco-js' as any);
  const ZKTeco = mod.default ?? mod;
  const device = new ZKTeco(ip, 4370, 10_000, 5_000);
  try {
    await device.createSocket();
    const usersResult = await device.getUsers();
    const rawUsers = Array.isArray(usersResult?.data) ? usersResult.data : [];
    const user = rawUsers.find((row: any) => normalizeDni(row?.userId ?? row?.uid) === dni);
    if (!user) throw new Error(`El DNI ${dni} no existe en el fichero ${alias}`);
    return {
      uid: Number.isFinite(Number(user?.uid)) ? Number(user.uid) : null,
      dni,
      nombre: String(user?.name ?? '').trim(),
    };
  } finally {
    try { await device.disconnect(); } catch { /* noop */ }
  }
}

interface AdmsSyncOptions {
  privilege: number;
  group: number;
  timezone: string;
  cardSource: 'none' | 'dni' | 'legajo';
}

interface AdmsSyncRules {
  servicios: Record<string, string[]>;
}

function readAdmsSyncRules(): AdmsSyncRules {
  const fallback: AdmsSyncRules = { servicios: {} };
  const raw = String(process.env.ADMS_SYNC_RULES_JSON || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<AdmsSyncRules>;
      return { servicios: parsed.servicios && typeof parsed.servicios === 'object' ? parsed.servicios : {} };
    } catch {
      return fallback;
    }
  }
  const rulesPath = path.resolve(process.cwd(), 'config', 'admsSyncRules.json');
  if (!fs.existsSync(rulesPath)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as Partial<AdmsSyncRules>;
    return { servicios: parsed.servicios && typeof parsed.servicios === 'object' ? parsed.servicios : {} };
  } catch {
    return fallback;
  }
}

function targetSnRulesForService(servicioId: number | null): string[] {
  if (!servicioId) return [];
  const rules = readAdmsSyncRules();
  const list = rules.servicios[String(servicioId)] || [];
  return Array.isArray(list) ? list.map(v => String(v).trim()).filter(Boolean) : [];
}

function admsSyncOptions(input: any = {}): AdmsSyncOptions {
  const privilege = clampInt(input.privilege, 0, 0, 14);
  const group = clampInt(input.group, 1, 1, 99);
  const timezone = String(input.timezone ?? '').trim().slice(0, 20);
  const cardSource = ['dni', 'legajo'].includes(String(input.cardSource)) ? String(input.cardSource) as 'dni' | 'legajo' : 'none';
  return { privilege, group, timezone, cardSource };
}

function cardForPersonal(row: PersonalSyncRow, options: AdmsSyncOptions, dni: string): string {
  if (options.cardSource === 'dni') return dni;
  if (options.cardSource === 'legajo') return String(row.legajo ?? '').trim();
  return '';
}

function personalUserCommand(row: PersonalSyncRow & { dniText: string; nombreAdms: string }, options: AdmsSyncOptions): string {
  return [
    `DATA UPDATE USERINFO PIN=${row.dniText}`,
    `Name=${row.nombreAdms}`,
    'Passwd=',
    `Grp=${options.group}`,
    `Card=${cardForPersonal(row, options, row.dniText)}`,
    `TZ=${options.timezone}`,
    `Pri=${options.privilege}`,
  ].join('\t');
}

function personalSyncSql(filters: { servicioId?: number | null; reparticionId?: number | null; sectorId?: number | null; soloActivos?: boolean }) {
  const where = ['p.dni IS NOT NULL', 'p.deleted_at IS NULL'];
  const replacements: Record<string, unknown> = {};
  if (filters.soloActivos !== false) where.push("(a.estado_empleo IS NULL OR a.estado_empleo = 'ACTIVO')");
  if (filters.servicioId) {
    where.push(`EXISTS (
      SELECT 1 FROM agentes_servicios ags_f
       WHERE ags_f.dni = p.dni AND ags_f.deleted_at IS NULL AND ags_f.fecha_hasta IS NULL
         AND ags_f.servicio_id = :servicioId
    )`);
    replacements.servicioId = filters.servicioId;
  }
  if (filters.reparticionId) {
    where.push(`EXISTS (
      SELECT 1 FROM agentes_servicios ags_r
      JOIN servicios srv_r ON srv_r.id = ags_r.servicio_id
       WHERE ags_r.dni = p.dni AND ags_r.deleted_at IS NULL AND ags_r.fecha_hasta IS NULL
         AND srv_r.reparticion_id = :reparticionId
    )`);
    replacements.reparticionId = filters.reparticionId;
  }
  if (filters.sectorId) {
    where.push(`EXISTS (
      SELECT 1 FROM agentes_sectores asec_f
       WHERE asec_f.dni = p.dni AND asec_f.deleted_at IS NULL AND asec_f.fecha_hasta IS NULL
         AND asec_f.sector_id = :sectorId
    )`);
    replacements.sectorId = filters.sectorId;
  }
  return {
    sql: `SELECT p.dni, p.apellido, p.nombre, a.legajo, a.estado_empleo,
                 ags.servicio_id, ags.nombre AS servicio_nombre
            FROM personal p
            LEFT JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
            LEFT JOIN agentes_servicios ags ON ags.id = (
              SELECT id FROM agentes_servicios
               WHERE dni = p.dni AND deleted_at IS NULL AND fecha_hasta IS NULL
               ORDER BY id DESC LIMIT 1
            )
           WHERE ${where.join(' AND ')}
           ORDER BY p.apellido, p.nombre, p.dni`,
    replacements,
  };
}

async function ensureAdmsStructureTables(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS adms_device_structures (
      id INT NOT NULL AUTO_INCREMENT,
      sn VARCHAR(40) NOT NULL,
      reparticion_id INT NULL,
      servicio_id INT NULL,
      sector_id INT NULL,
      fecha_desde DATE NULL,
      fecha_hasta DATE NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_adms_device_structures_sn (sn),
      KEY idx_adms_device_structures_rep (reparticion_id),
      KEY idx_adms_device_structures_srv (servicio_id),
      KEY idx_adms_device_structures_sec (sector_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function deviceStructure(sn: string | null): Promise<any | null> {
  if (!sn) return null;
  await ensureAdmsStructureTables();
  const rows = await sequelize.query<any>(`
    SELECT ads.id, ads.sn, ads.reparticion_id, r.reparticion_nombre,
           ads.servicio_id, s.nombre AS servicio_nombre,
           ads.sector_id, sec.nombre AS sector_nombre,
           ads.fecha_desde, ads.fecha_hasta
      FROM adms_device_structures ads
      LEFT JOIN reparticiones r ON r.id = ads.reparticion_id
      LEFT JOIN servicios s ON s.id = ads.servicio_id
      LEFT JOIN sectores sec ON sec.id = ads.sector_id
     WHERE ads.sn = :sn AND ads.deleted_at IS NULL AND ads.fecha_hasta IS NULL
     ORDER BY ads.id DESC LIMIT 1
  `, { type: QueryTypes.SELECT, replacements: { sn } });
  return rows[0] ?? null;
}

async function structureFiltersForSn(sn: string | null): Promise<{ reparticionId?: number; servicioId?: number; sectorId?: number }> {
  const row = await deviceStructure(sn);
  return row ? {
    ...(row.reparticion_id ? { reparticionId: Number(row.reparticion_id) } : {}),
    ...(row.servicio_id ? { servicioId: Number(row.servicio_id) } : {}),
    ...(row.sector_id ? { sectorId: Number(row.sector_id) } : {}),
  } : {};
}

function fingerprintVersion(template: unknown): string {
  const tmp = String(template ?? '');
  if (!tmp) return '';
  return tmp.slice(0, 3) === 'oco' ? '9' : '10';
}

function isFingerprintCompatible(deviceFpVersion: unknown, template: unknown): boolean {
  const deviceVersion = String(deviceFpVersion ?? '').trim();
  if (!deviceVersion) return true;
  const templateVersion = fingerprintVersion(template);
  return !templateVersion || templateVersion === deviceVersion;
}

function commandFromAction(action: string, payload: any): string | null {
  const dni = asStringOrNull(payload?.dni);
  const fid = Number(payload?.fid ?? 0);
  const retry = Number(payload?.retry ?? 3);
  const password = asStringOrNull(payload?.password);
  const filename = asStringOrNull(payload?.filename);
  const content = asStringOrNull(payload?.content);
  const optionKey = asStringOrNull(payload?.optionKey);
  const optionValue = asStringOrNull(payload?.optionValue);
  switch (action) {
    case 'clear-data':
      return 'CLEAR DATA';
    case 'clear-log':
      return 'CLEAR LOG';
    case 'reset-pwd':
      if (!dni || !password) return null;
      return `RESET PWD PIN=${dni}\tPasswd=${password}`;
    case 'enroll-fp':
      if (!dni || !Number.isFinite(fid)) return null;
      return `ENROLL_FP PIN=${dni}\tFID=${fid}\tRETRY=${Number.isFinite(retry) ? retry : 3}\tOVERWRITE=0`;
    case 'unlock':
      return 'UNLOCK';
    case 'noalarm':
      return 'NOALARM';
    case 'check':
      return 'CHECK';
    case 'reboot':
      return 'REBOOT';
    case 'get-file':
      if (!filename) return null;
      return `GetFile FILENAME=${filename}`;
    case 'put-file':
      if (!filename || !content) return null;
      return `PutFile FILENAME=${filename}\tContent=${content}`;
    case 'shell':
      if (!content) return null;
      return `Shell ${content}`;
    case 'set-option':
      if (!optionKey || optionValue == null) return null;
      return `SET OPTION ${optionKey}=${optionValue}`;
    default:
      return null;
  }
}

function messageStartTime(value: unknown): string {
  return parseDateTimeParam(value) || mysqlNow();
}

function safeClockMessage(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 180);
}

const admsAudioUpload = multer({
  dest: path.resolve(process.cwd(), 'tmp'),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (allowedAudio(file.mimetype, file.originalname)) cb(null, true);
    else cb(new Error('Solo se aceptan audios mp3, wav, ogg o m4a'));
  },
});

function renderMessageTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => String(vars[key] ?? ''));
}

function clockMessageUid(): string {
  return String((Date.now() % 900_000_000) + 100_000_000);
}

export function buildSmsCommands(input: {
  formato: string;
  dni: string;
  mensaje: string;
  inicio: string;
  minutos: number;
  uid?: string;
}): string[] {
  const msg = safeClockMessage(input.mensaje);
  const uid = normalizeDni(input.uid) || clockMessageUid();
  switch (input.formato) {
    case 'idle':
      return [`DATA UPDATE SMS MSG=${msg}\tTAG=253\tUID=${uid}\tMIN=${input.minutos}\tStartTime=${input.inicio}`];
    case 'legacy':
      return [`SMS TAG=0xFE\tUID=${input.dni}\tMIN=${input.minutos}\tStartTime=${input.inicio}\tMSG=${msg}`];
    case 'privado':
    default:
      return [
        `DATA UPDATE SMS MSG=${msg}\tTAG=254\tUID=${uid}\tMIN=${input.minutos}\tStartTime=${input.inicio}`,
        `DATA UPDATE USER_SMS PIN=${input.dni}\tUID=${uid}`,
      ];
  }
}

export function registerFicheroAdmsRoutes<TConfig extends FicheroAdmsConfig>(
  router: Router,
  deps: FicheroAdmsDeps<TConfig>
): void {
  const { admin, cargarConfig, conectarMySQL, parsearDateLocal } = deps;

  router.get('/adms/comunicacion', admin, async (req: Request, res: Response) => {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    return res.json({ ok: true, data: getAdmsRuntimeEvents(limit) });
  });

  router.get('/adms/estructuras', admin, async (_req: Request, res: Response) => {
    await ensureAdmsStructureTables();
    const data = await sequelize.query<any>(`
      SELECT ads.id, ads.sn, ads.reparticion_id, r.reparticion_nombre,
             ads.servicio_id, s.nombre AS servicio_nombre,
             ads.sector_id, sec.nombre AS sector_nombre,
             ads.fecha_desde, ads.fecha_hasta, ads.created_at, ads.updated_at
        FROM adms_device_structures ads
        LEFT JOIN reparticiones r ON r.id = ads.reparticion_id
        LEFT JOIN servicios s ON s.id = ads.servicio_id
        LEFT JOIN sectores sec ON sec.id = ads.sector_id
       WHERE ads.deleted_at IS NULL
       ORDER BY ads.fecha_hasta IS NULL DESC, ads.updated_at DESC
    `, { type: QueryTypes.SELECT });
    const reparticiones = await sequelize.query<any>(
      `SELECT id, reparticion_nombre AS nombre FROM reparticiones WHERE deleted_at IS NULL ORDER BY reparticion_nombre`,
      { type: QueryTypes.SELECT }
    );
    return res.json({ ok: true, data, reparticiones });
  });

  router.put('/adms/estructuras/:sn', admin, async (req: Request, res: Response) => {
    const sn = asStringOrNull(req.params.sn);
    if (!sn) return res.status(400).json({ ok: false, error: 'sn es requerido' });
    await ensureAdmsStructureTables();
    const reparticionId = req.body?.reparticion_id ? Number(req.body.reparticion_id) : null;
    const servicioId = req.body?.servicio_id ? Number(req.body.servicio_id) : null;
    const sectorId = req.body?.sector_id ? Number(req.body.sector_id) : null;
    await sequelize.transaction(async t => {
      await sequelize.query(
        `UPDATE adms_device_structures SET fecha_hasta = CURDATE(), updated_at = NOW()
          WHERE sn = :sn AND deleted_at IS NULL AND fecha_hasta IS NULL`,
        { replacements: { sn }, transaction: t }
      );
      if (reparticionId || servicioId || sectorId) {
        await sequelize.query(
          `INSERT INTO adms_device_structures (sn, reparticion_id, servicio_id, sector_id, fecha_desde)
           VALUES (:sn, :reparticionId, :servicioId, :sectorId, CURDATE())`,
          { replacements: { sn, reparticionId, servicioId, sectorId }, transaction: t }
        );
      }
    });
    return res.json({ ok: true, data: await deviceStructure(sn) });
  });

  router.get('/adms/dispositivos-historial', admin, async (_req: Request, res: Response) => {
    const cfg = cargarConfig();
    const conn = await conectarMySQL(cfg);
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT SN, Alias, IPAddress, State, DelTag, LastActivity, FWVersion, UserCount, FPCount, TransactionCount
           FROM iclock ORDER BY DelTag, LastActivity DESC, Alias, SN`
      );
      const structures = await Promise.all(rows.map(r => deviceStructure(String(r.SN))));
      return res.json({ ok: true, data: rows.map((r, i) => ({
        sn: r.SN, alias: r.Alias || r.SN, ip: r.IPAddress || null, state: Number(r.State),
        deleted: Number(r.DelTag) === 1, lastActivity: r.LastActivity || null,
        firmware: r.FWVersion || null, usuarios: r.UserCount ?? null, huellas: r.FPCount ?? null,
        fichadas: r.TransactionCount ?? null, estructura: structures[i],
      })) });
    } finally {
      await conn.end();
    }
  });

  router.get('/adms/sync/reglas', admin, async (_req: Request, res: Response) => {
    return res.json({ ok: true, data: readAdmsSyncRules() });
  });

  router.get('/adms/audio', admin, async (_req: Request, res: Response) => {
    const config = readAdmsAudioConfig();
    return res.json({ ok: true, ...config });
  });

  router.post('/adms/audio/upload', admin, admsAudioUpload.single('file'), async (req: Request, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    try {
      if (!file) return res.status(400).json({ ok: false, error: 'Archivo requerido' });
      const audio = addAdmsAudioFile({
        tempPath: file.path,
        originalName: file.originalname,
        mime: file.mimetype,
        size: file.size,
        nombre: String(req.body?.nombre || '').trim(),
      });
      return res.json({ ok: true, data: audio });
    } catch (err: any) {
      if (file?.path) { try { fs.unlinkSync(file.path); } catch { /* noop */ } }
      return res.status(400).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get('/adms/audio/archivos/:id/play', admin, async (req: Request, res: Response) => {
    const found = audioFilePath(req.params.id);
    if (!found) return res.status(404).json({ ok: false, error: 'Audio no encontrado' });
    res.setHeader('Content-Type', found.file.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return fs.createReadStream(found.path).pipe(res);
  });

  router.post('/adms/audio/reglas', admin, async (req: Request, res: Response) => {
    try {
      const evento = String(req.body?.evento || 'entrada');
      if (!['entrada', 'salida', 'fichada'].includes(evento)) throw new Error('Evento invalido');
      const rule = upsertAdmsAudioRule({
        id: asStringOrNull(req.body?.id) || undefined,
        nombre: asStringOrNull(req.body?.nombre) || undefined,
        evento: evento as any,
        sn: asStringOrNull(req.body?.sn),
        dni: normalizeDni(req.body?.dni) || null,
        audioId: String(req.body?.audioId || ''),
        activo: req.body?.activo !== false,
        volumen: Number(req.body?.volumen ?? 0.8),
      });
      trackAction('adms_audio_regla_guardar', { id: rule.id, evento: rule.evento, sn: rule.sn, dni: rule.dni }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, data: rule });
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.delete('/adms/audio/reglas/:id', admin, async (req: Request, res: Response) => {
    const deleted = deleteAdmsAudioRule(req.params.id);
    return res.json({ ok: true, deleted });
  });

  router.get('/adms/audio/eventos', admin, async (req: Request, res: Response) => {
    const limit = clampInt(req.query.limit, 100, 1, 300);
    return res.json({ ok: true, data: getAdmsAttendanceAudioEvents(limit) });
  });

  router.get('/adms/mensajes/agentes', admin, async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim().toUpperCase();
    const limit = clampInt(req.query.limit, 50, 1, 100);
    const sn = asStringOrNull(req.query.sn);
    try {
      const estructura = await deviceStructure(sn);
      const personalQuery = personalSyncSql({ soloActivos: true, ...(await structureFiltersForSn(sn)) });
      const rows = await sequelize.query<PersonalSyncRow>(
        personalQuery.sql,
        { type: QueryTypes.SELECT, replacements: personalQuery.replacements }
      );
      const data = rows
        .map(row => {
          const dni = normalizeDni(row.dni);
          return {
            dni,
            nombre: personalToAdmsName(row),
            legajo: row.legajo ?? null,
            servicioId: row.servicio_id ?? null,
            servicioNombre: row.servicio_nombre ?? null,
          };
        })
        .filter(row => row.dni && (!q || row.dni.includes(q) || normalizedText(row.nombre).includes(q)))
        .slice(0, limit);
      return res.json({ ok: true, data, total: data.length });
    } catch (err: any) {
      return res.status(503).json({ ok: false, error: err?.message ?? String(err), data: [] });
    }
  });

  async function buildMessagePayload(req: Request, conn: Connection) {
    const sn = asStringOrNull(req.body?.sn);
    const dni = normalizeDni(req.body?.dni);
    const formato = ['privado', 'idle', 'legacy'].includes(String(req.body?.formato))
      ? String(req.body?.formato)
      : 'privado';
    const plantilla = String(req.body?.plantilla || req.body?.mensaje || '').trim();
    const tipo = String(req.body?.tipo || '').trim();
    const minutos = clampInt(req.body?.minutos, 60, 1, 1440);
    const inicio = messageStartTime(req.body?.inicio);
    if (!sn || !dni || !plantilla) throw new Error('sn, dni y mensaje/plantilla son requeridos');

    const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, Alias, IPAddress, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]);
    if (!devices.length) throw new Error(`Reloj ${sn} no encontrado`);
    const personalQuery = personalSyncSql({ soloActivos: true });
    const personalRows = await sequelize.query<PersonalSyncRow>(
      personalQuery.sql,
      { type: QueryTypes.SELECT, replacements: personalQuery.replacements }
    );
    const person = personalRows.find(row => normalizeDni(row.dni) === dni);
    if (!person) throw new Error(`Agente activo ${dni} no encontrado`);

    const [admsUsers] = await conn.query<RowDataPacket[]>(
      'SELECT userid, badgenumber, name FROM userinfo WHERE badgenumber = ? LIMIT 1',
      [dni]
    );
    const ficheroUser = await readDirectFicheroMessageUser(devices[0], dni);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const vars = {
      dni,
      nombre: personalToAdmsName(person),
      fecha: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      hora: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      reloj: devices[0].Alias || devices[0].SN,
      tipo,
      servicio: person.servicio_nombre || '',
      legajo: person.legajo ?? '',
    };
    const mensaje = safeClockMessage(renderMessageTemplate(plantilla, vars));
    const mensajeUid = clockMessageUid();
    const comandos = buildSmsCommands({ formato, dni, mensaje, inicio, minutos, uid: mensajeUid });
    return {
      sn,
      dni,
      formato,
      plantilla,
      mensaje,
      inicio,
      minutos,
      tipo,
      comando: comandos.join('\n'),
      comandos,
      mensajeUid,
      pushVersion: devices[0].PushVersion,
      agente: {
        dni,
        nombre: vars.nombre,
        legajo: person.legajo ?? null,
        servicioId: person.servicio_id ?? null,
        servicioNombre: person.servicio_nombre ?? null,
        registradoAdms: !!admsUsers.length,
        registradoFichero: true,
        uidFichero: ficheroUser.uid,
        nombreFichero: ficheroUser.nombre || null,
      },
      reloj: { sn, alias: devices[0].Alias || sn, ip: devices[0].IPAddress || null },
    };
  }

  router.post('/adms/mensajes/preview', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const payload = await buildMessagePayload(req, conn);
      await conn.end();
      conn = null;
      return res.json({ ok: true, ...payload });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(400).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/mensajes/enviar', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const payload = await buildMessagePayload(req, conn);
      const ids: number[] = [];
      for (const comando of payload.comandos) {
        ids.push(await appendDeviceCommand(conn, payload.sn, comando, payload.pushVersion));
      }
      await conn.end();
      conn = null;
      (res.locals as any).audit = { action: 'adms_mensaje_enviar', table_name: 'devcmds', record_pk: ids.join(','), request_json: { sn: payload.sn, dni: payload.dni, formato: payload.formato, minutos: payload.minutos, mensaje: payload.mensaje, comandos: payload.comandos } };
      trackAction('adms_mensaje_enviar', { sn: payload.sn, dni: payload.dni, formato: payload.formato, ids }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, ids, total: ids.length, ...payload });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(400).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get('/adms/status', admin, async (_req: Request, res: Response) => {
    const cfg = cargarConfig();
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const tables = ['iclock', 'userinfo', 'checkinout', 'devcmds', 'devlog', 'oplog', 'template', 'biotemplate', 'departments'];
      const placeholders = tables.map(() => '?').join(',');
      const [tableRows] = await conn.query<RowDataPacket[]>(
        `SELECT TABLE_NAME AS tableName, TABLE_ROWS AS approxRows
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})
          ORDER BY TABLE_NAME`,
        [cfg.mysqlDb, ...tables]
      );
      const present = new Set(tableRows.map(r => String(r.tableName)));

      const [summaryRows] = await conn.query<RowDataPacket[]>(
        `SELECT
           (SELECT COUNT(1) FROM iclock) AS dispositivos,
           (SELECT COUNT(1) FROM userinfo) AS personas,
           (SELECT COUNT(1) FROM checkinout) AS fichadas,
           (SELECT COUNT(1) FROM devcmds WHERE CmdOverTime IS NULL) AS comandosPendientes,
           (SELECT MIN(checktime) FROM checkinout) AS primeraFichada,
           (SELECT MAX(checktime) FROM checkinout) AS ultimaFichada`
      );
      await conn.end();
      conn = null;

      return res.json({
        ok: true,
        database: cfg.mysqlDb,
        host: cfg.mysqlHost,
        port: cfg.mysqlPort,
        tables: tables.map(name => {
          const row = tableRows.find(r => String(r.tableName) === name);
          return { name, exists: present.has(name), approxRows: row?.approxRows ?? null };
        }),
        summary: summaryRows[0] ?? {},
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get('/adms/relectura/preview', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.query.sn);
    const desde = parseDateTimeParam(req.query.desde);
    const hasta = parseDateTimeParam(req.query.hasta, true);
    if (!sn || !desde || !hasta) return res.status(400).json({ ok: false, error: 'sn, desde y hasta son requeridos' });
    if (desde > hasta) return res.status(400).json({ ok: false, error: 'desde no puede ser mayor que hasta' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>(
        `SELECT SN, Alias, LogStamp, LastActivity, TransactionCount, PushVersion
           FROM iclock
          WHERE SN = ?
          LIMIT 1`,
        [sn]
      );
      if (!devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });

      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(1) AS total, MIN(ci.checktime) AS primera, MAX(ci.checktime) AS ultima
           FROM checkinout ci
           INNER JOIN userinfo ui ON ui.userid = ci.userid
          WHERE ci.SN = ?
            AND ci.checktime >= ?
            AND ci.checktime <= ?`,
        [sn, desde, hasta]
      );
      const [sampleRows] = await conn.query<RowDataPacket[]>(
        `SELECT ui.badgenumber, ui.name, ci.checktime, ci.checktype, ci.verifycode
           FROM checkinout ci
           INNER JOIN userinfo ui ON ui.userid = ci.userid
          WHERE ci.SN = ?
            AND ci.checktime >= ?
            AND ci.checktime <= ?
          ORDER BY ci.checktime DESC
          LIMIT 20`,
        [sn, desde, hasta]
      );
      await conn.end();
      conn = null;

      const device = devices[0];
      const stampActual = Number(device.LogStamp ?? 0) || 0;
      return res.json({
        ok: true,
        target: {
          sn: device.SN,
          alias: device.Alias || device.SN,
          lastActivity: device.LastActivity || null,
          transactionCount: device.TransactionCount ?? null,
          pushVersion: device.PushVersion ?? null,
        },
        rango: { desde, hasta },
        stamp: {
          actual: stampActual,
          propuesto: stampActual,
          margen: 0,
        },
        db: {
          totalEnRango: Number(countRows[0]?.total ?? 0),
          primera: countRows[0]?.primera ?? null,
          ultima: countRows[0]?.ultima ?? null,
          muestras: sampleRows.map(row => ({
            dni: row.badgenumber,
            nombre: row.name || '',
            fechaHora: row.checktime,
            tipo: String(row.checktype) === '0' ? 'entrada' : 'salida',
            verifycode: row.verifycode ?? null,
          })),
        },
        advertencia: 'Relectura por fechas: al aplicar no se borra nada de la DB. Se envia al reloj DATA QUERY ATTLOG para ese rango; las fichadas ya existentes se ignoran por clave unica y solo entran datos nuevos.',
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get('/adms/relojes/cruce', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const snA = asStringOrNull(req.query.snA);
    const snB = asStringOrNull(req.query.snB);
    const desde = parseDateTimeParam(req.query.desde);
    const hasta = parseDateTimeParam(req.query.hasta, true);
    const servicioId = req.query.servicio_id ? clampInt(req.query.servicio_id, 0, 0, 999999) : null;
    const limit = clampInt(req.query.limit, 200, 1, 1000);
    if (!snA || !snB || !desde || !hasta) return res.status(400).json({ ok: false, error: 'snA, snB, desde y hasta son requeridos' });
    if (snA === snB) return res.status(400).json({ ok: false, error: 'ElegÃ­ dos relojes distintos' });
    if (desde > hasta) return res.status(400).json({ ok: false, error: 'desde no puede ser mayor que hasta' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      const autoFilters = servicioId ? {} : { ...(await structureFiltersForSn(snA)), ...(await structureFiltersForSn(snB)) };
      const personalQuery = personalSyncSql({ servicioId, soloActivos: true, ...autoFilters });
      const personalRows = await sequelize.query<PersonalSyncRow>(
        personalQuery.sql,
        { type: QueryTypes.SELECT, replacements: personalQuery.replacements }
      );

      const activosByDni = new Map<string, { dni: string; nombre: string; servicioId: number | null; servicioNombre: string | null }>();
      for (const row of personalRows) {
        const dni = normalizeDni(row.dni);
        if (!dni || activosByDni.has(dni)) continue;
        activosByDni.set(dni, {
          dni,
          nombre: personalToAdmsName(row),
          servicioId: row.servicio_id ?? null,
          servicioNombre: row.servicio_nombre ?? null,
        });
      }

      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias FROM iclock WHERE SN IN (?, ?)',
        [snA, snB]
      );
      const deviceMap = new Map(devices.map(d => [String(d.SN), String(d.Alias || d.SN)]));
      if (!deviceMap.has(snA) || !deviceMap.has(snB)) return res.status(404).json({ ok: false, error: 'Uno de los relojes no existe en ADMS' });

      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT ui.badgenumber, ci.SN, COUNT(1) AS marcas,
                MIN(ci.checktime) AS primera, MAX(ci.checktime) AS ultima
           FROM checkinout ci
           INNER JOIN userinfo ui ON ui.userid = ci.userid
          WHERE ci.SN IN (?, ?)
            AND ci.checktime >= ?
            AND ci.checktime <= ?
          GROUP BY ui.badgenumber, ci.SN`,
        [snA, snB, desde, hasta]
      );
      await conn.end();
      conn = null;

      const marcaByDni = new Map<string, { a?: RowDataPacket; b?: RowDataPacket }>();
      for (const row of rows) {
        const dni = normalizeDni(row.badgenumber);
        if (!dni || !activosByDni.has(dni)) continue;
        const slot = marcaByDni.get(dni) || {};
        if (row.SN === snA) slot.a = row;
        if (row.SN === snB) slot.b = row;
        marcaByDni.set(dni, slot);
      }

      const onlyA: any[] = [];
      const onlyB: any[] = [];
      const ambos: any[] = [];
      const ninguno: any[] = [];
      for (const person of activosByDni.values()) {
        const marks = marcaByDni.get(person.dni) || {};
        const base = {
          ...person,
          marcasA: Number(marks.a?.marcas ?? 0),
          marcasB: Number(marks.b?.marcas ?? 0),
          primeraA: marks.a?.primera ?? null,
          ultimaA: marks.a?.ultima ?? null,
          primeraB: marks.b?.primera ?? null,
          ultimaB: marks.b?.ultima ?? null,
        };
        if (marks.a && marks.b) ambos.push(base);
        else if (marks.a) onlyA.push(base);
        else if (marks.b) onlyB.push(base);
        else ninguno.push(base);
      }

      return res.json({
        ok: true,
        rango: { desde, hasta },
        relojes: {
          a: { sn: snA, alias: deviceMap.get(snA) || snA },
          b: { sn: snB, alias: deviceMap.get(snB) || snB },
        },
        filtros: { servicioId, soloActivos: true },
        resumen: {
          activos: activosByDni.size,
          soloA: onlyA.length,
          soloB: onlyB.length,
          ambos: ambos.length,
          ninguno: ninguno.length,
        },
        soloA: onlyA.slice(0, limit),
        soloB: onlyB.slice(0, limit),
        ambos: ambos.slice(0, limit),
        ninguno: ninguno.slice(0, limit),
        limit,
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/relectura/apply', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const desde = parseDateTimeParam(req.body?.desde);
    const hasta = parseDateTimeParam(req.body?.hasta, true);
    const confirmacion = String(req.body?.confirmacion ?? '').trim().toUpperCase();
    if (!sn || !desde || !hasta) return res.status(400).json({ ok: false, error: 'sn, desde y hasta son requeridos' });
    if (desde > hasta) return res.status(400).json({ ok: false, error: 'desde no puede ser mayor que hasta' });
    if (confirmacion !== 'RELEER') return res.status(400).json({ ok: false, error: 'confirmacion RELEER requerida' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias, LogStamp, PushVersion FROM iclock WHERE SN = ? LIMIT 1',
        [sn]
      );
      if (!devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });
      const stampAnterior = Number(devices[0].LogStamp ?? 0) || 0;
      const [beforeRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(1) AS total
           FROM checkinout
          WHERE SN = ?
            AND checktime >= ?
            AND checktime <= ?`,
        [sn, desde, hasta]
      );
      const queryCommand = `DATA QUERY ATTLOG StartTime=${desde}\tEndTime=${hasta}`;
      const queryId = await appendDeviceCommand(conn, sn, queryCommand, devices[0].PushVersion);
      await conn.end();
      conn = null;
      const existentesAntes = Number(beforeRows[0]?.total ?? 0);

      (res.locals as any).audit = {
        action: 'adms_relectura_apply',
        table_name: 'devcmds',
        record_pk: sn,
        request_json: { sn, desde, hasta, existentesAntes, comando: queryCommand, queryId },
      };
      trackAction('adms_relectura_apply', { sn, desde, hasta, existentesAntes, comando: queryCommand, queryId }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, sn, desde, hasta, existentesAntes, borradas: 0, stampAnterior, stampNuevo: stampAnterior, comando: queryCommand, ids: [queryId], total: 1 });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get('/adms/fichadas/borrado/preview', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.query.sn);
    const desde = parseDateTimeParam(req.query.desde);
    const hasta = parseDateTimeParam(req.query.hasta, true);
    const dni = asStringOrNull(req.query.dni);
    const tipo = asStringOrNull(req.query.tipo);
    if (!sn || !desde || !hasta) return res.status(400).json({ ok: false, error: 'sn, desde y hasta son requeridos' });
    if (desde > hasta) return res.status(400).json({ ok: false, error: 'desde no puede ser mayor que hasta' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias, LastActivity, TransactionCount, PushVersion FROM iclock WHERE SN = ? LIMIT 1',
        [sn]
      );
      if (!devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });

      const where = ['ci.SN = ?', 'ci.checktime >= ?', 'ci.checktime <= ?'];
      const params: Array<string | number> = [sn, desde, hasta];
      const dniNorm = dni ? normalizeDni(dni) : '';
      if (dniNorm) {
        where.push('ui.badgenumber = ?');
        params.push(dniNorm);
      }
      if (tipo === 'entrada') {
        where.push('ci.checktype = 0');
      } else if (tipo === 'salida') {
        where.push('ci.checktype <> 0');
      }
      const whereSql = `WHERE ${where.join(' AND ')}`;

      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(1) AS total, MIN(ci.checktime) AS primera, MAX(ci.checktime) AS ultima
           FROM checkinout ci
           INNER JOIN userinfo ui ON ui.userid = ci.userid
           ${whereSql}`,
        params
      );
      const [sampleRows] = await conn.query<RowDataPacket[]>(
        `SELECT ui.badgenumber, ui.name, ci.checktime, ci.checktype, ci.verifycode
           FROM checkinout ci
           INNER JOIN userinfo ui ON ui.userid = ci.userid
           ${whereSql}
          ORDER BY ci.checktime DESC
          LIMIT 20`,
        params
      );
      await conn.end();
      conn = null;

      const device = devices[0];
      return res.json({
        ok: true,
        target: {
          sn: device.SN,
          alias: device.Alias || device.SN,
          lastActivity: device.LastActivity || null,
          transactionCount: device.TransactionCount ?? null,
          pushVersion: device.PushVersion ?? null,
        },
        filtros: { sn, desde, hasta, dni: dniNorm || null, tipo: tipo || null },
        db: {
          totalEnRango: Number(countRows[0]?.total ?? 0),
          primera: countRows[0]?.primera ?? null,
          ultima: countRows[0]?.ultima ?? null,
          muestras: sampleRows.map(row => ({
            dni: row.badgenumber,
            nombre: row.name || '',
            fechaHora: row.checktime,
            tipo: String(row.checktype) === '0' ? 'entrada' : 'salida',
            verifycode: row.verifycode ?? null,
          })),
        },
        advertencia: 'Borrado del fichero fisico: no borra nada de la DB. Encola DATA DELETE ATTLOG al reloj. Es irreversible en el reloj y depende de que el firmware soporte los filtros enviados.',
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/fichadas/borrado/apply', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const desde = parseDateTimeParam(req.body?.desde);
    const hasta = parseDateTimeParam(req.body?.hasta, true);
    const dni = asStringOrNull(req.body?.dni);
    const tipo = asStringOrNull(req.body?.tipo);
    const confirmacion = String(req.body?.confirmacion ?? '').trim().toUpperCase();
    if (!sn || !desde || !hasta) return res.status(400).json({ ok: false, error: 'sn, desde y hasta son requeridos' });
    if (desde > hasta) return res.status(400).json({ ok: false, error: 'desde no puede ser mayor que hasta' });
    if (confirmacion !== 'BORRAR FICHAJES') return res.status(400).json({ ok: false, error: 'confirmacion BORRAR FICHAJES requerida' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias, PushVersion FROM iclock WHERE SN = ? LIMIT 1',
        [sn]
      );
      if (!devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });

      const where = ['ci.SN = ?', 'ci.checktime >= ?', 'ci.checktime <= ?'];
      const params: Array<string | number> = [sn, desde, hasta];
      const dniNorm = dni ? normalizeDni(dni) : '';
      if (dniNorm) {
        where.push('ui.badgenumber = ?');
        params.push(dniNorm);
      }
      if (tipo === 'entrada') {
        where.push('ci.checktype = 0');
      } else if (tipo === 'salida') {
        where.push('ci.checktype <> 0');
      }
      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(1) AS total
           FROM checkinout ci
           INNER JOIN userinfo ui ON ui.userid = ci.userid
          WHERE ${where.join(' AND ')}`,
        params
      );

      const parts = [`DATA DELETE ATTLOG StartTime=${desde}`, `EndTime=${hasta}`];
      if (dniNorm) parts.push(`PIN=${dniNorm}`);
      if (tipo === 'entrada') parts.push('CheckType=0');
      if (tipo === 'salida') parts.push('CheckType=1');
      const command = parts.join('\t');
      const id = await appendDeviceCommand(conn, sn, command, devices[0].PushVersion);
      await conn.end();
      conn = null;

      const estimadas = Number(countRows[0]?.total ?? 0);
      (res.locals as any).audit = {
        action: 'adms_borrar_fichajes_fichero',
        table_name: 'devcmds',
        record_pk: String(id),
        request_json: { sn, desde, hasta, dni: dniNorm || null, tipo: tipo || null, estimadas, comando: command },
      };
      trackAction('adms_borrar_fichajes_fichero', { sn, desde, hasta, dni: dniNorm || null, tipo: tipo || null, estimadas, comando: command, id }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, ids: [id], total: 1, estimadas, comando: command });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get('/adms/dispositivos', admin, async (_req: Request, res: Response) => {
    const cfg = cargarConfig();
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT SN, Alias, LastActivity, State, IPAddress, FWVersion, UserCount, FPCount, TransactionCount, PushVersion
           FROM iclock
          WHERE DelTag IS NULL OR DelTag = 0
          ORDER BY LastActivity DESC, Alias, SN`
      );
      await conn.end();
      conn = null;

      const protocolResults = await Promise.all(rows.map(async (r) => {
        const ip = String(r.IPAddress || '').trim();
        if (!ip || ip === '::1' || ip === '127.0.0.1') {
          return { sn: String(r.SN), online: null as boolean | null, latencyMs: null as number | null, error: null as string | null };
        }
        const result = await checkZkProtocol(ip, 1500);
        return { sn: String(r.SN), online: result.online, latencyMs: result.latencyMs, error: result.error ?? null };
      }));
      const protocolBySn = new Map(protocolResults.map(r => [r.sn, r]));

      const data = rows.map(r => {
        const computed = admsEstadoFromLastActivity(r.LastActivity, parsearDateLocal);
        const protocol = protocolBySn.get(String(r.SN));
        const tcpOnline = protocol?.online ?? null;
        const estado = Number(r.State) === 0 ? 'pausado' : (tcpOnline === true ? 'online' : computed.estado);
        return {
          sn: r.SN,
          alias: r.Alias || r.SN,
          ip: r.IPAddress || null,
          estado,
          admsEstado: computed.estado,
          tcpOnline,
          tcpLatencyMs: protocol?.latencyMs ?? null,
          protocolOnline: tcpOnline,
          protocolLatencyMs: protocol?.latencyMs ?? null,
          protocolError: protocol?.error ?? null,
          lastActivity: r.LastActivity || null,
          segundosSinActividad: computed.segundosSinActividad,
          firmware: r.FWVersion || null,
          usuarios: r.UserCount ?? null,
          huellas: r.FPCount ?? null,
          fichadas: r.TransactionCount ?? null,
          pushVersion: r.PushVersion ?? null,
        };
      });

      return res.json({ ok: true, data });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err), data: [] });
    }
  });

  router.get('/adms/fichadas', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, 500_000);
    const dni = asStringOrNull(req.query.dni);
    const sn = asStringOrNull(req.query.sn);
    const desde = parseDateParam(req.query.desde);
    const hasta = parseDateParam(req.query.hasta);
    const tipo = asStringOrNull(req.query.tipo);
    const where: string[] = ['(DelTag IS NULL OR DelTag = 0)'];
    const params: Array<string | number> = [];

    if (dni) {
      where.push('ui.badgenumber LIKE ?');
      params.push(`%${dni.replace(/[%_]/g, '')}%`);
    }
    if (sn) {
      where.push('ci.SN = ?');
      params.push(sn);
    }
    if (desde) {
      where.push('ci.checktime >= ?');
      params.push(`${desde} 00:00:00`);
    }
    if (hasta) {
      where.push('ci.checktime <= ?');
      params.push(`${hasta} 23:59:59`);
    }
    if (tipo === 'entrada') {
      where.push('ci.checktype = 0');
    } else if (tipo === 'salida') {
      where.push('ci.checktype <> 0');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(1) AS total
           FROM checkinout ci
           INNER JOIN userinfo ui ON ci.userid = ui.userid
           ${whereSql}`,
        params
      );
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT ci.id, ui.badgenumber, ui.name, ci.checktime, ci.checktype, ci.verifycode, ci.SN, ci.sensorid
           FROM checkinout ci
           INNER JOIN userinfo ui ON ci.userid = ui.userid
           ${whereSql}
          ORDER BY ci.checktime DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      await conn.end();
      conn = null;

      return res.json({
        ok: true,
        total: Number(countRows[0]?.total ?? 0),
        limit,
        offset,
        data: rows.map(r => ({
          id: r.id,
          dni: r.badgenumber,
          nombre: r.name || '',
          fechaHora: r.checktime,
          tipo: String(r.checktype) === '0' ? 'entrada' : 'salida',
          checktype: r.checktype,
          verifycode: r.verifycode ?? null,
          sn: r.SN ?? null,
          sensorid: r.sensorid ?? null,
        })),
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err), data: [], total: 0 });
    }
  });

  router.get('/adms/personas', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const limit = clampInt(req.query.limit, 50, 1, 100);
    const offset = clampInt(req.query.offset, 0, 0, 50_000);
    const q = asStringOrNull(req.query.q);
    const sn = asStringOrNull(req.query.sn);
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    let device: any = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>(
        sn
          ? 'SELECT SN, Alias, IPAddress FROM iclock WHERE SN = ? LIMIT 1'
          : 'SELECT SN, Alias, IPAddress FROM iclock WHERE IPAddress IS NOT NULL AND IPAddress <> "" AND (DelTag IS NULL OR DelTag = 0) ORDER BY DelTag, LastActivity DESC, Alias, SN LIMIT 1',
        sn ? [sn] : []
      );
      await conn.end();
      conn = null;

      if (!devices.length) return res.status(404).json({ ok: false, error: sn ? `Reloj ${sn} no encontrado` : 'No hay relojes con IP configurada', data: [], total: 0 });
      const rowDevice = devices[0];
      const ip = asStringOrNull(rowDevice.IPAddress);
      if (!ip) return res.status(400).json({ ok: false, error: `El reloj ${rowDevice.Alias || rowDevice.SN} no tiene IP registrada`, data: [], total: 0 });

      let ZKTeco: any;
      try {
        const mod: any = await import('zkteco-js' as any);
        ZKTeco = mod.default ?? mod;
      } catch {
        return res.status(503).json({ ok: false, error: 'zkteco-js no disponible', data: [], total: 0 });
      }

      device = new ZKTeco(ip, 4370, 8000, 8000);
      await device.createSocket();
      const result = await device.getUsers();
      try { await device.disconnect(); } catch { /* noop */ }
      device = null;

      const clean = normalizedText(q || '');
      const allRows = (Array.isArray(result?.data) ? result.data : [])
        .map((u: any) => ({
          userid: Number(u.uid ?? 0),
          dni: String(u.userId ?? u.uid ?? '').trim(),
          nombre: String(u.name ?? '').trim(),
          departamentoId: null,
          tarjeta: u.cardno == null || Number(u.cardno) === 0 ? null : String(u.cardno),
          privilegio: u.role == null ? null : Number(u.role),
          grupo: null,
          zonas: null,
          sn: String(rowDevice.SN),
          actualizado: null,
        }))
        .filter((u: any) => !clean || normalizedText(`${u.dni} ${u.nombre} ${u.userid}`).includes(clean))
        .sort((a: any, b: any) => Number(a.userid) - Number(b.userid));
      const rows = allRows.slice(offset, offset + limit);

      return res.json({
        ok: true,
        total: allRows.length,
        limit,
        offset,
        fuente: 'reloj',
        reloj: { sn: rowDevice.SN, alias: rowDevice.Alias || rowDevice.SN, ip },
        data: rows,
      });
    } catch (err: any) {
      if (device) { try { await device.disconnect(); } catch { /* noop */ } }
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err), data: [], total: 0 });
    }
  });

  router.get('/adms/huellas', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const q = asStringOrNull(req.query.q);
    const sn = asStringOrNull(req.query.sn);

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>(
        sn
          ? 'SELECT SN, Alias, IPAddress FROM iclock WHERE SN = ? LIMIT 1'
          : 'SELECT SN, Alias, IPAddress FROM iclock WHERE IPAddress IS NOT NULL AND IPAddress <> "" AND (DelTag IS NULL OR DelTag = 0) ORDER BY DelTag, LastActivity DESC, Alias, SN LIMIT 1',
        sn ? [sn] : []
      );
      await conn.end();
      conn = null;

      if (!devices.length) {
        return res.status(404).json({ ok: false, error: sn ? `Reloj ${sn} no encontrado` : 'No hay relojes con IP configurada', data: [], total: 0 });
      }

      let ZKTeco: any;
      try {
        const mod: any = await import('zkteco-js' as any);
        ZKTeco = mod.default ?? mod;
      } catch {
        return res.status(503).json({ ok: false, error: 'zkteco-js no disponible', data: [], total: 0 });
      }

      const direct = await readDirectFicheroBiometrics(ZKTeco, devices[0]);
      const clean = normalizedText(q || '');
      const filtered = direct.templates
        .filter(row => !clean || normalizedText(`${row.dni} ${row.nombre} ${row.uid} ${row.slot}`).includes(clean))
        .sort((a, b) => a.dni.localeCompare(b.dni, 'es') || a.slot - b.slot || a.uid - b.uid);
      const data = filtered.slice(0, limit).map(row => ({
        userid: row.uid,
        dni: row.dni,
        nombre: row.nombre,
        tipo: 'template',
        tipoLabel: 'Template',
        fingerId: row.slot,
        sn: row.sn,
        fichero: row.alias,
        version: row.version,
        size: row.size,
        valid: row.valid,
        fuente: 'tcp_fichero',
        compatible: [],
      }));

      return res.json({
        ok: true,
        fuente: 'tcp_fichero',
        total: filtered.length,
        reloj: direct.reloj,
        resumen: {
          usuarios: direct.usuarios.length,
          templates: direct.templates.length,
          bytesTemplates: direct.bytesTemplates,
        },
        dispositivos: [{ sn: direct.reloj.sn, alias: direct.reloj.alias, fpVersion: '' }],
        data,
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err), data: [], total: 0 });
    }
  });

  router.get('/adms/estado-biometrico', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const offset = clampInt(req.query.offset, 0, 0, 500_000);
    const q = asStringOrNull(req.query.q);
    const sn = asStringOrNull(req.query.sn);
    const estadoRaw = asStringOrNull(req.query.estado) ?? 'incompleto';
    const exportar = String(req.query.exportar ?? '') === 'csv';
    const estadosValidos = new Set(['todos', 'incompleto', 'no_existe', 'fuera_estructura', 'sin_biometria', 'solo_huella', 'solo_palma', 'solo_cara', 'ambas']);
    const estado = estadosValidos.has(estadoRaw) ? estadoRaw : 'incompleto';
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;

    try {
      conn = await conectarMySQL(cfg);
      await ensureBiotemplateTable(conn);
      const estructura = await deviceStructure(sn);
      const [devices] = await conn.query<RowDataPacket[]>(
        sn
          ? 'SELECT SN, Alias, IPAddress FROM iclock WHERE SN = ? LIMIT 1'
          : 'SELECT SN, Alias, IPAddress FROM iclock WHERE IPAddress IS NOT NULL AND IPAddress <> "" AND (DelTag IS NULL OR DelTag = 0) ORDER BY Alias, SN',
        sn ? [sn] : []
      );
      if (sn && !devices.length) {
        await conn.end();
        conn = null;
        return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado`, data: [], total: 0 });
      }

      let ZKTeco: any;
      try {
        const mod: any = await import('zkteco-js' as any);
        ZKTeco = mod.default ?? mod;
      } catch {
        await conn.end();
        conn = null;
        return res.status(503).json({ ok: false, error: 'zkteco-js no disponible', data: [], total: 0 });
      }

      const ficheroUsers: FicheroUserRow[] = [];
      for (const deviceRow of devices) {
        const ip = asStringOrNull(deviceRow.IPAddress);
        if (!ip) continue;
        let zk: any = null;
        try {
          zk = new ZKTeco(ip, 4370, 8000, 8000);
          await zk.createSocket();
          const result = await zk.getUsers();
          const users = Array.isArray(result?.data) ? result.data : [];
          for (const user of users) {
            const dni = normalizeDni(user?.userId ?? user?.uid);
            if (!dni) continue;
            ficheroUsers.push({
              userid: Number.isFinite(Number(user?.uid)) ? Number(user.uid) : null,
              dni,
              nombre: String(user?.name ?? '').trim(),
              sn: String(deviceRow.SN),
              alias: String(deviceRow.Alias || deviceRow.SN),
            });
          }
        } catch (err: any) {
          console.warn('[adms estado biometrico] no se pudo leer usuarios del fichero', { sn: deviceRow.SN, ip, error: err?.message });
        } finally {
          if (zk) { try { await zk.disconnect(); } catch { /* noop */ } }
        }
      }

      // Con fichero seleccionado se suma el plantel esperado por estructura.
      // Sin fichero, la tabla se arma solo con usuarios leidos directo de los relojes.
      const structFilters = await structureFiltersForSn(sn);
      const personalQuery = sn ? personalSyncSql({ soloActivos: true, ...structFilters }) : null;
      const personalRows = personalQuery
        ? await sequelize.query<PersonalSyncRow>(
            personalQuery.sql,
            { type: QueryTypes.SELECT, replacements: personalQuery.replacements }
          )
        : [];
      const personalActivos = new Map<string, { dni: string; nombre: string }>();
      for (const row of personalRows) {
        const dni = normalizeDni(row.dni);
        if (!dni || personalActivos.has(dni)) continue;
        personalActivos.set(dni, { dni, nombre: personalToAdmsName(row) });
      }

      // BioType: 1=huella (tabla template), 9=rostro/cara, 10=palma (tabla biotemplate).
      // Las cuentas se agrupan por SN para no mezclar biometria de otro fichero.
      const aggregateSql = `
        SELECT ui.userid, ui.badgenumber, ui.name, bio.SN,
               SUM(bio.huellas) AS huellas,
               SUM(bio.palmas) AS palmas,
               SUM(bio.caras) AS caras
          FROM userinfo ui
          JOIN (
            SELECT userid, SN, COUNT(1) AS huellas, 0 AS palmas, 0 AS caras
              FROM template
             WHERE Template IS NOT NULL AND (DelTag IS NULL OR DelTag = 0)
               AND SN IS NOT NULL AND SN <> ''
               AND (? IS NULL OR SN = ?)
             GROUP BY userid, SN
            UNION ALL
            SELECT userid, SN, 0 AS huellas, COUNT(1) AS palmas, 0 AS caras
              FROM biotemplate
             WHERE BioType = 10 AND Template IS NOT NULL AND (DelTag IS NULL OR DelTag = 0)
               AND SN IS NOT NULL AND SN <> ''
               AND (? IS NULL OR SN = ?)
             GROUP BY userid, SN
            UNION ALL
            SELECT userid, SN, 0 AS huellas, 0 AS palmas, COUNT(1) AS caras
              FROM biotemplate
             WHERE BioType = 9 AND Template IS NOT NULL AND (DelTag IS NULL OR DelTag = 0)
               AND SN IS NOT NULL AND SN <> ''
               AND (? IS NULL OR SN = ?)
             GROUP BY userid, SN
          ) bio ON bio.userid = ui.userid
         GROUP BY ui.userid, ui.badgenumber, ui.name, bio.SN
      `;
      const [admsRows] = await conn.query<RowDataPacket[]>(
        `SELECT bio.* FROM (${aggregateSql}) bio ORDER BY bio.badgenumber`,
        [sn, sn, sn, sn, sn, sn]
      );
      const bioByFicheroDni = new Map<string, RowDataPacket>();
      for (const row of admsRows) {
        const dni = normalizeDni(row.badgenumber);
        const rowSn = asStringOrNull(row.SN);
        if (dni && rowSn) bioByFicheroDni.set(`${rowSn}|${dni}`, row);
      }

      const ficheroByDni = new Map<string, FicheroUserRow>();
      for (const user of ficheroUsers) {
        if (!ficheroByDni.has(user.dni)) ficheroByDni.set(user.dni, user);
      }

      // Universo = union del plantel (por estructura) + usuarios que el reloj REALMENTE devuelve.
      // Asi se ven las dos caras: agentes del plantel que faltan cargar ("no existe"), y gente
      // cargada en el reloj que no pertenece al plantel ("fuera de estructura").
      const dniUniverse = new Set<string>(sn ? personalActivos.keys() : []);
      for (const user of ficheroUsers) dniUniverse.add(user.dni);
      const allRows = [...dniUniverse].map(dni => {
        const personal = personalActivos.get(dni);
        const fichero = ficheroByDni.get(dni);
        const rowSn = fichero?.sn || sn || null;
        const bio = rowSn ? bioByFicheroDni.get(`${rowSn}|${dni}`) : null;
        const enEstructura = sn ? !!personal : true;
        const huellas = Number(bio?.huellas ?? 0);
        const palmas = Number(bio?.palmas ?? 0);
        const caras = Number(bio?.caras ?? 0);
        const existe = !!fichero; // cargado en el reloj, leído directo del fichero
        const tipos = (huellas > 0 ? 1 : 0) + (palmas > 0 ? 1 : 0) + (caras > 0 ? 1 : 0);
        const estadoBiometrico = (!enEstructura && existe) ? 'fuera_estructura'
          : !existe ? 'no_existe'
          : tipos >= 2 ? 'ambas'
          : huellas > 0 ? 'solo_huella'
          : palmas > 0 ? 'solo_palma'
          : caras > 0 ? 'solo_cara'
          : 'sin_biometria';
        return {
          userid: fichero?.userid ?? (bio ? Number(bio.userid) : null),
          dni,
          nombre: personal?.nombre || fichero?.nombre || String(bio?.name ?? ''),
          sn: rowSn,
          enEstructura,
          existe,
          huellas,
          palmas,
          caras,
          estado: estadoBiometrico,
        };
      });
      // El universo ya viene acotado a los agentes del fichero (por estructura), o al padron
      // completo si no hay fichero. NO se filtra por "existe": los que estan en la estructura
      // pero no cargados en el reloj son justamente los que hay que dar de alta ("no existe en fichero").
      const universe = allRows;

      // "Que usa el reloj": el tipo de biometria mas enrolado en ese fichero (dato guardado en
      // template.SN / biotemplate.SN por reloj). Sin fichero no hay un unico requerido.
      const conHuella = universe.filter(row => row.huellas > 0).length;
      const conPalma  = universe.filter(row => row.palmas > 0).length;
      const conCara   = universe.filter(row => row.caras > 0).length;
      let requerido: 'huella' | 'palma' | 'cara' | null = null;
      if (sn) {
        const max = Math.max(conHuella, conPalma, conCara);
        requerido = max === 0 ? null
          : conHuella === max ? 'huella'
          : conPalma === max ? 'palma'
          : 'cara';
      }
      const tieneRequerido = (row: { huellas: number; palmas: number; caras: number }) =>
        requerido === 'huella' ? row.huellas > 0
        : requerido === 'palma' ? row.palmas > 0
        : requerido === 'cara' ? row.caras > 0
        : (row.huellas > 0 || row.palmas > 0 || row.caras > 0);
      // "Le falta" aplica solo al plantel: agente que deberia estar y no esta cargado, o esta
      // pero sin la biometria que el reloj usa. Los "fuera de estructura" no cuentan como falta.
      const faltaRequerido = (row: { enEstructura: boolean; existe: boolean; huellas: number; palmas: number; caras: number }) =>
        row.enEstructura && (!row.existe || !tieneRequerido(row));

      const resumen = {
        total: universe.filter(row => row.enEstructura).length,             // plantel (deberia estar)
        enReloj: universe.filter(row => row.enEstructura && row.existe).length, // del plantel, cargados
        noExiste: universe.filter(row => row.enEstructura && !row.existe).length, // del plantel, faltan cargar
        fueraEstructura: universe.filter(row => !row.enEstructura && row.existe).length, // cargados de mas
        sinBiometria: universe.filter(row => row.estado === 'sin_biometria').length,
        soloHuella: universe.filter(row => row.estado === 'solo_huella').length,
        soloPalma: universe.filter(row => row.estado === 'solo_palma').length,
        soloCara: universe.filter(row => row.estado === 'solo_cara').length,
        ambas: universe.filter(row => row.estado === 'ambas').length,
        conHuella,
        conPalma,
        conCara,
        faltaRequerido: universe.filter(faltaRequerido).length,
      };
      const cleanQ = q ? q.replace(/[%_]/g, '').toUpperCase() : '';
      const filteredRows = universe.filter(row =>
        (!cleanQ || row.dni.includes(cleanQ) || row.nombre.toUpperCase().includes(cleanQ))
        && (estado === 'todos' ? true
            : estado === 'incompleto' ? faltaRequerido(row)
            : row.estado === estado)
      );

      if (exportar) {
        await conn.end();
        conn = null;

        const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const csv = [
          ['DNI', 'Nombre', 'En plantel', 'Cargado en reloj', 'Fichero / reloj', 'Huellas', 'Palmas', 'Rostro', 'Estado', 'Le falta lo que usa el reloj'].map(csvCell).join(';'),
          ...filteredRows.map(row => {
            const tipos = (row.huellas > 0 ? 1 : 0) + (row.palmas > 0 ? 1 : 0) + (row.caras > 0 ? 1 : 0);
            const label = (!row.enEstructura && row.existe) ? 'Fuera de estructura'
              : !row.existe ? 'No existe en fichero'
              : tipos >= 2 ? 'Varias'
              : row.huellas > 0 ? 'Solo huella'
              : row.palmas > 0 ? 'Solo palma'
              : row.caras > 0 ? 'Solo rostro'
              : 'Sin biometría';
            return [row.dni, row.nombre, row.enEstructura ? 'Sí' : 'No', row.existe ? 'Sí' : 'No', row.sn || 'Sin asignar', row.huellas, row.palmas, row.caras, label, faltaRequerido(row) ? 'Sí' : 'No'].map(csvCell).join(';');
          }),
        ].join('\r\n');
        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="estado_biometrico_${sn || 'general'}_${date}.csv"`);
        return res.send(`\uFEFF${csv}`);
      }
      await conn.end();
      conn = null;
      const rows = filteredRows.slice(offset, offset + limit);
      const requeridoLabel = requerido === 'huella' ? 'Huella'
        : requerido === 'palma' ? 'Palma'
        : requerido === 'cara' ? 'Rostro'
        : null;
      return res.json({
        ok: true,
        alcance: sn ? 'fichero' : 'general',
        sn,
        estructura,
        estado,
        requerido,
        requeridoLabel,
        total: filteredRows.length,
        limit,
        offset,
        resumen: {
          ...resumen,
        },
        data: rows,
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err), data: [], total: 0 });
    }
  });

  router.get('/adms/cruces', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.query.sn);
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      const estructura = await deviceStructure(sn);
      const personalQuery = personalSyncSql({ soloActivos: false, ...(await structureFiltersForSn(sn)) });
      const [personalRows, admsRows] = await Promise.all([
        sequelize.query<PersonalSyncRow>(
          personalQuery.sql,
          { type: QueryTypes.SELECT, replacements: personalQuery.replacements }
        ),
        (async () => {
          conn = await conectarMySQL(cfg);
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT userid, badgenumber, name
               FROM userinfo
              WHERE badgenumber IS NOT NULL AND (? IS NULL OR SN = ?)`,
            [sn, sn]
          );
          await conn.end();
          conn = null;
          return rows;
        })(),
      ]);

      const personalByDni = new Map<string, { dni: string; nombre: string }>();
      for (const row of personalRows) {
        const dni = normalizeDni(row.dni);
        if (!dni) continue;
        personalByDni.set(dni, {
          dni,
          nombre: [row.apellido, row.nombre].filter(Boolean).join(', ') || '',
        });
      }

      const admsByDni = new Map<string, { userid: number; dni: string; nombre: string }>();
      for (const row of admsRows) {
        const dni = normalizeDni(row.badgenumber);
        if (!dni) continue;
        admsByDni.set(dni, {
          userid: Number(row.userid),
          dni,
          nombre: row.name || '',
        });
      }

      const soloAdms = [...admsByDni.values()]
        .filter(row => !personalByDni.has(row.dni))
        .slice(0, 100);
      const soloPersonal = [...personalByDni.values()]
        .filter(row => !admsByDni.has(row.dni))
        .slice(0, 100);

      return res.json({
        ok: true,
        sn,
        estructura,
        totalPersonal: personalByDni.size,
        totalAdms: admsByDni.size,
        coincidencias: [...admsByDni.keys()].filter(dni => personalByDni.has(dni)).length,
        soloAdmsTotal: [...admsByDni.keys()].filter(dni => !personalByDni.has(dni)).length,
        soloPersonalTotal: [...personalByDni.keys()].filter(dni => !admsByDni.has(dni)).length,
        soloAdms,
        soloPersonal,
        limit: 100,
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // Encola DATA DELETE USERINFO (+ FINGERTMP) hacia los relojes. No toca userinfo.
  router.post('/adms/cruces/borrar-userinfo', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const dnis: string[] = Array.isArray(req.body?.dnis) ? req.body.dnis.map(String).filter(Boolean) : [];
    const incluirHuellas: boolean = req.body?.incluirHuellas !== false;
    const sn = asStringOrNull(req.body?.sn);
    if (!dnis.length) return res.status(400).json({ ok: false, error: 'dnis es requerido' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>(
        sn
          ? 'SELECT SN, PushVersion FROM iclock WHERE SN = ? LIMIT 1'
          : 'SELECT SN, PushVersion FROM iclock WHERE DelTag IS NULL OR DelTag = 0 ORDER BY Alias, SN',
        sn ? [sn] : []
      );
      if (!devices.length) {
        await conn.end();
        conn = null;
        return res.status(404).json({ ok: false, error: sn ? `Reloj ${sn} no encontrado` : 'No hay relojes ADMS activos' });
      }

      const placeholders = dnis.map(() => '?').join(',');
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT badgenumber FROM userinfo WHERE badgenumber IN (${placeholders})`,
        dnis
      );
      const existentes = new Set(rows.map(r => String(r.badgenumber)));
      const omitidos = dnis.filter(dni => !existentes.has(dni));

      const ids: number[] = [];
      for (const dni of dnis) {
        if (!existentes.has(dni)) continue;
        for (const device of devices) {
          ids.push(await appendDeviceCommand(conn, device.SN, `DATA DELETE USERINFO PIN=${dni}`, device.PushVersion));
          if (incluirHuellas) {
            ids.push(await appendDeviceCommand(conn, device.SN, `DATA DELETE FINGERTMP PIN=${dni}`, device.PushVersion));
          }
        }
      }
      await conn.end();
      conn = null;
      (res.locals as any).audit = {
        action: 'adms_cruces_borrar_usuarios_relojes',
        table_name: 'devcmds',
        record_pk: ids.join(','),
        request_json: { dnis, incluirHuellas, sn, relojes: devices.length, omitidos },
      };
      trackAction('adms_cruces_borrar_usuarios_relojes', { dnis, incluirHuellas, sn, relojes: devices.length, comandos: ids.length, omitidos }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, encolados: existentes.size ? dnis.length - omitidos.length : 0, comandos: ids, relojes: devices.length, omitidos });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get('/adms/sync/preview', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.query.sn);
    const limit = clampInt(req.query.limit, 200, 1, 1000);
    const servicioId = req.query.servicio_id ? clampInt(req.query.servicio_id, 0, 0, 999999) : null;
    const soloActivos = req.query.solo_activos !== '0';
    const options = admsSyncOptions(req.query);
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const ruleSns = !sn ? targetSnRulesForService(servicioId) : [];
      const rulePlaceholders = ruleSns.map(() => '?').join(',');
      const [devices] = await conn.query<RowDataPacket[]>(
        sn
          ? 'SELECT SN, Alias, PushVersion, FPVersion FROM iclock WHERE SN = ? LIMIT 1'
          : ruleSns.length
            ? `SELECT SN, Alias, PushVersion, FPVersion FROM iclock WHERE SN IN (${rulePlaceholders}) AND (DelTag IS NULL OR DelTag = 0) ORDER BY Alias, SN`
            : 'SELECT SN, Alias, PushVersion, FPVersion FROM iclock WHERE DelTag IS NULL OR DelTag = 0 ORDER BY Alias, SN',
        sn ? [sn] : ruleSns
      );
      if (sn && !devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });

      const personalQuery = personalSyncSql({ servicioId, soloActivos, ...(!servicioId ? await structureFiltersForSn(sn) : {}) });
      const [personalRows, admsRows] = await Promise.all([
        sequelize.query<PersonalSyncRow>(
          personalQuery.sql,
          { type: QueryTypes.SELECT, replacements: personalQuery.replacements }
        ),
        conn.query<RowDataPacket[]>(
          `SELECT userid, badgenumber, name
             FROM userinfo
            WHERE badgenumber IS NOT NULL`
        ).then(([rows]) => rows),
      ]);

      const admsByDni = new Map<string, { userid: number; dni: string; nombre: string }>();
      for (const row of admsRows) {
        const dni = normalizeDni(row.badgenumber);
        if (!dni) continue;
        admsByDni.set(dni, { userid: Number(row.userid), dni, nombre: row.name || '' });
      }

      const crear: Array<{ dni: string; nombre: string; tarjeta: string; comandos: number }> = [];
      const actualizar: Array<{ dni: string; actual: string; esperado: string; tarjeta: string; comandos: number }> = [];
      const bajas: Array<{ userid: number; dni: string; nombre: string; comandos: number }> = [];
      const vistos = new Set<string>();
      for (const row of personalRows) {
        const dni = normalizeDni(row.dni);
        if (!dni || vistos.has(dni)) continue;
        vistos.add(dni);
        const nombreAdms = personalToAdmsName(row);
        const adms = admsByDni.get(dni);
        if (!adms) {
          crear.push({ dni, nombre: nombreAdms, tarjeta: cardForPersonal(row, options, dni), comandos: devices.length });
        } else if (normalizedText(adms.nombre) !== normalizedText(nombreAdms)) {
          actualizar.push({ dni, actual: adms.nombre, esperado: nombreAdms, tarjeta: cardForPersonal(row, options, dni), comandos: devices.length });
        }
      }

      const soloAdms = [...admsByDni.values()].filter(row => !vistos.has(row.dni));
      for (const row of soloAdms) bajas.push({ ...row, comandos: devices.length });
      await conn.end();
      conn = null;

      return res.json({
        ok: true,
        target: { sn: sn || null, dispositivos: devices.map(d => ({ sn: d.SN, alias: d.Alias || d.SN })) },
        resumen: {
          personal: vistos.size,
          adms: admsByDni.size,
          dispositivos: devices.length,
          crear: crear.length,
          actualizar: actualizar.length,
          soloAdms: soloAdms.length,
          bajas: bajas.length,
          comandosEstimados: (crear.length + actualizar.length) * devices.length,
          comandosBajaEstimados: bajas.length * devices.length,
        },
        filtros: { servicioId, soloActivos, options, reglasDestino: ruleSns },
        crear: crear.slice(0, limit),
        actualizar: actualizar.slice(0, limit),
        soloAdms: bajas.slice(0, limit),
        limit,
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/sync/apply', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const limit = clampInt(req.body?.limit, 100, 1, 500);
    const servicioId = req.body?.servicio_id ? clampInt(req.body.servicio_id, 0, 0, 999999) : null;
    const soloActivos = req.body?.solo_activos !== false;
    const includeCreates = req.body?.crear !== false;
    const includeUpdates = req.body?.actualizar !== false;
    const includeBajas = req.body?.bajas === true;
    const incluirHuellas = req.body?.huellas === true;
    const options = admsSyncOptions(req.body);
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const ruleSns = !sn ? targetSnRulesForService(servicioId) : [];
      const rulePlaceholders = ruleSns.map(() => '?').join(',');
      const [devices] = await conn.query<RowDataPacket[]>(
        sn
          ? 'SELECT SN, Alias, PushVersion, FPVersion FROM iclock WHERE SN = ? LIMIT 1'
          : ruleSns.length
            ? `SELECT SN, Alias, PushVersion, FPVersion FROM iclock WHERE SN IN (${rulePlaceholders}) AND (DelTag IS NULL OR DelTag = 0) ORDER BY Alias, SN`
            : 'SELECT SN, Alias, PushVersion, FPVersion FROM iclock WHERE DelTag IS NULL OR DelTag = 0 ORDER BY Alias, SN',
        sn ? [sn] : ruleSns
      );
      if (!devices.length) return res.status(404).json({ ok: false, error: sn ? `Reloj ${sn} no encontrado` : 'No hay relojes ADMS' });

      const personalQuery = personalSyncSql({ servicioId, soloActivos, ...(!servicioId ? await structureFiltersForSn(sn) : {}) });
      const personalRows = await sequelize.query<PersonalSyncRow>(
        personalQuery.sql,
        { type: QueryTypes.SELECT, replacements: personalQuery.replacements }
      );
      const [admsRows] = await conn.query<RowDataPacket[]>(
        `SELECT userid, badgenumber, name
           FROM userinfo
          WHERE badgenumber IS NOT NULL`
      );

      const admsByDni = new Map<string, { userid: number; dni: string; nombre: string }>();
      for (const row of admsRows) {
        const dni = normalizeDni(row.badgenumber);
        if (!dni) continue;
        admsByDni.set(dni, { userid: Number(row.userid), dni, nombre: row.name || '' });
      }

      const ids: number[] = [];
      let creados = 0;
      let actualizados = 0;
      let bajas = 0;
      let huellas = 0;
      let huellasOmitidas = 0;
      const vistos = new Set<string>();
      for (const row of personalRows) {
        if (creados + actualizados >= limit) break;
        const dni = normalizeDni(row.dni);
        if (!dni || vistos.has(dni)) continue;
        vistos.add(dni);
        const nombreAdms = personalToAdmsName(row);
        const adms = admsByDni.get(dni);
        const shouldCreate = includeCreates && !adms;
        const shouldUpdate = includeUpdates && !!adms && normalizedText(adms.nombre) !== normalizedText(nombreAdms);
        if (!shouldCreate && !shouldUpdate) continue;

        if (shouldCreate) {
          await conn.query(
            `INSERT INTO userinfo (badgenumber, name, defaultdeptid, Card, Privilege, AccGroup, TimeZones, SN, UTime, DelTag)
             VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 0)`,
            [dni, nombreAdms || ' ', cardForPersonal(row, options, dni), options.privilege, options.group, options.timezone, devices[0].SN, mysqlNow()]
          );
          creados++;
        } else if (shouldUpdate) {
          await conn.query(
            `UPDATE userinfo SET name = ?, Card = ?, Privilege = ?, AccGroup = ?, TimeZones = ?, UTime = ? WHERE userid = ?`,
            [nombreAdms || ' ', cardForPersonal(row, options, dni), options.privilege, options.group, options.timezone, mysqlNow(), adms!.userid]
          );
          actualizados++;
        }

        for (const device of devices) {
          ids.push(await appendDeviceCommand(conn, device.SN, personalUserCommand({ ...row, dniText: dni, nombreAdms }, options), device.PushVersion));
        }

        if (incluirHuellas) {
          const [users] = await conn.query<RowDataPacket[]>('SELECT userid FROM userinfo WHERE badgenumber = ? LIMIT 1', [dni]);
          const userid = users[0]?.userid;
          if (userid) {
            const [templates] = await conn.query<RowDataPacket[]>(
              `SELECT FingerID, Template
                 FROM template
                WHERE userid = ? AND (DelTag IS NULL OR DelTag = 0) AND Template IS NOT NULL`,
              [userid]
            );
            for (const fp of templates) {
              const tmp = String(fp.Template || '').replace(/\r?\n/g, '');
              for (const device of devices) {
                if (!isFingerprintCompatible(device.FPVersion, tmp)) {
                  huellasOmitidas++;
                  continue;
                }
                ids.push(await appendDeviceCommand(
                  conn,
                  device.SN,
                  `DATA UPDATE FINGERTMP PIN=${dni}\tFID=${fp.FingerID}\tSize=${tmp.length}\tValid=1\tTMP=${tmp}`,
                  device.PushVersion
                ));
                huellas++;
              }
            }
          }
        }
      }

      if (includeBajas && bajas < limit) {
        for (const row of admsByDni.values()) {
          if (bajas >= limit) break;
          if (vistos.has(row.dni)) continue;
          for (const device of devices) {
            ids.push(await appendDeviceCommand(conn, device.SN, `DATA DELETE USERINFO PIN=${row.dni}`, device.PushVersion));
          }
          bajas++;
        }
      }

      await conn.end();
      conn = null;
      (res.locals as any).audit = {
        action: 'adms_sync_apply',
        table_name: 'devcmds',
        record_pk: ids.slice(0, 20).join(','),
        request_json: { sn, limit, servicioId, soloActivos, reglasDestino: ruleSns, includeCreates, includeUpdates, includeBajas, incluirHuellas, options, creados, actualizados, bajas, huellas, huellasOmitidas },
      };
      trackAction('adms_sync_apply', { sn, limit, servicioId, reglasDestino: ruleSns, creados, actualizados, bajas, huellas, huellasOmitidas, comandos: ids.length }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, ids, total: ids.length, creados, actualizados, bajas, huellas, huellasOmitidas, dispositivos: devices.length, limit });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const comando = asStringOrNull(req.body?.comando);
    if (!sn || !comando) return res.status(400).json({ ok: false, error: 'sn y comando son requeridos' });
    if (/^\s*CLEAR\s+(DATA|LOG)\b/i.test(comando) && asStringOrNull(req.body?.confirmacion) !== 'BORRAR') {
      return res.status(400).json({ ok: false, error: 'CLEAR DATA / CLEAR LOG requiere confirmacion=BORRAR' });
    }

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]);
      if (!devices.length) {
        await conn.end();
        conn = null;
        return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });
      }
      const id = await appendDeviceCommand(conn, sn, comando, devices[0].PushVersion);
      await conn.end();
      conn = null;
      return res.json({ ok: true, ids: [id], total: 1 });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/check', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    if (!sn) return res.status(400).json({ ok: false, error: 'sn es requerido' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]);
      if (!devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });
      const id = await appendDeviceCommand(conn, sn, 'CHECK', devices[0].PushVersion);
      await conn.end();
      conn = null;
      return res.json({ ok: true, ids: [id], total: 1 });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/reiniciar', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    if (!sn) return res.status(400).json({ ok: false, error: 'sn es requerido' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]);
      if (!devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });
      const id = await appendDeviceCommand(conn, sn, 'REBOOT', devices[0].PushVersion);
      await conn.end();
      conn = null;
      return res.json({ ok: true, ids: [id], total: 1 });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/borrar-usuario', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const dni = asStringOrNull(req.body?.dni);
    const incluirHuellas = req.body?.incluirHuellas !== false;
    const soloHuellas = req.body?.soloHuellas === true;
    const fid = req.body?.fid == null ? null : clampInt(req.body.fid, 0, 0, 9);
    if (!sn || !dni) return res.status(400).json({ ok: false, error: 'sn y dni son requeridos' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]);
      if (!devices.length) {
        await conn.end();
        conn = null;
        return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });
      }
      const ids: number[] = [];
      if (fid != null) {
        // Borrado de un dedo puntual: no toca al usuario ni al resto de las huellas
        ids.push(await appendDeviceCommand(conn, sn, `DATA DELETE FINGERTMP PIN=${dni}\tFID=${fid}`, devices[0].PushVersion));
      } else if (soloHuellas) {
        ids.push(await appendDeviceCommand(conn, sn, `DATA DELETE FINGERTMP PIN=${dni}`, devices[0].PushVersion));
      } else {
        ids.push(await appendDeviceCommand(conn, sn, `DATA DELETE USERINFO PIN=${dni}`, devices[0].PushVersion));
        if (incluirHuellas) {
          ids.push(await appendDeviceCommand(conn, sn, `DATA DELETE FINGERTMP PIN=${dni}`, devices[0].PushVersion));
        }
      }
      await conn.end();
      conn = null;
      (res.locals as any).audit = {
        action: 'adms_comando_borrar_usuario_reloj',
        table_name: 'devcmds',
        record_pk: ids.join(','),
        request_json: { sn, dni, incluirHuellas, soloHuellas, fid },
      };
      trackAction('adms_comando_borrar_usuario_reloj', { sn, dni, incluirHuellas, soloHuellas, fid, ids }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, ids, total: ids.length });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/enviar-usuario', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const dni = asStringOrNull(req.body?.dni);
    const incluirHuellas = req.body?.incluirHuellas !== false;
    if (!sn || !dni) return res.status(400).json({ ok: false, error: 'sn y dni son requeridos' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]);
      if (!devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });

      const [users] = await conn.query<RowDataPacket[]>(
        `SELECT userid, badgenumber, name, Password, AccGroup, Card, TimeZones, Privilege
           FROM userinfo
          WHERE badgenumber = ?
          LIMIT 1`,
        [dni]
      );
      if (!users.length) return res.status(404).json({ ok: false, error: `Usuario ADMS ${dni} no encontrado` });

      const ids: number[] = [];
      ids.push(await appendDeviceCommand(conn, sn, userInfoCommand(users[0]), devices[0].PushVersion));

      if (incluirHuellas) {
        const [templates] = await conn.query<RowDataPacket[]>(
          `SELECT FingerID, Template
             FROM template
            WHERE userid = ? AND (DelTag IS NULL OR DelTag = 0) AND Template IS NOT NULL`,
          [users[0].userid]
        );
        for (const fp of templates) {
          const tmp = String(fp.Template || '').replace(/\r?\n/g, '');
          ids.push(await appendDeviceCommand(
            conn,
            sn,
            `DATA UPDATE FINGERTMP PIN=${dni}\tFID=${fp.FingerID}\tSize=${tmp.length}\tValid=1\tTMP=${tmp}`,
            devices[0].PushVersion
          ));
        }
      }

      await conn.end();
      conn = null;
      return res.json({ ok: true, ids, total: ids.length });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/solicitar-biometria', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const dni = asStringOrNull(req.body?.dni);
    const incluirUsuario = req.body?.incluirUsuario !== false;
    const incluirHuellas = req.body?.incluirHuellas !== false;
    const incluirPalmas = req.body?.incluirPalmas !== false;
    const incluirCaras = req.body?.incluirCaras === true;
    if (!sn || !dni) return res.status(400).json({ ok: false, error: 'sn y dni son requeridos' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]);
      if (!devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });

      const comandos: string[] = [];
      if (incluirUsuario) comandos.push(`DATA QUERY USERINFO PIN=${dni}`);
      if (incluirHuellas) comandos.push(`DATA QUERY FINGERTMP PIN=${dni}`);
      if (incluirPalmas) comandos.push(...bioQueryCommands(dni, 10));
      if (incluirCaras) comandos.push(...bioQueryCommands(dni, 9));

      const ids: number[] = [];
      for (const comando of comandos) {
        ids.push(await appendDeviceCommand(conn, sn, comando, devices[0].PushVersion));
      }

      await conn.end();
      conn = null;
      return res.json({ ok: true, sn, dni, ids, total: ids.length, comandos });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/enviar-biometria', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const dni = asStringOrNull(req.body?.dni);
    const incluirUsuario = req.body?.incluirUsuario !== false;
    const incluirHuellas = req.body?.incluirHuellas !== false;
    const incluirPalmas = req.body?.incluirPalmas !== false;
    const incluirCaras = req.body?.incluirCaras === true;
    if (!sn || !dni) return res.status(400).json({ ok: false, error: 'sn y dni son requeridos' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      await ensureBiotemplateTable(conn);
      const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]);
      if (!devices.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });

      const [users] = await conn.query<RowDataPacket[]>(
        `SELECT userid, badgenumber, name, Password, AccGroup, Card, TimeZones, Privilege
           FROM userinfo
          WHERE badgenumber = ?
          LIMIT 1`,
        [dni]
      );
      if (!users.length) return res.status(404).json({ ok: false, error: `Usuario ADMS ${dni} no encontrado` });

      const ids: number[] = [];
      let usuarios = 0;
      let huellas = 0;
      let palmas = 0;
      let caras = 0;

      if (incluirUsuario) {
        ids.push(await appendDeviceCommand(conn, sn, userInfoCommand(users[0]), devices[0].PushVersion));
        usuarios++;
      }

      if (incluirHuellas) {
        const [templates] = await conn.query<RowDataPacket[]>(
          `SELECT FingerID, Template
             FROM template
            WHERE userid = ? AND (DelTag IS NULL OR DelTag = 0) AND Template IS NOT NULL`,
          [users[0].userid]
        );
        for (const fp of templates) {
          const tmp = String(fp.Template || '').replace(/\r?\n/g, '');
          ids.push(await appendDeviceCommand(
            conn,
            sn,
            `DATA UPDATE FINGERTMP PIN=${dni}\tFID=${fp.FingerID}\tSize=${tmp.length}\tValid=1\tTMP=${tmp}`,
            devices[0].PushVersion
          ));
          huellas++;
        }
      }

      const bioTypes: number[] = [];
      if (incluirPalmas) bioTypes.push(10);
      if (incluirCaras) bioTypes.push(9);
      if (bioTypes.length) {
        const placeholders = bioTypes.map(() => '?').join(', ');
        const [bios] = await conn.query<RowDataPacket[]>(
          `SELECT BioType, FingerID, Valid, Duress, Format, MajorVer, MinorVer, Template
             FROM biotemplate
            WHERE userid = ?
              AND BioType IN (${placeholders})
              AND (DelTag IS NULL OR DelTag = 0)
              AND Template IS NOT NULL
            ORDER BY BioType, FingerID`,
          [users[0].userid, ...bioTypes]
        );
        for (const bio of bios) {
          ids.push(await appendDeviceCommand(conn, sn, bioDataCommand(dni, bio), devices[0].PushVersion));
          if (Number(bio.BioType) === 10) palmas++;
          if (Number(bio.BioType) === 9) caras++;
        }
      }

      await conn.end();
      conn = null;
      return res.json({ ok: true, sn, dni, ids, total: ids.length, enviados: { usuarios, huellas, palmas, caras } });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/transferir-palmas', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const dni = asStringOrNull(req.body?.dni);
    const origenSn = asStringOrNull(req.body?.origenSn);
    const destinoSn = asStringOrNull(req.body?.destinoSn);
    const destinoSnsBody = Array.isArray(req.body?.destinoSns)
      ? req.body.destinoSns.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
      : [];
    if (!dni) return res.status(400).json({ ok: false, error: 'dni es requerido' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      await ensureBiotemplateTable(conn);

      const [users] = await conn.query<RowDataPacket[]>(
        `SELECT userid, badgenumber, name, Password, AccGroup, Card, TimeZones, Privilege, SN
           FROM userinfo
          WHERE badgenumber = ?
          LIMIT 1`,
        [dni]
      );
      if (!users.length) return res.status(404).json({ ok: false, error: `Usuario ADMS ${dni} no encontrado` });
      const user = users[0];

      const destinoSns = [...new Set([destinoSn, ...destinoSnsBody].filter(Boolean) as string[])];
      let targetSql = `SELECT SN, Alias, PushVersion
                         FROM iclock
                        WHERE (DelTag IS NULL OR DelTag = 0)
                          AND (State IS NULL OR State <> 0)`;
      const targetParams: string[] = [];
      if (destinoSns.length) {
        targetSql += ` AND SN IN (${destinoSns.map(() => '?').join(', ')})`;
        targetParams.push(...destinoSns);
      } else {
        targetSql += ` AND LOWER(COALESCE(Alias, '')) LIKE '%salida%' AND LOWER(COALESCE(Alias, '')) LIKE '%abajo%'`;
      }
      targetSql += ' ORDER BY Alias, SN';
      const [targets] = await conn.query<RowDataPacket[]>(targetSql, targetParams);
      if (!targets.length) return res.status(404).json({ ok: false, error: 'No hay relojes destino activos para transferir palmas' });

      const [palmas] = await conn.query<RowDataPacket[]>(
        `SELECT BioType, FingerID, Valid, Duress, Format, MajorVer, MinorVer, Template
           FROM biotemplate
          WHERE userid = ?
            AND BioType = 10
            AND (DelTag IS NULL OR DelTag = 0)
            AND Template IS NOT NULL
          ORDER BY FingerID`,
        [user.userid]
      );

      const ids: number[] = [];
      if (palmas.length) {
        for (const device of targets) {
          ids.push(await appendDeviceCommand(conn, device.SN, userInfoCommand(user), device.PushVersion));
          for (const palma of palmas) {
            ids.push(await appendDeviceCommand(conn, device.SN, bioDataCommand(dni, palma), device.PushVersion));
          }
        }
        await conn.end();
        conn = null;
        return res.json({
          ok: true,
          estado: 'enviado',
          dni,
          palmas: palmas.length,
          destinos: targets.map(d => ({ sn: d.SN, alias: d.Alias })),
          ids,
          total: ids.length,
        });
      }

      const sourceCandidates = [
        origenSn,
        asStringOrNull(user.SN),
      ].filter(Boolean) as string[];
      const [recentSources] = await conn.query<RowDataPacket[]>(
        `SELECT DISTINCT SN
           FROM checkinout
          WHERE userid = ? AND SN IS NOT NULL AND SN <> ''
          ORDER BY checktime DESC
          LIMIT 5`,
        [user.userid]
      );
      sourceCandidates.push(...recentSources.map(r => String(r.SN || '').trim()).filter(Boolean));
      const sourceSns = [...new Set(sourceCandidates)];

      const [sources] = sourceSns.length
        ? await conn.query<RowDataPacket[]>(
            `SELECT SN, Alias, PushVersion
               FROM iclock
              WHERE SN IN (${sourceSns.map(() => '?').join(', ')})
                AND (DelTag IS NULL OR DelTag = 0)
              ORDER BY FIELD(SN, ${sourceSns.map(() => '?').join(', ')})`,
            [...sourceSns, ...sourceSns]
          )
        : await conn.query<RowDataPacket[]>(
            `SELECT SN, Alias, PushVersion
               FROM iclock
              WHERE (DelTag IS NULL OR DelTag = 0)
                AND (State IS NULL OR State <> 0)
              ORDER BY Alias, SN`
          );

      for (const source of sources) {
        for (const comando of bioQueryCommands(dni, 10)) {
          ids.push(await appendDeviceCommand(conn, source.SN, comando, source.PushVersion));
        }
      }

      await conn.end();
      conn = null;
      return res.json({
        ok: true,
        estado: 'pendiente_captura',
        msg: 'No habia palma guardada en ADMS; se solicito al/los reloj(es) origen. Reintentar transferencia cuando el reloj responda.',
        dni,
        origenes: sources.map(d => ({ sn: d.SN, alias: d.Alias })),
        destinos: targets.map(d => ({ sn: d.SN, alias: d.Alias })),
        ids,
        total: ids.length,
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/accion', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const action = asStringOrNull(req.body?.action);
    if (!sn || !action) return res.status(400).json({ ok: false, error: 'sn y action son requeridos' });
    const comando = commandFromAction(action, req.body);
    if (!comando) return res.status(400).json({ ok: false, error: `Accion ${action} invalida o incompleta` });
    if ((action === 'clear-data' || action === 'clear-log') && asStringOrNull(req.body?.confirmacion) !== 'BORRAR') {
      return res.status(400).json({ ok: false, error: `La accion ${action} requiere confirmacion=BORRAR` });
    }

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]);
      if (!devices.length) {
        await conn.end();
        conn = null;
        return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });
      }
      const id = await appendDeviceCommand(conn, sn, comando, devices[0].PushVersion);
      await conn.end();
      conn = null;
      return res.json({ ok: true, ids: [id], total: 1, comando });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/reintentar-viejos', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const minutos = clampInt(req.body?.minutos, 15, 1, 1440);
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const params: Array<string | number> = [minutos];
      let whereSn = '';
      if (sn) {
        whereSn = 'AND SN_id = ?';
        params.push(sn);
      }
      const [result] = await conn.query<any>(
        `UPDATE devcmds
            SET CmdTransTime = NULL
          WHERE CmdOverTime IS NULL
            AND CmdTransTime IS NOT NULL
            AND CmdTransTime < DATE_SUB(NOW(), INTERVAL ? MINUTE)
            ${whereSn}`,
        params
      );
      await conn.end();
      conn = null;
      const afectados = Number(result?.affectedRows ?? 0);
      (res.locals as any).audit = { action: 'adms_comandos_reintentar', table_name: 'devcmds', record_pk: sn || '*', request_json: { sn, minutos, afectados } };
      trackAction('adms_comandos_reintentar', { sn, minutos, afectados }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, afectados });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/marcar-vencidos', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.body?.sn);
    const minutos = clampInt(req.body?.minutos, 60, 1, 10080);
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const params: Array<string | number> = [-2, minutos];
      let whereSn = '';
      if (sn) {
        whereSn = 'AND SN_id = ?';
        params.push(sn);
      }
      const [result] = await conn.query<any>(
        `UPDATE devcmds
            SET CmdOverTime = NOW(),
                CmdReturn = ?
          WHERE CmdOverTime IS NULL
            AND CmdTransTime IS NOT NULL
            AND CmdTransTime < DATE_SUB(NOW(), INTERVAL ? MINUTE)
            ${whereSn}`,
        params
      );
      await conn.end();
      conn = null;
      const afectados = Number(result?.affectedRows ?? 0);
      (res.locals as any).audit = { action: 'adms_comandos_marcar_vencidos', table_name: 'devcmds', record_pk: sn || '*', request_json: { sn, minutos, afectados } };
      trackAction('adms_comandos_marcar_vencidos', { sn, minutos, afectados }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, afectados });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.post('/adms/comandos/limpiar-finalizados', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const dias = clampInt(req.body?.dias, 30, 1, 3650);
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [result] = await conn.query<any>(
        `DELETE FROM devcmds
          WHERE CmdOverTime IS NOT NULL
            AND CmdOverTime < DATE_SUB(NOW(), INTERVAL ? DAY)`,
        [dias]
      );
      await conn.end();
      conn = null;
      const afectados = Number(result?.affectedRows ?? 0);
      (res.locals as any).audit = { action: 'adms_comandos_limpiar_finalizados', table_name: 'devcmds', record_pk: '*', request_json: { dias, afectados } };
      trackAction('adms_comandos_limpiar_finalizados', { dias, afectados }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, afectados });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // Estado de comandos encolados (para verificar el resultado de borrados/acciones por id)
  router.get('/adms/comandos/estado', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isInteger(n) && n > 0)
      .slice(0, 100);
    if (!ids.length) return res.status(400).json({ ok: false, error: 'ids es requerido (csv de ids de devcmds)' });
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const placeholders = ids.map(() => '?').join(',');
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id, SN_id, LEFT(CmdContent, 120) AS comando, CmdCommitTime, CmdTransTime, CmdOverTime, CmdReturn
           FROM devcmds
          WHERE id IN (${placeholders})
          ORDER BY id`,
        ids
      );
      await conn.end();
      conn = null;
      const data = rows.map(r => ({
        id: Number(r.id),
        sn: r.SN_id,
        comando: r.comando,
        commit: r.CmdCommitTime,
        enviado: r.CmdTransTime,
        finalizado: r.CmdOverTime,
        retorno: r.CmdReturn == null ? null : Number(r.CmdReturn),
        estado: r.CmdOverTime == null
          ? (r.CmdTransTime == null ? 'PENDIENTE' : 'ENVIADO')
          : (Number(r.CmdReturn) >= 0 ? 'OK' : 'ERROR'),
      }));
      return res.json({ ok: true, data });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.put('/adms/dispositivos/:sn', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.params.sn);
    if (!sn) return res.status(400).json({ ok: false, error: 'sn es requerido' });

    const sets: string[] = [];
    const params: Array<string | number> = [];

    const alias = asStringOrNull(req.body?.alias);
    if (alias != null) { sets.push('Alias = ?'); params.push(alias.slice(0, 50)); }

    if (req.body?.state != null) {
      const stateVal = req.body.state === true || req.body.state === 1 || req.body.state === '1' ? 1 : 0;
      sets.push('State = ?'); params.push(stateVal);
    }

    const transTimes = asStringOrNull(req.body?.transTimes);
    if (transTimes != null) { sets.push('TransTimes = ?'); params.push(transTimes.slice(0, 100)); }

    if (req.body?.transInterval != null) {
      sets.push('TransInterval = ?'); params.push(clampInt(req.body.transInterval, 1, 1, 1440));
    }

    if (req.body?.tzAdj != null) {
      sets.push('TZAdj = ?'); params.push(clampInt(req.body.tzAdj, 14, -12, 14));
    }

    if (!sets.length) return res.status(400).json({ ok: false, error: 'Nada que actualizar' });
    params.push(sn);

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [check] = await conn.query<RowDataPacket[]>('SELECT SN FROM iclock WHERE SN = ? LIMIT 1', [sn]);
      if (!check.length) { await conn.end(); return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` }); }
      await conn.query(`UPDATE iclock SET ${sets.join(', ')} WHERE SN = ?`, params);
      const [fresh] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias, State, TransTimes, TransInterval, TZAdj FROM iclock WHERE SN = ? LIMIT 1',
        [sn]
      );
      await conn.end(); conn = null;
      trackAction('adms_dispositivo_editar', { sn, sets: sets.map(s => s.split(' ')[0]) }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, data: fresh[0] ?? null });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  router.get('/adms/comandos', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const limit = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 50_000);
    const sn = asStringOrNull(req.query.sn);
    const estado = asStringOrNull(req.query.estado);
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (sn) {
      where.push('dc.SN_id = ?');
      params.push(sn);
    }
    if (estado === 'pendientes') {
      where.push('dc.CmdOverTime IS NULL');
    } else if (estado === 'enviados') {
      where.push('dc.CmdTransTime IS NOT NULL AND dc.CmdOverTime IS NULL');
    } else if (estado === 'finalizados') {
      where.push('dc.CmdOverTime IS NOT NULL');
    } else if (estado === 'errores') {
      where.push('dc.CmdOverTime IS NOT NULL AND dc.CmdReturn IS NOT NULL AND dc.CmdReturn <> 0');
    } else if (estado === 'vencidos') {
      where.push('dc.CmdOverTime IS NOT NULL AND dc.CmdReturn = -2');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(1) AS total FROM devcmds dc ${whereSql}`,
        params
      );
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT dc.id, dc.SN_id AS sn, dc.CmdContent AS contenido, dc.CmdCommitTime AS creado,
                dc.CmdTransTime AS enviado, dc.CmdOverTime AS finalizado, dc.CmdReturn AS retorno,
                ic.Alias AS alias
           FROM devcmds dc
           LEFT JOIN iclock ic ON ic.SN = dc.SN_id
           ${whereSql}
          ORDER BY dc.id DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      await conn.end();
      conn = null;

      return res.json({
        ok: true,
        total: Number(countRows[0]?.total ?? 0),
        limit,
        offset,
        data: rows.map(r => ({
          id: r.id,
          sn: r.sn,
          alias: r.alias || r.sn,
          contenido: r.contenido || '',
          creado: r.creado || null,
          enviado: r.enviado || null,
          finalizado: r.finalizado || null,
          retorno: r.retorno ?? null,
          estado: r.finalizado
            ? (Number(r.retorno ?? 0) === -2 ? 'vencido' : Number(r.retorno ?? 0) !== 0 ? 'error' : 'finalizado')
            : r.enviado ? 'enviado' : 'pendiente',
        })),
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err), data: [], total: 0 });
    }
  });

  // ─── Estado por protocolo ZK TCP 4370 ─────────────────────────────────────
  router.get('/adms/dispositivos/:sn/ping', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.params.sn);
    if (!sn) return res.status(400).json({ ok: false, error: 'sn requerido' });
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias, IPAddress, State FROM iclock WHERE SN = ? LIMIT 1', [sn]
      );
      await conn.end(); conn = null;
      if (!rows.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });
      const ip = String(rows[0].IPAddress || '');
      if (!ip) return res.json({ ok: true, sn, alias: rows[0].Alias, ip: null, tcpOnline: null, message: 'Sin IP registrada' });
      const result = await checkZkProtocol(ip, 3000);
      const portOpen = result.online ? true : await tcpPortOpen(ip, 4370, 1500);
      return res.json({
        ok: true,
        sn,
        alias: rows[0].Alias,
        ip,
        tcpOnline: result.online,
        protocolOnline: result.online,
        latencyMs: result.latencyMs,
        protocolLatencyMs: result.latencyMs,
        portOpen,
        error: result.error ?? null,
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // ─── Backup del aparato (descarga directa vía HTTP al reloj) ─────────────
  router.get('/adms/dispositivos/:sn/backup', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.params.sn);
    const tipo = String(req.query.tipo ?? 'datos'); // 'datos' | 'sistema'
    if (!sn) return res.status(400).json({ ok: false, error: 'sn requerido' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias, IPAddress, PushVersion FROM iclock WHERE SN = ? LIMIT 1', [sn]
      );
      await conn.end(); conn = null;
      if (!rows.length) return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` });
      const ip = String(rows[0].IPAddress || '');
      if (!ip) return res.status(400).json({ ok: false, error: 'El reloj no tiene IP registrada' });

      const axios = (await import('axios')).default;
      const style = tipo === 'sistema' ? '1' : '2';
      const filename = tipo === 'sistema' ? 'device.dat' : 'data.dat';
      const url = `http://${ip}/form/DataApp?style=${style}`;

      const upstream = await axios.get(url, {
        responseType: 'stream',
        timeout: 15000,
        validateStatus: (s) => s < 500,
      });

      if (upstream.status !== 200) {
        return res.status(502).json({ ok: false, error: `El reloj respondió HTTP ${upstream.status}` });
      }

      const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${sn}_${tipo}_${ts}.dat"`);
      if (upstream.headers['content-length']) {
        res.setHeader('Content-Length', upstream.headers['content-length']);
      }

      upstream.data.pipe(res);
      trackAction('adms_backup_dispositivo', { sn, ip, tipo, filename }, { id: (req as any).auth?.principalId ?? undefined });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      if (!res.headersSent) {
        return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
      }
    }
  });

  // ─── PULL fichadas por rango (TCP directo vía zkteco-js) ──────────────────
  router.post('/adms/dispositivos/:sn/pull-fichadas', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const sn = asStringOrNull(req.params.sn);
    const desde = parseDateTimeParam(req.body?.desde) ?? parseDateTimeParam(req.body?.desde, false);
    const hasta = parseDateTimeParam(req.body?.hasta, true);
    if (!sn) return res.status(400).json({ ok: false, error: 'sn requerido' });
    if (!desde || !hasta) return res.status(400).json({ ok: false, error: 'desde y hasta requeridos (YYYY-MM-DD)' });

    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT SN, Alias, IPAddress FROM iclock WHERE SN = ? LIMIT 1', [sn]
      );
      if (!rows.length) { await conn.end(); return res.status(404).json({ ok: false, error: `Reloj ${sn} no encontrado` }); }
      const ip = String(rows[0].IPAddress || '');
      if (!ip) { await conn.end(); return res.status(400).json({ ok: false, error: 'El reloj no tiene IP registrada' }); }

      // Importar zkteco-js dinámicamente
      let ZKTeco: any;
      try {
        ZKTeco = (await import('zkteco-js' as any)).default ?? (await import('zkteco-js' as any));
      } catch {
        await conn.end();
        return res.status(503).json({ ok: false, error: 'zkteco-js no disponible — npm install zkteco-js' });
      }

      const device = new ZKTeco(ip, 4370, 5200, 5000);
      await device.createSocket();
      let attendanceSize: number | null = null;
      try {
        const sizeRaw = await device.getAttendanceSize?.();
        const sizeNum = Number(sizeRaw);
        attendanceSize = Number.isFinite(sizeNum) ? sizeNum : null;
      } catch {
        attendanceSize = null;
      }

      if (attendanceSize == null || attendanceSize > 30_000) {
        try { await device.disconnect(); } catch { /* noop */ }
        const queryCommand = `DATA QUERY ATTLOG StartTime=${desde}\tEndTime=${hasta}`;
        const queryId = await appendDeviceCommand(conn, sn, queryCommand, rows[0].PushVersion);
        await conn.query('UPDATE iclock SET LastActivity = ? WHERE SN = ?', [mysqlNow(), sn]);
        await conn.end(); conn = null;
        trackAction('adms_pull_fichadas_relectura', { sn, desde, hasta, attendanceSize, queryId }, { id: (req as any).auth?.principalId ?? undefined });
        return res.json({
          ok: true,
          sn,
          desde,
          hasta,
          modo: 'adms_relectura',
          queryId,
          totalReloj: attendanceSize,
          enRango: 0,
          insertadas: 0,
          duplicadas: 0,
          advertencia: 'El reloj tiene demasiadas fichadas para descarga TCP completa; se encolo DATA QUERY ATTLOG por rango. Las fichadas entraran cuando el reloj procese el comando ADMS.',
        });
      }

      let allLogs: any[] = [];
      try {
        const result = await device.getAttendances();
        allLogs = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
      } finally {
        try { await device.disconnect(); } catch { /* noop */ }
      }

      // zkteco-js devuelve: { user_id: string, record_time: string(Date.toString()), type: number, state: number }
      // Normalizar a fecha MySQL: "YYYY-MM-DD HH:MM:SS"
      function normalizeFechaZk(val: any): string {
        if (!val) return '';
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return '';
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      }

      // Filtrar por rango de fecha — acepta cualquier campo de fecha posible
      const desdeTs = new Date(desde.replace(' ', 'T')).getTime();
      const hastaTs = new Date(hasta.replace(' ', 'T')).getTime();
      const filtered = allLogs.filter((r: any) => {
        const raw = r.record_time ?? r.recordTime ?? r.checktime ?? r.timestamp ?? '';
        const t = new Date(raw).getTime();
        return !Number.isNaN(t) && t >= desdeTs && t <= hastaTs;
      });

      // Helper local para obtener/crear userid por PIN
      async function getOrCreateUser(pin: string): Promise<number> {
        const [users] = await conn!.query<RowDataPacket[]>(
          'SELECT userid FROM userinfo WHERE badgenumber = ? LIMIT 1', [pin]
        );
        if (users[0]?.userid) return Number(users[0].userid);
        const now = mysqlNow();
        const [ins2] = await conn!.query<any>(
          `INSERT INTO userinfo (badgenumber, name, defaultdeptid, Password, Card, Privilege, AccGroup, TimeZones, SN, UTime, DelTag)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [pin, ' ', '', '', 0, 1, '', sn, now]
        );
        return ins2.insertId;
      }

      let insertadas = 0;
      let duplicadas = 0;
      for (const r of filtered) {
        // user_id es el campo de zkteco-js (PIN del usuario)
        const pin      = String(r.user_id ?? r.deviceUserId ?? r.userSn ?? r.pin ?? '').replace(/\D/g, '').replace(/^0+/, '');
        const rawTime  = r.record_time ?? r.recordTime ?? r.checktime ?? r.timestamp ?? '';
        const checktime = normalizeFechaZk(rawTime);
        const checktype = Number(r.type ?? r.verifyType ?? r.inOutStatus ?? 0);
        const verifycode = r.state ?? r.verifyMode ?? null;
        if (!pin || !checktime) continue;
        try {
          const userid = await getOrCreateUser(pin);
          const [ins] = await conn.query<any>(
            `INSERT IGNORE INTO checkinout (userid, checktime, checktype, verifycode, SN)
             VALUES (?, ?, ?, ?, ?)`,
            [userid, checktime, checktype, verifycode, sn]
          );
          if ((ins?.affectedRows ?? 0) > 0) insertadas++;
          else duplicadas++;
        } catch { /* skip */ }
      }

      // Actualizar LastActivity
      await conn.query('UPDATE iclock SET LastActivity = ? WHERE SN = ?', [mysqlNow(), sn]);
      await conn.end(); conn = null;

      // Debug: muestra rango de fechas del reloj
      const fechas = allLogs.map((r: any) => new Date(r.record_time ?? '').getTime()).filter((t: number) => !Number.isNaN(t)).sort((a: number, b: number) => a - b);
      const muestra = {
        total: allLogs.length,
        primeraFecha: fechas.length ? new Date(fechas[0]).toISOString() : null,
        ultimaFecha:  fechas.length ? new Date(fechas[fechas.length - 1]).toISOString() : null,
        primerRegistro: allLogs[0] ? { keys: Object.keys(allLogs[0]), record_time: allLogs[0].record_time, user_id: allLogs[0].user_id } : null,
      };

      trackAction('adms_pull_fichadas', { sn, desde, hasta, total: filtered.length, insertadas, duplicadas }, { id: (req as any).auth?.principalId ?? undefined });
      return res.json({ ok: true, sn, desde, hasta, totalReloj: allLogs.length, attendanceSize, enRango: filtered.length, insertadas, duplicadas, debug_muestra: muestra });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  // ─── Biotemplates (palma, cara, etc.) ─────────────────────────────────────
  router.get('/adms/biotemplates', admin, async (req: Request, res: Response) => {
    const cfg = cargarConfig();
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const q = asStringOrNull(req.query.q);
    const bioType = req.query.bioType != null ? clampInt(req.query.bioType, 0, 0, 99) : null;
    const sn = asStringOrNull(req.query.sn);
    let conn: Awaited<ReturnType<typeof conectarMySQL>> | null = null;
    try {
      conn = await conectarMySQL(cfg);
      // Crear tabla si no existe
      await conn.query(`
        CREATE TABLE IF NOT EXISTS biotemplate (
          id INT AUTO_INCREMENT PRIMARY KEY, userid INT NOT NULL,
          BioType TINYINT NOT NULL DEFAULT 10, FingerID TINYINT NOT NULL DEFAULT 0,
          Valid TINYINT NOT NULL DEFAULT 1, Duress TINYINT NOT NULL DEFAULT 0,
          Format TINYINT NOT NULL DEFAULT 0, MajorVer TINYINT NOT NULL DEFAULT 0,
          MinorVer TINYINT NOT NULL DEFAULT 0, Template MEDIUMTEXT,
          SN VARCHAR(20), UTime DATETIME, DelTag TINYINT NOT NULL DEFAULT 0,
          UNIQUE KEY uk_userid_biotype_slot (userid, BioType, FingerID)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      const where: string[] = ['(bt.DelTag IS NULL OR bt.DelTag = 0)', 'bt.Template IS NOT NULL'];
      const params: Array<string | number> = [];
      if (bioType != null) { where.push('bt.BioType = ?'); params.push(bioType); }
      if (sn) { where.push('bt.SN = ?'); params.push(sn); }
      if (q) {
        const clean = q.replace(/[%_]/g, '');
        where.push('(ui.badgenumber LIKE ? OR ui.name LIKE ?)');
        params.push(`%${clean}%`, `%${clean}%`);
      }
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(1) AS total FROM biotemplate bt INNER JOIN userinfo ui ON ui.userid = bt.userid ${whereSql}`, params
      );
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT bt.id, ui.badgenumber, ui.name, bt.BioType, bt.FingerID, bt.Valid,
                LENGTH(bt.Template) AS size, bt.MajorVer, bt.MinorVer, bt.SN, bt.UTime
           FROM biotemplate bt INNER JOIN userinfo ui ON ui.userid = bt.userid
           ${whereSql} ORDER BY ui.badgenumber, bt.BioType, bt.FingerID LIMIT ?`,
        [...params, limit]
      );
      const [devices] = await conn.query<RowDataPacket[]>('SELECT SN, Alias FROM iclock WHERE DelTag IS NULL OR DelTag = 0');
      await conn.end(); conn = null;
      return res.json({
        ok: true, total: Number(countRows[0]?.total ?? 0),
        dispositivos: devices.map(d => ({ sn: d.SN, alias: d.Alias || d.SN })),
        data: rows.map(r => ({
          id: r.id, dni: r.badgenumber, nombre: r.name || '',
          bioType: r.BioType, bioTypeName: BIOTYPE_NAMES[r.BioType] ?? `bio${r.BioType}`,
          index: r.FingerID, valid: r.Valid, size: r.size ?? 0,
          majorVer: r.MajorVer, minorVer: r.MinorVer, sn: r.SN || null, utime: r.UTime || null,
        })),
      });
    } catch (err: any) {
      if (conn) { try { await conn.end(); } catch { /* noop */ } }
      return res.status(503).json({ ok: false, error: err?.message ?? String(err), data: [], total: 0 });
    }
  });
}
