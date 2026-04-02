const config          = require('./config/env');
const { testConnection, pool } = require('./config/database');
const logger          = require('./config/logger');
const app             = require('./app');

// Verifica si la base tiene datos geográficos e infraestructura.
// Si está vacía, lanza el importador en segundo plano sin bloquear el arranque.
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
    logger.info('(El servidor ya está disponible. La importación puede tardar varios minutos.)');

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
      if (code === 0) logger.info('Importación de datos completada exitosamente');
      else logger.warn(`Importación finalizada con código ${code} — algunos datos pueden estar incompletos`);
    });
    child.on('error', err => logger.error('Error al iniciar importador', { error: err.message }));

    // Matar el proceso si tarda más de 20 minutos (evita zombies)
    const IMPORT_TIMEOUT_MS = 20 * 60 * 1000;
    const killTimer = setTimeout(() => {
      logger.warn('Importación superó el tiempo límite (20 min), terminando proceso...');
      child.kill('SIGTERM');
    }, IMPORT_TIMEOUT_MS);
    child.on('close', () => clearTimeout(killTimer));

  } catch (err) {
    // Si la tabla no existe todavía (antes de correr el schema), no hay problema
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      logger.warn('No se pudo verificar datos iniciales', { error: err.message });
    }
  }
}

async function start() {
  try {
    await testConnection();
  } catch (err) {
    logger.error('No se pudo conectar a la base de datos', { error: err.message });
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    logger.info(`Servidor iniciado en puerto ${config.port} [${config.appEnv.toUpperCase()}]`);
    logger.info(`Base de datos: ${config.db.name}`);
  });

  // Verificar e importar datos en segundo plano (no bloquea el arranque)
  checkAndImportData();

  async function shutdown(signal) {
    logger.info(`${signal} recibido, cerrando servidor...`);
    server.close(async () => {
      await pool.end();
      logger.info('Servidor detenido limpiamente');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start();
