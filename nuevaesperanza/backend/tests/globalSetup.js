'use strict';

require('./env');
const mysql = require('mysql2/promise');
const config = require('../src/config');

module.exports = async function globalSetup() {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  const [tables] = await conn.query('SHOW TABLES');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const row of tables) await conn.query(`DROP TABLE \`${Object.values(row)[0]}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  await conn.end();

  const { migrate } = require('../scripts/migrate');
  await migrate({ log: () => {} });
  const { seedCatalog, seedAdmin } = require('../scripts/seed');
  await seedCatalog();
  await seedAdmin();
  await require('../src/db').pool.end();
};
