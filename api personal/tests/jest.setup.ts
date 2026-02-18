// tests/jest.setup.ts
import path from "path";

// Cargar .env
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

// 🔧 Ajustes SOLO para tests (no tocan prod)
process.env.NODE_ENV = "test";

// evita esperas/reintentos por rate limiting
process.env.RATE_LIMIT_ENABLE = "false";
process.env.RATE_LIMIT_USE_REDIS = "false";

// si tu redis de test no soporta EVAL/SETEX, evitás ruido (y posibles handles)
process.env.CACHE_ENABLE = "false"; // si existe en tu env.ts; si no existe, no rompe
process.env.METRICS_ENABLE = "false"; // idem

// Aumentar timeout global (contratos recorren muchos endpoints)
jest.setTimeout(120000);

// Verificar recursos globales
beforeAll(() => {
  if (!global.__TEST_SEQUELIZE__ || !global.__TEST_SCHEMA__) {
    throw new Error("❌ Recursos globales no inicializados");
  }
  console.log("  ✅ Recursos globales disponibles");
});

// ✅ Cerrar logger al final para que Jest no quede colgado por transports abiertos
afterAll(async () => {
  try {
    const mod = await import("../src/logging/logger");
    // winston logger.close() NO lleva callback
    mod.logger?.close?.();
  } catch {
    // si no existe o falla, no frenamos tests
  }
});
