import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool.js";
import { authContext } from "../middlewares/authContext.js";
import { requirePermission } from "../middlewares/rbac.js";

const router = Router();

const hcSchema = z.object({
  dni: z.string().min(5).max(20),
  apellido_nombre: z.string().min(3).max(180),
  fecha_ultimo_movimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  comentarios: z.string().optional(),
});

const configSchema = z.object({
  menor: z.coerce.number().int().min(1).max(99),
  mayor: z.coerce.number().int().min(1).max(99),
  etiqueta: z
    .object({
      ancho_mm: z.coerce.number().min(20).max(210),
      alto_mm: z.coerce.number().min(10).max(297),
      fuente_pt: z.coerce.number().min(5).max(32),
    })
    .optional(),
});

const pedidoSchema = z.object({
  historiaClinicaId: z.coerce.number().int().positive(),
  comentarios: z.string().optional(),
});

const pedidoManualSchema = z.object({
  dni: z.string().min(5).max(20),
  apellido_nombre: z.string().min(3).max(180),
  comentarios: z.string().optional(),
});

const procesarPedidoSchema = z.object({
  fecha_ultimo_movimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  comentarios: z.string().optional(),
});

const poolCreateSchema = z.object({
  dni: z.string().min(5).max(20),
  apellido_nombre: z.string().min(3).max(180),
  fecha_ultimo_movimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  comentarios: z.string().optional(),
});

