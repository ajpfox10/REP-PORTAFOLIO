const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

// Crea la base de prueba desde cero con los mismos scripts que usa Docker
module.exports = async () => {
  require('./setupEnv');
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || '127.0.0.1',
    port:     Number(process.env.DB_PORT || 3306),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    charset:  'utf8mb4',
  });
  const db = process.env.DB_NAME;
  await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
  await conn.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${db}\``);

  const dir = path.resolve(__dirname, '../database/init');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    await conn.query(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  await conn.end();
};
