'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const pwHash = require('../../../../shared/passwordHash');
const {
  db,
  R,
  log,
  sendWelcome,
  sendNewDeviceLogin,
  sendPasswordReset,
  authLimiter,
  validate,
  buildOwnerToken,
  buildOwnerRefresh,
  publishPortalEvent,
  PASSWORD_POLICY,
  vBody,
  jwt,
} = require('../portal.common');
const { formatDateTime } = require('../../../../shared/locale');

const router = Router();

function sameEmailConstantTime(a, b) {
  const left = Buffer.from(String(a || '').toLowerCase().padEnd(320, '\0'));
  const right = Buffer.from(String(b || '').toLowerCase().padEnd(320, '\0'));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function loadActivation(token) {
  if (!token) return null;
  return db.queryOne(
    `SELECT id, client_id, org_id, email
     FROM portal_activation_tokens
     WHERE token_hash = :hash
       AND used_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    { hash: jwt.hashToken(token) }
  ).catch((err) => {
    log.warn('portal activation lookup failed', { err: err.message });
    return null;
  });
}

router.post('/register',
  authLimiter,
  vBody('email').isEmail().normalizeEmail(),
  vBody('password').isLength({ min: 10 }).matches(PASSWORD_POLICY),
  vBody('firstName').notEmpty().isString().trim().isLength({ max: 100 }),
  vBody('lastName').notEmpty().isString().trim().isLength({ max: 100 }),
  vBody('phone').optional().isString().trim().isLength({ max: 30 }),
  validate,
  async (req, res, next) => {
    try {
      const { email, password, firstName, lastName, activationToken } = req.body;
      const phone = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 30) : null;
      const rawOrgId = req.headers['x-org-id'];
      const orgId = rawOrgId && /^\d{1,10}$/.test(String(rawOrgId)) ? String(rawOrgId) : null;
      const allowSelfRegistration = process.env.NODE_ENV !== 'production'
        && process.env.PORTAL_ALLOW_SELF_REGISTRATION !== 'false';

      const activation = await loadActivation(activationToken);
      if (activationToken && !activation) return R.unauthorized(res, 'Token de activacion invalido o expirado');
      if (activation?.email && !sameEmailConstantTime(activation.email, email)) {
        return R.forbidden(res, 'Token de activacion no corresponde al email');
      }
      if (activation?.org_id && orgId && Number(activation.org_id) !== Number(orgId)) {
        return R.forbidden(res, 'Token de activacion no corresponde a la organizacion');
      }

      const scopeOrgId = activation?.org_id || null;
      const existingOrgCond = scopeOrgId ? 'AND (c.organization_id = :scopeOrgId OR b.organization_id = :scopeOrgId)' : '';
      const existing = await db.queryOne(
        `SELECT c.id
         FROM clients c
         LEFT JOIN branches b ON c.branch_id = b.id
         WHERE c.email=:email
           AND c.portal_password_hash IS NOT NULL
           ${existingOrgCond}`,
        { email, ...(scopeOrgId ? { scopeOrgId } : {}) }
      );
      if (existing) return R.conflict(res, 'Ya existe una cuenta con ese email');

      const hash = await pwHash.hash(password);
      const clientOrgCond = scopeOrgId ? 'AND (c.organization_id = :scopeOrgId OR b.organization_id = :scopeOrgId)' : '';
      const client = await db.queryOne(
        `SELECT c.id, COALESCE(c.organization_id, b.organization_id) AS organization_id
         FROM clients c
         LEFT JOIN branches b ON c.branch_id = b.id
         WHERE c.email=:email ${clientOrgCond}
         LIMIT 1`,
        { email, ...(scopeOrgId ? { scopeOrgId } : {}) }
      );

      if (client) {
        if (!allowSelfRegistration) {
          if (!activation) return R.unauthorized(res, 'Se requiere invitacion para activar el portal');
          if (activation.client_id && Number(activation.client_id) !== Number(client.id)) {
            return R.forbidden(res, 'Token de activacion no corresponde al cliente');
          }
          if (activation.org_id && client.organization_id && Number(activation.org_id) !== Number(client.organization_id)) {
            return R.forbidden(res, 'Token de activacion no corresponde a la organizacion del cliente');
          }
        }

        await db.transaction(async (conn) => {
          if (activation) {
            const [activationUpdate] = await conn.query(
              `UPDATE portal_activation_tokens
               SET used_at=NOW()
               WHERE id=:id AND used_at IS NULL`,
              { id: activation.id }
            );
            if (!activationUpdate.affectedRows) {
              throw Object.assign(new Error('Token de activacion ya utilizado'), { http: 409, code: 'PORTAL_ACTIVATION_USED' });
            }
          }
          await conn.query(
            `UPDATE clients SET portal_password_hash=:hash, updated_at=NOW() WHERE id=:id`,
            { hash, id: client.id }
          );
        });

        const accessToken = buildOwnerToken({ ...client, email });
        const refreshToken = buildOwnerRefresh(client);
        sendWelcome({ to: email, name: firstName, orgName: 'VetManager Pro' }).catch((err) => log.warn('welcome email failed', { err: err.message }));
        publishPortalEvent('portal.owner.registered', { clientId: client.id, email, orgId: client.organization_id || orgId || null }, req);
        return R.created(res, { accessToken, refreshToken });
      }

      if (!allowSelfRegistration && !activation) return R.unauthorized(res, 'Se requiere invitacion para registrar una cuenta portal');
      const effectiveOrgId = scopeOrgId;
      if (!effectiveOrgId) return R.badRequest(res, 'Se requiere organizacion para registrar una cuenta portal');

      const branch = await db.queryOne(
        `SELECT id
         FROM branches
         WHERE organization_id = :orgId
         ORDER BY id
         LIMIT 1`,
        { orgId: effectiveOrgId }
      );
      if (!branch) return R.notFound(res, 'No hay sucursales disponibles para la organizacion');

      const created = await db.transaction(async (conn) => {
        const [r] = await conn.query(
          `INSERT INTO clients (branch_id, first_name, last_name, email, phone, portal_password_hash, organization_id)
           VALUES (:branchId, :fn, :ln, :email, :phone, :hash, :orgId)`,
          { branchId: branch.id, fn: firstName, ln: lastName, email, phone: phone || null, hash, orgId: effectiveOrgId }
        );
        if (activation) {
          const [activationUpdate] = await conn.query(
            `UPDATE portal_activation_tokens
             SET used_at=NOW(), client_id=COALESCE(client_id, :clientId)
             WHERE id=:id AND used_at IS NULL`,
            { id: activation.id, clientId: r.insertId }
          );
          if (!activationUpdate.affectedRows) {
            throw Object.assign(new Error('Token de activacion ya utilizado'), { http: 409, code: 'PORTAL_ACTIVATION_USED' });
          }
        }
        return { insertId: r.insertId };
      });

      const accessToken = buildOwnerToken({ id: created.insertId, organization_id: effectiveOrgId, email });
      const refreshToken = buildOwnerRefresh({ id: created.insertId });
      sendWelcome({ to: email, name: firstName, orgName: 'VetManager Pro' }).catch((err) => log.warn('welcome email failed', { err: err.message }));
      publishPortalEvent('portal.owner.registered', { clientId: created.insertId, email, orgId: effectiveOrgId }, req);
      return R.created(res, { accessToken, refreshToken });
    } catch (e) { next(e); }
  }
);

router.post('/login',
  authLimiter,
  vBody('email').isEmail().normalizeEmail(),
  vBody('password').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const rawOrgIdLogin = req.headers['x-org-id'];
      const orgId = rawOrgIdLogin && /^\d{1,10}$/.test(String(rawOrgIdLogin)) ? String(rawOrgIdLogin) : null;
      if (!orgId && process.env.NODE_ENV === 'production') {
        return R.unauthorized(res, 'Email o contrasena incorrectos');
      }
      const orgCond = orgId ? 'AND (c.organization_id = :orgId OR b.organization_id = :orgId)' : '';
      const client = await db.queryOne(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.portal_password_hash,
                COALESCE(c.organization_id, b.organization_id) AS organization_id,
                c.is_active
         FROM clients c
         LEFT JOIN branches b ON c.branch_id = b.id
         WHERE c.email=:email ${orgCond}`,
        { email, ...(orgId ? { orgId } : {}) }
      );
      if (!client || !client.portal_password_hash) return R.unauthorized(res, 'Email o contrasena incorrectos');
      // Usar el mismo mensaje genérico para cuentas inactivas — evita enumeración de estado de cuenta
      if (!client.is_active) return R.unauthorized(res, 'Email o contrasena incorrectos');

      const ok = await pwHash.verify(password, client.portal_password_hash);
      if (!ok) return R.unauthorized(res, 'Email o contrasena incorrectos');

      const accessToken = buildOwnerToken(client);
      const refreshToken = buildOwnerRefresh(client);

      const ip = req.ip || req.socket?.remoteAddress || 'desconocida';
      const ua = req.headers['user-agent'] || 'desconocido';
      const seenBefore = await db.queryOne(
        `SELECT 1 FROM login_history
         WHERE user_id = :id AND ip_address = :ip AND success = TRUE
           AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
         LIMIT 1`,
        { id: client.id, ip }
      ).catch((err) => {
        log.warn('login history lookup failed', { err: err.message });
        return false;
      });

      if (!seenBefore) {
        sendNewDeviceLogin({
          to: client.email,
          name: client.first_name,
          ip,
          userAgent: ua,
          time: formatDateTime(new Date()),
        }).catch((err) => log.warn('new device email failed', { err: err.message }));
      }

      db.query(
        `INSERT INTO login_history (user_id, email_attempted, ip_address, user_agent, success)
         VALUES (:id, :email, :ip, :ua, TRUE)`,
        { id: client.id, email: client.email, ip, ua }
      ).catch((err) => log.warn('login history insert failed', { err: err.message }));

      publishPortalEvent('portal.owner.logged_in', { clientId: client.id, email: client.email, orgId: client.organization_id || null, ip }, req, { ip });
      return R.ok(res, { accessToken, refreshToken, owner: { id: client.id, name: `${client.first_name} ${client.last_name}`, email: client.email } });
    } catch (e) { next(e); }
  }
);

