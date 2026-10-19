// Variables para los tests: base propia (*_test) y secretos de prueba.
// Los datos de conexión pueden venir del entorno (CI) o de .env.test.
process.env.APP_ENV = 'test';
process.env.NODE_ENV = 'test';
process.env.AUTO_IMPORT_DATA = 'false';
process.env.RATE_LIMIT_AUTH_MAX = '1000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.JWT_SECRET ||= 'test_access_secret_que_tiene_mas_de_32_caracteres';
process.env.JWT_REFRESH_SECRET ||= 'test_refresh_secret_que_tiene_mas_de_32_caracteres';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.test') });
process.env.DB_NAME ||= 'defensacivil_test';

if (!process.env.DB_NAME.endsWith('_test')) {
  throw new Error(`Los tests borran la base: DB_NAME debe terminar en _test (es ${process.env.DB_NAME})`);
}
