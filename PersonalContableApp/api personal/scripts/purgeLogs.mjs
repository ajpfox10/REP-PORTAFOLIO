#!/usr/bin/env node
// scripts/purgeLogs.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '../logs');
const DEFAULT_RETENTION_DAYS = 30;

function parseArgs() {
  const args = process.argv.slice(2);
  let days = DEFAULT_RETENTION_DAYS;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i+1]) {
      days = parseInt(args[i+1], 10);
      i++;
    }
    if (args[i] === '--dry-run') {
      dryRun = true;
    }
    if (args[i] === '--help') {
      console.log(`
🧹 Purge Logs - Limpiador de archivos de log

Uso: node purgeLogs.mjs [opciones]

Opciones:
  --days <n>     Conservar logs de los últimos n días (default: 30)
  --dry-run      Solo mostrar qué se borraría, no borrar
  --help         Mostrar esta ayuda

Ejemplos:
  node purgeLogs.mjs --days 15
  node purgeLogs.mjs --dry-run --days 60
      `);
      process.exit(0);
    }
  }

  return { days, dryRun };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function main() {
  const { days, dryRun } = parseArgs();
  
  console.log('🧹 ========================================');
  console.log(`🧹 PURGE LOGS - Conservando últimos ${days} días`);
  console.log('🧹 ========================================');
  console.log(`📁 Directorio: ${LOG_DIR}`);
  
  if (!fs.existsSync(LOG_DIR)) {
    console.log('❌ Directorio de logs no existe');
    process.exit(0);
  }

  const files = fs.readdirSync(LOG_DIR);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let deleted = 0;
  let skipped = 0;
  let totalFreed = 0;

  files.forEach(file => {
    const filePath = path.join(LOG_DIR, file);
    const stat = fs.statSync(filePath);
    
    if (!stat.isFile()) return;
    if (!file.endsWith('.log') && !file.includes('.log.')) return;

    if (stat.mtime < cutoff) {
      totalFreed += stat.size;
      if (dryRun) {
        console.log(`  [DRY RUN] 🗑️ Eliminaría: ${file.padEnd(30)} ${formatBytes(stat.size).padStart(10)} (${stat.mtime.toISOString().split('T')[0]})`);
        deleted++;
      } else {
        try {
          fs.unlinkSync(filePath);
          console.log(`  ✅ Eliminado: ${file.padEnd(30)} ${formatBytes(stat.size).padStart(10)}`);
          deleted++;
        } catch (err) {
          console.error(`  ❌ Error eliminando ${file}: ${err.message}`);
        }
      }
    } else {
      skipped++;
    }
  });

  console.log('\n📊 ========================================');
  console.log('📊 RESUMEN');
  console.log('📊 ========================================');
  console.log(`  ✅ Archivos eliminados: ${deleted}`);
  console.log(`  💾 Espacio liberado:   ${formatBytes(totalFreed)}`);
  console.log(`  📄 Archivos conservados: ${skipped}`);
  
  if (dryRun) {
    console.log(`\n⚠️  DRY RUN - No se eliminó ningún archivo. Usá sin --dry-run para ejecutar.`);
  }
  console.log('📊 ========================================\n');
}

main();