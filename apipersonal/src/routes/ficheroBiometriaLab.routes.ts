import { Router, Request, Response } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { QueryTypes, Sequelize } from 'sequelize';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { requirePermission } from '../middlewares/rbacCrud';
import { cargarConfig, conectarMySQL } from './fichero.routes';

type BioKind = 'usuario' | 'huellas' | 'rostros' | 'caras' | 'palmas';
const execFileAsync = promisify(execFile);

interface CommandPreview {
  destino: string;
  tipo: BioKind | 'mensaje' | 'lectura';
  comando: string;
  detalle: string;
}

interface DeviceStructureName {
  sn: string;
  reparticion: string | null;
  servicio: string | null;
  sector: string | null;
}

interface SdkBioTransferResult {
  ok: boolean;
  error?: string;
  action?: string;
  captured?: {
    user?: Record<string, any> | null;
    fingers?: SdkBioRow[];
    faces?: SdkBioRow[];
    biodata?: SdkBioRow[];
    errors?: string[];
  };
  applied?: Array<Record<string, any>>;
  userErrors?: string[];
  applyErrors?: string[];
}

interface SdkBioRow {
  method?: string;
  bioType?: number;
  fingerId?: number;
  template?: string;
  rawLine?: string;
  length?: number;
}

function nowMysql(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeDni(value: unknown): string {
  return asString(value).replace(/\D/g, '').replace(/^0+/, '');
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function boolFrom(value: unknown, fallback = false): boolean {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'si', 'sí', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function cleanMessage(value: unknown): string {
  return asString(value).replace(/\s+/g, ' ').slice(0, 60);
}

function commandForDevice(command: string, pushVersion: unknown): string {
  const v = Number(pushVersion ?? 0);
  if (Number.isFinite(v) && v < 2) {
    return command
      .replace('DATA UPDATE USERINFO', 'DATA USER')
      .replace('DATA DELETE USERINFO', 'DATA DEL_USER')
      .replace('DATA UPDATE FINGERTMP', 'DATA FP')
      .replace('DATA DELETE FINGERTMP', 'DATA DEL_FP');
  }
  return command;
}

function publicCommand(command: string): string {
  return command.replace(/(TMP=)[^\t\r\n]+/gi, '$1<template>');
}

function biotypeLabel(type: number): 'rostros' | 'palmas' | 'caras' {
  if (type === 10) return 'palmas';
  if (type === 9) return 'rostros';
  return 'caras';
}

function supportsAdmsBiodata(device: RowDataPacket | null): boolean {
  const pushVersion = asString(device?.PushVersion);
  if (!pushVersion || pushVersion === '0' || pushVersion === '0.0') return false;
  const [majorRaw, minorRaw] = pushVersion.split('.');
  const major = Number(majorRaw);
  const minor = Number(minorRaw ?? 0);
  return Number.isFinite(major) && (major > 1 || (major === 1 && minor >= 5));
}

function admsBiodataUnsupportedReason(device: RowDataPacket | null): string {
  const modelo = asString(device?.DeviceName) || asString(device?.Alias) || asString(device?.SN) || 'este fichero';
  const pushVersion = asString(device?.PushVersion) || 'sin version';
  return `${modelo} informa PushVersion=${pushVersion}; no soporta DATA QUERY biodata/biotemplate por ADMS moderno`;
}

function wantedKinds(raw: any): Set<BioKind> {
  const src = raw && typeof raw === 'object' ? raw : {};
  const set = new Set<BioKind>();
  if (boolFrom(src.usuario, true)) set.add('usuario');
  if (boolFrom(src.huellas, true)) set.add('huellas');
  if (boolFrom(src.rostros, true)) set.add('rostros');
  if (boolFrom(src.caras, true)) set.add('caras');
  if (boolFrom(src.palmas, true)) set.add('palmas');
  return set;
}

async function appendCommand(conn: Awaited<ReturnType<typeof conectarMySQL>>, sn: string, command: string): Promise<number> {
  const [result] = await conn.query<ResultSetHeader>(
    `INSERT INTO devcmds (SN_id, CmdContent, CmdCommitTime) VALUES (?, ?, ?)`,
    [sn, command, nowMysql()]
  );
  return Number(result.insertId || 0);
}

async function ensureSdkBioTable(conn: Awaited<ReturnType<typeof conectarMySQL>>): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS fichero_bio_sdk_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      origen_sn VARCHAR(20) NOT NULL,
      pin VARCHAR(32) NOT NULL,
      bio_type TINYINT NOT NULL,
      finger_id TINYINT NOT NULL DEFAULT 0,
      method VARCHAR(32) NOT NULL,
      template MEDIUMTEXT,
      raw_line MEDIUMTEXT,
      template_length INT NOT NULL DEFAULT 0,
      captured_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY uk_fichero_bio_sdk (origen_sn, pin, bio_type, finger_id, method)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function saveSdkBioRows(
  conn: Awaited<ReturnType<typeof conectarMySQL>>,
  origenSn: string,
  pin: string,
  rows: SdkBioRow[]
): Promise<number> {
  if (!rows.length) return 0;
  await ensureSdkBioTable(conn);
  let saved = 0;
  for (const row of rows) {
    const bioType = Number(row.bioType || 0);
    // 1 = huella (SDK), 9 = cara/rostro, 10 = palma
    if (bioType !== 1 && bioType !== 9 && bioType !== 10) continue;
    const template = asString(row.template);
    const rawLine = asString(row.rawLine);
    if (!template && !rawLine) continue;
    await conn.query(
      `INSERT INTO fichero_bio_sdk_templates
         (origen_sn, pin, bio_type, finger_id, method, template, raw_line, template_length, captured_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         template = VALUES(template),
         raw_line = VALUES(raw_line),
         template_length = VALUES(template_length),
         updated_at = VALUES(updated_at)`,
      [
        origenSn,
        pin,
        bioType,
        Number(row.fingerId || 0) || 0,
        asString(row.method) || 'sdk',
        template || null,
        rawLine || null,
        Number(row.length || template.length || rawLine.length || 0) || 0,
        nowMysql(),
        nowMysql(),
      ]
    );
    saved += 1;
  }
  return saved;
}

async function runSdkBioTransfer(input: {
  origenIp: string;
  destinoIp: string;
  dni: string;
  userName?: string;
  password?: string;
  privilege?: number;
  includeFace: boolean;
  includePalm: boolean;
}): Promise<SdkBioTransferResult> {
  const script = path.resolve(process.cwd(), 'scripts', 'fichero-bio-sdk.ps1');
  const payload = JSON.stringify({
    action: 'transfer',
    originIp: input.origenIp,
    targetIp: input.destinoIp,
    pin: input.dni,
    userName: input.userName || '',
    password: input.password || '',
    privilege: input.privilege ?? 0,
    includeUser: true,
    includeFace: input.includeFace,
    includePalm: input.includePalm,
  });
  try {
    const { stdout } = await execFileAsync(
      'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputJson', payload],
      { windowsHide: true, timeout: 90_000, maxBuffer: 20 * 1024 * 1024 }
    );
    return JSON.parse(String(stdout || '{}')) as SdkBioTransferResult;
  } catch (e: any) {
    const stdout = String(e?.stdout || '').trim();
    if (stdout) {
      try { return JSON.parse(stdout) as SdkBioTransferResult; } catch { /* fallthrough */ }
    }
    return { ok: false, error: e?.message || String(e) };
  }
}

async function runSdk<T = any>(payload: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const script = path.resolve(process.cwd(), 'scripts', 'fichero-bio-sdk.ps1');
  try {
    const { stdout } = await execFileAsync(
      'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputJson', JSON.stringify(payload)],
      { windowsHide: true, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 }
    );
    return JSON.parse(String(stdout || '{}')) as T & { ok: boolean; error?: string };
  } catch (e: any) {
    const stdout = String(e?.stdout || '').trim();
    if (stdout) {
      try { return JSON.parse(stdout) as T & { ok: boolean; error?: string }; } catch { /* fallthrough */ }
    }
    return { ok: false, error: e?.message || String(e) } as T & { ok: boolean; error?: string };
  }
}

async function resolveDeviceIp(
  conn: Awaited<ReturnType<typeof conectarMySQL>>,
  sn: string
): Promise<{ device: RowDataPacket; ip: string } | { error: string; status: number }> {
  const device = await deviceBySn(conn, sn);
  if (!device) return { error: 'Fichero no encontrado', status: 404 };
  const ip = asString(device.IPAddress).split(/\s+/)[0];
  if (!ip) return { error: 'El fichero no tiene IP cargada', status: 400 };
  return { device, ip };
}

async function deviceBySn(conn: Awaited<ReturnType<typeof conectarMySQL>>, sn: string): Promise<RowDataPacket | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT SN, Alias, DeviceName, IPAddress, PushVersion, FWVersion, FPVersion, State, DelTag, LastActivity
       FROM iclock
      WHERE SN = ?
      LIMIT 1`,
    [sn]
  );
  return rows[0] ?? null;
}

async function userByDni(conn: Awaited<ReturnType<typeof conectarMySQL>>, dni: string, sn = ''): Promise<RowDataPacket | null> {
  const params: unknown[] = [dni];
  let where = 'badgenumber = ?';
  if (sn) {
    where += ' AND (SN = ? OR SN IS NULL OR SN = "")';
    params.push(sn);
  }
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT userid, badgenumber, name, Password, Card, Privilege, AccGroup, TimeZones, SN
       FROM userinfo
      WHERE ${where}
      ORDER BY SN = ? DESC, userid DESC
      LIMIT 1`,
    [...params, sn]
  );
  return rows[0] ?? null;
}