router.post('/refresh',
  vBody('refreshToken').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const decoded = jwt.verifyRefresh(req.body.refreshToken);
      if (decoded.role !== 'owner') return R.unauthorized(res, 'Token invalido');

      const client = await db.queryOne(
        `SELECT c.id, c.email, COALESCE(c.organization_id, b.organization_id) AS organization_id
         FROM clients c
         LEFT JOIN branches b ON c.branch_id = b.id
         WHERE c.id=:id AND c.is_active=1`,
        { id: decoded.clientId }
      );
      if (!client) return R.unauthorized(res, 'Cuenta no encontrada');

      return R.ok(res, { accessToken: buildOwnerToken(client), refreshToken: buildOwnerRefresh(client) });
    } catch (err) {
      log.warn('portal refresh failed', { err: err.message });
      return R.unauthorized(res, 'Token invalido o expirado');
    }
  }
);

router.post('/forgot-password',
  authLimiter,
  vBody('email').isEmail().normalizeEmail(),
  validate,
  async (req, res, next) => {
    try {
      const { email } = req.body;
      const rawOrgIdFp = req.headers['x-org-id'];
      const orgId = rawOrgIdFp && /^\d{1,10}$/.test(String(rawOrgIdFp)) ? String(rawOrgIdFp) : null;
      let client = null;

      if (orgId || process.env.NODE_ENV !== 'production') {
        const orgCond = orgId ? 'AND (c.organization_id = :orgId OR b.organization_id = :orgId)' : '';
        client = await db.queryOne(
          `SELECT c.id, COALESCE(c.organization_id, b.organization_id) AS organization_id
           FROM clients c
           LEFT JOIN branches b ON c.branch_id = b.id
           WHERE c.email=:email ${orgCond}
           LIMIT 1`,
          { email, ...(orgId ? { orgId } : {}) }
        );
      }

      if (client) {
        const token = jwt.generateOpaqueToken();
        const hash = jwt.hashToken(token);
        await db.query(
          `INSERT INTO portal_password_reset_tokens (client_id, org_id, token_hash, expires_at)
           VALUES (:clientId, :orgId, :hash, DATE_ADD(NOW(), INTERVAL 1 HOUR))
           ON DUPLICATE KEY UPDATE
             org_id=:orgId,
             token_hash=:hash,
             expires_at=DATE_ADD(NOW(), INTERVAL 1 HOUR),
             used_at=NULL`,
          { clientId: client.id, orgId: client.organization_id || orgId || null, hash }
        );
        sendPasswordReset({ to: email, token, expiresInMinutes: 60, portal: true }).catch((err) => log.warn('password reset email failed', { err: err.message }));
      }

      return R.ok(res, { message: 'Si ese email existe, recibira un enlace de recuperacion.' });
    } catch (e) { next(e); }
  }
);

