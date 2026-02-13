#!/usr/bin/env node
// scripts/rotateApiKeys.mjs
import { createSequelize } from '../src/db/sequelize.js';

const DEFAULT_EXPIRY_DAYS = 365;
const DEFAULT_WARNING_DAYS = 30;

function parseArgs() {
  const args = process.argv.slice(2);
  let expiryDays = DEFAULT_EXPIRY_DAYS;
  let warningDays = DEFAULT_WARNING_DAYS;
  let checkOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expiry' && args[i+1]) {
      expiryDays = parseInt(args[i+1], 10);
      i++;
    }
    if (args[i] === '--warning' && args[i+1]) {
      warningDays = parseInt(args[i+1], 10);
      i++;
    }
    if (args[i] === '--check-only') {
      checkOnly = true;
    }
    if (args[i] === '--help') {
      console.log(`
🔑 Rotate API Keys - Gestión de ciclo de vida de API keys

Uso: node rotateApiKeys.mjs [opciones]

Opciones:
  --expiry <n>     Días para considerar una key expirada (default: 365)
  --warning <n>    Días antes de expirar para alertar (default: 30)
  --check-only     Solo mostrar, no revocar
  --help           Mostrar esta ayuda

Ejemplos:
  node rotateApiKeys.mjs
  node rotateApiKeys.mjs --expiry 180 --warning 15
  node rotateApiKeys.mjs --check-only
      `);
      process.exit(0);
    }
  }

  return { expiryDays, warningDays, checkOnly };
}

function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

function daysSince(date) {
  const then = new Date(date).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

async function main() {
  const { expiryDays, warningDays, checkOnly } = parseArgs();

  console.log('\n🔑 ========================================');
  console.log('🔑 ROTATE API KEYS - personalv5');
  console.log('🔑 ========================================');
  console.log(`   📅 Expiración:     ${expiryDays} días`);
  console.log(`   ⚠️  Alerta previa:  ${warningDays} días`);
  console.log(`   🔍 Modo check-only: ${checkOnly ? 'SÍ' : 'NO'}`);
  console.log('🔑 ========================================\n');

  const sequelize = createSequelize();
  await sequelize.authenticate();
  console.log('✅ Conexión a DB exitosa\n');

  // ------------------------------------------------------------------------
  // 1. Estadísticas generales
  // ------------------------------------------------------------------------
  const [stats] = await sequelize.query(
    `SELECT 
       COUNT(*) as total,
       SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) as activas,
       SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) as revocadas,
       MIN(created_at) as mas_antigua,
       MAX(created_at) as mas_reciente
     FROM api_keys`
  );

  const s = stats[0];
  console.log('📊 ESTADÍSTICAS GENERALES:');
  console.log(`   📌 Total API keys:   ${s.total || 0}`);
  console.log(`   ✅ Activas:           ${s.activas || 0}`);
  console.log(`   ❌ Revocadas:         ${s.revocadas || 0}`);
  console.log(`   📅 Más antigua:       ${formatDate(s.mas_antigua)} (${daysSince(s.mas_antigua)} días)`);
  console.log(`   📅 Más reciente:      ${formatDate(s.mas_reciente)}`);
  console.log('');

  // ------------------------------------------------------------------------
  // 2. Keys expiradas (creadas hace más de expiryDays)
  // ------------------------------------------------------------------------
  const [expiradas] = await sequelize.query(
    `SELECT id, name, created_at, revoked_at
     FROM api_keys
     WHERE revoked_at IS NULL
       AND created_at < DATE_SUB(NOW(), INTERVAL :expiryDays DAY)
     ORDER BY created_at ASC`,
    { replacements: { expiryDays } }
  );

  if (expiradas.length > 0) {
    console.log(`⚠️  KEYS EXPIRADAS (${expiradas.length}):`);
    expiradas.forEach(k => {
      const antiguedad = daysSince(k.created_at);
      console.log(`   🆔 ${k.id.toString().padStart(5)} | ${(k.name || 'Sin nombre').padEnd(25)} | Creada: ${formatDate(k.created_at)} (${antiguedad} días)`);
    });

    if (!checkOnly && expiradas.length > 0) {
      console.log('\n🔄 REVOCANDO KEYS EXPIRADAS...');
      const [revoked] = await sequelize.query(
        `UPDATE api_keys 
         SET revoked_at = NOW() 
         WHERE revoked_at IS NULL
           AND created_at < DATE_SUB(NOW(), INTERVAL :expiryDays DAY)`,
        { replacements: { expiryDays } }
      );
      console.log(`   ✅ Revocadas: ${revoked.affectedRows || 0}`);
    }
    console.log('');
  } else {
    console.log('✅ No hay keys expiradas.\n');
  }

  // ------------------------------------------------------------------------
  // 3. Keys próximas a expirar (warning)
  // ------------------------------------------------------------------------
  const [proximas] = await sequelize.query(
    `SELECT id, name, created_at, revoked_at
     FROM api_keys
     WHERE revoked_at IS NULL
       AND created_at < DATE_SUB(NOW(), INTERVAL :expiryDays - :warningDays DAY)
       AND created_at >= DATE_SUB(NOW(), INTERVAL :expiryDays DAY)
     ORDER BY created_at ASC`,
    { replacements: { expiryDays, warningDays } }
  );

  if (proximas.length > 0) {
    console.log(`⚠️  KEYS PRÓXIMAS A EXPIRAR (${proximas.length}):`);
    proximas.forEach(k => {
      const antiguedad = daysSince(k.created_at);
      const diasRestantes = expiryDays - antiguedad;
      console.log(`   🆔 ${k.id.toString().padStart(5)} | ${(k.name || 'Sin nombre').padEnd(25)} | Expira en: ${diasRestantes} días`);
    });
    console.log('');
  }

  // ------------------------------------------------------------------------
  // 4. Resumen final
  // ------------------------------------------------------------------------
  const [finalStats] = await sequelize.query(
    `SELECT 
       COUNT(*) as total,
       SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) as activas
     FROM api_keys`
  );

  console.log('📊 ========================================');
  console.log('📊 RESUMEN FINAL');
  console.log('📊 ========================================');
  console.log(`   📌 Total API keys:   ${finalStats[0].total || 0}`);
  console.log(`   ✅ Activas:           ${finalStats[0].activas || 0}`);
  console.log(`   🔄 Procesadas:        ${expiradas.length} expiradas, ${proximas.length} próximas`);
  if (checkOnly) {
    console.log(`\n⚠️  Modo CHECK-ONLY - No se revocó ninguna key.`);
  }
  console.log('📊 ========================================\n');

  await sequelize.close();
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});