const fechaMovimientoSchema = z.object({
  fecha_ultimo_movimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const etiquetaImpresaSchema = z.object({
  impresa: z.coerce.boolean(),
});

const cajaSchema = z.object({
  caja: z.string().trim().min(1).max(80),
});

const cajaBuscarSchema = z.object({
  codigo: z.string().trim().min(1).max(160),
});

type DbConnection = Awaited<ReturnType<typeof pool.getConnection>>;

type HcAuditRow = {
  id: number;
  dni: string;
  apellido_nombre: string;
  fecha_ultimo_movimiento: string | Date;
  caja: string | null;
  comentarios: string | null;
  etiqueta_impresa: number;
  fecha_impresion: string | Date | null;
  impreso_por: number | null;
};

router.use(authContext);

async function setAuditContext(connection: DbConnection, userId: number, accion: "CREAR" | "ACTUALIZAR" | "IMPRIMIR", pedidoId: number | null = null) {
  await connection.execute(
    `SET @hc_audit_usuario_id = :userId,
         @hc_audit_pedido_id = :pedidoId,
         @hc_audit_accion = :accion`,
    { userId, pedidoId, accion }
  );
}

async function clearAuditContext(connection: DbConnection) {
  await connection.execute(
    `SET @hc_audit_usuario_id = NULL,
         @hc_audit_pedido_id = NULL,
         @hc_audit_accion = NULL`
  );
}

function extractCajaCode(value: string) {
  const raw = value.trim();
  const match = raw.match(/(?:^|;)CAJA=([^;]+)/i);
  return (match ? match[1] : raw.replace(/^CAJA=/i, "")).trim();
}

async function findHistoriaForPedido(connection: DbConnection, pedido: { historia_clinica_id: number | null; dni: string }) {
  if (pedido.historia_clinica_id) {
    const [rows] = await connection.execute(
      `SELECT id, dni, apellido_nombre, fecha_ultimo_movimiento, caja, comentarios,
              etiqueta_impresa, fecha_impresion, impreso_por
         FROM historias_clinicas
        WHERE id = :id AND deleted_at IS NULL
        LIMIT 1`,
      { id: pedido.historia_clinica_id }
    );
    const hc = (rows as HcAuditRow[])[0];
    if (hc) return hc;
  }

  const [rows] = await connection.execute(
    `SELECT id, dni, apellido_nombre, fecha_ultimo_movimiento, caja, comentarios,
            etiqueta_impresa, fecha_impresion, impreso_por
       FROM historias_clinicas
      WHERE dni = :dni AND deleted_at IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    { dni: pedido.dni }
  );
  return (rows as HcAuditRow[])[0] ?? null;
}

// Lee los umbrales configurables de historias clinicas sin movimiento.
async function loadConfig() {
  const rows = await query<Array<{ clave: string; valor: string }>>(
    `SELECT clave, valor
       FROM app_settings
      WHERE clave IN (
        'hc_anios_sin_movimiento_menor',
        'hc_anios_sin_movimiento_mayor',
        'hc_etiqueta_ancho_mm',
        'hc_etiqueta_alto_mm',
        'hc_etiqueta_fuente_pt'
      )`
  );
  const map = Object.fromEntries(rows.map((row) => [row.clave, Number(row.valor)]));
  return {
    menor: map.hc_anios_sin_movimiento_menor || 5,
    mayor: map.hc_anios_sin_movimiento_mayor || 10,
    etiqueta: {
      ancho_mm: map.hc_etiqueta_ancho_mm || 64,
      alto_mm: map.hc_etiqueta_alto_mm || 36,
      fuente_pt: map.hc_etiqueta_fuente_pt || 8,
    },
  };
}

router.get("/config", requirePermission("hc:leer"), async (_req, res, next) => {
  try {
    res.json({ ok: true, data: await loadConfig() });
  } catch (error) {
    next(error);
  }
});

router.patch("/config", requirePermission("hc:configurar"), async (req, res, next) => {
  try {
    const input = configSchema.parse(req.body);
    await query(
      `INSERT INTO app_settings (clave, valor, descripcion)
       VALUES
        ('hc_anios_sin_movimiento_menor', :menor, 'Primer umbral de historias clinicas sin movimiento'),
        ('hc_anios_sin_movimiento_mayor', :mayor, 'Segundo umbral de historias clinicas sin movimiento'),
        ('hc_etiqueta_ancho_mm', :etiquetaAncho, 'Ancho de etiqueta HC en milimetros'),
        ('hc_etiqueta_alto_mm', :etiquetaAlto, 'Alto de etiqueta HC en milimetros'),
        ('hc_etiqueta_fuente_pt', :etiquetaFuente, 'Tamanio de letra de etiqueta HC en puntos')
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), descripcion = VALUES(descripcion)`,
      {
        menor: String(input.menor),
        mayor: String(input.mayor),
        etiquetaAncho: String(input.etiqueta?.ancho_mm ?? 64),
        etiquetaAlto: String(input.etiqueta?.alto_mm ?? 36),
        etiquetaFuente: String(input.etiqueta?.fuente_pt ?? 8),
      }
    );
    res.json({ ok: true, data: await loadConfig() });
  } catch (error) {
    next(error);
  }
});

// Lista el historial completo de historias clinicas cargadas en la tabla.
router.get("/", requirePermission("hc:leer"), async (_req, res, next) => {
  try {
    const config = await loadConfig();
    const data = await query(
      `SELECT id, dni, apellido_nombre, fecha_ultimo_movimiento, caja, comentarios,
              etiqueta_impresa, fecha_impresion,
              TIMESTAMPDIFF(YEAR, fecha_ultimo_movimiento, CURDATE()) AS anios_sin_movimiento,
              CASE
                WHEN fecha_ultimo_movimiento <= DATE_SUB(CURDATE(), INTERVAL :mayor YEAR) THEN :mayor
                WHEN fecha_ultimo_movimiento <= DATE_SUB(CURDATE(), INTERVAL :menor YEAR) THEN :menor
                ELSE NULL
              END AS criterio_anios
         FROM historias_clinicas
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC`,
      { menor: config.menor, mayor: config.mayor }
    );
    res.json({ ok: true, data, config });
  } catch (error) {
    next(error);
  }
});

// Carga una historia clinica al control del pasivo.
router.post("/", requirePermission("hc:crear"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const input = hcSchema.parse(req.body);
    await connection.beginTransaction();
    await setAuditContext(connection, req.auth!.userId, "CREAR");
    await connection.execute(
      `INSERT INTO historias_clinicas (dni, apellido_nombre, fecha_ultimo_movimiento, comentarios, cargado_por)
       VALUES (:dni, :apellidoNombre, :fechaUltimoMovimiento, :comentarios, :userId)`,
      {
        dni: input.dni.trim(),
        apellidoNombre: input.apellido_nombre.trim(),
        fechaUltimoMovimiento: input.fecha_ultimo_movimiento,
        comentarios: input.comentarios?.trim() || null,
        userId: req.auth!.userId,
      }
    );
    await connection.commit();
    res.status(201).json({ ok: true });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    await clearAuditContext(connection).catch(() => undefined);
    connection.release();
  }
});

// Genera un pedido para que el pasivo suba o gestione la historia clinica.
router.post("/pedidos", requirePermission("hc:pedir"), async (req, res, next) => {
  try {
    const input = pedidoSchema.parse(req.body);
    const rows = await query<Array<{ id: number; dni: string; apellido_nombre: string; fecha_ultimo_movimiento: string; comentarios: string | null }>>(
      `SELECT id, dni, apellido_nombre, fecha_ultimo_movimiento, comentarios
         FROM historias_clinicas
        WHERE id = :id AND deleted_at IS NULL
        LIMIT 1`,
      { id: input.historiaClinicaId }
    );
    const hc = rows[0];
    if (!hc) return res.status(404).json({ ok: false, error: "Historia clinica no encontrada" });
    await query(
      `INSERT INTO pedidos_historias_clinicas
        (historia_clinica_id, dni, apellido_nombre, fecha_ultimo_movimiento, comentarios, solicitado_por)
       VALUES
        (:hcId, :dni, :apellidoNombre, :fechaUltimoMovimiento, :comentarios, :userId)`,
      {
        hcId: hc.id,
        dni: hc.dni,
        apellidoNombre: hc.apellido_nombre,
        fechaUltimoMovimiento: hc.fecha_ultimo_movimiento,
        comentarios: input.comentarios?.trim() || hc.comentarios,
        userId: req.auth!.userId,
      }
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Genera un pedido manual cuando Legales todavia no conoce la fecha real de movimiento.
router.post("/pedidos/manual", requirePermission("hc:pedir"), async (req, res, next) => {
  try {
    const input = pedidoManualSchema.parse(req.body);
    await query(
      `INSERT INTO pedidos_historias_clinicas
        (historia_clinica_id, dni, apellido_nombre, fecha_ultimo_movimiento, comentarios, solicitado_por)
       VALUES
        (NULL, :dni, :apellidoNombre, NULL, :comentarios, :userId)`,
      {
        dni: input.dni.trim(),
        apellidoNombre: input.apellido_nombre.trim(),
        comentarios: input.comentarios?.trim() || null,
        userId: req.auth!.userId,
      }
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Pool de HC: es la tabla real historias_clinicas, con estado de impresion.
router.get("/pool/buscar", requirePermission("pedidos_hc:resolver"), async (req, res, next) => {
  try {
    const dni = z.string().min(5).max(20).parse(String(req.query.dni || "").trim());
    const rows = await query(
      `SELECT hc.id, NULL AS pedido_id, hc.dni, hc.apellido_nombre,
              hc.fecha_ultimo_movimiento,
              YEAR(hc.fecha_ultimo_movimiento) AS anio_movimiento,
              hc.caja,
              hc.comentarios, hc.created_at AS fecha_carga, hc.etiqueta_impresa,
              hc.fecha_impresion,
              uc.username AS cargado_por_usuario,
              ui.username AS impreso_por_usuario,
              NULL AS solicitado_por_usuario
         FROM historias_clinicas hc
         LEFT JOIN usuarios uc ON uc.id = hc.cargado_por
         LEFT JOIN usuarios ui ON ui.id = hc.impreso_por
        WHERE hc.deleted_at IS NULL
          AND hc.dni = :dni
        ORDER BY hc.id DESC
        LIMIT 1`,
      { dni }
    );
    const data = (rows as unknown[])[0] || null;
    res.json({ ok: true, exists: Boolean(data), data });
  } catch (error) {
    next(error);
  }
});

router.get("/cajas/buscar", requirePermission("pedidos_hc:resolver"), async (req, res, next) => {
  try {
    const input = cajaBuscarSchema.parse(req.query);
    const caja = extractCajaCode(input.codigo);
    if (!caja) return res.status(400).json({ ok: false, error: "Codigo de caja invalido" });

    const data = await query(
      `SELECT hc.id, NULL AS pedido_id, hc.dni, hc.apellido_nombre,
              hc.fecha_ultimo_movimiento,
              YEAR(hc.fecha_ultimo_movimiento) AS anio_movimiento,
              hc.caja,
              hc.comentarios, hc.created_at AS fecha_carga, hc.etiqueta_impresa,
              hc.fecha_impresion,
              uc.username AS cargado_por_usuario,
              ui.username AS impreso_por_usuario,
              NULL AS solicitado_por_usuario
         FROM historias_clinicas hc
         LEFT JOIN usuarios uc ON uc.id = hc.cargado_por
         LEFT JOIN usuarios ui ON ui.id = hc.impreso_por
        WHERE hc.deleted_at IS NULL
          AND TRIM(hc.caja) = :caja
        ORDER BY hc.apellido_nombre ASC, hc.dni ASC, hc.id ASC`,
      { caja }
    );

    res.json({ ok: true, caja, total: Array.isArray(data) ? data.length : 0, data });
  } catch (error) {
    next(error);
  }
});

router.post("/pool", requirePermission("pedidos_hc:resolver"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const input = poolCreateSchema.parse(req.body);
    await connection.beginTransaction();

    const [existingRows] = await connection.execute(
      `SELECT id FROM historias_clinicas WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
      { dni: input.dni.trim() }
    );
    const existing = (existingRows as Array<{ id: number }>)[0];
    if (existing) {
      await connection.rollback();
      return res.status(409).json({ ok: false, error: "La HC ya existe. Solo se puede actualizar la fecha de ultimo movimiento." });
    }

    await setAuditContext(connection, req.auth!.userId, "CREAR");
    const [result] = await connection.execute(
      `INSERT INTO historias_clinicas
        (dni, apellido_nombre, fecha_ultimo_movimiento, comentarios, cargado_por, etiqueta_impresa)
       VALUES
        (:dni, :apellidoNombre, :fechaUltimoMovimiento, :comentarios, :userId, 0)`,
      {
        dni: input.dni.trim(),
        apellidoNombre: input.apellido_nombre.trim(),
        fechaUltimoMovimiento: input.fecha_ultimo_movimiento,
        comentarios: input.comentarios?.trim() || null,
        userId: req.auth!.userId,
      }
    );

    await connection.commit();
    res.status(201).json({ ok: true, data: { id: Number((result as { insertId: number }).insertId) } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    await clearAuditContext(connection).catch(() => undefined);
    connection.release();
  }
});

router.get("/pool", requirePermission("pedidos_hc:resolver"), async (_req, res, next) => {
  try {
    const data = await query(
      `SELECT hc.id, NULL AS pedido_id, hc.dni, hc.apellido_nombre,
              hc.fecha_ultimo_movimiento,
              YEAR(hc.fecha_ultimo_movimiento) AS anio_movimiento,
              hc.caja,
              hc.comentarios, hc.created_at AS fecha_carga, hc.etiqueta_impresa,
              hc.fecha_impresion,
              uc.username AS cargado_por_usuario,
              ui.username AS impreso_por_usuario,
              NULL AS solicitado_por_usuario
         FROM historias_clinicas hc
         LEFT JOIN usuarios uc ON uc.id = hc.cargado_por
         LEFT JOIN usuarios ui ON ui.id = hc.impreso_por
        WHERE hc.deleted_at IS NULL
        ORDER BY hc.etiqueta_impresa ASC, hc.updated_at DESC, hc.id DESC`
    );
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/pedidos", requirePermission("pedidos_hc:leer"), async (req, res, next) => {
  try {
    const canSeeAll = req.auth?.permissions.includes("pedidos_hc:resolver") || req.auth?.permissions.includes("*:*");
    const data = await query(
      `SELECT p.id, p.dni, p.apellido_nombre, p.fecha_ultimo_movimiento, p.comentarios,
              p.fecha_pedido, p.resuelto, p.fecha_resuelto,
              u.username AS solicitado_por_usuario,
              ur.username AS resuelto_por_usuario
         FROM pedidos_historias_clinicas p
         LEFT JOIN usuarios u ON u.id = p.solicitado_por
         LEFT JOIN usuarios ur ON ur.id = p.resuelto_por
        WHERE (:canSeeAll = 1 OR p.solicitado_por = :userId)
        ORDER BY p.fecha_pedido DESC`,
      { canSeeAll: canSeeAll ? 1 : 0, userId: req.auth!.userId }
    );
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

router.patch("/pedidos/:id/procesar", requirePermission("pedidos_hc:resolver"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Pedido invalido" });
    const input = procesarPedidoSchema.parse(req.body);

    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, historia_clinica_id, dni, apellido_nombre, comentarios, resuelto
         FROM pedidos_historias_clinicas
        WHERE id = :id
        LIMIT 1`,
      { id }
    );
    const pedido = (rows as Array<{
      id: number;
      historia_clinica_id: number | null;
      dni: string;
      apellido_nombre: string;
      comentarios: string | null;
      resuelto: number;
    }>)[0];
    if (!pedido) {
      await connection.rollback();
      return res.status(404).json({ ok: false, error: "Pedido no encontrado" });
    }
    if (pedido.resuelto) {
      await connection.rollback();
      return res.status(400).json({ ok: false, error: "El pedido ya esta resuelto" });
    }

    const existing = await findHistoriaForPedido(connection, pedido);
    const nextData = {
      dni: pedido.dni.trim(),
      apellido_nombre: pedido.apellido_nombre.trim(),
      fecha_ultimo_movimiento: input.fecha_ultimo_movimiento,
      caja: null,
      comentarios: input.comentarios?.trim() || pedido.comentarios,
      etiqueta_impresa: 0,
      fecha_impresion: null,
      impreso_por: null,
    };

    let historiaClinicaId: number;
    if (!existing) {
      await setAuditContext(connection, req.auth!.userId, "CREAR", pedido.id);
      const [result] = await connection.execute(
        `INSERT INTO historias_clinicas
          (dni, apellido_nombre, fecha_ultimo_movimiento, comentarios, cargado_por, etiqueta_impresa)
         VALUES
          (:dni, :apellidoNombre, :fechaUltimoMovimiento, :comentarios, :userId, 0)`,
        {
          dni: nextData.dni,
          apellidoNombre: nextData.apellido_nombre,
          fechaUltimoMovimiento: nextData.fecha_ultimo_movimiento,
          comentarios: nextData.comentarios,
          userId: req.auth!.userId,
        }
      );
      historiaClinicaId = Number((result as { insertId: number }).insertId);
    } else {
      historiaClinicaId = existing.id;
      await setAuditContext(connection, req.auth!.userId, "ACTUALIZAR", pedido.id);
      await connection.execute(
        `UPDATE historias_clinicas
            SET fecha_ultimo_movimiento = :fechaUltimoMovimiento,
                cargado_por = :userId,
                caja = NULL,
                etiqueta_impresa = 0,
                fecha_impresion = NULL,
                impreso_por = NULL
          WHERE id = :id`,
        {
          id: existing.id,
          fechaUltimoMovimiento: nextData.fecha_ultimo_movimiento,
          userId: req.auth!.userId,
        }
      );
    }

    await connection.execute(
      `UPDATE pedidos_historias_clinicas
          SET historia_clinica_id = :historiaClinicaId,
              resuelto = 1,
              fecha_resuelto = NOW(),
              resuelto_por = :userId,
              fecha_ultimo_movimiento = :fechaUltimoMovimiento
        WHERE id = :id`,
      { id, historiaClinicaId, userId: req.auth!.userId, fechaUltimoMovimiento: input.fecha_ultimo_movimiento }
    );

    await connection.commit();
    res.json({ ok: true, data: { historiaClinicaId } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    await clearAuditContext(connection).catch(() => undefined);
    connection.release();
  }
});

router.patch("/pedidos/:id/resuelto", requirePermission("pedidos_hc:resolver"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const input = z.object({ resuelto: z.coerce.boolean() }).parse(req.body);
    await query(
      `UPDATE pedidos_historias_clinicas
          SET resuelto = :resuelto,
              resuelto_por = CASE WHEN :resuelto = 1 THEN :userId ELSE NULL END
        WHERE id = :id`,
      { id, resuelto: input.resuelto ? 1 : 0, userId: req.auth!.userId }
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.patch("/pool/:id", requirePermission("pedidos_hc:resolver"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "HC invalida" });
    const input = fechaMovimientoSchema.parse(req.body);

    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, dni, apellido_nombre, fecha_ultimo_movimiento, comentarios,
              etiqueta_impresa, fecha_impresion, impreso_por
         FROM historias_clinicas
        WHERE id = :id AND deleted_at IS NULL
        LIMIT 1`,
      { id }
    );
    const current = (rows as HcAuditRow[])[0];
    if (!current) {
      await connection.rollback();
      return res.status(404).json({ ok: false, error: "HC no encontrada" });
    }

    await setAuditContext(connection, req.auth!.userId, "ACTUALIZAR");
    await connection.execute(
      `UPDATE historias_clinicas
          SET fecha_ultimo_movimiento = :fechaUltimoMovimiento,
              cargado_por = :userId,
              caja = NULL,
              etiqueta_impresa = 0,
              fecha_impresion = NULL,
              impreso_por = NULL
        WHERE id = :id`,
      {
        id,
        fechaUltimoMovimiento: input.fecha_ultimo_movimiento,
        userId: req.auth!.userId,
      }
    );
    await connection.commit();
    res.json({ ok: true });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    await clearAuditContext(connection).catch(() => undefined);
    connection.release();
  }
});

router.patch("/pool/:id/etiqueta", requirePermission("pedidos_hc:resolver"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "HC invalida" });
    const input = etiquetaImpresaSchema.parse(req.body);

    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, dni, apellido_nombre, fecha_ultimo_movimiento, caja, comentarios,
              etiqueta_impresa, fecha_impresion, impreso_por
         FROM historias_clinicas
        WHERE id = :id AND deleted_at IS NULL
        LIMIT 1`,
      { id }
    );
    const current = (rows as HcAuditRow[])[0];
    if (!current) {
      await connection.rollback();
      return res.status(404).json({ ok: false, error: "HC no encontrada" });
    }
    if (input.impresa && !current.caja) {
      await connection.rollback();
      return res.status(400).json({ ok: false, error: "Carga la caja antes de marcar la etiqueta como impresa" });
    }

    await setAuditContext(connection, req.auth!.userId, "IMPRIMIR");
    await connection.execute(
      `UPDATE historias_clinicas
          SET etiqueta_impresa = :impresa,
              fecha_impresion = CASE WHEN :impresa = 1 THEN NOW() ELSE NULL END,
              impreso_por = CASE WHEN :impresa = 1 THEN :userId ELSE NULL END
        WHERE id = :id`,
      { id, impresa: input.impresa ? 1 : 0, userId: req.auth!.userId }
    );
    await connection.commit();
    res.json({ ok: true });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    await clearAuditContext(connection).catch(() => undefined);
    connection.release();
  }
});

router.patch("/pool/:id/caja", requirePermission("pedidos_hc:resolver"), async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "HC invalida" });
    const input = cajaSchema.parse(req.body);

    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, dni, apellido_nombre, fecha_ultimo_movimiento, caja, comentarios,
              etiqueta_impresa, fecha_impresion, impreso_por
         FROM historias_clinicas
        WHERE id = :id AND deleted_at IS NULL
        LIMIT 1`,
      { id }
    );
    const current = (rows as HcAuditRow[])[0];
    if (!current) {
      await connection.rollback();
      return res.status(404).json({ ok: false, error: "HC no encontrada" });
    }

    await setAuditContext(connection, req.auth!.userId, "IMPRIMIR");
    await connection.execute(
      `UPDATE historias_clinicas
          SET caja = :caja
        WHERE id = :id`,
      { id, caja: input.caja }
    );
    await connection.commit();
    res.json({ ok: true });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    await clearAuditContext(connection).catch(() => undefined);
    connection.release();
  }
});

export { router as hcRouter };
