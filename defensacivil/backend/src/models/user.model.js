const bcrypt         = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query, queryOne } = require('../config/database');

const SAFE_FIELDS = 'id, uuid, username, email, role, full_name, is_active, last_login, created_at, updated_at';

async function findAll() {
  return query(`SELECT ${SAFE_FIELDS} FROM users ORDER BY created_at DESC`);
}

async function findByUuid(uuid) {
  return queryOne(`SELECT ${SAFE_FIELDS} FROM users WHERE uuid = ?`, [uuid]);
}

async function findByUsername(username) {
  return queryOne('SELECT * FROM users WHERE username = ? AND is_active = 1', [username]);
}

async function findByEmail(email) {
  return queryOne(`SELECT ${SAFE_FIELDS} FROM users WHERE email = ?`, [email]);
}

async function findById(id) {
  return queryOne(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`, [id]);
}

async function create({ username, email, password, role, full_name }) {
  const uuid          = uuidv4();
  const password_hash = await bcrypt.hash(password, 12);
  await query(
    'INSERT INTO users (uuid, username, email, password_hash, role, full_name) VALUES (?, ?, ?, ?, ?, ?)',
    [uuid, username.toLowerCase(), email, password_hash, role, full_name]
  );
  return findByUuid(uuid);
}

async function update(uuid, fields) {
  const allowed = ['email', 'role', 'full_name'];
  const updates = [];
  const values  = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (!updates.length) return findByUuid(uuid);

  values.push(uuid);
  await query(`UPDATE users SET ${updates.join(', ')} WHERE uuid = ?`, values);
  return findByUuid(uuid);
}

async function resetPassword(uuid, newPassword) {
  const password_hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = ? WHERE uuid = ?', [password_hash, uuid]);
}

async function changePassword(id, newPassword) {
  const password_hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, id]);
}

async function toggleActive(uuid) {
  await query('UPDATE users SET is_active = NOT is_active WHERE uuid = ?', [uuid]);
  return findByUuid(uuid);
}

async function updateLastLogin(id) {
  await query('UPDATE users SET last_login = NOW() WHERE id = ?', [id]);
}

module.exports = {
  findAll, findByUuid, findByUsername, findByEmail, findById,
  create, update, resetPassword, changePassword, toggleActive, updateLastLogin,
};
