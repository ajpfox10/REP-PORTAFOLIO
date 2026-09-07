import express, { Router, Request, Response } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { cargarConfig, conectarMySQL } from './fichero.routes';
import { recordAdmsRuntimeEvent } from '../services/admsRuntime';
import { recordAdmsAttendanceAudioEvent } from '../services/admsAudio';

function text(res: Response, body: string, status = 200): Response {
  return res.status(status).type('text/plain; charset=utf-8').send(body);
}

function one(value: unknown): string {
  return String(value ?? '').trim();
}

function cleanSn(value: unknown): string {
  return one(value).slice(0, 20);
}

function remoteIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  return (
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim()
    || req.socket.remoteAddress
    || req.ip
    || ''
  ).replace(/^::ffff:/, '');
}

function isLoopbackIp(ip: string): boolean {
  return ip === '::1' || ip === '127.0.0.1' || ip === 'localhost';
}

function recordEvent(req: Request, sn: string, endpoint: string, ok: boolean, detail: string): void {
  recordAdmsRuntimeEvent({ sn, endpoint, method: req.method, ip: remoteIp(req), ok, detail });
}

function mysqlNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function bodyAsText(req: Request): string {
  const body = req.body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    return new URLSearchParams(body as Record<string, string>).toString();
  }
  return '';
}

function bodyAsBuffer(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) return req.body;
  return Buffer.from(bodyAsText(req), 'utf8');
}

function parseKeyValueLine(line: string): Record<string, string> {
  const row: Record<string, string> = {};
  for (const part of line.trim().split(/\t+/)) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const rawKey = part.slice(0, idx).trim();
    const key = rawKey.split(/\s+/).pop() || rawKey;
    row[key] = part.slice(idx + 1);
  }
  return row;
}

function uploadRoot(): string {
  return path.resolve(process.cwd(), 'fichadas', 'adms_uploads');
}

function safeSegment(value: unknown): string {
  return one(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unknown';
}

function saveUpload(parts: string[], filename: string, data: Buffer): string {
  const dir = path.join(uploadRoot(), ...parts.map(safeSegment));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, safeSegment(filename));
  fs.writeFileSync(filePath, data);
  return filePath;
}

function csvSet(value: string | undefined): Set<string> {
  return new Set(String(value || '').split(',').map(v => v.trim()).filter(Boolean));
}

function isAllowedDevice(sn: string, ip: string): boolean {
  const allowedSn = csvSet(process.env.ADMS_ALLOWED_SN);
  const allowedIp = csvSet(process.env.ADMS_ALLOWED_IP);
  if (allowedSn.size && !allowedSn.has(sn)) return false;
  if (allowedIp.size && !allowedIp.has(ip)) return false;
  return true;
}

function parseDevicePosts(raw: string): Array<Record<string, string>> {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  return lines.map(line => {
    const row: Record<string, string> = {};
    for (const part of line.split('&')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      row[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1).replace(/\+/g, ' '));
    }
    return row;
  });
}

function extractUploadContent(raw: Buffer, post: Record<string, string>): Buffer {
  if (post.Content) return Buffer.from(post.Content, 'utf8');
  const textBody = raw.toString('binary');
  const marker = 'Content=';
  const idx = textBody.indexOf(marker);
  if (idx < 0) return Buffer.alloc(0);
  return raw.subarray(idx + marker.length);
}

function parseAttLogLine(line: string): {
  pin: string;
  checktime: string;
  checktype: string;
  verifycode: string | null;
  sensorid: string | null;
} | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const [pin, date, time, checktype = '0', verifycode = null, sensorid = null] = parts;
  if (!pin || !date || !time) return null;
  return { pin, checktime: `${date} ${time}`, checktype, verifycode, sensorid };
}

