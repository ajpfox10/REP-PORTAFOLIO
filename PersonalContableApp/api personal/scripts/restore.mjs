#!/usr/bin/env node
// scripts/restore.mjs
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

const DEFAULT_BACKUP_DIR = path.resolve(process.cwd(), '../backups/personalv5');
const DEFAULT_DB_HOST = 'localhost';
const DEFAULT_DB_PORT = '3306';
const DEFAULT_DB_NAME = 'personalv5';
const DEFAULT_DB_USER = 'root';
const DEFAULT_DOCS_DIR = 'D:\\G\\RESOLUCIONES Y VARIOS';

function logInfo(msg) { console.log(`\x1b[36mℹ️  ${msg}\x1b[0m`); }
function logSuccess(msg) { console.log(`\x1b[32m✅ ${msg}\x1b[0m`); }
function logWarning(msg) { console.log(`\x1b[33m⚠️  ${msg}\x1b[0m`); }
function logError(msg) { console.log(`\x1b[31m❌ ${msg}\x1b[0m`); }

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function listBackupFiles(dir, pattern) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.match(pattern))
    .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime); // más reciente primero
}

async function selectBackup(files, type) {
  if (!files.length) {
    logWarning(`No hay backups de ${type} en el directorio.`);
    return null;
  }

  console.log(`\n📋 Backups de ${type} disponibles:`);
  files.forEach((f, i) => {
    const date = f.mtime.toLocaleString();
    const size = (fs.statSync(f.path).size / 1024 / 1024).toFixed(2) + ' MB';
    console.log(`   ${i + 1}) ${f.name} (${date}) - ${size}`);
  });

  const choice = await ask(`\nSeleccioná el número del backup a restaurar (1-${files.length}): `);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= files.length) {
    logError('Selección inválida');
    return null;
  }

  return files[idx];
}

async function restoreDatabase(backupFile, dbConfig) {
  logInfo(`Restaurando base de datos desde: ${backupFile.name}`);

  const cmd = `mysql -h ${dbConfig.host} -P ${dbConfig.port} -u ${dbConfig.user} ${dbConfig.password ? '-p' + dbConfig.password : ''} ${dbConfig.database} < "${backupFile.path}"`;
  
  try {
    execSync(cmd, { stdio: 'inherit', shell: true });
    logSuccess('Base de datos restaurada correctamente');
    return true;
  } catch (err) {
    logError(`Error restaurando DB: ${err.message}`);
    return false;
  }
}

async function restoreDocuments(backupFile, docsDir) {
  logInfo(`Restaurando documentos desde: ${backupFile.name}`);

  // Crear backup del directorio actual por seguridad
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupCurrentDir = `${docsDir}_backup_${timestamp}`;
  
  if (exists(docsDir)) {
    logInfo(`Creando backup del directorio actual en: ${backupCurrentDir}`);
    fs.renameSync(docsDir, backupCurrentDir);
  }

  // Restaurar
  try {
    if (backupFile.name.endsWith('.7z')) {
      execSync(`7z x "${backupFile.path}" -o"${path.dirname(docsDir)}" -y`, { stdio: 'inherit' });
    } else if (backupFile.name.endsWith('.tar.gz')) {
      execSync(`tar -xzf "${backupFile.path}" -C "${path.dirname(docsDir)}"`, { stdio: 'inherit' });
    } else {
      logError('Formato de backup no soportado. Usá .7z o .tar.gz');
      return false;
    }

    logSuccess('Documentos restaurados correctamente');
    logInfo(`Backup anterior guardado en: ${backupCurrentDir}`);
    return true;
  } catch (err) {
    logError(`Error restaurando documentos: ${err.message}`);
    
    // Revertir si falló
    if (exists(backupCurrentDir) && !exists(docsDir)) {
      fs.renameSync(backupCurrentDir, docsDir);
    }
    return false;
  }
}

