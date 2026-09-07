import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import xlsxModule from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const XLSX = xlsxModule.default || xlsxModule;
dotenv.config({ path: path.join(appRoot, '.env') });

const BECARIOS_LEY_IDS = new Set([6, 7, 8, 9, 10, 11, 12, 13]);

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'on'].includes(String(raw).trim().toLowerCase());
}

function mustEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configurar ${name} en .env`);
  return value;
}

function optEnv(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDmy(value) {
  const date = toDate(value);
  if (!date) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function artIngresoDate(dbDate) {
  const ingreso = toDate(dbDate);
  const today = todayLocal();
  if (!ingreso) return today;
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - 1);
  return ingreso >= cutoff ? ingreso : today;
}

function normalizeCuil(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function normalizePhone(value) {
  let digits = onlyDigits(value);
  if (digits.startsWith('54') && digits.length > 10) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');
  if (digits.length > 10) digits = digits.slice(-10);
  // El "15" es el prefijo local de celular y ART lo rechaza. Para BsAs el numero
  // correcto es 11 + los 8 digitos: reemplazamos el "15" inicial por "11".
  if (digits.startsWith('15')) digits = '11' + digits.slice(2);
  return digits;
}

// ART quiere solo los 4 digitos del CP. El CPA argentino viene como "B1759" o "B1759EKC";
// nos quedamos con los 4 digitos (que en el CPA son justamente el codigo postal).
function normalizeCP(value) {
  const digits = onlyDigits(value);
  return digits.length >= 4 ? digits.slice(0, 4) : digits;
}

function normalizeSexo(value) {
  const raw = String(value || '').toUpperCase();
  if (raw.includes('FEM') || raw === 'F') return optEnv('ART_SEXO_FEMENINO_TEXT', 'Femenino');
  if (raw.includes('MASC') || raw === 'M') return optEnv('ART_SEXO_MASCULINO_TEXT', 'Masculino');
  return optEnv('ART_SEXO_DEFAULT_TEXT', '');
}

function isBecarioLike(row) {
  if (BECARIOS_LEY_IDS.has(Number(row.ley_id))) return true;
  const ley = String(row.ley_nombre || '').toUpperCase();
  return ley.includes('BECA') || ley.includes('BECARIO') || ley.includes('RESIDENTE');
}

function resolveTipoContrato(row) {
  if (process.env.ART_TIPO_CONTRATO_TEXT?.trim()) return process.env.ART_TIPO_CONTRATO_TEXT.trim();
  return isBecarioLike(row)
    ? optEnv('ART_TIPO_CONTRATO_BECARIO_TEXT', 'Becarios')
    : optEnv('ART_TIPO_CONTRATO_NOMBRADO_TEXT', 'Empleo publico provincial');
}

function xpathLiteral(value) {
  const s = String(value);
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  return `concat('${s.split("'").join("',\"'\",'")}')`;
}