function userInfoCommand(user: RowDataPacket): string {
  return [
    `DATA UPDATE USERINFO PIN=${user.badgenumber}`,
    `Name=${user.name || ''}`,
    `Passwd=${user.Password || ''}`,
    `Grp=${user.AccGroup || 1}`,
    `Card=${user.Card || ''}`,
    `TZ=${user.TimeZones || ''}`,
    `Pri=${user.Privilege ?? 0}`,
  ].join('\t');
}

function fingerCommand(dni: string, row: RowDataPacket): string {
  const tmp = String(row.Template || '').replace(/\r?\n/g, '');
  return [
    `DATA UPDATE FINGERTMP PIN=${dni}`,
    `FID=${Number(row.FingerID ?? 0) || 0}`,
    `Valid=${Number(row.Valid ?? 1) || 1}`,
    `TMP=${tmp}`,
  ].join('\t');
}

function bioCommand(dni: string, row: RowDataPacket): string {
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

async function buildTransferCommands(
  conn: Awaited<ReturnType<typeof conectarMySQL>>,
  origenSn: string,
  destinoSn: string,
  dni: string,
  kinds: Set<BioKind>
): Promise<{ commands: Array<CommandPreview & { raw: string }>; warnings: string[] }> {
  const warnings: string[] = [];
  const target = await deviceBySn(conn, destinoSn);
  if (!target) throw new Error('Reloj destino no encontrado');
  if (Number(target.DelTag ?? 0) === 1 || Number(target.State ?? 1) === 0) {
    warnings.push('El destino figura pausado/inactivo; el comando quedara en cola hasta que el reloj consulte.');
  }

  const user = await userByDni(conn, dni, origenSn);
  if (!user) {
    throw new Error('No encontre USERINFO para ese DNI/PIN. Primero pedi lectura al reloj origen.');
  }

  const commands: Array<CommandPreview & { raw: string }> = [];
  if (kinds.has('usuario')) {
    const raw = commandForDevice(userInfoCommand(user), target.PushVersion);
    commands.push({ destino: destinoSn, tipo: 'usuario', raw, comando: publicCommand(raw), detalle: `Crear/actualizar usuario ${dni}` });
  }

  if (kinds.has('huellas')) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT FingerID, Valid, Template, SN
         FROM template
        WHERE userid = ? AND COALESCE(DelTag, 0) = 0 AND Template IS NOT NULL AND Template <> ''
        ORDER BY FingerID`,
      [user.userid]
    );
    if (!rows.length) warnings.push('No hay huellas FINGERTMP guardadas para transferir.');
    for (const row of rows) {
      const raw = commandForDevice(fingerCommand(dni, row), target.PushVersion);
      commands.push({ destino: destinoSn, tipo: 'huellas', raw, comando: publicCommand(raw), detalle: `Huella dedo ${row.FingerID ?? 0}` });
    }
  }

  if (kinds.has('rostros') || kinds.has('caras') || kinds.has('palmas')) {
    const wantedTypes: number[] = [];
    if (kinds.has('rostros') || kinds.has('caras')) wantedTypes.push(9);
    if (kinds.has('palmas')) wantedTypes.push(10);
    if (!supportsAdmsBiodata(target)) {
      warnings.push('Cara/palma no se encolan por ADMS viejo: se transfieren por SDK directo al enviar.');
      return { commands, warnings };
    }
    const placeholders = wantedTypes.map(() => '?').join(',');
    const [bioRows] = await conn.query<RowDataPacket[]>(
      `SELECT BioType, FingerID, Valid, Duress, Format, MajorVer, MinorVer, Template, SN
         FROM biotemplate
        WHERE userid = ? AND COALESCE(DelTag, 0) = 0 AND BioType IN (${placeholders})
          AND Template IS NOT NULL AND Template <> ''
        ORDER BY BioType, FingerID`,
      [user.userid, ...wantedTypes]
    );
    if (!bioRows.length) warnings.push('No hay BIODATA/BIOTEMPLATE de rostro/cara/palma guardado para transferir.');
    for (const row of bioRows) {
      const raw = bioCommand(dni, row);
      const tipo = biotypeLabel(Number(row.BioType ?? 0));
      commands.push({ destino: destinoSn, tipo, raw, comando: publicCommand(raw), detalle: `${tipo} slot ${row.FingerID ?? 0}` });
    }
  }

  return { commands, warnings };
}

function queryCommandsFor(dni: string, kinds: Set<BioKind>): string[] {
  const commands = [`DATA QUERY USERINFO PIN=${dni}`];
  if (kinds.has('huellas')) commands.push(`DATA QUERY FINGERTMP PIN=${dni}`);
  if (kinds.has('rostros') || kinds.has('caras')) {
    commands.push(`DATA QUERY tablename=biodata,fielddesc=*,filter=Type=9\tPin=${dni}`);
  }
  if (kinds.has('palmas')) {
    commands.push(`DATA QUERY tablename=biodata,fielddesc=*,filter=Type=10\tPin=${dni}`);
  }
  return [...new Set(commands)];
}

function biometricQueryCommandsFor(dni: string, kinds: Set<BioKind>): string[] {
  const commands: string[] = [];
  if (kinds.has('huellas')) commands.push(`DATA QUERY FINGERTMP PIN=${dni}`);
  if (kinds.has('rostros') || kinds.has('caras')) {
    commands.push(`DATA QUERY tablename=biodata,fielddesc=*,filter=Type=9\tPin=${dni}`);
  }
  if (kinds.has('palmas')) {
    commands.push(`DATA QUERY tablename=biodata,fielddesc=*,filter=Type=10\tPin=${dni}`);
  }
  return [...new Set(commands)];
}

function messageCommands(input: any): { commands: CommandPreview[]; smsId: number; content: string } {
  const sn = asString(input?.sn);
  const dni = normalizeDni(input?.dni);
  const content = cleanMessage(input?.contenido || input?.mensaje);
  if (!sn) throw new Error('sn es requerido');
  if (!content) throw new Error('mensaje es requerido');
  const personal = boolFrom(input?.personal, Boolean(dni));
  if (personal && !dni) throw new Error('dni es requerido para mensaje personal');
  const smsId = clampInt(input?.smsId, Math.floor(Date.now() / 1000) % 900000 + 10000, 1, 999999);
  const minutes = clampInt(input?.minutos, 1440, 0, 65535);
  const startTime = asString(input?.inicio) || nowMysql();
  const tag = personal ? 254 : 253;
  const update = [
    `UPDATE SMS ID=${smsId}`,
    `Tag=${tag}`,
    `ValidMinutes=${minutes}`,
    `StartTime=${startTime}`,
    `Content=${content}`,
  ].join('\t');
  const commands: CommandPreview[] = [
    { destino: sn, tipo: 'mensaje', comando: update, detalle: personal ? `Mensaje personal ${smsId}` : `Mensaje publico ${smsId}` },
  ];
  if (personal) {
    commands.push({
      destino: sn,
      tipo: 'mensaje',
      comando: `USER SMS PIN=${dni}\tSMSID=${smsId}`,
      detalle: `Asignar mensaje ${smsId} al PIN ${dni}`,
    });
  }
  return { commands, smsId, content };
}

function isIpLike(value: unknown): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}(?:\s+\S+)?$/.test(asString(value));
}

function deviceUiName(row: RowDataPacket, structure?: DeviceStructureName): string {
  const alias = asString(row.alias ?? row.Alias);
  if (alias && !isIpLike(alias)) return alias;
  const names = [structure?.sector, structure?.servicio, structure?.reparticion].filter(Boolean);
  if (names.length) return names.join(' / ');
  return asString(row.modelo ?? row.DeviceName) || asString(row.sn ?? row.SN);
}

export function buildFicheroBiometriaLabRouter(sequelize: Sequelize): Router {
  const router = Router();
  router.use(requirePermission('crud:*:*'));

  router.get('/dispositivos', async (_req: Request, res: Response) => {
    const conn = await conectarMySQL(cargarConfig());
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT SN AS sn, Alias AS alias, DeviceName AS modelo, IPAddress AS ip, PushVersion AS pushVersion,
                FWVersion AS firmware, FPVersion AS fpVersion, State AS state, DelTag AS delTag, LastActivity AS lastActivity
           FROM iclock
          ORDER BY DelTag, State DESC, Alias, SN`
      );
      const sns = rows.map(row => asString(row.sn)).filter(Boolean);
      const structureRows = sns.length ? await sequelize.query<DeviceStructureName>(
        `SELECT ads.sn,
                r.reparticion_nombre AS reparticion,
                s.nombre AS servicio,
                sec.nombre AS sector
           FROM adms_device_structures ads
           LEFT JOIN reparticiones r ON r.id = ads.reparticion_id AND r.deleted_at IS NULL
           LEFT JOIN servicios s ON s.id = ads.servicio_id AND s.deleted_at IS NULL
           LEFT JOIN sectores sec ON sec.id = ads.sector_id AND sec.deleted_at IS NULL
          WHERE ads.deleted_at IS NULL
            AND ads.fecha_hasta IS NULL
            AND ads.sn IN (:sns)`,
        { replacements: { sns }, type: QueryTypes.SELECT }
      ) : [];
      const structures = new Map(structureRows.map(row => [row.sn, row]));
      const data = rows.map(row => {
        const structure = structures.get(asString(row.sn));
        return {
          ...row,
          nombre: deviceUiName(row, structure),
          reparticion: structure?.reparticion ?? null,
          servicio: structure?.servicio ?? null,
          sector: structure?.sector ?? null,
        };
      });
      return res.json({ ok: true, data });
    } finally {
      await conn.end();
    }
  });

  router.get('/usuarios', async (req: Request, res: Response) => {
    const q = asString(req.query.q);
    const sn = asString(req.query.sn);
    const conn = await conectarMySQL(cargarConfig());
    try {
      const params: unknown[] = [];
      const where: string[] = [];
      if (q) {
        where.push('(ui.badgenumber LIKE ? OR ui.name LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
      }
      if (sn) {
        where.push('(ui.SN = ? OR EXISTS (SELECT 1 FROM checkinout ci WHERE ci.userid = ui.userid AND ci.SN = ? LIMIT 1))');
        params.push(sn, sn);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT ui.userid, ui.badgenumber AS dni, ui.name AS nombre, ui.SN AS sn,
                (SELECT COUNT(1) FROM template t WHERE t.userid = ui.userid AND COALESCE(t.DelTag,0)=0) AS huellas,
                (SELECT COUNT(1) FROM biotemplate bt WHERE bt.userid = ui.userid AND bt.BioType = 9 AND COALESCE(bt.DelTag,0)=0) AS rostros,
                (SELECT COUNT(1) FROM biotemplate bt WHERE bt.userid = ui.userid AND bt.BioType = 10 AND COALESCE(bt.DelTag,0)=0) AS palmas
           FROM userinfo ui
          ${whereSql}
          ORDER BY ui.name, ui.badgenumber
          LIMIT 80`,
        params
      );
      return res.json({ ok: true, data: rows });
    } finally {
      await conn.end();
    }
  });

  router.get('/usuarios/:dni/biometria', async (req: Request, res: Response) => {
    const dni = normalizeDni(req.params.dni);
    const sn = asString(req.query.sn);
    const conn = await conectarMySQL(cargarConfig());
    try {
      const user = await userByDni(conn, dni, sn);
      if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
      const [finger] = await conn.query<RowDataPacket[]>(
        `SELECT FingerID AS slot, Valid AS valid, SN AS sn, CHAR_LENGTH(Template) AS bytes
           FROM template
          WHERE userid = ? AND COALESCE(DelTag,0)=0
          ORDER BY FingerID`,
        [user.userid]
      );
      const [bio] = await conn.query<RowDataPacket[]>(
        `SELECT BioType AS bioType, FingerID AS slot, Valid AS valid, SN AS sn, CHAR_LENGTH(Template) AS bytes
           FROM biotemplate
          WHERE userid = ? AND COALESCE(DelTag,0)=0
          ORDER BY BioType, FingerID`,
        [user.userid]
      );
      return res.json({ ok: true, user, huellas: finger, biometria: bio });
    } finally {
      await conn.end();
    }
  });

  router.get('/biometria-fichero', async (req: Request, res: Response) => {
    const sn = asString(req.query.sn);
    const q = asString(req.query.q);
    const limit = clampInt(req.query.limit, 1000, 1, 5000);
    if (!sn) return res.status(400).json({ ok: false, error: 'sn es requerido' });
    const conn = await conectarMySQL(cargarConfig());
    try {
      const device = await deviceBySn(conn, sn);
      if (!device) return res.status(404).json({ ok: false, error: 'Fichero no encontrado' });
      await ensureSdkBioTable(conn);

      const params: unknown[] = [sn, sn, sn, sn, sn, sn, sn];
      const where: string[] = ['ui.SN = ?'];
      if (q) {
        where.push('(ui.badgenumber LIKE ? OR ui.name LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
      }
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT ui.userid,
                ui.badgenumber AS dni,
                ui.name AS nombre,
                ui.SN AS sn,
                ((SELECT COUNT(DISTINCT t.FingerID)
                    FROM template t
                   WHERE t.userid = ui.userid
                     AND t.SN = ?
                     AND COALESCE(t.DelTag, 0) = 0
                     AND t.Template IS NOT NULL
                     AND t.Template <> '')
                 + (SELECT COUNT(1)
                      FROM fichero_bio_sdk_templates sbt
                     WHERE sbt.pin = ui.badgenumber
                       AND sbt.origen_sn = ?
                       AND sbt.bio_type = 1
                       AND (sbt.template IS NOT NULL OR sbt.raw_line IS NOT NULL))) AS huellas,
                ((SELECT COUNT(1)
                    FROM biotemplate bt
                   WHERE bt.userid = ui.userid
                     AND bt.SN = ?
                     AND bt.BioType = 9
                     AND COALESCE(bt.DelTag, 0) = 0
                     AND bt.Template IS NOT NULL
                     AND bt.Template <> '')
                 + (SELECT COUNT(1)
                      FROM fichero_bio_sdk_templates sbt
                     WHERE sbt.pin = ui.badgenumber
                       AND sbt.origen_sn = ?
                       AND sbt.bio_type = 9
                       AND (sbt.template IS NOT NULL OR sbt.raw_line IS NOT NULL))) AS caras,
                ((SELECT COUNT(1)
                    FROM biotemplate bt
                   WHERE bt.userid = ui.userid
                     AND bt.SN = ?
                     AND bt.BioType = 10
                     AND COALESCE(bt.DelTag, 0) = 0
                     AND bt.Template IS NOT NULL
                     AND bt.Template <> '')
                 + (SELECT COUNT(1)
                      FROM fichero_bio_sdk_templates sbt
                     WHERE sbt.pin = ui.badgenumber
                       AND sbt.origen_sn = ?
                       AND sbt.bio_type = 10
                       AND (sbt.template IS NOT NULL OR sbt.raw_line IS NOT NULL))) AS palmas
           FROM userinfo ui
          WHERE ${where.join(' AND ')}
          ORDER BY ui.name, ui.badgenumber
          LIMIT ?`,
        [...params, limit]
      );
      const resumen = rows.reduce((acc, row) => {
        acc.total += 1;
        if (Number(row.huellas || 0) > 0) acc.conHuella += 1;
        if (Number(row.caras || 0) > 0) acc.conCara += 1;
        if (Number(row.palmas || 0) > 0) acc.conPalma += 1;
        return acc;
      }, { total: 0, conHuella: 0, conCara: 0, conPalma: 0 });
      return res.json({ ok: true, sn, resumen, data: rows });
    } finally {
      await conn.end();
    }
  });

  router.post('/biometria-fichero/actualizar', async (req: Request, res: Response) => {
    const sn = asString(req.body?.sn);
    const q = asString(req.body?.q);
    const limit = clampInt(req.body?.limit, 1000, 1, 5000);
    const soloFaltantes = boolFrom(req.body?.soloFaltantes, true);
    const kinds = wantedKinds(req.body?.incluir || req.body);
    const wantsHuellas = kinds.has('huellas');
    const wantsCaras = kinds.has('rostros') || kinds.has('caras');
    const wantsPalmas = kinds.has('palmas');
    if (!sn) return res.status(400).json({ ok: false, error: 'sn es requerido' });
    if (!wantsHuellas && !wantsCaras && !wantsPalmas) {
      return res.status(400).json({ ok: false, error: 'Elegí al menos huellas, cara o palma' });
    }

    const conn = await conectarMySQL(cargarConfig());
    try {
      const device = await deviceBySn(conn, sn);
      if (!device) return res.status(404).json({ ok: false, error: 'Fichero no encontrado' });
      const canQueryBiodata = supportsAdmsBiodata(device);
      const warnings = !canQueryBiodata && (wantsCaras || wantsPalmas)
        ? [admsBiodataUnsupportedReason(device)]
        : [];

      const params: unknown[] = [sn, sn, sn, sn];
      const where: string[] = ['ui.SN = ?'];
      if (q) {
        where.push('(ui.badgenumber LIKE ? OR ui.name LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
      }
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT ui.userid,
                ui.badgenumber AS dni,
                ui.name AS nombre,
                COUNT(DISTINCT CASE WHEN t.SN = ? THEN t.FingerID END) AS huellas,
                COUNT(DISTINCT CASE WHEN bt.SN = ? AND bt.BioType = 9 THEN bt.id END) AS caras,
                COUNT(DISTINCT CASE WHEN bt.SN = ? AND bt.BioType = 10 THEN bt.id END) AS palmas
           FROM userinfo ui
           LEFT JOIN template t ON t.userid = ui.userid
             AND COALESCE(t.DelTag, 0) = 0
             AND t.Template IS NOT NULL
             AND t.Template <> ''
           LEFT JOIN biotemplate bt ON bt.userid = ui.userid
             AND COALESCE(bt.DelTag, 0) = 0
             AND bt.Template IS NOT NULL
             AND bt.Template <> ''
          WHERE ${where.join(' AND ')}
          GROUP BY ui.userid, ui.badgenumber, ui.name
          ORDER BY ui.name, ui.badgenumber
          LIMIT ?`,
        [...params, limit]
      );

      const ids: number[] = [];
      let usuarios = 0;
      let omitidos = 0;
      const resumen = { huellas: 0, caras: 0, palmas: 0 };

      for (const row of rows) {
        const dni = normalizeDni(row.dni);
        if (!dni) {
          omitidos += 1;
          continue;
        }
        const userKinds = new Set<BioKind>();
        if (wantsHuellas && (!soloFaltantes || Number(row.huellas || 0) === 0)) {
          userKinds.add('huellas');
          resumen.huellas += 1;
        }
        if (canQueryBiodata && wantsCaras && (!soloFaltantes || Number(row.caras || 0) === 0)) {
          userKinds.add('caras');
          resumen.caras += 1;
        }
        if (canQueryBiodata && wantsPalmas && (!soloFaltantes || Number(row.palmas || 0) === 0)) {
          userKinds.add('palmas');
          resumen.palmas += 1;
        }
        if (!userKinds.size) {
          omitidos += 1;
          continue;
        }

        usuarios += 1;
        for (const command of biometricQueryCommandsFor(dni, userKinds)) {
          ids.push(await appendCommand(conn, sn, command));
        }
      }

      return res.json({
        ok: true,
        sn,
        ids: ids.slice(-80),
        total: ids.length,
        usuarios,
        omitidos,
        resumen,
        warnings,
        limitadoA: limit,
        soloFaltantes,
      });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || String(e) });
    } finally {
      await conn.end();
    }
  });

  router.post('/lectura/enviar', async (req: Request, res: Response) => {
    const sn = asString(req.body?.sn);
    const dni = normalizeDni(req.body?.dni);
    if (!sn || !dni) return res.status(400).json({ ok: false, error: 'sn y dni son requeridos' });
    const kinds = wantedKinds(req.body?.incluir || req.body);
    const conn = await conectarMySQL(cargarConfig());
    try {
      const device = await deviceBySn(conn, sn);
      if (!device) return res.status(404).json({ ok: false, error: 'Fichero no encontrado' });
      const canQueryBiodata = supportsAdmsBiodata(device);
      const effectiveKinds = new Set<BioKind>();
      for (const kind of kinds) {
        if ((kind === 'rostros' || kind === 'caras' || kind === 'palmas') && !canQueryBiodata) continue;
        effectiveKinds.add(kind);
      }
      const warnings = !canQueryBiodata && (kinds.has('rostros') || kinds.has('caras') || kinds.has('palmas'))
        ? [admsBiodataUnsupportedReason(device)]
        : [];
      const commands = queryCommandsFor(dni, effectiveKinds);
      const ids: number[] = [];
      for (const command of commands) ids.push(await appendCommand(conn, sn, command));
      return res.json({ ok: true, ids, total: ids.length, comandos: commands, warnings });
    } finally {
      await conn.end();
    }
  });

  router.post('/transferencias/preview', async (req: Request, res: Response) => {
    const origenSn = asString(req.body?.origenSn);
    const destinoSn = asString(req.body?.destinoSn);
    const dni = normalizeDni(req.body?.dni);
    if (!origenSn || !destinoSn || !dni) return res.status(400).json({ ok: false, error: 'origenSn, destinoSn y dni son requeridos' });
    const conn = await conectarMySQL(cargarConfig());
    try {
      const result = await buildTransferCommands(conn, origenSn, destinoSn, dni, wantedKinds(req.body?.incluir));
      return res.json({
        ok: true,
        data: result.commands.map(({ raw: _raw, ...cmd }) => cmd),
        total: result.commands.length,
        warnings: result.warnings,
      });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || String(e) });
    } finally {
      await conn.end();
    }
  });

  router.post('/transferencias/enviar', async (req: Request, res: Response) => {
    const origenSn = asString(req.body?.origenSn);
    const destinoSn = asString(req.body?.destinoSn);
    const dni = normalizeDni(req.body?.dni);
    if (!origenSn || !destinoSn || !dni) return res.status(400).json({ ok: false, error: 'origenSn, destinoSn y dni son requeridos' });
    const kinds = wantedKinds(req.body?.incluir);
    const conn = await conectarMySQL(cargarConfig());
    try {
      const result = await buildTransferCommands(conn, origenSn, destinoSn, dni, kinds);
      const ids: number[] = [];
      for (const cmd of result.commands) ids.push(await appendCommand(conn, destinoSn, cmd.raw));
      let sdk: SdkBioTransferResult | null = null;
      const wantsFace = kinds.has('rostros') || kinds.has('caras');
      const wantsPalm = kinds.has('palmas');
      if (wantsFace || wantsPalm) {
        const origen = await deviceBySn(conn, origenSn);
        const destino = await deviceBySn(conn, destinoSn);
        const user = await userByDni(conn, dni, origenSn);
        const useSdk = destino && !supportsAdmsBiodata(destino);
        if (useSdk) {
          const origenIp = asString(origen?.IPAddress);
          const destinoIp = asString(destino?.IPAddress);
          if (!origenIp || !destinoIp) {
            result.warnings.push('SDK directo no ejecutado: falta IP en origen o destino.');
          } else {
            sdk = await runSdkBioTransfer({
              origenIp,
              destinoIp,
              dni,
              userName: asString(user?.name),
              password: asString(user?.Password),
              privilege: Number(user?.Privilege ?? 0) || 0,
              includeFace: wantsFace,
              includePalm: wantsPalm,
            });
            if (sdk.ok) {
              const rows = [
                ...((sdk.captured?.faces || []) as SdkBioRow[]),
                ...((sdk.captured?.biodata || []) as SdkBioRow[]),
              ];
              const saved = await saveSdkBioRows(conn, origenSn, dni, rows);
              const appliedOk = (sdk.applied || []).filter(row => row.ok).length;
              result.warnings.push(`SDK directo cara/palma: ${appliedOk} aplicado(s), ${saved} guardado(s) en tabla nueva.`);
              for (const err of [...(sdk.captured?.errors || []), ...(sdk.userErrors || []), ...(sdk.applyErrors || [])]) {
                result.warnings.push(err);
              }
            } else {
              result.warnings.push(`SDK directo cara/palma fallo: ${sdk.error || 'sin detalle'}`);
            }
          }
        }
      }
      return res.json({
        ok: true,
        ids,
        total: ids.length,
        warnings: result.warnings,
        data: result.commands.map(({ raw: _raw, ...cmd }) => cmd),
        sdk: sdk ? {
          ok: sdk.ok,
          applied: sdk.applied,
          captured: {
            faces: sdk.captured?.faces?.length || 0,
            biodata: sdk.captured?.biodata?.length || 0,
            errors: sdk.captured?.errors || [],
          },
          error: sdk.error,
        } : null,
      });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || String(e) });
    } finally {
      await conn.end();
    }
  });

  router.post('/mensajes/preview', (req: Request, res: Response) => {
    try {
      const result = messageCommands(req.body);
      return res.json({ ok: true, smsId: result.smsId, content: result.content, data: result.commands, total: result.commands.length });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || String(e) });
    }
  });

  router.post('/mensajes/enviar', async (req: Request, res: Response) => {
    const conn = await conectarMySQL(cargarConfig());
    try {
      const result = messageCommands(req.body);
      const ids: number[] = [];
      for (const cmd of result.commands) ids.push(await appendCommand(conn, cmd.destino, cmd.comando));
      return res.json({ ok: true, ids, total: ids.length, smsId: result.smsId, content: result.content, data: result.commands });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || String(e) });
    } finally {
      await conn.end();
    }
  });

  router.get('/comandos', async (req: Request, res: Response) => {
    const sn = asString(req.query.sn);
    const ids = asString(req.query.ids).split(',').map(v => Number(v.trim())).filter(Number.isFinite);
    const conn = await conectarMySQL(cargarConfig());
    try {
      const params: unknown[] = [];
      const where: string[] = [];
      if (sn) {
        where.push('SN_id = ?');
        params.push(sn);
      }
      if (ids.length) {
        where.push(`id IN (${ids.map(() => '?').join(',')})`);
        params.push(...ids);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id, SN_id AS sn, CmdContent AS comando, CmdCommitTime AS creado,
                CmdTransTime AS enviadoAlReloj, CmdOverTime AS finalizado, CmdReturn AS retorno
           FROM devcmds
          ${whereSql}
          ORDER BY id DESC
          LIMIT 80`,
        params
      );
      return res.json({ ok: true, data: rows });
    } finally {
      await conn.end();
    }
  });

  // ============ SDK directo (COM zkemkeeper, 32 bits) ============

  // Identidad + capacidades reales del reloj (huella/cara/palma).
  router.post('/sdk/info', async (req: Request, res: Response) => {
    const sn = asString(req.body?.sn);
    if (!sn) return res.status(400).json({ ok: false, error: 'sn es requerido' });
    const conn = await conectarMySQL(cargarConfig());
    try {
      const resolved = await resolveDeviceIp(conn, sn);
      if ('error' in resolved) return res.status(resolved.status).json({ ok: false, error: resolved.error });
      const out = await runSdk({ action: 'info', ip: resolved.ip });
      return res.json({ ...out, sn, ip: resolved.ip });
    } finally {
      await conn.end();
    }
  });

  // Diagnostico contra el reloj real: identidad + capacidades + sonda en vivo
  // (prueba si cara/huella/biodata se pueden leer en ese firmware).
  router.post('/sdk/diagnostico', async (req: Request, res: Response) => {
    const sn = asString(req.body?.sn);
    const dni = normalizeDni(req.body?.dni);
    if (!sn) return res.status(400).json({ ok: false, error: 'sn es requerido' });
    const conn = await conectarMySQL(cargarConfig());
    try {
      const resolved = await resolveDeviceIp(conn, sn);
      if ('error' in resolved) return res.status(resolved.status).json({ ok: false, error: resolved.error });
      const out = await runSdk({ action: 'diagnose', ip: resolved.ip, pin: dni });
      return res.json({ ...out, sn, ip: resolved.ip, dni });
    } finally {
      await conn.end();
    }
  });

  // Contar huella/cara/palma de un PIN directamente en el reloj (no en la base).
  router.post('/sdk/contar', async (req: Request, res: Response) => {
    const sn = asString(req.body?.sn);
    const dni = normalizeDni(req.body?.dni);
    if (!sn || !dni) return res.status(400).json({ ok: false, error: 'sn y dni son requeridos' });
    const conn = await conectarMySQL(cargarConfig());
    try {
      const resolved = await resolveDeviceIp(conn, sn);
      if ('error' in resolved) return res.status(resolved.status).json({ ok: false, error: resolved.error });
      const out = await runSdk({ action: 'count', ip: resolved.ip, pin: dni });
      return res.json({ ...out, sn, ip: resolved.ip, dni });
    } finally {
      await conn.end();
    }
  });

  // Leer un usuario directamente del reloj.
  router.post('/sdk/usuario', async (req: Request, res: Response) => {
    const sn = asString(req.body?.sn);
    const dni = normalizeDni(req.body?.dni);
    if (!sn || !dni) return res.status(400).json({ ok: false, error: 'sn y dni son requeridos' });
    const conn = await conectarMySQL(cargarConfig());
    try {
      const resolved = await resolveDeviceIp(conn, sn);
      if ('error' in resolved) return res.status(resolved.status).json({ ok: false, error: resolved.error });
      const out = await runSdk({ action: 'readUser', ip: resolved.ip, pin: dni });
      return res.json({ ...out, sn, ip: resolved.ip, dni });
    } finally {
      await conn.end();
    }
  });

  // Borrar biometria/usuario en el reloj (peligroso).
  router.post('/sdk/borrar', async (req: Request, res: Response) => {
    const sn = asString(req.body?.sn);
    const dni = normalizeDni(req.body?.dni);
    const scope = (asString(req.body?.alcance || req.body?.scope) || 'todo').toLowerCase();
    const allowed = ['todo', 'huellas', 'cara', 'palma', 'usuario'];
    if (!sn || !dni) return res.status(400).json({ ok: false, error: 'sn y dni son requeridos' });
    if (!allowed.includes(scope)) return res.status(400).json({ ok: false, error: `alcance invalido (usar: ${allowed.join(', ')})` });
    const conn = await conectarMySQL(cargarConfig());
    try {
      const resolved = await resolveDeviceIp(conn, sn);
      if ('error' in resolved) return res.status(resolved.status).json({ ok: false, error: resolved.error });
      const out = await runSdk({ action: 'delete', ip: resolved.ip, pin: dni, scope });
      return res.json({ ...out, sn, ip: resolved.ip, dni, scope });
    } finally {
      await conn.end();
    }
  });

  // Transferir por SDK directo: usuario + huella + cara + palma, origen -> destino.
  router.post('/sdk/transferir', async (req: Request, res: Response) => {
    const origenSn = asString(req.body?.origenSn);
    const destinoSn = asString(req.body?.destinoSn);
    const dni = normalizeDni(req.body?.dni);
    if (!origenSn || !destinoSn || !dni) return res.status(400).json({ ok: false, error: 'origenSn, destinoSn y dni son requeridos' });
    if (origenSn === destinoSn) return res.status(400).json({ ok: false, error: 'Origen y destino no pueden ser el mismo fichero' });
    const kinds = wantedKinds(req.body?.incluir);
    const includeUser = kinds.has('usuario');
    const includeFinger = kinds.has('huellas');
    const includeFace = kinds.has('rostros') || kinds.has('caras');
    const includePalm = kinds.has('palmas');
    if (!includeUser && !includeFinger && !includeFace && !includePalm) {
      return res.status(400).json({ ok: false, error: 'Elegí al menos usuario, huella, cara o palma' });
    }
    const conn = await conectarMySQL(cargarConfig());
    try {
      const origen = await resolveDeviceIp(conn, origenSn);
      if ('error' in origen) return res.status(origen.status).json({ ok: false, error: `Origen: ${origen.error}` });
      const destino = await resolveDeviceIp(conn, destinoSn);
      if ('error' in destino) return res.status(destino.status).json({ ok: false, error: `Destino: ${destino.error}` });

      const user = await userByDni(conn, dni, origenSn);
      const out = await runSdk<SdkBioTransferResult>({
        action: 'transfer',
        originIp: origen.ip,
        targetIp: destino.ip,
        pin: dni,
        userName: asString(user?.name),
        password: asString(user?.Password),
        privilege: Number(user?.Privilege ?? 0) || 0,
        includeUser,
        includeFinger,
        includeFace,
        includePalm,
      });

      let guardados = 0;
      if (out.ok) {
        const fingerRows: SdkBioRow[] = ((out.captured?.fingers || []) as SdkBioRow[]).map(f => ({ ...f, bioType: 1 }));
        const rows: SdkBioRow[] = [
          ...((out.captured?.faces || []) as SdkBioRow[]),
          ...((out.captured?.biodata || []) as SdkBioRow[]),
          ...fingerRows,
        ];
        guardados = await saveSdkBioRows(conn, origenSn, dni, rows);
      }

      const applied = out.applied || [];
      const aplicadosOk = applied.filter(r => r.ok).length;
      return res.json({
        ...out,
        origenSn,
        destinoSn,
        dni,
        guardados,
        aplicadosOk,
        aplicadosTotal: applied.length,
      });
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || String(e) });
    } finally {
      await conn.end();
    }
  });

  return router;
}
