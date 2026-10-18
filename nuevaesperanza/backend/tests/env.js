'use strict';

// Los tests usan siempre una base aparte, que se recrea en cada corrida.
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'nueva_esperanza_test';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'Admin.Test2026';