async function ensureUser(
  conn: Awaited<ReturnType<typeof conectarMySQL>>,
  sn: string,
  pin: string,
  defaults: Record<string, string> = {}
): Promise<number> {
  const [users] = await conn.query<RowDataPacket[]>('SELECT userid FROM userinfo WHERE badgenumber = ? LIMIT 1', [pin]);
  if (users[0]?.userid) return Number(users[0].userid);

  const [ins] = await conn.query<ResultSetHeader>(
    `INSERT INTO userinfo (badgenumber, name, defaultdeptid, Password, Card, Privilege, AccGroup, TimeZones, SN, UTime, DelTag)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      pin,
      defaults.Name || ' ',
      defaults.Passwd || '',
      defaults.Card || '',
      Number(defaults.Pri ?? 0) || 0,
      Number(defaults.Grp ?? 1) || 1,
      defaults.TZ || '',
      sn,
      mysqlNow(),
    ]
  );
  return ins.insertId;
}

async function saveUserInfoLine(
  conn: Awaited<ReturnType<typeof conectarMySQL>>,
  sn: string,
  line: string
): Promise<void> {
  const data = parseKeyValueLine(line);
  const pin = data.PIN || data.Badgenumber || data.badgenumber;
  if (!pin) throw new Error('USERINFO sin PIN');
  await ensureUser(conn, sn, pin, data);
  await conn.query(
    `UPDATE userinfo
        SET name = COALESCE(NULLIF(?, ''), name),
            Password = COALESCE(NULLIF(?, ''), Password),
            Card = COALESCE(NULLIF(?, ''), Card),
            Privilege = ?,
            AccGroup = ?,
            TimeZones = COALESCE(NULLIF(?, ''), TimeZones),
            SN = ?,
            UTime = ?,
            DelTag = 0
      WHERE badgenumber = ?`,
    [
      data.Name || '',
      data.Passwd || '',
      data.Card || '',
      Number(data.Pri ?? 0) || 0,
      Number(data.Grp ?? 1) || 1,
      data.TZ || '',
      sn,
      mysqlNow(),
      pin,
    ]
  );
}

async function saveFingerTemplateLine(
  conn: Awaited<ReturnType<typeof conectarMySQL>>,
  sn: string,
  line: string
): Promise<void> {
  const data = parseKeyValueLine(line);
  const pin = data.PIN;
  const fingerId = Number(data.FID ?? data.FingerID);
  const template = data.TMP || data.Template || '';
  if (!pin || !Number.isFinite(fingerId) || !template) throw new Error('FINGERTMP incompleto');
  const userid = await ensureUser(conn, sn, pin);

  await conn.query(
    `INSERT INTO template (userid, Template, FingerID, Valid, DelTag, SN, UTime)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON DUPLICATE KEY UPDATE
       Template = VALUES(Template),
       Valid = VALUES(Valid),
       DelTag = 0,
       SN = VALUES(SN),
       UTime = VALUES(UTime)`,
    [userid, template, fingerId, Number(data.Valid ?? 1) || 1, sn, mysqlNow()]
  );
}

async function saveBioTemplateLine(
  conn: Awaited<ReturnType<typeof conectarMySQL>>,
  sn: string,
  line: string
): Promise<void> {
  const data = parseKeyValueLine(line);
  const pin = data.PIN || data.Pin || data.pin;
  const bioType = Number(data.BioType ?? data.Type ?? data.type ?? 10);
  const index = Number(data.Index ?? data.index ?? data.FingerID ?? data.No ?? data.no ?? 0);
  const valid = Number(data.Valid ?? data.valid ?? 1);
  const duress = Number(data.Duress ?? data.duress ?? 0);
  const fmt = Number(data.Format ?? data.format ?? 0);
  const majVer = Number(data.MajorVer ?? data.majorver ?? 0);
  const minVer = Number(data.MinorVer ?? data.minorver ?? 0);
  const tmp = data.Tmp || data.TMP || data.Template || data.template || data.Content || data.tmp || '';
  if (!pin || !tmp) throw new Error('BIODATA incompleto');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS biotemplate (
      id       INT AUTO_INCREMENT PRIMARY KEY,
      userid   INT NOT NULL,
      BioType  TINYINT NOT NULL DEFAULT 10,
      FingerID TINYINT NOT NULL DEFAULT 0,
      Valid    TINYINT NOT NULL DEFAULT 1,
      Duress   TINYINT NOT NULL DEFAULT 0,
      Format   TINYINT NOT NULL DEFAULT 0,
      MajorVer TINYINT NOT NULL DEFAULT 0,
      MinorVer TINYINT NOT NULL DEFAULT 0,
      Template MEDIUMTEXT,
      SN       VARCHAR(20),
      UTime    DATETIME,
      DelTag   TINYINT NOT NULL DEFAULT 0,
      UNIQUE KEY uk_userid_biotype_slot (userid, BioType, FingerID)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const userid = await ensureUser(conn, sn, pin);
  await conn.query(
    `INSERT INTO biotemplate (userid, BioType, FingerID, Valid, Duress, Format, MajorVer, MinorVer, Template, SN, UTime, DelTag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       Valid=VALUES(Valid), Duress=VALUES(Duress), Format=VALUES(Format),
       MajorVer=VALUES(MajorVer), MinorVer=VALUES(MinorVer),
       Template=VALUES(Template), SN=VALUES(SN), UTime=VALUES(UTime), DelTag=0`,
    [userid, bioType, index, valid, duress, fmt, majVer, minVer, tmp, sn, mysqlNow()]
  );
}

function queryDataLines(raw: string): string[] {
  const textBody = raw.trim();
  if (!textBody) return [];
  const lines = textBody.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return textBody.split('$').map(line => line.trim()).filter(Boolean);
}

function inferQueryDataTable(table: string, line: string): string {
  if (table) return table.toUpperCase();
  const data = parseKeyValueLine(line);
  if (data.Tmp || data.TMP || data.tmp || data.BioType || data.Type || data.type || data.MajorVer || data.majorver) return 'BIODATA';
  if (data.FID || data.FingerID || data.TMP) return 'FINGERTMP';
  if (data.Name || data.Passwd || data.Card || data.Pri || data.Badgenumber) return 'USERINFO';
  return '';
}

async function ensureDevice(req: Request, res: Response) {
  const cfg = cargarConfig();
  const sn = cleanSn(req.query.SN);
  if (!sn) {
    text(res, 'UNKNOWN Device');
    return { conn: null, cfg, device: null as RowDataPacket | null, sn };
  }

  const conn = await conectarMySQL(cfg);
  const [rows] = await conn.query<RowDataPacket[]>('SELECT * FROM iclock WHERE SN = ? LIMIT 1', [sn]);
  const now = mysqlNow();
  const ip = remoteIp(req);
  const pushVersion = one(req.query.pushver || req.query.PushVersion);
  if (!isAllowedDevice(sn, ip)) {
    await conn.end();
    recordEvent(req, sn, 'security', false, `blocked ip=${ip}`);
    text(res, `UNKNOWN Device: ${sn}`, 403);
    return { conn: null, cfg, device: null as RowDataPacket | null, sn };
  }

  if (!rows.length) {
    await conn.query(
      `INSERT INTO iclock
         (SN, Alias, LastActivity, IPAddress, State, TransTimes, TransInterval, LogStamp, OpLogStamp, PhotoStamp, UpdateDB, AccFun, TZAdj, DelTag, PushVersion)
       VALUES (?, ?, ?, ?, 1, '00:00;14:05', 1, 0, 0, 0, '1111111100', 0, 14, 0, ?)`,
      [sn, ip || sn, now, ip, pushVersion || '0.0']
    );
  } else if (Number(rows[0].DelTag ?? 0) === 1 || Number(rows[0].State ?? 1) === 0) {
    await conn.end();
    text(res, `UNKNOWN Device: ${sn}`);
    return { conn: null, cfg, device: null as RowDataPacket | null, sn };
  } else {
    const ipSql = isLoopbackIp(ip) ? '' : ', IPAddress = COALESCE(NULLIF(?, ""), IPAddress)';
    await conn.query(
      `UPDATE iclock
          SET LastActivity = ?${ipSql}
              ${pushVersion ? ', PushVersion = ?' : ''}
        WHERE SN = ?`,
      pushVersion
        ? (ipSql ? [now, ip, pushVersion, sn] : [now, pushVersion, sn])
        : (ipSql ? [now, ip, sn] : [now, sn])
    );
  }

  const [fresh] = await conn.query<RowDataPacket[]>('SELECT * FROM iclock WHERE SN = ? LIMIT 1', [sn]);
  return { conn, cfg, device: fresh[0] ?? null, sn };
}

async function saveDeviceInfo(conn: Awaited<ReturnType<typeof conectarMySQL>>, sn: string, info: string): Promise<void> {
  const parts = info.split(',');
  if (parts.length < 4) return;
  const fields: string[] = ['FWVersion = ?', 'UserCount = ?', 'FPCount = ?', 'TransactionCount = ?'];
  const params: Array<string | number> = [parts[0], Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0];
  if (parts[4]) {
    fields.push('IPAddress = ?');
    params.push(parts[4]);
  }
  if (parts[5]) {
    fields.push('FPVersion = ?');
    params.push(parts[5]);
  }
  params.push(sn);
  await conn.query(`UPDATE iclock SET ${fields.join(', ')} WHERE SN = ?`, params);
}

async function handleCdataGet(req: Request, res: Response): Promise<Response> {
  const ctx = await ensureDevice(req, res);
  if (!ctx.conn || !ctx.device) return res;
  try {
    const d = ctx.device;
    const pushver = one(req.query.pushver);
    const attStamp = pushver ? 'ATTLOGStamp' : 'Stamp';
    const opStamp = pushver ? 'OPERLOGStamp' : 'OpStamp';
    const photoStamp = pushver ? 'ATTPHOTOStamp' : 'PhotoStamp';
    const body = [
      `GET OPTION FROM: ${ctx.sn}`,
      `${attStamp}=${d.LogStamp ?? 0}`,
      `${opStamp}=${d.OpLogStamp ?? 0}`,
      `${photoStamp}=${d.PhotoStamp ?? 0}`,
      'ErrorDelay=30',
      'Delay=10',
      `TransTimes=${d.TransTimes || '00:00;14:05'}`,
      `TransInterval=${Math.max(1, Number(d.TransInterval ?? 1))}`,
      `TransFlag=${String(d.UpdateDB || '1111111100').replace(/\\t/g, '\t')}`,
      `TimeZone=${d.TZAdj == null || Number(d.TZAdj) === 14 ? 0 : d.TZAdj}`,
      'Realtime=1',
      'Encrypt=0',
      // Anunciar soporte multi-biométrico: posición 10 = palma visible
      'MultiBioDataSupport=0:0:0:0:0:0:0:0:0:1:0',
      ...(pushver ? ['ServerVer=0.0.2 2010-07-22', 'TableNameStamp'] : []),
      '',
    ].join('\n');
    await ctx.conn.end();
    recordEvent(req, ctx.sn, 'cdata:get', true, 'options');
    return text(res, body);
  } catch (e: any) {
    recordEvent(req, ctx.sn, 'cdata:get', false, String(e?.message ?? e));
    await ctx.conn.end();
    return text(res, String(e?.message ?? e), 500);
  }
}

async function handleCdataPost(req: Request, res: Response): Promise<Response> {
  const ctx = await ensureDevice(req, res);
  if (!ctx.conn || !ctx.device) return res;
  try {
    const raw = bodyAsText(req);
    const table = one(req.query.table || req.query.type || req.query.Type).toUpperCase();
    const stamp = one(req.query.Stamp || req.query.ATTLOGStamp || req.query.OpStamp || req.query.OPERLOGStamp);
    let ok = 0;
    let errors = 0;

    if (table === 'USERINFO') {
      for (const line of raw.split(/\r?\n/).filter(Boolean)) {
        try {
          await saveUserInfoLine(ctx.conn, ctx.sn, line);
          ok++;
        } catch {
          errors++;
        }
      }
      if (stamp) await ctx.conn.query('UPDATE iclock SET OpLogStamp = ? WHERE SN = ?', [stamp, ctx.sn]);
      await ctx.conn.query('INSERT INTO devlog (SN_id, OP, Object, Cnt, ECnt, OpTime) VALUES (?, ?, ?, ?, ?, ?)', [ctx.sn, 'USERDATA', 'USERINFO', ok, errors, mysqlNow()]);
    } else if (table === 'FINGERTMP' || table === 'TEMPLATE') {
      for (const line of raw.split(/\r?\n/).filter(Boolean)) {
        try {
          await saveFingerTemplateLine(ctx.conn, ctx.sn, line);
          ok++;
        } catch {
          errors++;
        }
      }
      if (stamp) await ctx.conn.query('UPDATE iclock SET OpLogStamp = ? WHERE SN = ?', [stamp, ctx.sn]);
      await ctx.conn.query('INSERT INTO devlog (SN_id, OP, Object, Cnt, ECnt, OpTime) VALUES (?, ?, ?, ?, ?, ?)', [ctx.sn, 'USERDATA', 'FINGERTMP', ok, errors, mysqlNow()]);
    } else if (table === 'OPERLOG' || req.query.OpStamp || req.query.OPERLOGStamp) {
      for (const line of raw.split(/\r?\n/).filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        try {
          await ctx.conn.query(
            `INSERT IGNORE INTO iclock_oplog (SN, admin, OP, OPTime, Object, Param1, Param2, Param3)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [ctx.sn, Number(parts[0]) || 0, Number(parts[1]) || 0, `${parts[2] || mysqlNow().slice(0, 10)} ${parts[3] || mysqlNow().slice(11)}`, parts[4] || null, parts[5] || null, parts[6] || null, parts[7] || null]
          );
          ok++;
        } catch {
          errors++;
        }
      }
      if (stamp) await ctx.conn.query('UPDATE iclock SET OpLogStamp = ? WHERE SN = ?', [stamp, ctx.sn]);
      await ctx.conn.query('INSERT INTO devlog (SN_id, OP, Object, Cnt, ECnt, OpTime) VALUES (?, ?, ?, ?, ?, ?)', [ctx.sn, 'USERDATA', 'OPERLOG', ok, errors, mysqlNow()]);
    } else if ((table === 'BIODATA' || table === 'BIOTEMPLATE' || table === 'BIOPHOTO') && !req.query.FPImage) {
      // Plantillas multi-biométricas: palma (BioType=10), cara (BioType=9), etc.
      // Crear tabla si no existe
      try {
        await ctx.conn.query(`
          CREATE TABLE IF NOT EXISTS biotemplate (
            id       INT AUTO_INCREMENT PRIMARY KEY,
            userid   INT NOT NULL,
            BioType  TINYINT NOT NULL DEFAULT 10,
            FingerID TINYINT NOT NULL DEFAULT 0,
            Valid    TINYINT NOT NULL DEFAULT 1,
            Duress   TINYINT NOT NULL DEFAULT 0,
            Format   TINYINT NOT NULL DEFAULT 0,
            MajorVer TINYINT NOT NULL DEFAULT 0,
            MinorVer TINYINT NOT NULL DEFAULT 0,
            Template MEDIUMTEXT,
            SN       VARCHAR(20),
            UTime    DATETIME,
            DelTag   TINYINT NOT NULL DEFAULT 0,
            UNIQUE KEY uk_userid_biotype_slot (userid, BioType, FingerID)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
      } catch { /* ya existe */ }

      for (const line of raw.split(/\r?\n/).filter(Boolean)) {
        const data = parseKeyValueLine(line);
        // Soporta ambos formatos: Pin/PIN y BioType/Type
        const pin     = data.PIN || data.Pin || data.pin;
        const bioType = Number(data.BioType ?? data.Type ?? 10);
        const index   = Number(data.Index ?? data.FingerID ?? data.No ?? 0);
        const valid   = Number(data.Valid ?? 1);
        const duress  = Number(data.Duress ?? 0);
        const fmt     = Number(data.Format ?? 0);
        const majVer  = Number(data.MajorVer ?? 0);
        const minVer  = Number(data.MinorVer ?? 0);
        const tmp     = data.Tmp || data.Template || data.Content || '';
        if (!pin || !tmp) { errors++; continue; }
        try {
          const userid = await ensureUser(ctx.conn, ctx.sn, pin);
          await ctx.conn.query(
            `INSERT INTO biotemplate (userid, BioType, FingerID, Valid, Duress, Format, MajorVer, MinorVer, Template, SN, UTime, DelTag)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE
               Valid=VALUES(Valid), Duress=VALUES(Duress), Format=VALUES(Format),
               MajorVer=VALUES(MajorVer), MinorVer=VALUES(MinorVer),
               Template=VALUES(Template), SN=VALUES(SN), UTime=VALUES(UTime), DelTag=0`,
            [userid, bioType, index, valid, duress, fmt, majVer, minVer, tmp, ctx.sn, mysqlNow()]
          );
          ok++;
        } catch {
          errors++;
        }
      }
      if (stamp) await ctx.conn.query('UPDATE iclock SET OpLogStamp = ? WHERE SN = ?', [stamp, ctx.sn]);
      await ctx.conn.query('INSERT INTO devlog (SN_id, OP, Object, Cnt, ECnt, OpTime) VALUES (?, ?, ?, ?, ?, ?)',
        [ctx.sn, 'BIODATA', String(table), ok, errors, mysqlNow()]);
    } else if (req.query.FPImage) {
      const pin = one(req.query.PIN) || 'unknown';
      const fid = one(req.query.FID) || '0';
      const fpName = path.basename(one(req.query.FPImage)) || `fp-${fid}.bmp`;
      saveUpload([ctx.sn, 'fpimage', pin], fpName, bodyAsBuffer(req));
      ok = 1;
      await ctx.conn.query('INSERT INTO devlog (SN_id, OP, Object, Cnt, ECnt, OpTime) VALUES (?, ?, ?, ?, ?, ?)', [ctx.sn, 'FPIMAGE', pin, ok, errors, mysqlNow()]);
    } else {
      // DEBUG TEMPORAL: captura raw del ZMM720 (salida arriba) para diagnóstico
      if (ctx.sn === 'CK7Z211060032' && raw.trim()) {
        try {
          const debugPath = path.resolve(process.cwd(), 'fichadas', `debug_attlog_${ctx.sn}_${Date.now()}.txt`);
          fs.mkdirSync(path.dirname(debugPath), { recursive: true });
          fs.writeFileSync(debugPath, `SN=${ctx.sn}\nSTAMP=${stamp}\nTABLE=${table}\n---RAW---\n${raw.slice(0, 4096)}`);
        } catch { /* noop */ }
      }
      for (const line of raw.split(/\r?\n/).filter(Boolean)) {
        const parsed = parseAttLogLine(line);
        if (!parsed) { errors++; continue; }
        try {
          const userid = await ensureUser(ctx.conn, ctx.sn, parsed.pin);
          await ctx.conn.query(
            `INSERT IGNORE INTO checkinout (userid, checktime, checktype, verifycode, SN, sensorid)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userid, parsed.checktime, parsed.checktype, parsed.verifycode, ctx.sn, parsed.sensorid]
          );
          const [users] = await ctx.conn.query<RowDataPacket[]>('SELECT name FROM userinfo WHERE userid = ? LIMIT 1', [userid]);
          recordAdmsAttendanceAudioEvent({
            sn: ctx.sn,
            dni: parsed.pin,
            nombre: users[0]?.name || '',
            checktime: parsed.checktime,
            checktype: parsed.checktype,
          });
          ok++;
        } catch {
          errors++;
        }
      }
      if (stamp) await ctx.conn.query('UPDATE iclock SET LogStamp = ? WHERE SN = ?', [stamp, ctx.sn]);
      await ctx.conn.query('INSERT INTO devlog (SN_id, OP, Object, Cnt, ECnt, OpTime) VALUES (?, ?, ?, ?, ?, ?)', [ctx.sn, 'TRANSACT', null, ok, errors, mysqlNow()]);
    }

    await ctx.conn.end();
    recordEvent(req, ctx.sn, 'cdata:post', true, `${table || 'ATTLOG'} ok=${ok} errors=${errors}`);
    return text(res, `OK:${ok}\nPOST from: ${ctx.sn}\n`);
  } catch (e: any) {
    recordEvent(req, ctx.sn, 'cdata:post', false, String(e?.message ?? e));
    await ctx.conn.end();
    return text(res, String(e?.message ?? e), 500);
  }
}