async function main() {
  console.log('\n🔄 ========================================');
  console.log('🔄 RESTAURACIÓN GUIADA - personalv5');
  console.log('🔄 ========================================\n');

  // Configuración
  const backupDir = await ask(`📁 Directorio de backups (Enter para default: ${DEFAULT_BACKUP_DIR}): `) || DEFAULT_BACKUP_DIR;
  
  if (!exists(backupDir)) {
    logError(`El directorio ${backupDir} no existe`);
    process.exit(1);
  }

  // Listar backups disponibles
  const dbBackups = listBackupFiles(path.join(backupDir, 'db'), /^db_.*\.sql(\.gz)?$/);
  const docsBackups = listBackupFiles(path.join(backupDir, 'docs'), /^docs_.*\.(7z|tar\.gz)$/);

  console.log('\n📊 BACKUPS ENCONTRADOS:');
  console.log(`   📁 DB: ${dbBackups.length} backup(s)`);
  console.log(`   📁 Documentos: ${docsBackups.length} backup(s)`);

  // Preguntar qué restaurar
  const restoreDb = (await ask('\n¿Restaurar base de datos? (s/N): ')).toLowerCase() === 's';
  const restoreDocs = (await ask('¿Restaurar documentos? (s/N): ')).toLowerCase() === 's';

  if (!restoreDb && !restoreDocs) {
    logWarning('No se seleccionó nada para restaurar');
    process.exit(0);
  }

  let dbConfig = null;
  if (restoreDb) {
    console.log('\n🔧 Configuración de base de datos:');
    const host = await ask(`   Host (Enter para default: ${DEFAULT_DB_HOST}): `) || DEFAULT_DB_HOST;
    const port = await ask(`   Puerto (Enter para default: ${DEFAULT_DB_PORT}): `) || DEFAULT_DB_PORT;
    const database = await ask(`   Nombre DB (Enter para default: ${DEFAULT_DB_NAME}): `) || DEFAULT_DB_NAME;
    const user = await ask(`   Usuario (Enter para default: ${DEFAULT_DB_USER}): `) || DEFAULT_DB_USER;
    const password = await ask('   Contraseña (opcional, Enter si no hay): ');

    dbConfig = { host, port, database, user, password };
  }

  let docsDir = DEFAULT_DOCS_DIR;
  if (restoreDocs) {
    docsDir = await ask(`📁 Directorio de documentos (Enter para default: ${DEFAULT_DOCS_DIR}): `) || DEFAULT_DOCS_DIR;
  }

  // Confirmación final
  console.log('\n📋 RESUMEN DE RESTAURACIÓN:');
  if (restoreDb) console.log(`   📁 DB Backup: a seleccionar`);
  if (restoreDocs) console.log(`   📁 Docs Backup: a seleccionar`);
  
  const confirm = await ask('\n¿Proceder con la restauración? (s/N): ');
  if (confirm.toLowerCase() !== 's') {
    logWarning('Restauración cancelada');
    process.exit(0);
  }

  // Ejecutar restauración
  let success = true;

  if (restoreDb) {
    const dbBackup = await selectBackup(dbBackups, 'base de datos');
    if (dbBackup) {
      const ok = await restoreDatabase(dbBackup, dbConfig);
      if (!ok) success = false;
    } else {
      success = false;
    }
  }

  if (restoreDocs && success) {
    const docsBackup = await selectBackup(docsBackups, 'documentos');
    if (docsBackup) {
      const ok = await restoreDocuments(docsBackup, docsDir);
      if (!ok) success = false;
    } else {
      success = false;
    }
  }

  console.log('\n📊 ========================================');
  if (success) {
    logSuccess('RESTAURACIÓN COMPLETADA EXITOSAMENTE');
  } else {
    logError('RESTAURACIÓN COMPLETADA CON ERRORES');
    logWarning('Revisá los logs para más detalles');
  }
  console.log('📊 ========================================\n');

  rl.close();
  process.exit(success ? 0 : 1);
}

main().catch(err => {
  logError(`Error fatal: ${err.message}`);
  process.exit(1);
});