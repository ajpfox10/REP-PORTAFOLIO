import { Router, Request, Response } from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { logger } from '../logging/logger';
import { trackAction } from '../logging/track';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { celularDe } from './licenciasMedicasControl.routes';

type CumpleEstado = 'PENDIENTE' | 'AVISADO' | 'OMITIDO';

const initializedDatabases = new WeakSet<Sequelize>();

async function ensureTable(sequelize: Sequelize) {
  if (initializedDatabases.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS alertas_cumpleanos_estado (
      id INT NOT NULL AUTO_INCREMENT,
      dni INT NOT NULL,
      anio INT NOT NULL,
      fecha_cumple DATE NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      avisado_at DATETIME NULL,
      avisado_por INT NULL,
      omitido_at DATETIME NULL,
      omitido_por INT NULL,
      observaciones TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_alertas_cumpleanos_dni_anio (dni, anio),
      KEY idx_alertas_cumpleanos_estado (estado),
      KEY idx_alertas_cumpleanos_fecha (fecha_cumple)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  initializedDatabases.add(sequelize);
}

function toInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function parseDbDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const text = String(value).slice(0, 10);
  const parts = text.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return isNaN(d.getTime()) ? null : d;
}

function birthdayForYear(fechaNacimiento: any, year: number) {
  const born = parseDbDate(fechaNacimiento);
  if (!born) return null;
  const month = born.getMonth();
  const day = born.getDate();
  const candidate = new Date(year, month, day);
  if (month === 1 && day === 29 && candidate.getMonth() !== 1) {
    return new Date(year, 1, 28);
  }
  return candidate;
}

function dateOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function setEstado(sequelize: Sequelize, req: Request, res: Response, estado: CumpleEstado) {
  try {
    await ensureTable(sequelize);
    const dni = Number(req.params.dni);
    const anio = Number(req.params.anio);
    const userId = (req as any).auth?.principalId ?? null;
    if (!Number.isInteger(dni) || dni <= 0 || !Number.isInteger(anio)) {
      return res.status(400).json({ ok: false, error: 'Parametros invalidos' });
    }

    const rows = await sequelize.query<{ fecha_nacimiento: string }>(
      `SELECT fecha_nacimiento FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
      { replacements: { dni }, type: QueryTypes.SELECT },
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'DNI no encontrado' });

    const cumple = birthdayForYear(rows[0].fecha_nacimiento, anio);
    if (!cumple) return res.status(400).json({ ok: false, error: 'Fecha de nacimiento invalida' });

    if (estado === 'PENDIENTE') {
      await sequelize.query(
        `INSERT INTO alertas_cumpleanos_estado
           (dni, anio, fecha_cumple, estado, created_at, updated_at)
         VALUES
           (:dni, :anio, :fechaCumple, :estado, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           fecha_cumple = VALUES(fecha_cumple),
           estado = VALUES(estado),
           avisado_at = NULL,
           avisado_por = NULL,
           omitido_at = NULL,
           omitido_por = NULL,
           updated_at = NOW()`,
        { replacements: { dni, anio, fechaCumple: dateOnly(cumple), estado } },
      );
    } else {
      const nowField = estado === 'AVISADO' ? 'avisado_at' : 'omitido_at';
      const userField = estado === 'AVISADO' ? 'avisado_por' : 'omitido_por';

      await sequelize.query(
        `INSERT INTO alertas_cumpleanos_estado
           (dni, anio, fecha_cumple, estado, ${nowField}, ${userField}, created_at, updated_at)
         VALUES
           (:dni, :anio, :fechaCumple, :estado, NOW(), :userId, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           fecha_cumple = VALUES(fecha_cumple),
           estado = VALUES(estado),
           ${nowField} = NOW(),
           ${userField} = :userId,
           updated_at = NOW()`,
        { replacements: { dni, anio, fechaCumple: dateOnly(cumple), estado, userId } },
      );
    }

    trackAction('alerta_cumpleanos_estado', { actor: userId, dni, anio, estado });
    return res.json({ ok: true, data: { dni, anio, estado } });
  } catch (err: any) {
    logger.error({ msg: 'Error actualizando alerta de cumpleanos', err });
    return res.status(500).json({ ok: false, error: 'Error al actualizar cumpleanos' });
  }
}

// ── Felicitaciones por WhatsApp ─────────────────────────────────────────────
// La tarjeta (imagen) la arma el front en un canvas (diseño predefinido o imagen subida + nombre)
// y la extensión de Chrome la manda por WhatsApp Web con el texto como comentario.
// Acá se guardan: la configuración (una fila), las imágenes subidas y cada intento de envío.
const felicitacionInit = new WeakSet<Sequelize>();
async function ensureFelicitacionTables(sequelize: Sequelize) {
  if (felicitacionInit.has(sequelize)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS cumpleanos_felicitacion_config (
      id INT NOT NULL,
      plantilla TEXT NULL,
      imagen VARCHAR(40) NOT NULL DEFAULT 'diseno:globos',
      nombre_en_imagen TINYINT(1) NOT NULL DEFAULT 1,
      automatico TINYINT(1) NOT NULL DEFAULT 0,
      hora VARCHAR(5) NOT NULL DEFAULT '09:00',
      prueba TINYINT(1) NOT NULL DEFAULT 1,
      destino_prueba VARCHAR(50) NULL,
      modo VARCHAR(20) NOT NULL DEFAULT 'TELEFONO',
      updated_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS cumpleanos_felicitacion_imagenes (
      id INT NOT NULL AUTO_INCREMENT,
      nombre VARCHAR(200) NOT NULL,
      mime VARCHAR(50) NOT NULL,
      datos MEDIUMBLOB NOT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS cumpleanos_felicitacion_envios (
      id INT NOT NULL AUTO_INCREMENT,
      dni INT NOT NULL,
      anio INT NOT NULL,
      estado VARCHAR(20) NOT NULL,
      modo VARCHAR(20) NULL,
      destino VARCHAR(100) NULL,
      detalle VARCHAR(500) NULL,
      imagen VARCHAR(40) NULL,
      prueba TINYINT(1) NOT NULL DEFAULT 0,
      automatico TINYINT(1) NOT NULL DEFAULT 0,
      enviado_por INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_cfe_dni_anio (dni, anio),
      KEY idx_cfe_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // "Toma" de un cumpleaños por la PC que lo va a mandar en automático: evita que dos PCs
  // con la app abierta manden el mismo saludo a la vez (la toma vence a los 10 minutos).
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS cumpleanos_felicitacion_tomas (
      dni INT NOT NULL,
      anio INT NOT NULL,
      prueba TINYINT(1) NOT NULL,
      token VARCHAR(40) NOT NULL,
      tomado_at DATETIME NOT NULL,
      PRIMARY KEY (dni, anio, prueba)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Latido de cada navegador que tiene tildado "Esta PC manda las felicitaciones automáticas":
  // la página avisa si ninguna se reporta hace rato (PC suspendida, pestaña dormida, sesión caída).
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS cumpleanos_felicitacion_pcs (
      pc_id VARCHAR(40) NOT NULL,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      usuario_id INT NULL,
      ext_version VARCHAR(20) NULL,
      estado VARCHAR(40) NULL,
      ultimo_latido DATETIME NOT NULL,
      PRIMARY KEY (pc_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await sequelize.query(`INSERT IGNORE INTO cumpleanos_felicitacion_config (id) VALUES (1)`);
  // imagen pasó de VARCHAR(40) a 255 para guardar 'carpeta:<nombre de archivo>'
  await sequelize.query(`ALTER TABLE cumpleanos_felicitacion_config MODIFY imagen VARCHAR(255) NOT NULL DEFAULT 'diseno:globos'`);
  await sequelize.query(`ALTER TABLE cumpleanos_felicitacion_envios MODIFY imagen VARCHAR(255) NULL`);
  // Texto para cuando el cumpleaños ya pasó (se felicita atrasado)
  const [col] = await sequelize.query<any>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cumpleanos_felicitacion_config' AND COLUMN_NAME = 'plantilla_atrasado'`,
    { type: QueryTypes.SELECT },
  );
  if (!Number(col?.n)) {
    await sequelize.query(`ALTER TABLE cumpleanos_felicitacion_config ADD COLUMN plantilla_atrasado TEXT NULL AFTER plantilla`);
  }
  felicitacionInit.add(sequelize);
}

// Carpeta de tarjetas propias: toda imagen que se guarde ahí aparece en la página para elegir.
// En el servidor es D:\G\TARJETAS CUMPLEANOS (en la red \\host\G\TARJETAS CUMPLEANOS);
// adentro hay un LEEME con las instrucciones.
const TARJETAS_DIR = path.resolve(process.env.FELICITACIONES_TARJETAS_DIR?.trim() || 'D:\\G\\TARJETAS CUMPLEANOS');
const TARJETAS_MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const TARJETAS_MAX_BYTES = 8 * 1024 * 1024;

function listarCarpetaTarjetas() {
  const existe = fs.existsSync(TARJETAS_DIR);
  const imagenes = !existe ? [] : fs.readdirSync(TARJETAS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && TARJETAS_MIME[path.extname(d.name).toLowerCase()])
    .map((d) => {
      const st = fs.statSync(path.join(TARJETAS_DIR, d.name));
      return { archivo: d.name, nombre: path.basename(d.name, path.extname(d.name)), bytes: st.size, modificado: st.mtime };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return {
    ruta: TARJETAS_DIR,
    // relativa al share (lo que va después de \\host\): D:\G\X → G\X
    uncRel: TARJETAS_DIR.replace(/^[a-zA-Z]:[\\/]/, '').replace(/\//g, '\\'),
    existe,
    imagenes,
  };
}

/** Archivo de la carpeta de tarjetas, o null si el nombre no es válido (sin subcarpetas ni "..") */
function archivoTarjeta(nombre: string) {
  const base = path.basename(String(nombre || ''));
  if (!base || base !== nombre || !TARJETAS_MIME[path.extname(base).toLowerCase()]) return null;
  const full = path.join(TARJETAS_DIR, base);
  return path.dirname(full) === TARJETAS_DIR ? full : null;
}

const PLANTILLA_FELICITACION_DEFAULT =
  '¡Feliz cumpleaños, {nombre}! 🎂🎉\n\nDe parte de todo el equipo de Personal te deseamos un día hermoso, rodeado de afecto. ¡Que lo disfrutes mucho!';

const PLANTILLA_ATRASADO_DEFAULT =
  '¡Hola, {nombre}! 🎂\n\nSabemos que {fecha} fue tu cumpleaños y lamentamos no haber podido saludarte a tiempo. De parte de todo el equipo de Personal te deseamos un muy feliz cumpleaños. ¡Esperamos que hayas pasado un día hermoso, rodeado de afecto!';

const imagenUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

async function leerConfigFelicitacion(sequelize: Sequelize) {
  await ensureFelicitacionTables(sequelize);
  const [c] = await sequelize.query<any>(`SELECT * FROM cumpleanos_felicitacion_config WHERE id = 1`, { type: QueryTypes.SELECT });
  return {
    plantilla: c?.plantilla || PLANTILLA_FELICITACION_DEFAULT,
    plantilla_atrasado: c?.plantilla_atrasado || PLANTILLA_ATRASADO_DEFAULT,
    imagen: c?.imagen || 'diseno:globos',
    nombre_en_imagen: !!Number(c?.nombre_en_imagen ?? 1),
    automatico: !!Number(c?.automatico ?? 0),
    hora: c?.hora || '09:00',
    prueba: !!Number(c?.prueba ?? 1),
    destino_prueba: c?.destino_prueba || '',
    modo: c?.modo || 'TELEFONO',
    updated_at: c?.updated_at || null,
  };
}

async function marcarAvisado(sequelize: Sequelize, dni: number, anio: number, userId: number | null) {
  const rows = await sequelize.query<{ fecha_nacimiento: string }>(
    `SELECT fecha_nacimiento FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
    { replacements: { dni }, type: QueryTypes.SELECT },
  );
  const cumple = rows.length ? birthdayForYear(rows[0].fecha_nacimiento, anio) : null;
  if (!cumple) return;
  await sequelize.query(
    `INSERT INTO alertas_cumpleanos_estado
       (dni, anio, fecha_cumple, estado, avisado_at, avisado_por, created_at, updated_at)
     VALUES (:dni, :anio, :fechaCumple, 'AVISADO', NOW(), :userId, NOW(), NOW())
     ON DUPLICATE KEY UPDATE estado = 'AVISADO', avisado_at = NOW(), avisado_por = :userId, updated_at = NOW()`,
    { replacements: { dni, anio, fechaCumple: dateOnly(cumple), userId } },
  );
}

/** Último envío (real y de prueba) por dni-anio, para mostrar en la lista. */
async function ultimosEnvios(sequelize: Sequelize, claves: { dni: number; anio: number }[]) {
  const map = new Map<string, any>();
  if (!claves.length) return map;
  const dnis = [...new Set(claves.map((c) => c.dni))];
  const anios = [...new Set(claves.map((c) => c.anio))];
  const rows = await sequelize.query<any>(
    `SELECT e.* FROM cumpleanos_felicitacion_envios e WHERE e.dni IN (:dnis) AND e.anio IN (:anios) ORDER BY e.id`,
    { replacements: { dnis, anios }, type: QueryTypes.SELECT },
  );
  for (const r of rows) {
    const k = `${r.dni}-${r.anio}`;
    const prev = map.get(k) || { real: null, prueba: null, intentos: 0 };
    prev.intentos++;
    const dato = { estado: r.estado, modo: r.modo, destino: r.destino, detalle: r.detalle, automatico: !!Number(r.automatico), at: r.created_at };
    if (Number(r.prueba)) prev.prueba = dato; else prev.real = dato;
    map.set(k, prev);
  }
  return map;
}

export function buildCumpleanosAlertasRouter(sequelize: Sequelize) {
  const router = Router();

  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    try {
      await ensureTable(sequelize);
      const dias = toInt(req.query.dias, 7, 0, 60);
      const estadoFiltro = String(req.query.estado || 'pendientes').toLowerCase();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(today);
      end.setDate(end.getDate() + dias);

      const rows = await sequelize.query<any>(
        `SELECT
           p.dni, p.apellido, p.nombre, p.fecha_nacimiento, p.email, p.telefono,
           (SELECT srv.nombre FROM agentes_servicios ags JOIN servicios srv ON srv.id = ags.servicio_id
             WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
             ORDER BY ags.id DESC LIMIT 1) AS servicio_nombre,
           (SELECT sec.nombre FROM agentes_sectores ags JOIN sectores sec ON sec.id = ags.sector_id
             WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
             ORDER BY ags.id DESC LIMIT 1) AS sector_nombre
         FROM personal p
         JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO'
         WHERE p.deleted_at IS NULL
           AND p.fecha_nacimiento IS NOT NULL`,
        { type: QueryTypes.SELECT },
      );

      const years = [today.getFullYear(), today.getFullYear() + 1];
      const items = rows.flatMap((p) => {
        return years.map((year) => {
          const cumple = birthdayForYear(p.fecha_nacimiento, year);
          if (!cumple) return null;
          cumple.setHours(0, 0, 0, 0);
          if (cumple < today || cumple > end) return null;
          const diasRestantes = Math.round((cumple.getTime() - today.getTime()) / 86400000);
          return {
            ...p,
            anio: year,
            fecha_cumple: dateOnly(cumple),
            dias: diasRestantes,
          };
        }).filter(Boolean);
      });

      // El sembrado de los cumpleanos del dia lo hace un EVENT diario de MySQL
      // (ev_sembrar_cumpleanos_diario) — NO depende de que la app se abra.
      // Aca solo se listan.

      // Backlog: cumpleanos ya pasados que quedaron sembrados en PENDIENTE y
      // todavia no se marcaron. Se siguen listando (independiente de `dias`)
      // hasta que alguien los avise u omita.
      let backlogItems: any[] = [];
      if (estadoFiltro === 'pendientes' || estadoFiltro === 'todos') {
        const backlog = await sequelize.query<any>(
          `SELECT e.dni, e.anio, e.fecha_cumple,
                  p.apellido, p.nombre, p.fecha_nacimiento, p.email, p.telefono,
                  (SELECT srv.nombre FROM agentes_servicios ags JOIN servicios srv ON srv.id = ags.servicio_id
                    WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
                    ORDER BY ags.id DESC LIMIT 1) AS servicio_nombre,
                  (SELECT sec.nombre FROM agentes_sectores ags JOIN sectores sec ON sec.id = ags.sector_id
                    WHERE ags.dni = p.dni AND ags.deleted_at IS NULL AND ags.fecha_hasta IS NULL
                    ORDER BY ags.id DESC LIMIT 1) AS sector_nombre
           FROM alertas_cumpleanos_estado e
           JOIN personal p ON p.dni = e.dni AND p.deleted_at IS NULL
           JOIN agentes a ON a.dni = p.dni AND a.deleted_at IS NULL AND a.estado_empleo = 'ACTIVO'
           WHERE e.estado = 'PENDIENTE' AND e.fecha_cumple < :today`,
          { replacements: { today: dateOnly(today) }, type: QueryTypes.SELECT },
        );
        backlogItems = backlog.map((b: any) => {
          const fc = parseDbDate(b.fecha_cumple);
          return {
            dni: b.dni,
            apellido: b.apellido,
            nombre: b.nombre,
            fecha_nacimiento: b.fecha_nacimiento,
            email: b.email,
            telefono: b.telefono,
            servicio_nombre: b.servicio_nombre,
            sector_nombre: b.sector_nombre,
            anio: b.anio,
            fecha_cumple: fc ? dateOnly(fc) : String(b.fecha_cumple).slice(0, 10),
            dias: fc ? Math.round((fc.getTime() - today.getTime()) / 86400000) : 0,
            estado_aviso: 'PENDIENTE',
            avisado_at: null,
            avisado_por: null,
            avisado_por_nombre: null,
          };
        });
      }

      const estadoRows = await sequelize.query<any>(
        `SELECT e.*, COALESCE(NULLIF(u.nombre, ''), u.email) AS avisado_por_nombre
         FROM alertas_cumpleanos_estado e
         LEFT JOIN usuarios u ON u.id = e.avisado_por
         WHERE e.fecha_cumple BETWEEN :desde AND :hasta`,
        { replacements: { desde: dateOnly(today), hasta: dateOnly(end) }, type: QueryTypes.SELECT },
      );
      const estadoMap = new Map(estadoRows.map((e) => [`${e.dni}-${e.anio}`, e]));

      const windowData = items.map((item: any) => {
        const estado = estadoMap.get(`${item.dni}-${item.anio}`);
        return {
          ...item,
          estado_aviso: estado?.estado || 'PENDIENTE',
          avisado_at: estado?.avisado_at || null,
          avisado_por: estado?.avisado_por || null,
          avisado_por_nombre: estado?.avisado_por_nombre || null,
        };
      });

      // backlog (cumple < hoy) y windowData (cumple >= hoy) son disjuntos por fecha
      const data = [...backlogItems, ...windowData]
        .filter((item: any) => {
          if (estadoFiltro === 'todos') return true;
          if (estadoFiltro === 'avisados') return item.estado_aviso === 'AVISADO';
          if (estadoFiltro === 'omitidos') return item.estado_aviso === 'OMITIDO';
          return item.estado_aviso === 'PENDIENTE';
        })
        .sort((a: any, b: any) => a.dias - b.dias || String(a.apellido).localeCompare(String(b.apellido), 'es'));

      await ensureFelicitacionTables(sequelize);
      const envios = await ultimosEnvios(sequelize, data.map((d: any) => ({ dni: Number(d.dni), anio: Number(d.anio) })));
      const conWsp = data.map((d: any) => {
        const cel = celularDe(d.telefono);
        return { ...d, celular: cel.celular, celular_dudoso: cel.dudoso, whatsapp: envios.get(`${d.dni}-${d.anio}`) || null };
      });

      return res.json({ ok: true, data: conWsp, meta: { total: conWsp.length, dias, estado: estadoFiltro } });
    } catch (err: any) {
      logger.error({ msg: 'Error listando alertas de cumpleanos', err });
      return res.status(500).json({ ok: false, error: 'Error al listar cumpleanos' });
    }
  });

  router.post('/:dni/:anio/avisar', requirePermission('api:access'), (req, res) => setEstado(sequelize, req, res, 'AVISADO'));
  router.post('/:dni/:anio/omitir', requirePermission('api:access'), (req, res) => setEstado(sequelize, req, res, 'OMITIDO'));
  router.post('/:dni/:anio/pendiente', requirePermission('api:access'), (req, res) => setEstado(sequelize, req, res, 'PENDIENTE'));

  // ── Felicitaciones por WhatsApp ───────────────────────────────────────────
  router.get('/felicitacion/config', requirePermission('api:access'), async (_req, res) => {
    try {
      const config = await leerConfigFelicitacion(sequelize);
      const imagenes = await sequelize.query<any>(
        `SELECT id, nombre, mime, LENGTH(datos) AS bytes, created_at FROM cumpleanos_felicitacion_imagenes
          WHERE deleted_at IS NULL ORDER BY id DESC`,
        { type: QueryTypes.SELECT },
      );
      let carpeta: any;
      try { carpeta = listarCarpetaTarjetas(); } catch (e: any) {
        carpeta = { ruta: TARJETAS_DIR, uncRel: '', existe: false, imagenes: [], error: e?.message || 'No se pudo leer la carpeta' };
      }
      const pcs = await sequelize.query<any>(
        `SELECT p.pc_id, p.ip, p.user_agent, p.ext_version, p.estado, p.ultimo_latido, u.nombre AS usuario,
                TIMESTAMPDIFF(MINUTE, p.ultimo_latido, NOW()) AS minutos
           FROM cumpleanos_felicitacion_pcs p LEFT JOIN usuarios u ON u.id = p.usuario_id
          WHERE p.ultimo_latido > NOW() - INTERVAL 30 DAY
          ORDER BY p.ultimo_latido DESC`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ ok: true, data: { config, imagenes, carpeta, pcs, plantilla_default: PLANTILLA_FELICITACION_DEFAULT, plantilla_atrasado_default: PLANTILLA_ATRASADO_DEFAULT } });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion config', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo leer la configuración' });
    }
  });

  router.put('/felicitacion/config', requirePermission('crud:*:*'), async (req, res) => {
    try {
      await ensureFelicitacionTables(sequelize);
      const b = req.body || {};
      const hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.hora || '')) ? String(b.hora) : '09:00';
      const img = String(b.imagen || '');
      const imagen = /^(diseno:[a-z]+|subida:\d+)$/.test(img) || (img.startsWith('carpeta:') && img.length <= 255 && archivoTarjeta(img.slice(8)))
        ? img : 'diseno:globos';
      const modo = ['TELEFONO', 'NOMBRE_TELEFONO'].includes(String(b.modo)) ? String(b.modo) : 'TELEFONO';
      const plantilla = String(b.plantilla ?? '').slice(0, 2000).trim() || null;
      const plantillaAtrasado = String(b.plantilla_atrasado ?? '').slice(0, 2000).trim() || null;
      await sequelize.query(
        `UPDATE cumpleanos_felicitacion_config SET plantilla = :plantilla, plantilla_atrasado = :pat, imagen = :imagen, nombre_en_imagen = :nei,
            automatico = :auto, hora = :hora, prueba = :prueba, destino_prueba = :dp, modo = :modo, updated_by = :uid
          WHERE id = 1`,
        { replacements: {
          plantilla, pat: plantillaAtrasado, imagen, nei: b.nombre_en_imagen === false ? 0 : 1, auto: b.automatico ? 1 : 0, hora,
          prueba: b.prueba === false ? 0 : 1, dp: String(b.destino_prueba || '').slice(0, 50) || null, modo,
          uid: (req as any).auth?.principalId ?? null,
        } },
      );
      trackAction('cumpleanos_felicitacion_config', { actor: (req as any).auth?.principalId ?? null, automatico: !!b.automatico, prueba: b.prueba !== false });
      return res.json({ ok: true, data: await leerConfigFelicitacion(sequelize) });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion config put', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo guardar la configuración' });
    }
  });

  router.get('/felicitacion/imagenes/:id', requirePermission('api:access'), async (req, res) => {
    try {
      await ensureFelicitacionTables(sequelize);
      const [img] = await sequelize.query<any>(
        `SELECT mime, datos FROM cumpleanos_felicitacion_imagenes WHERE id = :id AND deleted_at IS NULL`,
        { replacements: { id: Number(req.params.id) || 0 }, type: QueryTypes.SELECT },
      );
      if (!img) return res.status(404).json({ ok: false, error: 'Imagen no encontrada' });
      return res.json({ ok: true, data: { mime: img.mime, base64: Buffer.from(img.datos).toString('base64') } });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion imagen get', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo leer la imagen' });
    }
  });

  // Instructivo de la carpeta (el .txt que empieza con LEEME): la página lo muestra tal cual,
  // así si se edita el archivo cambia en los dos lados.
  router.get('/felicitacion/carpeta-leeme', requirePermission('api:access'), async (_req, res) => {
    try {
      const archivo = fs.existsSync(TARJETAS_DIR)
        ? fs.readdirSync(TARJETAS_DIR).find((n) => /^LEEME.*\.txt$/i.test(n))
        : undefined;
      if (!archivo) return res.status(404).json({ ok: false, error: `No hay ningún LEEME*.txt en ${TARJETAS_DIR}` });
      const texto = fs.readFileSync(path.join(TARJETAS_DIR, archivo), 'utf8').replace(/^\uFEFF/, '');
      return res.json({ ok: true, data: { archivo, texto } });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion leeme', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo leer el instructivo' });
    }
  });

  // Imagen de la carpeta de tarjetas (D:\G\TARJETAS CUMPLEANOS)
  router.get('/felicitacion/carpeta/:archivo', requirePermission('api:access'), async (req, res) => {
    try {
      const full = archivoTarjeta(req.params.archivo);
      if (!full || !fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'La tarjeta ya no está en la carpeta' });
      const st = fs.statSync(full);
      if (st.size > TARJETAS_MAX_BYTES) return res.status(400).json({ ok: false, error: 'La imagen pesa más de 8 MB' });
      const mime = TARJETAS_MIME[path.extname(full).toLowerCase()];
      return res.json({ ok: true, data: { mime, base64: fs.readFileSync(full).toString('base64') } });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion carpeta get', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo leer la tarjeta' });
    }
  });

  router.post('/felicitacion/imagenes', requirePermission('crud:*:*'), imagenUpload.single('archivo'), async (req, res) => {
    try {
      await ensureFelicitacionTables(sequelize);
      const f = (req as any).file as { mimetype: string; originalname: string; buffer: Buffer } | undefined;
      if (!f) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
      if (!/^image\/(png|jpeg|webp)$/.test(f.mimetype)) return res.status(400).json({ ok: false, error: 'Solo imágenes JPG, PNG o WEBP' });
      const nombre = String(req.body?.nombre || f.originalname || 'imagen').slice(0, 200);
      const [id] = await sequelize.query(
        `INSERT INTO cumpleanos_felicitacion_imagenes (nombre, mime, datos, created_by) VALUES (:nombre, :mime, :datos, :uid)`,
        { replacements: { nombre, mime: f.mimetype, datos: f.buffer, uid: (req as any).auth?.principalId ?? null } },
      );
      return res.json({ ok: true, data: { id, nombre } });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion imagen post', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo guardar la imagen' });
    }
  });

  router.delete('/felicitacion/imagenes/:id', requirePermission('crud:*:*'), async (req, res) => {
    try {
      await ensureFelicitacionTables(sequelize);
      const id = Number(req.params.id) || 0;
      await sequelize.query(`UPDATE cumpleanos_felicitacion_imagenes SET deleted_at = NOW() WHERE id = :id`, { replacements: { id } });
      // Si era la elegida, vuelve al diseño por defecto
      await sequelize.query(`UPDATE cumpleanos_felicitacion_config SET imagen = 'diseno:globos' WHERE id = 1 AND imagen = :img`, { replacements: { img: `subida:${id}` } });
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion imagen delete', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo borrar la imagen' });
    }
  });

  // Envío automático: la PC que va a mandar "toma" el cumpleaños. tomado=false si ya hubo un
  // intento automático (en el mismo modo prueba/real), si ya está avisado/omitido (real) o si otra
  // PC lo tomó hace menos de 10 minutos.
  router.post('/felicitacion/tomar', requirePermission('api:access'), async (req, res) => {
    try {
      await ensureFelicitacionTables(sequelize);
      const dni = Number(req.body?.dni), anio = Number(req.body?.anio), prueba = req.body?.prueba ? 1 : 0;
      if (!Number.isInteger(dni) || !Number.isInteger(anio)) return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });
      const [previo] = await sequelize.query<any>(
        `SELECT COUNT(*) AS n FROM cumpleanos_felicitacion_envios WHERE dni = :dni AND anio = :anio AND automatico = 1 AND prueba = :prueba`,
        { replacements: { dni, anio, prueba }, type: QueryTypes.SELECT },
      );
      if (Number(previo?.n) > 0) return res.json({ ok: true, tomado: false, motivo: 'Ya hubo un intento automático' });
      if (!prueba) {
        const [est] = await sequelize.query<any>(
          `SELECT estado FROM alertas_cumpleanos_estado WHERE dni = :dni AND anio = :anio`,
          { replacements: { dni, anio }, type: QueryTypes.SELECT },
        );
        if (est && est.estado !== 'PENDIENTE') return res.json({ ok: true, tomado: false, motivo: `Ya está ${est.estado}` });
      }
      const token = crypto.randomBytes(12).toString('hex');
      await sequelize.query(
        `INSERT INTO cumpleanos_felicitacion_tomas (dni, anio, prueba, token, tomado_at) VALUES (:dni, :anio, :prueba, :token, NOW())
         ON DUPLICATE KEY UPDATE
           token = IF(tomado_at < NOW() - INTERVAL 10 MINUTE, VALUES(token), token),
           tomado_at = IF(tomado_at < NOW() - INTERVAL 10 MINUTE, VALUES(tomado_at), tomado_at)`,
        { replacements: { dni, anio, prueba, token } },
      );
      const [t] = await sequelize.query<any>(
        `SELECT token FROM cumpleanos_felicitacion_tomas WHERE dni = :dni AND anio = :anio AND prueba = :prueba`,
        { replacements: { dni, anio, prueba }, type: QueryTypes.SELECT },
      );
      return res.json({ ok: true, tomado: t?.token === token, motivo: t?.token === token ? null : 'Lo está mandando otra PC' });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion tomar', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo tomar el cumpleaños' });
    }
  });

  // Latido de la PC automática (cada 5 min desde FelicitacionAutomatica). `baja: true` = destildó.
  router.post('/felicitacion/latido', requirePermission('api:access'), async (req, res) => {
    try {
      await ensureFelicitacionTables(sequelize);
      const pcId = String(req.body?.pc_id || '').trim();
      if (!/^[a-z0-9-]{8,40}$/i.test(pcId)) return res.status(400).json({ ok: false, error: 'pc_id inválido' });
      if (req.body?.baja) {
        await sequelize.query(`DELETE FROM cumpleanos_felicitacion_pcs WHERE pc_id = :pcId`, { replacements: { pcId } });
        return res.json({ ok: true });
      }
      await sequelize.query(
        `INSERT INTO cumpleanos_felicitacion_pcs (pc_id, ip, user_agent, usuario_id, ext_version, estado, ultimo_latido)
         VALUES (:pcId, :ip, :ua, :uid, :ext, :estado, NOW())
         ON DUPLICATE KEY UPDATE ip = VALUES(ip), user_agent = VALUES(user_agent), usuario_id = VALUES(usuario_id),
           ext_version = VALUES(ext_version), estado = VALUES(estado), ultimo_latido = NOW()`,
        { replacements: {
          pcId,
          ip: String(req.ip || '').replace(/^::ffff:/, '').slice(0, 64) || null,
          ua: String(req.header('user-agent') || '').slice(0, 255) || null,
          uid: (req as any).auth?.principalId ?? null,
          ext: String(req.body?.ext || '').slice(0, 20) || null,
          estado: String(req.body?.estado || '').slice(0, 40) || null,
        } },
      );
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion latido', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo registrar el latido' });
    }
  });

  // Resultado de un envío (manual o automático). Si salió bien y no es prueba → AVISADO.
  router.post('/felicitacion/envios', requirePermission('api:access'), async (req, res) => {
    try {
      await ensureFelicitacionTables(sequelize);
      const b = req.body || {};
      const dni = Number(b.dni), anio = Number(b.anio);
      if (!Number.isInteger(dni) || !Number.isInteger(anio)) return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });
      const estado = String(b.estado || 'ERROR').slice(0, 20);
      const prueba = b.prueba ? 1 : 0;
      const userId = (req as any).auth?.principalId ?? null;
      await sequelize.query(
        `INSERT INTO cumpleanos_felicitacion_envios (dni, anio, estado, modo, destino, detalle, imagen, prueba, automatico, enviado_por)
         VALUES (:dni, :anio, :estado, :modo, :destino, :detalle, :imagen, :prueba, :auto, :uid)`,
        { replacements: {
          dni, anio, estado, modo: b.modo ? String(b.modo).slice(0, 20) : null, destino: b.destino ? String(b.destino).slice(0, 100) : null,
          detalle: b.detalle ? String(b.detalle).slice(0, 500) : null, imagen: b.imagen ? String(b.imagen).slice(0, 255) : null,
          prueba, auto: b.automatico ? 1 : 0, uid: userId,
        } },
      );
      if (estado === 'ENVIADO' && !prueba) await marcarAvisado(sequelize, dni, anio, userId);
      trackAction('cumpleanos_felicitacion_envio', { actor: userId, dni, anio, estado, prueba: !!prueba, automatico: !!b.automatico });
      return res.json({ ok: true });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion envio', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo registrar el envío' });
    }
  });

  router.get('/felicitacion/envios', requirePermission('api:access'), async (req, res) => {
    try {
      await ensureFelicitacionTables(sequelize);
      const limite = toInt(req.query.limite, 200, 1, 1000);
      const rows = await sequelize.query<any>(
        `SELECT e.*, p.apellido, p.nombre, COALESCE(NULLIF(u.nombre, ''), u.email) AS enviado_por_nombre
           FROM cumpleanos_felicitacion_envios e
           LEFT JOIN personal p ON p.dni = e.dni
           LEFT JOIN usuarios u ON u.id = e.enviado_por
          ORDER BY e.id DESC LIMIT ${limite}`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ ok: true, data: rows });
    } catch (err: any) {
      logger.error({ msg: 'felicitacion envios get', err: err?.message });
      return res.status(500).json({ ok: false, error: 'No se pudo leer el historial' });
    }
  });

  return router;
}