async function querydata(req: Request, res: Response): Promise<Response> {
  const ctx = await ensureDevice(req, res);
  if (!ctx.conn || !ctx.device) return res;
  try {
    const raw = bodyAsText(req);
    const tableHint = one(req.query.table || req.query.Table || req.query.tablename || req.query.TableName || req.query.type || req.query.Type);
    let ok = 0;
    let errors = 0;
    let object = tableHint || 'AUTO';

    for (const line of queryDataLines(raw)) {
      const table = inferQueryDataTable(tableHint, line);
      object = table || object;
      try {
        if (table === 'USERINFO' || table === 'USER') {
          await saveUserInfoLine(ctx.conn, ctx.sn, line);
        } else if (table === 'FINGERTMP' || table === 'TEMPLATE' || table === 'FP') {
          await saveFingerTemplateLine(ctx.conn, ctx.sn, line);
        } else if (table === 'BIODATA' || table === 'BIOTEMPLATE' || table === 'BIOPHOTO') {
          await saveBioTemplateLine(ctx.conn, ctx.sn, line);
        } else {
          throw new Error('querydata sin tabla reconocida');
        }
        ok++;
      } catch {
        errors++;
      }
    }

    await ctx.conn.query(
      'INSERT INTO devlog (SN_id, OP, Object, Cnt, ECnt, OpTime) VALUES (?, ?, ?, ?, ?, ?)',
      [ctx.sn, 'QUERYDATA', object, ok, errors, mysqlNow()]
    );
    await ctx.conn.end();
    recordEvent(req, ctx.sn, 'querydata', true, `${object} ok=${ok} errors=${errors}`);
    return text(res, `OK:${ok}\nPOST from: ${ctx.sn}\n`);
  } catch (e: any) {
    recordEvent(req, ctx.sn, 'querydata', false, String(e?.message ?? e));
    await ctx.conn.end();
    return text(res, String(e?.message ?? e), 500);
  }
}