function dbConfig() {
  return {
    host: mustEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: mustEnv('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: mustEnv('DB_NAME'),
    dateStrings: true,
  };
}

async function loadDireccionFromXlsx(dni) {
  const baseDir = optEnv('DIRECCIONES_INTRANET_PATH', 'D:\\G\\DIRECCIONES INTRANET');
  const files = [
    'direccioneshtal.xlsx',
    'Direcciones Hospital.xlsx',
    'Direcciones UPA 4.xlsx',
    'Direcciones UPA18.xlsx',
  ];

  let best = null;
  for (const file of files) {
    const full = path.join(baseDir, file);
    try {
      const wb = XLSX.readFile(full, { cellDates: true });
      const ws = wb.Sheets.Listado;
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
      for (const row of rows) {
        if (Number(row['NRO DOCUMENTO']) !== Number(dni)) continue;
        const fecha = toDate(row['FECHA MODIFICACION']);
        if (!best || (fecha?.getTime() || 0) > (best.fecha?.getTime() || 0)) {
          best = {
            fecha,
            calle: row.CALLE ? String(row.CALLE).trim() : null,
            numero: row.NUMERO ? String(row.NUMERO).trim() : null,
            piso: row.PISO ? String(row.PISO).trim() : null,
            departamento: row.DEPARTAMENTO ? String(row.DEPARTAMENTO).trim() : null,
            localidad: row.LOCALIDAD ? String(row.LOCALIDAD).trim() : null,
            codigo_postal: row['CODIGO POSTAL'] ? String(row['CODIGO POSTAL']).trim() : null,
            email: row.EMAIL ? String(row.EMAIL).trim() : null,
            telefonos: row.TELEFONOS ? String(row.TELEFONOS).trim() : null,
          };
        }
      }
    } catch {
      // El archivo puede no existir en todas las instalaciones.
    }
  }
  return best;
}

async function loadQueueItem(conn, queueId, dniArg) {
  const where = queueId ? 'q.id = ?' : 'q.dni = ?';
  const value = queueId || dniArg;
  const [rows] = await conn.query(
    `SELECT
       q.id AS queue_id,
       q.agente_id,
       q.status AS queue_status,
       a.dni,
       a.ley_id,
       l.nombre AS ley_nombre,
       a.legajo,
       oc.nombre AS ocupacion_nombre,
       oc.codigo AS ocupacion_codigo,
       DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
       a.estado_empleo,
       p.apellido,
       p.nombre,
       p.cuil,
       DATE_FORMAT(p.fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
       p.email,
       p.telefono,
       p.nacionalidad,
       p.domicilio,
       p.numerodomicilio,
       p.piso,
       p.depto,
       p.cp,
       sx.nombre AS sexo_nombre,
       loc.localidad_nombre AS localidad_nombre,
       loc.provincia_nombre AS provincia_nombre,
       loc.provincia_id AS provincia_id,
       sec.nombre AS sector_nombre,
       srv.nombre AS servicio_nombre
     FROM art_alta_queue q
     JOIN agentes a ON a.id = q.agente_id
     JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
     LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
     LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
     LEFT JOIN sexos sx ON sx.id = p.sexo_id
     LEFT JOIN localidades loc ON loc.id = p.localidad_id
     LEFT JOIN (
       SELECT s1.dni, s1.servicio_id
       FROM agentes_servicios s1
       JOIN (
         SELECT dni, MAX(id) AS id
         FROM agentes_servicios
         WHERE deleted_at IS NULL
           AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
         GROUP BY dni
       ) ult ON ult.id = s1.id
     ) ags ON ags.dni = a.dni
     LEFT JOIN (
       SELECT x1.dni, x1.sector_id
       FROM agentes_sectores x1
       JOIN (
         SELECT dni, MAX(id) AS id
         FROM agentes_sectores
         WHERE deleted_at IS NULL
           AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
         GROUP BY dni
       ) ultx ON ultx.id = x1.id
     ) asec ON asec.dni = a.dni
     LEFT JOIN servicios srv ON srv.id = ags.servicio_id AND srv.deleted_at IS NULL
     LEFT JOIN sectores sec ON sec.id = asec.sector_id AND sec.deleted_at IS NULL
     WHERE ${where}
     LIMIT 1`,
    [value]
  );
  if (!rows.length && dniArg) {
    const [manualRows] = await conn.query(
      `SELECT
         NULL AS queue_id,
         a.id AS agente_id,
         'MANUAL' AS queue_status,
         a.dni,
         a.ley_id,
         l.nombre AS ley_nombre,
         a.legajo,
         oc.nombre AS ocupacion_nombre,
         oc.codigo AS ocupacion_codigo,
         DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
         a.estado_empleo,
         p.apellido,
         p.nombre,
         p.cuil,
         DATE_FORMAT(p.fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
         p.email,
         p.telefono,
         p.nacionalidad,
         p.domicilio,
         p.numerodomicilio,
         p.piso,
         p.depto,
         p.cp,
         sx.nombre AS sexo_nombre,
         loc.localidad_nombre AS localidad_nombre,
       loc.provincia_nombre AS provincia_nombre,
       loc.provincia_id AS provincia_id,
         sec.nombre AS sector_nombre,
         srv.nombre AS servicio_nombre
       FROM agentes a
       JOIN personal p ON p.dni = a.dni AND p.deleted_at IS NULL
       LEFT JOIN ley l ON l.id = a.ley_id AND l.deleted_at IS NULL
       LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
       LEFT JOIN sexos sx ON sx.id = p.sexo_id
       LEFT JOIN localidades loc ON loc.id = p.localidad_id
       LEFT JOIN (
         SELECT s1.dni, s1.servicio_id
         FROM agentes_servicios s1
         JOIN (
           SELECT dni, MAX(id) AS id
           FROM agentes_servicios
           WHERE deleted_at IS NULL
             AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
           GROUP BY dni
         ) ult ON ult.id = s1.id
       ) ags ON ags.dni = a.dni
       LEFT JOIN (
         SELECT x1.dni, x1.sector_id
         FROM agentes_sectores x1
         JOIN (
           SELECT dni, MAX(id) AS id
           FROM agentes_sectores
           WHERE deleted_at IS NULL
             AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
           GROUP BY dni
         ) ultx ON ultx.id = x1.id
       ) asec ON asec.dni = a.dni
       LEFT JOIN servicios srv ON srv.id = ags.servicio_id AND srv.deleted_at IS NULL
       LEFT JOIN sectores sec ON sec.id = asec.sector_id AND sec.deleted_at IS NULL
       WHERE a.dni = ?
         AND a.deleted_at IS NULL
       ORDER BY a.id DESC
       LIMIT 1`,
      [dniArg]
    );
    if (manualRows.length) return manualRows[0];
  }
  if (!rows.length) throw new Error(`No se encontro item ART para ${queueId ? `queue ${queueId}` : `DNI ${dniArg}`}`);
  return rows[0];
}

async function loadBecariosArtPendientes(conn, limit = null, opts = {}) {
  const limitSql = limit ? 'LIMIT ?' : '';
  const values = limit ? [Number(limit)] : [];
  // Filtro opcional: solo los que fallaron por establecimiento (para re-correr esa tanda).
  const estabSql = opts.establecimientoOnly
    ? "AND EXISTS (SELECT 1 FROM becarios_art_errores e WHERE e.dni = p.dni AND e.motivo LIKE '%establecimiento%')"
    : '';
  const [rows] = await conn.query(
    `SELECT
       NULL AS queue_id,
       a.id AS agente_id,
       'BECARIOS_ART' AS queue_status,
       a.dni,
       a.ley_id,
       l.nombre AS ley_nombre,
       a.legajo,
       oc.nombre AS ocupacion_nombre,
       oc.codigo AS ocupacion_codigo,
       DATE_FORMAT(a.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
       a.estado_empleo,
       p.apellido,
       p.nombre,
       p.cuil,
       DATE_FORMAT(p.fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
       p.email,
       p.telefono,
       p.nacionalidad,
       p.domicilio,
       p.numerodomicilio,
       p.piso,
       p.depto,
       p.cp,
       sx.nombre AS sexo_nombre,
       loc.localidad_nombre AS localidad_nombre,
       loc.provincia_nombre AS provincia_nombre,
       loc.provincia_id AS provincia_id,
       sec.nombre AS sector_nombre,
       srv.nombre AS servicio_nombre
     FROM personal p
     JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL
     JOIN ley l ON l.id = a.ley_id
     LEFT JOIN ocupaciones oc ON oc.id = a.ocupacion_id AND oc.deleted_at IS NULL
     LEFT JOIN sexos sx ON sx.id = p.sexo_id
     LEFT JOIN localidades loc ON loc.id = p.localidad_id
     LEFT JOIN (
       SELECT s1.dni, s1.servicio_id
       FROM agentes_servicios s1
       JOIN (
         SELECT dni, MAX(id) AS id
         FROM agentes_servicios
         WHERE deleted_at IS NULL
           AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
         GROUP BY dni
       ) ult ON ult.id = s1.id
     ) ags ON ags.dni = p.dni
     LEFT JOIN (
       SELECT x1.dni, x1.sector_id
       FROM agentes_sectores x1
       JOIN (
         SELECT dni, MAX(id) AS id
         FROM agentes_sectores
         WHERE deleted_at IS NULL
           AND (fecha_hasta IS NULL OR fecha_hasta >= CURDATE())
         GROUP BY dni
       ) ultx ON ultx.id = x1.id
     ) asec ON asec.dni = p.dni
     LEFT JOIN servicios srv ON srv.id = ags.servicio_id AND srv.deleted_at IS NULL
     LEFT JOIN sectores sec ON sec.id = asec.sector_id AND sec.deleted_at IS NULL
     WHERE a.estado_empleo = 'ACTIVO'
       AND p.deleted_at IS NULL
       AND a.ley_id IN (6,7,8,9,10,11,12,13)
       AND NOT EXISTS (
         SELECT 1 FROM becarios_art b
         WHERE b.dni = p.dni AND b.deleted_at IS NULL
       )
       ${estabSql}
     ORDER BY p.apellido ASC, p.nombre ASC
     ${limitSql}`,
    values
  );
  return rows;
}

async function setQueueStatus(conn, queueId, status, fields = {}) {
  if (!queueId) return;
  const parts = ['status = ?', 'updated_at = NOW()'];
  const values = [status];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`${key} = ?`);
    values.push(value);
  }
  values.push(queueId);
  await conn.query(`UPDATE art_alta_queue SET ${parts.join(', ')} WHERE id = ?`, values);
}

