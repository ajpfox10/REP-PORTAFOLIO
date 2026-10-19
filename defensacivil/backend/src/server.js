const path   = require('path');
const config = require('./config/env');
const { testConnection, pool, query } = require('./config/database');
const { runMigrations } = require('./db/migrations');
const logger = require('./config/logger');
const app    = require('./app');

// Si la base no tiene localidades ni infraestructura cargadas, lanza el
// importador de datos oficiales en segundo plano, sin demorar el arranque.
async function checkAndImportData() {
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
    if (necesitaGeo  && !necesitaInfra) args.push('--solo-geo');
    if (!necesitaGeo && necesitaInfra)  args.push('--solo-infra');

    logger.info('Base sin datos geográficos: importando en segundo plano (puede tardar varios minutos)');

    const { spawn } = require('child_process');
    const scriptPath = path.resolve(__dirname, '../scripts/import-data.js');
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env:   process.env,
    });

    // Corta el proceso si tarda más de 20 minutos
    const killTimer = setTimeout(() => {
      logger.warn('La importación superó los 20 minutos, se detiene');
      child.kill('SIGTERM');
    }, 20 * 60 * 1000);

    child.on('close', code => {
      clearTimeout(killTimer);
      if (code === 0) logger.info('Importación de datos completada');
      else logger.warn(`Importación finalizada con código ${code}: algunos datos pueden faltar`);
    });
    child.on('error', err => logger.error('No se pudo iniciar el importador', { error: err.message }));
  } catch (err) {
    logger.warn('No se pudo verificar los datos iniciales', { error: err.message });
  }
}

async function start() {
  try {
    await testConnection();
    await runMigrations();
  } catch (err) {
    logger.error('No se pudo preparar la base de datos', { error: err.message });
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    logger.info(`Servidor iniciado en puerto ${config.port} [${config.appEnv}]`);
  });

  if (config.autoImport) checkAndImportData();

  function shutdown(signal) {
    logger.info(`${signal} recibido, cerrando servidor...`);
    server.close(async () => {
      await pool.end();
      logger.info('Servidor detenido');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start();