async function getrequest(req: Request, res: Response): Promise<Response> {
  const ctx = await ensureDevice(req, res);
  if (!ctx.conn || !ctx.device) return res;
  try {
    const info = one(req.query.INFO);
    if (info) await saveDeviceInfo(ctx.conn, ctx.sn, info);

    const [rows] = await ctx.conn.query<RowDataPacket[]>(
      `SELECT id, CmdContent, CmdTransTime
         FROM devcmds
        WHERE SN_id = ? AND CmdOverTime IS NULL
        ORDER BY id
        LIMIT 200`,
      [ctx.sn]
    );

    let response = '';
    let sent = 0;
    for (const row of rows) {
      const line = `C:${row.id}:${row.CmdContent}\n`;
      if (response.length + line.length > 40 * 1024) break;
      response += line;
      sent++;
      await ctx.conn.query('UPDATE devcmds SET CmdTransTime = ? WHERE id = ?', [mysqlNow(), row.id]);
      if (['REBOOT', 'RESTART'].includes(String(row.CmdContent).trim().toUpperCase())) break;
    }

    await ctx.conn.end();
    recordEvent(req, ctx.sn, 'getrequest', true, sent ? `sent=${sent}` : 'OK');
    return text(res, sent ? response : 'OK');
  } catch (e: any) {
    recordEvent(req, ctx.sn, 'getrequest', false, String(e?.message ?? e));
    await ctx.conn.end();
    return text(res, String(e?.message ?? e), 500);
  }
}