async function confirmPasswordReset(req, res, next) {
  try {
    const hash = jwt.hashToken(req.body.token);
    const newHash = await pwHash.hash(req.body.newPassword);

    const updated = await db.transaction(async (conn) => {
      const reset = await conn.queryOne(
        `SELECT prt.id, prt.client_id, c.email
         FROM portal_password_reset_tokens prt
         JOIN clients c ON c.id = prt.client_id
         WHERE prt.token_hash = :hash
           AND prt.expires_at > NOW()
           AND prt.used_at IS NULL
           AND c.is_active = 1
         FOR UPDATE`,
        { hash }
      );
      if (!reset) return false;

      await conn.query(
        `UPDATE clients
         SET portal_password_hash=:passwordHash, updated_at=NOW()
         WHERE id=:clientId`,
        { passwordHash: newHash, clientId: reset.client_id }
      );
      await conn.query(
        `UPDATE portal_password_reset_tokens SET used_at=NOW() WHERE id=:id`,
        { id: reset.id }
      );
      return true;
    });

    if (!updated) return R.badRequest(res, 'Token invalido o expirado');
    return R.ok(res, { message: 'Contrasena actualizada' });
  } catch (e) { next(e); }
}

router.post('/password-reset/confirm',
  authLimiter,
  vBody('token').notEmpty(),
  vBody('newPassword').isLength({ min: 10 }).matches(PASSWORD_POLICY),
  validate,
  confirmPasswordReset
);

// B-6: alias legacy removido para evitar ruta duplicada — usar /password-reset/confirm

module.exports = router;