// Quita tildes/diacríticos para comparar texto de forma robusta.
function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Detecta si el domicilio es de CABA a partir de las variantes que guarda la base.
// Insensible a tildes: en la base la provincia es "Ciudad Autónoma de Buenos Aires".
function isCaba(...vals) {
  const s = stripAccents(vals.map((v) => String(v || '').toUpperCase()).join(' | '));
  return /\bC\.?\s*A\.?\s*B\.?\s*A\.?\b/.test(s)
      || s.includes('CAPITAL FEDERAL')
      || s.includes('CIUDAD AUTONOMA')
      || s.includes('CIUDAD DE BUENOS AIRES')
      || s.includes('AUTONOMA DE BUENOS AIRES');
}

// CP de CABA: rango 1000–1499 (Capital Federal).
function cpIsCaba(cp) {
  const n = parseInt(String(cp || '').replace(/\D/g, '').slice(0, 4), 10);
  return Number.isFinite(n) && n >= 1000 && n <= 1499;
}

// provincia_id canónico de CABA en la tabla localidades.
const PROVINCIA_ID_CABA = '2';

// Resuelve el provincia_id: de la tabla si el agente tiene localidad_id;
// si la dirección viene del Excel (sin localidad_id), busca el nombre de la
// localidad en `localidades` (prefiriendo la coincidencia de CABA). Devuelve string|null.
async function resolveProvinciaId(conn, row, dir) {
  if (row?.provincia_id != null && String(row.provincia_id) !== '') {
    return String(row.provincia_id);
  }
  const locName = dir?.localidad;
  if (!locName) return null;
  try {
    const [rows] = await conn.query(
      `SELECT provincia_id
         FROM localidades
        WHERE UPPER(localidad_nombre) = UPPER(?)
          AND deleted_at IS NULL
        ORDER BY (provincia_id = '${PROVINCIA_ID_CABA}') DESC
        LIMIT 1`,
      [String(locName).trim()]
    );
    return rows?.[0]?.provincia_id != null ? String(rows[0].provincia_id) : null;
  } catch {
    return null;
  }
}

function buildPayload(row, dir, provinciaId = null) {
  const ingresoArt = artIngresoDate(row.fecha_ingreso);
  const email = row.email || dir?.email || '';
  const telefono = normalizePhone(row.telefono || dir?.telefonos || '');
  // Domicilio DB-first: para agentes nuevos los datos vienen correctos de la base
  // (calle en domicilio, numero en numerodomicilio). La planilla Excel queda de fallback.
  let calle = String(row.domicilio || dir?.calle || '').trim();
  let numero = String(row.numerodomicilio || dir?.numero || '').trim();
  // Si no vino el numero por separado pero la calle termina en digitos, los separamos
  // ("JUAN CRUZ VARELA 4893" -> calle="JUAN CRUZ VARELA", numero="4893").
  if (!numero) {
    const m = calle.match(/^(.*?)[\s,]+(\d+)\s*$/);
    if (m) { calle = m[1].trim(); numero = m[2]; }
  }
  // CABA: la base guarda variantes (CABA / "Ciudad Autonoma de Buenos Aires" / etc.) que NO
  // matchean el combo de ART. ART usa "CAPITAL FEDERAL" tanto en Provincia como en Localidad,
  // y como los combos son encadenados hay que setear las DOS.
  let provincia = row.provincia_nombre || optEnv('ART_PROVINCIA_TEXT', 'Buenos Aires');
  let localidad = row.localidad_nombre || dir?.localidad || optEnv('ART_LOCALIDAD_DEFAULT_TEXT', '');
  const cpRaw = normalizeCP(row.cp || dir?.codigo_postal || '');
  // CABA: ART usa "CAPITAL FEDERAL" en Provincia y Localidad (los combos son encadenados).
  // Se detecta por (1) provincia_id=2 resuelto de la tabla o por nombre de localidad,
  // (2) texto que diga CABA (insensible a tildes), o (3) refuerzo por CP 1000–1499 si el nombre no resolvió.
  const esCaba =
    String(provinciaId ?? '') === PROVINCIA_ID_CABA
      || isCaba(provincia, localidad)
      || (!provinciaId && cpIsCaba(cpRaw));
  if (esCaba) {
    provincia = optEnv('ART_CABA_PROVINCIA_TEXT', 'CAPITAL FEDERAL');
    localidad = optEnv('ART_CABA_LOCALIDAD_TEXT', 'CAPITAL FEDERAL');
  }
  return {
    dni: Number(row.dni),
    agenteId: Number(row.agente_id),
    isBecario: isBecarioLike(row),
    cuil: normalizeCuil(row.cuil),
    nombreApellido: `${String(row.apellido || '').trim()}, ${String(row.nombre || '').trim()}`.replace(/^,\s*/, ''),
    sexo: normalizeSexo(row.sexo_nombre),
    estadoCivil: row.estado_civil || optEnv('ART_ESTADO_CIVIL_DEFAULT_TEXT', ''),
    fechaNacimiento: formatDmy(row.fecha_nacimiento),
    nacionalidad: row.nacionalidad || optEnv('ART_NACIONALIDAD_DEFAULT_TEXT', 'Argentina'),
    email,
    sinEmail: !email,
    fechaIngresoEmpresa: formatDmy(ingresoArt),
    fechaIngresoDb: row.fecha_ingreso || '',
    tipoContrato: resolveTipoContrato(row),
    sector: row.sector_nombre || row.servicio_nombre || optEnv('ART_SECTOR_FALLBACK_TEXT', ''),
    tarea: row.ocupacion_nombre || optEnv('ART_TAREA_FALLBACK_TEXT', ''),
    ciuo: row.ocupacion_codigo || row.ocupacion_nombre || optEnv('ART_CIUO_FALLBACK_TEXT', ''),
    provincia,
    localidad,
    codigoPostal: cpRaw,
    calle,
    numero,
    piso: row.piso || dir?.piso || '',
    departamento: row.depto || dir?.departamento || '',
    telefono,
    tipoTelefono: optEnv('ART_TIPO_TELEFONO_TEXT', 'Celular'),
    establecimientoBusqueda: optEnv('ART_ESTABLECIMIENTO_BUSQUEDA', '32'),
    codigoAltaTemprana: optEnv('ART_COD_ALTA_TEMPRANA', ''),
  };
}

function assertPayload(payload) {
  const missing = [];
  for (const key of ['cuil', 'nombreApellido', 'fechaNacimiento', 'fechaIngresoEmpresa', 'telefono', 'tipoContrato', 'sector', 'tarea', 'ciuo']) {
    if (!payload[key]) missing.push(key);
  }
  if (missing.length) throw new Error(`Datos/configuracion faltante para alta ART: ${missing.join(', ')}`);
}