async function devicecmd(req: Request, res: Response): Promise<Response> {
  const ctx = await ensureDevice(req, res);
  if (!ctx.conn || !ctx.device) return res;
  try {
    const raw = bodyAsText(req);
    const posts = parseDevicePosts(raw);
    let updated = 0;

    for (const post of posts) {
      const id = Number(post.ID);
      if (!id) continue;
      if (post.CMD === 'INFO' && post.Content) await saveDeviceInfo(ctx.conn, ctx.sn, post.Content);
      if ((post.CMD === 'GetFile' || post.CMD === 'Shell') && Number(post.Return) > 0) {
        const filename = post.FILENAME || (post.CMD === 'Shell' ? 'shellout.txt' : `cmd-${id}.bin`);
        const content = extractUploadContent(bodyAsBuffer(req), post);
        if (content.length) saveUpload([ctx.sn, 'cmd', String(id)], filename, content);
      }
      await ctx.conn.query('UPDATE devcmds SET CmdOverTime = ?, CmdReturn = ? WHERE id = ?', [mysqlNow(), Number(post.Return) || 0, id]);
      updated++;
    }

    await ctx.conn.end();
    recordEvent(req, ctx.sn, 'devicecmd', true, `updated=${updated}`);
    return text(res, updated >= 0 ? 'OK' : 'OK');
  } catch (e: any) {
    recordEvent(req, ctx.sn, 'devicecmd', false, String(e?.message ?? e));
    await ctx.conn.end();
    return text(res, String(e?.message ?? e), 500);
  }
}

