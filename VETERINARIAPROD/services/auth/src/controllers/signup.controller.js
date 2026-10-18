'use strict';

/**
 * Alta self-service de clínicas (SaaS).
 *
 * POST /signup crea, en una sola transacción:
 *   organización → sede principal → usuario org_admin → suscripción en prueba.
 * Después inicia la sesión igual que /login (cookies httpOnly + CSRF).
 */

const crypto = require('crypto');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const passwordHash = require('../../../../shared/passwordHash');
const { validatePassword } = require('../../../../shared/passwordPolicy');
const subscriptions = require('../../../../shared/subscriptions');
const { createLogger } = require('../../../../shared/logger');
const { finalizeLogin } = require('./auth.controller');

const log = createLogger('auth-signup');

const DEFAULT_TIMEZONE = process.env.DEFAULT_BRANCH_TIMEZONE || 'America/Argentina/Buenos_Aires';
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'portal', 'mail', 'static', 'status', 'docs']);

function slugify(value) {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'clinica';
}

async function uniqueSubdomain(conn, clinicName) {
  const base = slugify(clinicName);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 && !RESERVED_SUBDOMAINS.has(base)
      ? base
      : `${base}-${crypto.randomBytes(2).toString('hex')}`;
    const taken = await conn.queryOne('SELECT id FROM tenants WHERE subdomain = :candidate', { candidate });
    if (!taken) return candidate;
  }
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * POST /signup
 */
async function signup(req, res) {
  const clinicName = String(req.body.clinicName || '').trim();
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = req.body.phone ? String(req.body.phone).trim() : null;
  const { password } = req.body;
  // En clínicas chicas quien registra la cuenta suele ser también el veterinario.
  const roles = req.body.isVeterinarian === false ? ['org_admin'] : ['org_admin', 'veterinarian'];

  if (!req.body.acceptTerms) {
    return R.badRequest(res, 'Tenés que aceptar los términos y condiciones');
  }

  const policy = validatePassword(password, { email, firstName, lastName });
  if (!policy.valid) {
    return R.badRequest(res, policy.errors[0], policy.errors);
  }

  const existing = await db.queryOne('SELECT id FROM users WHERE email = :email', { email });
  if (existing) {
    // Mismo mensaje genérico que el resto del flujo: no confirma qué emails existen
    // más allá de lo imprescindible para que la persona pueda iniciar sesión.
    return R.conflict(res, 'Ya existe una cuenta con ese email. Iniciá sesión o recuperá tu contraseña.');
  }

  const hashed = await passwordHash.hash(password);

  let created;
  try {
    created = await db.transaction(async (conn) => {
      const [org] = await conn.query(
        `INSERT INTO organizations (name, email, is_active)
         VALUES (:clinicName, :email, 1)`,
        { clinicName, email }
      );
      const orgId = org.insertId;

      const [branch] = await conn.query(
        `INSERT INTO branches (organization_id, name, email, phone, timezone, is_active)
         VALUES (:orgId, :branchName, :email, :phone, :timezone, 1)`,
        { orgId, branchName: 'Sede principal', email, phone, timezone: DEFAULT_TIMEZONE }
      );
      const branchId = branch.insertId;

      const [user] = await conn.query(
        `INSERT INTO users
           (branch_id, username, first_name, last_name, email, phone, password_hash, is_active, created_at, updated_at)
         VALUES
           (:branchId, :username, :firstName, :lastName, :email, :phone, :passwordHash, 1, NOW(), NOW())`,
        { branchId, username: email.slice(0, 100), firstName, lastName, email, phone, passwordHash: hashed }
      );
      const userId = user.insertId;

      for (const roleName of roles) {
        const role = await conn.queryOne('SELECT id FROM roles WHERE name = :roleName', { roleName });
        if (!role) throw Object.assign(new Error(`Rol ${roleName} no configurado`), { code: 'SIGNUP_ROLE_MISSING' });
        await conn.query(
          `INSERT INTO user_roles (user_id, role_id, assigned_by, is_active)
           VALUES (:userId, :roleId, NULL, 1)`,
          { userId, roleId: role.id }
        );
      }

      const subdomain = await uniqueSubdomain(conn, clinicName);
      const trial = await subscriptions.startTrial(conn, { orgId, subdomain, billingEmail: email });

      return { orgId, branchId, userId, subdomain, trial };
    });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return R.conflict(res, 'Ya existe una cuenta con ese email. Iniciá sesión o recuperá tu contraseña.');
    }
    throw err;
  }

  log.info('Clinic signed up', { orgId: created.orgId, userId: created.userId, subdomain: created.subdomain });

  const user = {
    id: created.userId,
    email,
    first_name: firstName,
    last_name: lastName,
    organization_id: created.orgId,
    branch_id: created.branchId,
  };
  const session = await finalizeLogin(res, req, user, roles, {
    id: created.userId,
    email,
    name: `${firstName} ${lastName}`.trim(),
    orgId: created.orgId,
    branchId: created.branchId,
    roles,
  });

  return R.created(res, {
    ...session,
    organization: { id: created.orgId, name: clinicName, subdomain: created.subdomain },
    subscription: {
      plan: created.trial.plan,
      status: created.trial.status,
      trialEndsAt: created.trial.trialEndsAt.toISOString(),
      trialDays: subscriptions.TRIAL_DAYS,
    },
  });
}

/**
 * GET /plans — catálogo público de planes (página de precios).
 */
function listPlans(_req, res) {
  return R.ok(res, {
    trialDays: subscriptions.TRIAL_DAYS,
    currency: subscriptions.CURRENCY,
    plans: subscriptions.listPlans(),
  });
}

module.exports = { signup, listPlans, _slugify: slugify };