async function fillAfterLabel(page, label, value, tag = 'input') {
  if (!value) return;
  const editable = tag === 'input' ? "[not(@type='hidden') and not(@readonly)]" : '';
  const loc = page.locator(`xpath=//*[string-length(normalize-space(.)) <= 80 and contains(normalize-space(.), ${xpathLiteral(label)})]/following::${tag}${editable}[1]`);
  await loc.first().fill(String(value));
}

async function selectAfterLabel(page, label, value) {
  if (!value) return;
  const loc = page.locator(`xpath=//*[string-length(normalize-space(.)) <= 80 and contains(normalize-space(.), ${xpathLiteral(label)})]/following::select[1]`);
  const select = loc.first();
  await select.selectOption({ label: String(value) }).catch(async () => {
    await select.selectOption(String(value));
  });
}

async function fillAfterSectionLabel(page, section, label, value, tag = 'input') {
  if (!value) return;
  const editable = tag === 'input' ? "[not(@type='hidden') and not(@readonly)]" : '';
  const loc = page.locator(`xpath=//*[string-length(normalize-space(.)) <= 80 and contains(normalize-space(.), ${xpathLiteral(section)})]/following::*[string-length(normalize-space(.)) <= 80 and contains(normalize-space(.), ${xpathLiteral(label)})]/following::${tag}${editable}[1]`);
  await loc.first().fill(String(value));
}

async function selectAfterSectionLabel(page, section, label, value) {
  if (!value) return;
  const loc = page.locator(`xpath=//*[string-length(normalize-space(.)) <= 80 and contains(normalize-space(.), ${xpathLiteral(section)})]/following::*[string-length(normalize-space(.)) <= 80 and contains(normalize-space(.), ${xpathLiteral(label)})]/following::select[1]`);
  const select = loc.first();
  await select.selectOption({ label: String(value) }).catch(async () => {
    await select.selectOption(String(value));
  });
}

async function checkNearText(page, text) {
  const box = page.locator(`xpath=//*[string-length(normalize-space(.)) <= 120 and contains(normalize-space(.), ${xpathLiteral(text)})]/preceding::input[@type='checkbox'][1] | //*[string-length(normalize-space(.)) <= 120 and contains(normalize-space(.), ${xpathLiteral(text)})]/following::input[@type='checkbox'][1]`);
  await box.first().check({ force: true });
}