async function fdata(req: Request, res: Response): Promise<Response> {
  const ctx = await ensureDevice(req, res);
  if (!ctx.conn || !ctx.device) return res;
  try {
    const stamp = one(req.query.Stamp || req.query.PhotoStamp);
    const pin = one(req.query.PIN) || `${Date.now()}.jpg`;
    const filename = pin.includes('.') ? pin : `${pin}.jpg`;
    saveUpload([ctx.sn, 'photos'], filename, bodyAsBuffer(req));
    if (stamp) await ctx.conn.query('UPDATE iclock SET PhotoStamp = ? WHERE SN = ?', [stamp, ctx.sn]);
    await ctx.conn.query('INSERT INTO devlog (SN_id, OP, Object, Cnt, ECnt, OpTime) VALUES (?, ?, ?, 1, 0, ?)', [ctx.sn, 'PICTURE', pin || null, mysqlNow()]);
    await ctx.conn.end();
    recordEvent(req, ctx.sn, 'fdata', true, pin);
    return text(res, 'OK\n');
  } catch (e: any) {
    recordEvent(req, ctx.sn, 'fdata', false, String(e?.message ?? e));
    await ctx.conn.end();
    return text(res, String(e?.message ?? e), 500);
  }
}

export function buildIclockAdmsRouter(): Router {
  const router = Router();
  router.use(express.raw({ type: ['text/*', 'application/octet-stream'], limit: '10mb' }));

  router.get('/', (_req, res) => text(res, 'This is the iclock device core communication.'));
  router.get('/cdata', handleCdataGet);
  router.post('/cdata', handleCdataPost);
  router.post('/querydata', querydata);
  router.get('/querydata', querydata);
  router.get('/getrequest', getrequest);
  router.post('/devicecmd', devicecmd);
  router.post('/fdata', fdata);

  return router;
}
