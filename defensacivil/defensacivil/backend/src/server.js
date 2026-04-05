console.log('=== server.js iniciando ===');

process.on('uncaughtException', (err) => {
  console.error('=== UNCAUGHT EXCEPTION ===');
  console.error(err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('=== UNHANDLED REJECTION ===');
  console.error(String(reason));
  process.exit(1);
});

console.log('=== cargando env ===');
console.log('Variables disponibles:', {
  NODE_ENV: process.env.NODE_ENV,
  APP_ENV: process.env.APP_ENV,
  PORT: process.env.PORT,
  DB_HOST: process.env.DB_HOST,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  JWT_SECRET: process.env.JWT_SECRET ? 'OK' : 'FALTA',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ? 'OK' : 'FALTA',
  DB_PASSWORD: process.env.DB_PASSWORD ? 'OK' : 'FALTA',
});

const config = require('./config/env');
console.log('=== env cargado, puerto:', config.port, '===');

const { testConnection, pool } = require('./config/database');
console.log('=== database cargado ===');

const logger = require('./config/logger');
const app    = require('./app');
console.log('=== app cargada ===');

async function checkAndImportData() {
  const { query } = require('./config/database');
  try {
    const [locCount]   = await query('SELECT COUNT(*) AS n FROM localities');
    const [infraCount] = await query('SELECT COUNT(*) AS n FROM infrastructure_points');

    const necesitaGeo   = locCount.n < 50;
    const necesitaInfra = infraCount.n < 10;

    if (!necesitaGeo && !necesitaInfra) {
      logger.info(`Datos iniciales OK — ${locCount.n} localidades, ${infraCount.n} puntos de infraestructura`);
      return;
    }

    const args = [];
    if (necesitaGeo   && !necesitaInfra) args.push('--solo-geo');
    if (!necesitaGeo  && necesitaInfra)  args.push('--solo-infra');

    logger.info('Base de datos sin datos iniciales — iniciando importación en segundo plano...');

    const { spawn } = require('child_process');
    const path = require('path');
    const scriptPath = path.resolve(__dirname, '../../scripts/import-data.js');
    const child = spawn(process.execPath, [scriptPath, ...args], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    child.stdout.on('data', d => process.stdout.write(d));
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('close', code => {
      if (code === 0) logger.info('Importación completada');
      else logger.warn(`Importación finalizada con código ${code}`);
    });
    child.on('error', err => logger.error('Error al iniciar importador', { error: err.message }));

    const killTimer = setTimeout(() => {
      logger.warn('Importación superó 20 min, terminando...');
      child.kill('SIGTERM');
    }, 20 * 60 * 1000);
    child.on('close', () => clearTimeout(killTimer));

  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      logger.warn('No se pudo verificar datos iniciales', { error: err.message });
    }
  }
}

async function ensureTables() {
  const { query } = require('./config/database');
  // Tablas que pueden faltar si el schema fue aplicado parcialmente
  const migrations = [
    `CREATE TABLE IF NOT EXISTS incident_number_sequences (
       year     SMALLINT UNSIGNED NOT NULL,
       last_seq INT UNSIGNED      NOT NULL DEFAULT 0,
       PRIMARY KEY (year)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    // Sincronizar la secuencia con el máximo número de incidente existente
    `INSERT INTO incident_number_sequences (year, last_seq)
     SELECT YEAR(started_at) AS year, MAX(CAST(SUBSTRING_INDEX(incident_number, '-', -1) AS UNSIGNED)) AS last_seq
     FROM incidents
     WHERE incident_number REGEXP '^DC-[0-9]{4}-[0-9]+$'
     GROUP BY YEAR(started_at)
     ON DUPLICATE KEY UPDATE last_seq = GREATEST(last_seq, VALUES(last_seq))`,
    `CREATE TABLE IF NOT EXISTS infrastructure_points (
       id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
       type        ENUM('HOSPITAL','SALITA','BOMBEROS','SAME','DEFENSA_CIVIL','CUARTEL_GN','OTRO') NOT NULL DEFAULT 'OTRO',
       name        VARCHAR(200) NOT NULL,
       address     VARCHAR(255) NULL,
       phone       VARCHAR(100) NULL,
       province_id INT UNSIGNED NULL,
       partido_id  INT UNSIGNED NULL,
       latitude    DECIMAL(10,8) NULL,
       longitude   DECIMAL(11,8) NULL,
       beds        INT NULL,
       level       VARCHAR(30) NULL,
       is_active   TINYINT(1) NOT NULL DEFAULT 1,
       PRIMARY KEY (id),
       KEY idx_infra_type (type),
       KEY idx_infra_province (province_id),
       KEY idx_infra_coords (latitude, longitude)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];
  for (const sql of migrations) {
    try { await query(sql); }
    catch (err) { logger.warn('Error en migración automática', { error: err.message }); }
  }
  logger.info('Verificación de tablas completada');
}

async function start() {
  console.log('=== intentando conectar a BD ===');
  try {
    await testConnection();
  } catch (err) {
    console.error('=== ERROR CONEXION BD ===', err.message);
    process.exit(1);
  }

  await ensureTables();

  const server = app.listen(config.port, () => {
    console.log(`=== Servidor en puerto ${config.port} ===`);
    logger.info(`Servidor iniciado en puerto ${config.port} [${config.appEnv.toUpperCase()}]`);
  });

  checkAndImportData();

  async function shutdown(signal) {
    logger.info(`${signal} recibido, cerrando...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start();
