// src/routes/casosViolencia.routes.ts
// Casos de violencia laboral: víctima, expediente, agresor interno/externo,
// intervención y recomendaciones del equipo de violencia y todo lo remitido.
// Datos sensibles: solo admin (crud:*:*).
// Tablas: ver scripts/migrations/063__casos_violencia.sql (acá se crean igual si faltan).

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes, Transaction } from 'sequelize';
import { logger } from '../logging/logger';

const CARATULA_EXPEDIENTE = 'VIOLENCIA LABORAL - EXPEDIENTE';
const ESTADOS = ['ABIERTO', 'EN_SEGUIMIENTO', 'CERRADO'];

function getUser(req: Request) {
  const auth = (req as any).auth ?? {};
  const perms: string[] = auth.permissions ?? [];
  const isAdmin = perms.includes('crud:*:*');
  return { id: (auth.principalId ?? null) as number | null, isAdmin };
}

const txt   = (v: any) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const fecha = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
const bit   = (v: any) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const entero = (v: any) => { const n = Number(String(v ?? '').replace(/\D/g, '')); return n > 0 ? n : null; };

async function ensureTablas(sequelize: Sequelize) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS casos_violencia_destinos (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      orden INT NOT NULL DEFAULT 0,
      UNIQUE KEY uq_cvd_nombre (nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    `INSERT IGNORE INTO casos_violencia_destinos (nombre, orden) VALUES
      ('DAVSAL', 1), ('Salud Laboral', 2), ('Dirección', 3), ('Jefatura de servicio', 4),
      ('Legales', 5), ('Personal / RRHH', 6), ('Otro', 99)`,
    `CREATE TABLE IF NOT EXISTS casos_violencia (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      dni INT NOT NULL,
      servicio_id INT NULL,
      fecha_hecho DATE NULL,
      descripcion TEXT NULL,
      expediente_numero VARCHAR(255) NULL,
      expediente_id INT NULL,
      agresor_tipo ENUM('INTERNO','EXTERNO') NOT NULL,
      agresor_dni INT NULL,
      agresor_servicio_id INT NULL,
      agresor_externo_nombre VARCHAR(200) NULL,
      agresor_externo_vinculo VARCHAR(120) NULL,
      equipo_intervino TINYINT(1) NOT NULL DEFAULT 0,
      equipo_fecha_intervencion DATE NULL,
      equipo_observaciones TEXT NULL,
      rec_davsal TINYINT(1) NOT NULL DEFAULT 0,
      rec_cambio_horario TINYINT(1) NOT NULL DEFAULT 0,
      rec_cambio_sector TINYINT(1) NOT NULL DEFAULT 0,
      rec_otra VARCHAR(255) NULL,
      estado ENUM('ABIERTO','EN_SEGUIMIENTO','CERRADO') NOT NULL DEFAULT 'ABIERTO',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      created_by INT NULL,
      updated_by INT NULL,
      deleted_by INT NULL,
      KEY idx_cv_dni (dni),
      KEY idx_cv_agresor_dni (agresor_dni),
      KEY idx_cv_estado (estado),
      CONSTRAINT fk_cv_dni__personal FOREIGN KEY (dni) REFERENCES personal (dni) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_cv_agresor_dni__personal FOREIGN KEY (agresor_dni) REFERENCES personal (dni) ON DELETE RESTRICT ON UPDATE RESTRICT,
      CONSTRAINT fk_cv_servicio FOREIGN KEY (servicio_id) REFERENCES servicios (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_cv_agresor_servicio FOREIGN KEY (agresor_servicio_id) REFERENCES servicios (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_cv_expediente FOREIGN KEY (expediente_id) REFERENCES expedientes (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_cv_created_by FOREIGN KEY (created_by) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_cv_updated_by FOREIGN KEY (updated_by) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_cv_deleted_by FOREIGN KEY (deleted_by) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT chk_cv_agresor CHECK (
        (agresor_tipo = 'INTERNO' AND agresor_dni IS NOT NULL) OR
        (agresor_tipo = 'EXTERNO' AND agresor_dni IS NULL))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    `CREATE TABLE IF NOT EXISTS casos_violencia_remisiones (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      caso_id INT NOT NULL,
      destino_id INT NOT NULL,
      fecha DATE NOT NULL,
      numero VARCHAR(255) NULL,
      observacion TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      created_by INT NULL,
      deleted_by INT NULL,
      KEY idx_cvr_caso (caso_id),
      CONSTRAINT fk_cvr_caso FOREIGN KEY (caso_id) REFERENCES casos_violencia (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_cvr_destino FOREIGN KEY (destino_id) REFERENCES casos_violencia_destinos (id) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT fk_cvr_created_by FOREIGN KEY (created_by) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_cvr_deleted_by FOREIGN KEY (deleted_by) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    `CREATE TABLE IF NOT EXISTS casos_violencia_auditoria (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      caso_id INT NOT NULL,
      accion VARCHAR(40) NOT NULL,
      usuario_id INT NULL,
      datos_antes JSON NULL,
      datos_despues JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_cva_caso (caso_id),
      CONSTRAINT fk_cva_caso FOREIGN KEY (caso_id) REFERENCES casos_violencia (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_cva_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  ];
  for (const s of stmts) await sequelize.query(s);
}

async function logAudit(
  sequelize: Sequelize, casoId: number, accion: string, userId: number | null,
  antes: any, despues: any, transaction?: Transaction,
) {
  try {
    await sequelize.query(
      `INSERT INTO casos_violencia_auditoria (caso_id, accion, usuario_id, datos_antes, datos_despues)
       VALUES (?, ?, ?, ?, ?)`,
      { replacements: [casoId, accion, userId,
          antes ? JSON.stringify(antes) : null, despues ? JSON.stringify(despues) : null], transaction },
    );
  } catch (e: any) { logger.warn({ msg: 'casos_violencia auditoria', err: e?.message }); }
}

// Servicio vigente del agente (agentes_servicios abierto)
async function servicioVigente(sequelize: Sequelize, dni: number) {
  const [row] = await sequelize.query<any>(
    `SELECT ags.servicio_id, s.nombre AS servicio_nombre
       FROM agentes_servicios ags
       LEFT JOIN servicios s ON s.id = ags.servicio_id
      WHERE ags.dni = ? AND ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL
      ORDER BY ags.fecha_desde DESC, ags.id DESC LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: [dni] },
  );
  return row ?? null;
}

// Alta idempotente en `expedientes` del agente (mismo criterio que jubilación).
async function registrarExpediente(
  sequelize: Sequelize, dni: number, numero: string, userId: number | null, transaction: Transaction,
): Promise<number> {
  const [existe] = await sequelize.query<any>(
    `SELECT id FROM expedientes WHERE dni = ? AND numero = ? AND deleted_at IS NULL LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: [dni, numero], transaction },
  );
  if (existe) return Number(existe.id);
  const [insertId] = await sequelize.query(
    `INSERT INTO expedientes (dni, numero, caratula, fecha, estado, created_by, created_at)
     VALUES (?, ?, ?, CURDATE(), 'En trámite', ?, NOW())`,
    { replacements: [dni, numero, CARATULA_EXPEDIENTE, userId], type: QueryTypes.INSERT, transaction },
  ) as any;
  return Number(insertId);
}

const SELECT_CASO = `
  SELECT c.*,
         DATE_FORMAT(c.fecha_hecho, '%Y-%m-%d')               AS fecha_hecho,
         DATE_FORMAT(c.equipo_fecha_intervencion, '%Y-%m-%d') AS equipo_fecha_intervencion,
         CONCAT(pv.apellido, ', ', pv.nombre) AS victima_nombre,
         sv.nombre                            AS servicio_nombre,
         CONCAT(pa.apellido, ', ', pa.nombre) AS agresor_nombre,
         sa.nombre                            AS agresor_servicio_nombre,
         uc.email                             AS creado_por_email,
         (SELECT COUNT(*) FROM casos_violencia_remisiones r
           WHERE r.caso_id = c.id AND r.deleted_at IS NULL) AS remisiones_count
    FROM casos_violencia c
    JOIN personal pv       ON pv.dni = c.dni
    LEFT JOIN servicios sv ON sv.id  = c.servicio_id
    LEFT JOIN personal pa  ON pa.dni = c.agresor_dni
    LEFT JOIN servicios sa ON sa.id  = c.agresor_servicio_id
    LEFT JOIN usuarios uc  ON uc.id  = c.created_by`;

export function buildCasosViolenciaRouter(sequelize: Sequelize) {
  const router = Router();

  ensureTablas(sequelize).catch((e) => logger.error({ msg: 'casos_violencia ensureTablas', err: e?.message }));

  router.use((req, res, next) => {
    if (!getUser(req).isAdmin) return res.status(403).json({ ok: false, error: 'Sin permiso' });
    next();
  });

  const traerCaso = async (id: number, transaction?: Transaction) => {
    const [row] = await sequelize.query<any>(
      `${SELECT_CASO} WHERE c.id = ? AND c.deleted_at IS NULL`,
      { type: QueryTypes.SELECT, replacements: [id], transaction },
    );
    return row ?? null;
  };

  // Normaliza y valida el body; devuelve error string o los valores a guardar.
  const leerBody = async (body: any) => {
    const dni = entero(body?.dni);
    if (!dni) return { error: 'Falta el agente (víctima)' };
    const agresorTipo = String(body?.agresor_tipo || '').toUpperCase();
    if (!['INTERNO', 'EXTERNO'].includes(agresorTipo)) return { error: 'Indicá si el agresor es interno o externo' };
    const agresorDni = agresorTipo === 'INTERNO' ? entero(body?.agresor_dni) : null;
    if (agresorTipo === 'INTERNO' && !agresorDni) return { error: 'Falta el agente agresor' };
    if (agresorTipo === 'INTERNO' && agresorDni === dni) return { error: 'El agresor no puede ser el mismo agente' };
    if (agresorTipo === 'EXTERNO' && !txt(body?.agresor_externo_nombre) && !txt(body?.agresor_externo_vinculo)) {
      return { error: 'Cargá nombre o vínculo del agresor externo' };
    }
    const estado = String(body?.estado || 'ABIERTO').toUpperCase();
    if (!ESTADOS.includes(estado)) return { error: 'Estado inválido' };
    const equipoIntervino = bit(body?.equipo_intervino);

    // Servicio: el que manden, o el vigente del agente
    const servicioId = entero(body?.servicio_id) ?? (await servicioVigente(sequelize, dni))?.servicio_id ?? null;
    const agresorServicioId = agresorDni
      ? (entero(body?.agresor_servicio_id) ?? (await servicioVigente(sequelize, agresorDni))?.servicio_id ?? null)
      : null;

    return {
      v: {
        dni,
        servicio_id: servicioId,
        fecha_hecho: fecha(body?.fecha_hecho),
        descripcion: txt(body?.descripcion),
        expediente_numero: txt(body?.expediente_numero),
        agresor_tipo: agresorTipo,
        agresor_dni: agresorDni,
        agresor_servicio_id: agresorServicioId,
        agresor_externo_nombre: agresorTipo === 'EXTERNO' ? txt(body?.agresor_externo_nombre) : null,
        agresor_externo_vinculo: agresorTipo === 'EXTERNO' ? txt(body?.agresor_externo_vinculo) : null,
        equipo_intervino: equipoIntervino,
        equipo_fecha_intervencion: equipoIntervino ? fecha(body?.equipo_fecha_intervencion) : null,
        equipo_observaciones: txt(body?.equipo_observaciones),
        rec_davsal: bit(body?.rec_davsal),
        rec_cambio_horario: bit(body?.rec_cambio_horario),
        rec_cambio_sector: bit(body?.rec_cambio_sector),
        rec_otra: txt(body?.rec_otra),
        estado,
      } as Record<string, any>,
    };
  };

  // ── GET /destinos ──────────────────────────────────────────────────────────
  router.get('/destinos', async (_req, res) => {
    try {
      const rows = await sequelize.query<any>(
        `SELECT id, nombre FROM casos_violencia_destinos WHERE activo = 1 ORDER BY orden, nombre`,
        { type: QueryTypes.SELECT },
      );
      return res.json({ ok: true, data: rows });
    } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
  });

  // ── GET /agente/:dni → nombre + servicio vigente (para el form) ─────────────
  router.get('/agente/:dni', async (req, res) => {
    const dni = entero(req.params.dni);
    if (!dni) return res.status(400).json({ ok: false, error: 'DNI inválido' });
    try {
      const [p] = await sequelize.query<any>(
        `SELECT dni, apellido, nombre FROM personal WHERE dni = ? AND deleted_at IS NULL`,
        { type: QueryTypes.SELECT, replacements: [dni] },
      );
      if (!p) return res.status(404).json({ ok: false, error: 'No existe el agente en personal' });
      const s = await servicioVigente(sequelize, dni);
      return res.json({ ok: true, data: { ...p, servicio_id: s?.servicio_id ?? null, servicio_nombre: s?.servicio_nombre ?? null } });
    } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
  });

  // ── GET / → listado con filtros ─────────────────────────────────────────────
  router.get('/', async (req, res) => {
    const { estado, agresor_tipo, equipo, recomendacion, q } = req.query as Record<string, string>;
    const conds = ['c.deleted_at IS NULL'];
    const vals: any[] = [];
    if (estado && ESTADOS.includes(estado)) { conds.push('c.estado = ?'); vals.push(estado); }
    if (agresor_tipo === 'INTERNO' || agresor_tipo === 'EXTERNO') { conds.push('c.agresor_tipo = ?'); vals.push(agresor_tipo); }
    if (equipo === '1' || equipo === '0') { conds.push('c.equipo_intervino = ?'); vals.push(Number(equipo)); }
    if (recomendacion === 'davsal')  conds.push('c.rec_davsal = 1');
    if (recomendacion === 'horario') conds.push('c.rec_cambio_horario = 1');
    if (recomendacion === 'sector')  conds.push('c.rec_cambio_sector = 1');
    const qq = txt(q);
    if (qq) {
      conds.push(`(CAST(c.dni AS CHAR) LIKE ? OR pv.apellido LIKE ? OR pv.nombre LIKE ?
                   OR CAST(c.agresor_dni AS CHAR) LIKE ? OR pa.apellido LIKE ?
                   OR c.agresor_externo_nombre LIKE ? OR c.expediente_numero LIKE ?)`);
      const like = `%${qq}%`;
      vals.push(like, like, like, like, like, like, like);
    }
    try {
      const rows = await sequelize.query<any>(
        `${SELECT_CASO} WHERE ${conds.join(' AND ')} ORDER BY c.fecha_hecho DESC, c.id DESC`,
        { type: QueryTypes.SELECT, replacements: vals },
      );
      return res.json({ ok: true, data: rows });
    } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
  });

  // ── GET /:id → caso + remisiones ────────────────────────────────────────────
  router.get('/:id', async (req, res) => {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    try {
      const caso = await traerCaso(id);
      if (!caso) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const remisiones = await sequelize.query<any>(
        `SELECT r.id, r.destino_id, d.nombre AS destino, DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
                r.numero, r.observacion, r.created_at, u.email AS creado_por_email
           FROM casos_violencia_remisiones r
           JOIN casos_violencia_destinos d ON d.id = r.destino_id
           LEFT JOIN usuarios u ON u.id = r.created_by
          WHERE r.caso_id = ? AND r.deleted_at IS NULL
          ORDER BY r.fecha DESC, r.id DESC`,
        { type: QueryTypes.SELECT, replacements: [id] },
      );
      return res.json({ ok: true, data: { ...caso, remisiones } });
    } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
  });

  // ── POST / → alta ───────────────────────────────────────────────────────────
  router.post('/', async (req, res) => {
    const u = getUser(req);
    const r = await leerBody(req.body).catch((e) => ({ error: e?.message || 'Error' } as any));
    if ('error' in r) return res.status(400).json({ ok: false, error: r.error });
    const v = r.v;
    try {
      const creado = await sequelize.transaction(async (t) => {
        v.expediente_id = v.expediente_numero
          ? await registrarExpediente(sequelize, v.dni, v.expediente_numero, u.id, t) : null;
        const cols = Object.keys(v);
        const [newId] = await sequelize.query(
          `INSERT INTO casos_violencia (${cols.join(', ')}, created_by)
           VALUES (${cols.map(() => '?').join(', ')}, ?)`,
          { replacements: [...cols.map((k) => v[k]), u.id], type: QueryTypes.INSERT, transaction: t },
        ) as any;
        const caso = await traerCaso(Number(newId), t);
        await logAudit(sequelize, Number(newId), 'crear', u.id, null, caso, t);
        return caso;
      });
      return res.json({ ok: true, data: creado });
    } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
  });

  // ── PUT /:id → modificación ─────────────────────────────────────────────────
  router.put('/:id', async (req, res) => {
    const u = getUser(req);
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    const r = await leerBody(req.body).catch((e) => ({ error: e?.message || 'Error' } as any));
    if ('error' in r) return res.status(400).json({ ok: false, error: r.error });
    const v = r.v;
    try {
      const actualizado = await sequelize.transaction(async (t) => {
        const antes = await traerCaso(id, t);
        if (!antes) return null;
        // Si el número no cambió conserva la fila de expedientes; si cambió, da de alta la nueva
        // (la anterior queda en el legajo del agente, no se borra).
        v.expediente_id = !v.expediente_numero ? null
          : (v.expediente_numero === antes.expediente_numero && Number(antes.dni) === v.dni && antes.expediente_id)
            ? antes.expediente_id
            : await registrarExpediente(sequelize, v.dni, v.expediente_numero, u.id, t);
        const cols = Object.keys(v);
        await sequelize.query(
          `UPDATE casos_violencia SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_by = ? WHERE id = ?`,
          { replacements: [...cols.map((k) => v[k]), u.id, id], transaction: t },
        );
        const despues = await traerCaso(id, t);
        await logAudit(sequelize, id, 'modificar', u.id, antes, despues, t);
        return despues;
      });
      if (!actualizado) return res.status(404).json({ ok: false, error: 'No encontrado' });
      return res.json({ ok: true, data: actualizado });
    } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
  });

  // ── DELETE /:id → baja lógica ───────────────────────────────────────────────
  router.delete('/:id', async (req, res) => {
    const u = getUser(req);
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    try {
      const antes = await traerCaso(id);
      if (!antes) return res.status(404).json({ ok: false, error: 'No encontrado' });
      await sequelize.query(
        `UPDATE casos_violencia SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`,
        { replacements: [u.id, id] },
      );
      await logAudit(sequelize, id, 'eliminar', u.id, antes, null);
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
  });

  // ── POST /:id/remisiones ────────────────────────────────────────────────────
  router.post('/:id/remisiones', async (req, res) => {
    const u = getUser(req);
    const id = entero(req.params.id);
    const destinoId = entero(req.body?.destino_id);
    const f = fecha(req.body?.fecha);
    if (!id) return res.status(400).json({ ok: false, error: 'id inválido' });
    if (!destinoId) return res.status(400).json({ ok: false, error: 'Elegí a dónde se remitió' });
    if (!f) return res.status(400).json({ ok: false, error: 'Falta la fecha de remisión' });
    try {
      if (!(await traerCaso(id))) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const [newId] = await sequelize.query(
        `INSERT INTO casos_violencia_remisiones (caso_id, destino_id, fecha, numero, observacion, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        { replacements: [id, destinoId, f, txt(req.body?.numero), txt(req.body?.observacion), u.id], type: QueryTypes.INSERT },
      ) as any;
      await logAudit(sequelize, id, 'remitir', u.id, null,
        { remision_id: Number(newId), destino_id: destinoId, fecha: f, numero: txt(req.body?.numero) });
      return res.json({ ok: true, id: Number(newId) });
    } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
  });

  // ── DELETE /:id/remisiones/:rid ─────────────────────────────────────────────
  router.delete('/:id/remisiones/:rid', async (req, res) => {
    const u = getUser(req);
    const id = entero(req.params.id);
    const rid = entero(req.params.rid);
    if (!id || !rid) return res.status(400).json({ ok: false, error: 'id inválido' });
    try {
      const [antes] = await sequelize.query<any>(
        `SELECT * FROM casos_violencia_remisiones WHERE id = ? AND caso_id = ? AND deleted_at IS NULL`,
        { type: QueryTypes.SELECT, replacements: [rid, id] },
      );
      if (!antes) return res.status(404).json({ ok: false, error: 'No encontrada' });
      await sequelize.query(
        `UPDATE casos_violencia_remisiones SET deleted_at = NOW(), deleted_by = ? WHERE id = ?`,
        { replacements: [u.id, rid] },
      );
      await logAudit(sequelize, id, 'quitar_remision', u.id, antes, null);
      return res.json({ ok: true });
    } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message }); }
  });

  return router;
}
