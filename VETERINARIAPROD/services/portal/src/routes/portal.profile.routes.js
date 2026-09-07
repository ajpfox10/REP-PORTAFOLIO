'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { db, R, portalAuth, validate, vBody, PASSWORD_POLICY, log } = require('../portal.common');
const pwHash = require('../../../../shared/passwordHash');
const { decrypt } = require('../../../../shared/encryption');

const router = Router();

// BUG-006: rate limit estricto en cambio de contraseña para prevenir brute force
const passwordChangeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Demasiados intentos de cambio de contraseña. Intente de nuevo en 1 hora.' } },
});

router.get('/', portalAuth, async (req, res, next) => {
  try {
    const client = await db.queryOne(
      `SELECT id, first_name, last_name, email, phone, address, city,
              document_type, document_number, created_at
       FROM clients WHERE id=:id`,
      { id: req.owner.clientId }
    );
    if (!client) return R.notFound(res, 'Cuenta no encontrada');
    if (client.document_number) client.document_number = decrypt(client.document_number);
    return R.ok(res, client);
  } catch (e) { next(e); }
});

router.put('/',
  portalAuth,
  vBody('firstName').optional().notEmpty().isLength({ max: 100 }),    // BUG-010
  vBody('lastName').optional().notEmpty().isLength({ max: 100 }),     // BUG-010
  vBody('phone').optional().isLength({ max: 30 }),                    // BUG-010
  vBody('address').optional().isLength({ max: 300 }),                 // BUG-010
  vBody('city').optional().isLength({ max: 100 }),                    // BUG-010
  validate,
  async (req, res, next) => {
    try {
      const { firstName, lastName, phone, address, city } = req.body;
      await db.query(
        `UPDATE clients SET
           first_name=COALESCE(:fn, first_name),
           last_name=COALESCE(:ln, last_name),
           phone=COALESCE(:phone, phone),
           address=COALESCE(:addr, address),
           city=COALESCE(:city, city),
           updated_at=NOW()
         WHERE id=:id`,
        { fn: firstName || null, ln: lastName || null, phone: phone || null, addr: address || null, city: city || null, id: req.owner.clientId }
      );
      return R.noContent(res);
    } catch (e) { next(e); }
  }
);

router.put('/password',
  portalAuth,
  passwordChangeLimiter,   // BUG-006
  vBody('currentPassword').notEmpty(),
  vBody('newPassword').isLength({ min: 10 }).matches(PASSWORD_POLICY),
  validate,
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const client = await db.queryOne(`SELECT portal_password_hash FROM clients WHERE id=:id`, { id: req.owner.clientId });
      if (!await pwHash.verify(currentPassword, client.portal_password_hash)) {
        return R.badRequest(res, 'Contrasena actual incorrecta');
      }

      const newHash = await pwHash.hash(newPassword);

      // BUG-016: actualizar contraseña e invalidar sesiones en una sola transacción
      // Si la invalidación falla, la operación completa se revierte para evitar estado inconsistente
      await db.transaction(async (conn) => {
        await conn.query(
          `UPDATE clients SET portal_password_hash=:hash, updated_at=NOW() WHERE id=:id`,
          { hash: newHash, id: req.owner.clientId }
        );
        await conn.query(
          `DELETE FROM client_sessions WHERE client_id=:id`,
          { id: req.owner.clientId }
        );
      });

      return R.ok(res, { message: 'Contrasena actualizada. Por favor, inicia sesion nuevamente.' });
    } catch (e) {
      log.warn('portal password update failed', { err: e.message });
      next(e);
    }
  }
);

module.exports = router;