async function chooseAutocomplete(page, label, value) {
  if (!value) return;
  const input = page.locator(`xpath=//*[string-length(normalize-space(.)) <= 80 and contains(normalize-space(.), ${xpathLiteral(label)})]/following::input[1]`).first();
  await input.fill(String(value));
  await page.waitForTimeout(800);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

async function clickVisibleCenter(page, locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 20000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No pude ubicar visualmente ${label}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.waitForTimeout(350);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
}

async function fillById(page, id, value) {
  if (value === undefined || value === null || value === '') return;
  await page.locator(`#${id}`).fill(String(value));
}

async function typeInto(page, locator, value) {
  await locator.click({ timeout: 15000 });
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.press('Backspace');
  await locator.type(String(value), { delay: Number(process.env.ART_TYPE_DELAY_MS || 35) });
}

async function selectById(page, id, value) {
  if (!value) return;
  const select = page.locator(`#${id}`);
  await select.selectOption({ label: String(value) }, { timeout: 2500 }).catch(async () => {
    await select.selectOption(String(value), { timeout: 2500 }).catch(async () => {
      const selected = await page.evaluate(({ id, value }) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const wanted = String(value).trim().toUpperCase();
        const opt = Array.from(el.options || []).find((option) => {
          const text = String(option.textContent || '').trim().toUpperCase();
          const val = String(option.value || '').trim().toUpperCase();
          return text === wanted || val === wanted || text.includes(wanted);
        });
        if (!opt) return false;
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, { id, value });
      if (!selected) throw new Error(`No se pudo seleccionar ${value} en #${id}`);
    });
  });
}

async function chooseAutocompleteById(page, id, value) {
  if (!value) return;
  const input = page.locator(`#${id}`);
  await input.fill(String(value));
  await page.waitForTimeout(800);
  await input.press('ArrowDown');
  await input.press('Enter');
}

// Cierra el modal de ART (#myModal, ej "Ingresá la altura de la direccion") si esta bloqueando.
async function dismissModal(page) {
  const modal = page.locator('#myModal');
  if (await modal.isVisible({ timeout: 800 }).catch(() => false)) {
    const btn = modal.locator('button:has-text("ACEPTAR"), input[value="ACEPTAR"], button:has-text("Aceptar")').first();
    const ok = await btn.click({ timeout: 2500 }).then(() => true).catch(() => false);
    if (!ok) await modal.locator('.close, [class*="close"]').first().click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

async function fillStreet(page, value) {
  if (!value) return;
  await dismissModal(page);
  const street = page.locator('#txtDireccion');
  const tagName = await street.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  if (tagName === 'select') {
    await page.locator('#btnNoFoundStreet').click({ timeout: 10000 }).catch(() => undefined);
    await dismissModal(page);
    await page.waitForTimeout(700);
    const manualInput = page.locator('xpath=//*[normalize-space(.)="Calle"]/following::input[not(@type="hidden")][1]');
    await manualInput.fill(String(value), { timeout: 10000 }).catch(() => undefined);
    return;
  }
  await street.fill(String(value)).catch(() => undefined);
}

async function fillTelefonoPrincipal(page, payload) {
  // ART exige teléfono de EXACTAMENTE 10 dígitos. Si el dato no es válido (vacío, "NO POSEE",
  // 9 dígitos, etc.) NO abrimos la edición: cargar un número inválido ART lo rechaza y lo deja
  // "sin guardar", lo que BLOQUEA todo el alta. Mejor avanzar sin teléfono.
  const digits = String(payload.telefono || '').replace(/\D/g, '');
  if (digits.length !== 10) {
    console.log(JSON.stringify({ warn: 'telefono invalido, se omite', dni: payload.dni, telefono: payload.telefono, digitos: digits.length }));
    return;
  }

  await page.locator('#iframeTelefonos').scrollIntoViewIfNeeded();
  const frame = page.frame({ name: 'iframeTelefonos' });
  if (!frame) throw new Error('No encontre iframeTelefonos');

  await frame.locator('#btnEditarTelefono_1').click({ timeout: 10000 });
  await page.waitForTimeout(500);

  // Primer telefono = principal. Elegimos el primer tipo disponible (index 1, saltea el
  // placeholder) y listo. Sin buscar por label, que colgaba 30s por intento cuando no matcheaba.
  const tipo = frame.locator('#tipoTelefono_1');
  await tipo.selectOption({ index: 1 }).catch(() => tipo.selectOption({ index: 0 }));

  await frame.locator('#numero_1').fill(digits);
  await frame.locator('#btnGuardarTelefono_1').click({ timeout: 10000 });
  await page.waitForTimeout(700);
}

async function navigateToAltaTrabajador(page) {
  const loginUrl = optEnv('ART_LOGIN_URL', 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados');
  // Bajo pm2/headless la primera carga a veces tarda mas que los 30s por defecto y Playwright
  // corta con "page.goto Timeout". Reintentamos con timeout mas holgado (ART_NAV_TIMEOUT_MS)
  // antes de rendirnos. OJO: si el proceso pm2 NO tiene salida a internet, esto igual falla.
  const navTimeout = Number(process.env.ART_NAV_TIMEOUT_MS || 90000);
  let navErr = null;
  for (let intento = 1; intento <= 3; intento += 1) {
    try {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });
      navErr = null;
      break;
    } catch (err) {
      navErr = err;
      await page.waitForTimeout(2000);
    }
  }
  if (navErr) throw navErr;
  // Solo login si REALMENTE estamos en la pagina de login (sesion caida).
  // Si la sesion sigue viva, ART redirige y el boton de login no aparece:
  // en ese caso NO tocamos el form (antes agarraba #avatar y fallaba 15s -> cascada).
  const loginBtn = page.locator('button:has-text("Iniciar sesión"), button:has-text("Iniciar sesion"), input[type="submit"][value*="Iniciar"]').first();
  const needsLogin = await loginBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (needsLogin) {
    const loginInputs = page.locator('input:not([type="hidden"]):not([readonly])');
    await typeInto(page, loginInputs.nth(0), mustEnv('ART_PROVINCIA_USER'));
    await typeInto(page, loginInputs.nth(1), mustEnv('ART_PROVINCIA_PASSWORD'));
    await page.waitForTimeout(500);
    await clickVisibleCenter(page, loginBtn, 'Iniciar sesion');
    await page.waitForURL('**/bienvenida-cliente', { timeout: 45000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
  }
  await page.waitForTimeout(1500);

  // El portal de ProvinciART se rediseño (2026-09): el menu viejo por iframe (#menu_21 /
  // #linkSubmenu_422) ya NO existe. Ahora la nomina vive en "Mi contrato -> Gestion de nomina"
  // = /nomina-trabajadores. Vamos directo por URL (mas robusto que depender del dropdown).
  // El resto del flujo (boton "ALTA DE TRABAJADOR" -> /nomina-trabajadores/alta-trabajador y
  // los IDs del formulario) quedo IGUAL que antes: confirmado explorando el portal nuevo.
  const origin = new URL(loginUrl).origin;
  await page.goto(`${origin}/nomina-trabajadores`, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  await page.waitForURL('**/nomina-trabajadores', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
  await page.waitForTimeout(1200);

  await clickVisibleCenter(page, page.locator('input[type="button"][value="ALTA DE TRABAJADOR"]').first(), 'Alta de trabajador');
  await page.waitForURL('**/nomina-trabajadores/alta-trabajador', { timeout: 45000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}

async function addEstablecimiento(page, busqueda) {
  const addButton = page.locator('#altaEstablecimientos').or(page.getByText('AGREGAR ESTABLECIMIENTO', { exact: false })).or(page.getByText('Agregar establecimiento', { exact: false })).first();
  await addButton.click({ timeout: 10000 });
  await fillAfterLabel(page, 'Nombre', busqueda);
  await page.getByText('BUSCAR', { exact: false }).first().click();
  await page.waitForTimeout(800);
  const check = page.locator('xpath=//*[contains(@class, "ui-icon-check") or contains(@class, "check") or normalize-space(.)="✓" or normalize-space(.)="✔"]').last();
  await check.click({ timeout: 10000 });
}

async function addEstablecimientoMapped(page, busqueda) {
  const addButton = page.locator('#altaEstablecimientos').or(page.getByText('AGREGAR ESTABLECIMIENTO', { exact: false })).or(page.getByText('Agregar establecimiento', { exact: false })).first();
  // Best-effort: intentamos cargar el establecimiento pero NUNCA cortamos aca.
  // Siempre seguimos a GUARDAR; si el establecimiento no quedo, ART lo avisara al guardar
  // (y lo capturamos), pero al menos el alta se intenta.
  try {
    await addButton.click({ timeout: 10000 });
    const dialog = page.locator('#dialogEstablecimiento');
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await dialog.locator('#nombre').fill(String(busqueda));
    await dialog.locator('input[type="submit"][value="BUSCAR"]').click({ timeout: 10000 });

    // Esperamos un resultado seleccionable (en vez de un waitForTimeout fijo que se adelantaba).
    const selectButton = dialog.locator('input.btnSeleccionar, #divContentGrid input.btnSeleccionar, input[id^="grid_col"][type="button"]').last();
    const hayResultado = await selectButton.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    if (hayResultado) {
      await clickVisibleCenter(page, selectButton, 'tilde seleccionar establecimiento');
      // Esperamos el ACEPTAR de confirmacion (si aparece) y lo clickeamos.
      const acceptButton = page.locator('button:has-text("ACEPTAR"), input[type="button"][value="ACEPTAR"]').last();
      if (await acceptButton.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
        await clickVisibleCenter(page, acceptButton, 'Aceptar establecimiento guardado');
      }
      await page.waitForTimeout(1000);
    } else {
      // No cargaron resultados: cerramos el dialog para poder guardar igual.
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  } catch (err) {
    // No frenamos por el establecimiento: seguimos a GUARDAR de todas formas.
    await page.keyboard.press('Escape').catch(() => undefined);
  }
}

// Lee los mensajes de validacion/error visibles del form (ej "El C.U.I.L. ingresado es invalido").
// Lee los mensajes de validacion/error visibles en la pagina Y en sus iframes
// (ej el error del CP en el form, o "debe tener 10 digitos" dentro del iframe de telefonos).
async function collectPageErrors(page) {
  const rxSrc = 'inv[aá]lid|no corresponde|debe tener [0-9]|es campo obligatorio|domicilio vac[ií]o|sin guardar|no coincide|ya (existe|se encuentra)|es incorrect|no es v[aá]lid|hay \\d+ error';
  const out = [];
  const seen = new Set();
  for (const frame of page.frames()) {
    let errs = [];
    try {
      errs = await frame.evaluate((src) => {
        const rx = new RegExp(src, 'i');
        const res = [];
        for (const n of document.querySelectorAll('span, div, label, p, li, small, strong, td')) {
          const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
          if (!t || t.length > 160) continue;
          if (!rx.test(t)) continue;
          const r = n.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          res.push(t);
          if (res.length >= 8) break;
        }
        return res;
      }, rxSrc);
    } catch {
      errs = [];
    }
    for (const e of errs) {
      if (!seen.has(e)) { seen.add(e); out.push(e); }
    }
  }
  return out.slice(0, 8);
}

async function ensureBecariosArtErroresTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS becarios_art_errores (
      dni INT NOT NULL,
      motivo VARCHAR(500) NULL,
      detalle TEXT NULL,
      screenshot VARCHAR(500) NULL,
      lote VARCHAR(80) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (dni)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// Resume un error largo de ART en un motivo corto y categorizable para la pagina.
function resumenMotivo(msg) {
  const s = String(msg || '');
  if (/tel[eé]fono|debe tener 10 d[ií]gitos/i.test(s)) return 'Teléfono inválido (ART pide 10 dígitos)';
  if (/localidad|domicilio|\bcalle\b|c[oó]digo postal/i.test(s)) return 'Domicilio/localidad';
  if (/c\.?u\.?i\.?l/i.test(s)) return 'CUIL inválido';
  return (s.split(/\r?\n/)[0].replace(/\s*\|\s*/g, ' · ').slice(0, 200)) || 'La carga falló';
}

async function saveBecarioArtError(conn, dni, motivo, detalle, screenshot, lote) {
  await conn.query(
    `INSERT INTO becarios_art_errores (dni, motivo, detalle, screenshot, lote)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE motivo = VALUES(motivo), detalle = VALUES(detalle),
       screenshot = VALUES(screenshot), lote = VALUES(lote), updated_at = NOW()`,
    [dni, String(motivo || '').slice(0, 500), String(detalle || '').slice(0, 4000),
     String(screenshot || '').slice(0, 500), String(lote || '').slice(0, 80)]
  );
}

async function clearBecarioArtError(conn, dni) {
  await conn.query('DELETE FROM becarios_art_errores WHERE dni = ?', [dni]);
}

// Clickea el boton "No sé mi CP" (es un boton, no checkbox); si no lo encuentra, tilda el checkbox.
async function clickNoSeMiCP(page) {
  const btn = page.locator('button:has-text("No sé mi CP"), button:has-text("No se mi CP"), input[type="button"][value*="No s"], #btnNoSeCP').first();
  const clicked = await btn.click({ timeout: 4000 }).then(() => true).catch(() => false);
  if (!clicked) {
    await page.locator('#chkNoSeCP, input[type="checkbox"]').last().check({ force: true }).catch(() => undefined);
  }
  await page.waitForTimeout(500);
}

async function submitAndConfirm(page) {
  if (!envFlag('ART_SUBMIT_ENABLED', false)) {
    throw new Error('ART_SUBMIT_ENABLED no esta activo; no se envia el formulario');
  }

  const submit = page.locator('#btnGuardar').or(page.locator('input[type="submit"], button[type="submit"]')).first();
  await submit.click({ timeout: 10000 });

  const successText = optEnv('ART_SUCCESS_TEXT', 'correctamente');
  const success = page.getByText(successText, { exact: false }).or(page.getByText(/correctamente|exitosamente/i)).last();
  const timeoutMs = Number(process.env.ART_SUCCESS_TIMEOUT_MS || 30000);
  const graceMs = 2500;
  let triedNoCP = false;
  const start = Date.now();

  // Carrera: confirmacion de exito vs error de validacion visible (incluye iframes).
  // Si ART rechaza (CUIL invalido, CP, telefono, "debe cargar establecimiento"...),
  // capturamos el motivo real y cortamos ya, sin esperar el timeout completo.
  while (true) {
    if (await success.isVisible().catch(() => false)) {
      const acceptButton = page.locator('button:has-text("ACEPTAR"), input[type="button"][value="ACEPTAR"]').last();
      if (await acceptButton.isVisible().catch(() => false)) {
        await clickVisibleCenter(page, acceptButton, 'Aceptar guardado final');
      }
      return;
    }
    // Margen para que aparezca el "correctamente" antes de mirar errores,
    // asi no marcamos falsos por textos de validacion que quedaron de antes.
    if (Date.now() - start > graceMs) {
      const errs = await collectPageErrors(page);
      if (errs.length) {
        // Si el problema es el CP, clickeamos "No sé mi CP" y reintentamos guardar (una vez).
        if (!triedNoCP && errs.some((e) => /c[oó]digo postal/i.test(e))) {
          triedNoCP = true;
          await clickNoSeMiCP(page);
          await submit.click({ timeout: 10000 }).catch(() => undefined);
          await page.waitForTimeout(800);
          continue;
        }
        throw new Error('ART rechazo el alta: ' + errs.join(' | '));
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout ${timeoutMs}ms esperando confirmacion de ART (sin exito ni error visible)`);
    }
    await page.waitForTimeout(700);
  }
}

async function runBrowser(payload) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: envFlag('ART_HEADLESS', true),
    channel: optEnv('ART_BROWSER_CHANNEL', 'chrome'),
  });
  const page = await browser.newPage();
  try {
    await page.goto(optEnv('ART_LOGIN_URL', 'https://www.provinciart.com.ar/acceso-exclusivo-usuarios-registrados'), { waitUntil: 'domcontentloaded' });
    await fillAfterLabel(page, 'Usuario', mustEnv('ART_PROVINCIA_USER'));
    await fillAfterLabel(page, 'Contraseña', mustEnv('ART_PROVINCIA_PASSWORD'));
    const loginButton = page.getByRole('button', { name: /Iniciar sesi/i }).or(page.getByText(/Iniciar sesi/i)).first();
    await Promise.all([
      page.waitForURL((url) => !String(url).includes('acceso-exclusivo-usuarios-registrados'), { timeout: 45000 }).catch(() => null),
      loginButton.click(),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
    await page.goto(optEnv('ART_ALTA_URL', 'https://www.provinciart.com.ar/nomina-trabajadores/alta-trabajador'), { waitUntil: 'domcontentloaded' });

    await fillAfterLabel(page, 'C.U.I.L.', payload.cuil);
    await fillAfterLabel(page, 'Nombre y Apellido', payload.nombreApellido);
    await selectAfterLabel(page, 'Sexo', payload.sexo);
    await fillAfterLabel(page, 'Cód. Alta Temprana', payload.codigoAltaTemprana);
    await selectAfterLabel(page, 'Estado Civil', payload.estadoCivil);
    await fillAfterLabel(page, 'F. de Nacimiento', payload.fechaNacimiento);
    await selectAfterLabel(page, 'Nacionalidad', payload.nacionalidad);
    if (payload.sinEmail) await checkNearText(page, 'Declaro NO poseer E-mail');
    else await fillAfterLabel(page, 'E-mail', payload.email);
    await fillAfterLabel(page, 'F. Ingreso Empresa', payload.fechaIngresoEmpresa);
    await selectAfterLabel(page, 'Tipo de Contrato', payload.tipoContrato);
    await chooseAutocomplete(page, 'Sector', payload.sector);
    await chooseAutocomplete(page, 'Tarea', payload.tarea);
    await chooseAutocomplete(page, 'CIUO', payload.ciuo);
    await selectAfterLabel(page, 'Provincia', payload.provincia);
    await selectAfterLabel(page, 'Localidad', payload.localidad);
    if (payload.codigoPostal) await fillAfterLabel(page, 'Código Postal', payload.codigoPostal);
    else await checkNearText(page, 'No sé mi CP');
    await fillAfterLabel(page, 'Calle', payload.calle);
    await fillAfterLabel(page, 'Número', payload.numero);
    await fillAfterLabel(page, 'Piso', payload.piso);
    await fillAfterLabel(page, 'Departamento', payload.departamento);
    await fillTelefonoPrincipal(page, payload);
    await addEstablecimientoMapped(page, payload.establecimientoBusqueda);
    await submitAndConfirm(page);
  } catch (err) {
    const dir = path.join(appRoot, 'logs', 'art');
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
    const screenshot = path.join(dir, `art_error_${payload.dni}_${Date.now()}.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    throw new Error(`${err?.message || err}. Captura: ${screenshot}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function markBecarioIfNeeded(conn, payload) {
  if (!payload.isBecario || !envFlag('ART_MARK_BECARIOS_TABLE', true)) return;
  await conn.query(
    `INSERT INTO becarios_art (dni, pagina, origen_art, creado_por, created_at, updated_at)
     VALUES (?, ?, 'automatico', NULL, NOW(), NOW())
     ON DUPLICATE KEY UPDATE origen_art = 'automatico', deleted_at = NULL, updated_at = NOW()`,
    [payload.dni, optEnv('ART_PAGINA_DEFAULT', '')]
  );
}

async function _timed(label, dni, fn) {
  const s = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - s;
    console.error(`[T] DNI ${dni} ${label}: ${(ms / 1000).toFixed(1)}s`);
    try {
      await fs.appendFile(path.join(appRoot, 'logs', 'art', 'timing.log'), `${new Date().toISOString()} ${dni} ${label} ${ms}ms\n`);
    } catch {}
  }
}

async function fillAltaTrabajadorMapped(page, payload) {
  const dni = payload.dni;
  await _timed('datos-basicos', dni, async () => {
    await fillById(page, 'cuil', payload.cuil);
    await fillById(page, 'nombre', payload.nombreApellido);
    await selectById(page, 'sexo', payload.sexo);
    await fillById(page, 'codigoAltaTemprana', payload.codigoAltaTemprana);
    await selectById(page, 'estadoCivil', payload.estadoCivil);
    await fillById(page, 'fechaNacimiento', payload.fechaNacimiento);
    await selectById(page, 'nacionalidad', payload.nacionalidad);
    if (payload.sinEmail) await page.locator('#sinEmail').check({ force: true });
    else await fillById(page, 'email', payload.email);
    await fillById(page, 'fechaIngreso', payload.fechaIngresoEmpresa);
    await selectById(page, 'tipoContrato', payload.tipoContrato);
    await fillById(page, 'sector', payload.sector);
    await fillById(page, 'tarea', payload.tarea);
  });
  await _timed('ciuo', dni, () => chooseAutocompleteById(page, 'autocompleteCIUO', payload.ciuo));
  await _timed('provincia-localidad', dni, async () => {
    await selectById(page, 'cbProvincia', payload.provincia);
    // El combo Localidad se puebla por AJAX DESPUES de elegir Provincia. Si lo seleccionamos
    // de una, todavia no esta la opcion y no toma. Esperamos a que se recargue.
    await page.waitForTimeout(1000);
    await selectById(page, 'cbLocalidad', payload.localidad);
  });
  await _timed('direccion', dni, async () => {
    // Numero (altura) primero: ART pide la altura antes de dejar avanzar con la calle.
    await fillById(page, 'txtAltura', payload.numero);
    await fillById(page, 'txtPiso', payload.piso);
    await fillById(page, 'txtDpto', payload.departamento);
    await fillStreet(page, payload.calle);
    await dismissModal(page);
    if (payload.codigoPostal) await fillById(page, 'txtCPostal', payload.codigoPostal);
    else await clickNoSeMiCP(page);
    await dismissModal(page);
  });
  await _timed('telefono', dni, () => fillTelefonoPrincipal(page, payload));
  await _timed('establecimiento', dni, () => addEstablecimientoMapped(page, payload.establecimientoBusqueda));
  await _timed('submit', dni, () => submitAndConfirm(page));
}

async function runBrowserMapped(payload) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: envFlag('ART_HEADLESS', true),
    channel: optEnv('ART_BROWSER_CHANNEL', 'chrome'),
    slowMo: Number(process.env.ART_SLOW_MO_MS || 0),
    args: envFlag('ART_HEADLESS', true) ? [] : ['--start-maximized'],
  });
  const context = await browser.newContext(envFlag('ART_HEADLESS', true) ? {} : { viewport: null });
  const page = await context.newPage();
  try {
    await navigateToAltaTrabajador(page);
    await fillAltaTrabajadorMapped(page, payload);
  } catch (err) {
    const dir = path.join(appRoot, 'logs', 'art');
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
    const screenshot = path.join(dir, `art_error_${payload.dni}_${Date.now()}.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    throw new Error(`${err?.message || err}. Captura: ${screenshot}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function appendBatchLog(logPath, entry) {
  await fs.appendFile(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

async function goToAltaTrabajadorWithSession(page, firstNavigation) {
  if (firstNavigation) {
    await navigateToAltaTrabajador(page);
    return;
  }

  try {
    await page.goto(optEnv('ART_ALTA_URL', 'https://www.provinciart.com.ar/nomina-trabajadores/alta-trabajador'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
    await page.waitForTimeout(900);
  } catch {
    // Sesion caida: ART interrumpe el goto con un redirect a /nomina-trabajadores.
    // Re-logueamos de cero en vez de fallar el registro.
    await navigateToAltaTrabajador(page);
    return;
  }
  const hasForm = await page.locator('#cuil').isVisible({ timeout: 5000 }).catch(() => false);
  if (!hasForm) await navigateToAltaTrabajador(page);
}

async function runBecariosArtBatch(conn, rows) {
  const { chromium } = await import('playwright');
  const dir = path.join(appRoot, 'logs', 'art');
  await fs.mkdir(dir, { recursive: true });
  const logPath = path.join(dir, `becarios_art_lote_${Date.now()}.jsonl`);
  const lote = path.basename(logPath, '.jsonl');
  await ensureBecariosArtErroresTable(conn);
  const headless = envFlag('ART_HEADLESS', true);
  const browser = await chromium.launch({
    headless,
    channel: optEnv('ART_BROWSER_CHANNEL', 'chrome'),
    slowMo: Number(process.env.ART_SLOW_MO_MS || 0),
    args: headless ? [] : ['--start-maximized'],
  });
  const context = await browser.newContext(headless ? {} : { viewport: null });
  let page = await context.newPage();
  let firstNavigation = true;
  let ok = 0;
  let errors = 0;
  const erroresList = [];

  try {
    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx];
      const dni = Number(row.dni);
      try {
        const dirXlsx = await loadDireccionFromXlsx(dni);
        const provinciaId = await resolveProvinciaId(conn, row, dirXlsx);
        const payload = buildPayload(row, dirXlsx, provinciaId);
        assertPayload(payload);

        console.log(`[${idx + 1}/${rows.length}] Cargando DNI ${dni} - ${payload.nombreApellido}`);
        await goToAltaTrabajadorWithSession(page, firstNavigation);
        firstNavigation = false;
        await fillAltaTrabajadorMapped(page, payload);
        await markBecarioIfNeeded(conn, payload);
        await clearBecarioArtError(conn, dni).catch(() => undefined);
        ok += 1;
        await appendBatchLog(logPath, { status: 'OK', dni, nombre: payload.nombreApellido });
      } catch (err) {
        errors += 1;
        const screenshot = path.join(dir, `art_lote_error_${dni}_${Date.now()}.png`);
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
        const message = String(err?.message || err);
        const pageErrs = await collectPageErrors(page).catch(() => []);
        // Motivo real: preferimos el mensaje de validacion de ART; si no, la 1a linea del error tecnico.
        const motivo = (pageErrs[0] || message.split('\n')[0]).slice(0, 500);
        const detalle = (pageErrs.length ? pageErrs.join(' | ') + ' || ' : '') + message;
        console.error(`[ERROR] DNI ${dni}: ${motivo}`);
        await saveBecarioArtError(conn, dni, motivo, detalle, screenshot, lote).catch(() => undefined);
        erroresList.push({ dni, motivo });
        await appendBatchLog(logPath, { status: 'ERROR', dni, motivo, error: message.slice(0, 2000), pageErrors: pageErrs, screenshot });
        await page.close().catch(() => undefined);
        page = await context.newPage();
        firstNavigation = true;
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  // Reporte final agrupado por motivo (para revisar/corregir).
  const porMotivo = {};
  for (const e of erroresList) {
    (porMotivo[e.motivo] = porMotivo[e.motivo] || []).push(e.dni);
  }
  const reporte = [
    `LOTE ART becarios — ${new Date().toISOString()}`,
    `OK: ${ok}   ERROR: ${errors}   TOTAL: ${rows.length}`,
    '',
    ...Object.entries(porMotivo)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([m, dnis]) => `[${dnis.length}] ${m}\n     ${dnis.join(', ')}`),
  ].join('\n');
  const reportePath = path.join(path.dirname(logPath), `${lote}_reporte.txt`);
  await fs.writeFile(reportePath, reporte + '\n', 'utf8').catch(() => undefined);
  console.log('\n' + reporte + `\n\nReporte: ${reportePath}`);

  return { ok, errors, total: rows.length, logPath, reportePath };
}

async function main() {
  const queueId = argValue('--queue-id') ? Number(argValue('--queue-id')) : null;
  const dniArg = argValue('--dni') ? Number(argValue('--dni')) : null;
  const becariosPendientes = hasArg('--becarios-pendientes');
  const limitArg = argValue('--limit') ? Number(argValue('--limit')) : null;
  const dryRun = hasArg('--dry-run') || envFlag('ART_DRY_RUN', false);
  const soloEstablecimiento = hasArg('--solo-establecimiento');
  if (!becariosPendientes && !queueId && !dniArg) throw new Error('Usa --queue-id <id>, --dni <dni> o --becarios-pendientes');

  const conn = await mysql.createConnection(dbConfig());
  try {
    if (becariosPendientes) {
      const rows = await loadBecariosArtPendientes(conn, limitArg, { establecimientoOnly: soloEstablecimiento });
      if (dryRun) {
        console.log(JSON.stringify({ ok: true, dryRun: true, total: rows.length, dnis: rows.map((r) => r.dni) }, null, 2));
        return;
      }
      const result = await runBecariosArtBatch(conn, rows);
      console.log(JSON.stringify({ ok: true, ...result }));
      return;
    }

    const row = await loadQueueItem(conn, queueId, dniArg);
    if (queueId && row.queue_status !== 'PROCESSING') {
      await setQueueStatus(conn, queueId, 'PROCESSING', { locked_at: new Date(), started_at: new Date() });
    }
    const dir = await loadDireccionFromXlsx(row.dni);
    const provinciaId = await resolveProvinciaId(conn, row, dir);
    const payload = buildPayload(row, dir, provinciaId);
    assertPayload(payload);

    if (dryRun) {
      console.log(JSON.stringify({ ok: true, dryRun: true, payload }, null, 2));
      return;
    }

    await runBrowserMapped(payload);
    await markBecarioIfNeeded(conn, payload);
    await setQueueStatus(conn, row.queue_id, 'DONE', {
      finished_at: new Date(),
      locked_at: null,
      resultado_art: `Alta ART confirmada para DNI ${payload.dni}`,
    });
    // Alta OK → sacamos la fila de la lista de errores de la pagina "Carga de ART" (si estaba).
    await conn.query('DELETE FROM becarios_art_errores WHERE dni = ?', [payload.dni]).catch(() => undefined);
    console.log(JSON.stringify({ ok: true, queueId: row.queue_id, dni: payload.dni }));
  } catch (err) {
    const fullMsg = String(err?.message || err);
    if (queueId) {
      await setQueueStatus(conn, queueId, 'ERROR', {
        finished_at: new Date(),
        locked_at: null,
        last_error: fullMsg.slice(0, 60000),
      }).catch(() => undefined);
    }
    // Actualizar la pagina "Carga de ART" con el motivo del ULTIMO intento (no dejar el viejo).
    let dniErr = dniArg || null;
    if (!dniErr && queueId) {
      const [qr] = await conn.query('SELECT dni FROM art_alta_queue WHERE id = ?', [queueId]).catch(() => [[]]);
      dniErr = qr?.[0]?.dni || null;
    }
    if (dniErr) {
      await saveBecarioArtError(conn, dniErr, resumenMotivo(fullMsg), fullMsg, null, null).catch(() => undefined);
    }
    throw err;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
