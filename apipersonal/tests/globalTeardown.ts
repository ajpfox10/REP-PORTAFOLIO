// tests/globalTeardown.ts
import { closeRedisClient } from '../src/infra/redis';

export default async function globalTeardown() {
  console.log('\n🧹 [GLOBAL TEARDOWN] Cerrando conexiones...');

  try {
    await closeRedisClient();
    console.log('  ✅ Redis cerrado');
  } catch (e: any) {
    console.log('  ⚠️ No se pudo cerrar Redis:', e?.message || String(e));
  }

  const sequelize = (global as any).__TEST_SEQUELIZE__;
  if (sequelize) {
    await sequelize.close();
    console.log('  ✅ Conexión DB cerrada');
  }

  console.log('✅ [GLOBAL TEARDOWN] Completado\n');
}
