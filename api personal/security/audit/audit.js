// security/audit/audit.js
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.AUDIT_URL || 'http://localhost:3000';
const REPORT_DIR = path.join(__dirname, '../reports');
const TIMEOUT = 5000;

// Colores para console
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function logInfo(msg) { console.log(`${colors.cyan}🔍 ${msg}${colors.reset}`); }
function logPass(msg) { console.log(`${colors.green}✅ ${msg}${colors.reset}`); }
function logWarn(msg) { console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`); }
function logFail(msg) { console.log(`${colors.red}❌ ${msg}${colors.reset}`); }
function logTitle(msg) { console.log(`\n${colors.magenta}═══════════════════════════════════════════\n📋 ${msg}\n═══════════════════════════════════════════${colors.reset}`); }

// Crear directorio de reportes
fs.mkdirSync(REPORT_DIR, { recursive: true });

const agent = new https.Agent({ rejectUnauthorized: false });

// ============================================
// 1. VERIFICAR QUE LA API ESTÁ VIVA
// ============================================
async function checkApiAlive() {
  logTitle('Verificando conectividad');
  
  try {
    const res = await axios.get(`${BASE_URL}/health`, { timeout: TIMEOUT });
    if (res.status === 200) {
      logPass(`API respondiendo en ${BASE_URL}`);
      return true;
    }
  } catch (err) {
    logFail(`No se puede conectar a ${BASE_URL}`);
    return false;
  }
}

// ============================================
// 2. HEADERS DE SEGURIDAD
// ============================================
async function checkSecurityHeaders() {
  logTitle('Headers de seguridad');
  
  try {
    const res = await axios.get(`${BASE_URL}/health`, { timeout: TIMEOUT });
    const headers = res.headers;
    
    const requiredHeaders = [
      { name: 'x-content-type-options', expected: 'nosniff' },
      { name: 'x-frame-options', expected: 'DENY' },
      { name: 'x-xss-protection', expected: '1; mode=block' },
      { name: 'strict-transport-security', expected: null },
      { name: 'content-security-policy', expected: null },
      { name: 'referrer-policy', expected: null },
    ];
    
    let passed = 0;
    
    for (const h of requiredHeaders) {
      const value = headers[h.name];
      if (value) {
        if (h.expected && value !== h.expected) {
          logWarn(`${h.name}: ${value} (esperado: ${h.expected})`);
        } else {
          logPass(`${h.name}: ${value || 'presente'}`);
          passed++;
        }
      } else {
        logFail(`${h.name}: ausente`);
      }
    }
    
    return passed / requiredHeaders.length;
    
  } catch (err) {
    logFail('No se pudieron verificar headers');
    return 0;
  }
}

// ============================================
// 3. PRUEBAS DE AUTENTICACIÓN
// ============================================
async function checkAuth() {
  logTitle('Autenticación y autorización');
  
  const tests = [
    {
      name: 'Acceso a /api/v1/tables sin token',
      url: '/api/v1/tables',
      expectedStatus: 401,
    },
    {
      name: 'Acceso a /api/v1/documents sin token',
      url: '/api/v1/documents',
      expectedStatus: 401,
    },
    {
      name: 'Login con credenciales inválidas',
      url: '/api/v1/auth/login',
      method: 'post',
      data: { email: 'fake@test.com', password: 'wrong' },
      expectedStatus: 401,
    },
    {
      name: 'Login con usuario correcto',
      url: '/api/v1/auth/login',
      method: 'post',
      data: { email: 'admin@local.com', password: 'admin1234' },
      expectedStatus: 200,
    },
  ];
  
  let passed = 0;
  
  for (const test of tests) {
    try {
      let res;
      if (test.method === 'post') {
        res = await axios.post(`${BASE_URL}${test.url}`, test.data, { timeout: TIMEOUT });
      } else {
        res = await axios.get(`${BASE_URL}${test.url}`, { timeout: TIMEOUT });
      }
      
      if (res.status === test.expectedStatus) {
        logPass(`${test.name}: OK (${res.status})`);
        passed++;
      } else {
        logFail(`${test.name}: esperado ${test.expectedStatus}, recibido ${res.status}`);
      }
    } catch (err) {
      if (err.response && err.response.status === test.expectedStatus) {
        logPass(`${test.name}: OK (${err.response.status})`);
        passed++;
      } else {
        logFail(`${test.name}: error - ${err.message}`);
      }
    }
  }
  
  return passed / tests.length;
}

// ============================================
// 4. SQL INJECTION (básico)
// ============================================
async function checkSqlInjection() {
  logTitle('SQL Injection');
  
  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "' UNION SELECT * FROM users--",
    "1' ORDER BY 1--",
    "' AND 1=1--",
  ];
  
  let vulnerable = 0;
  
  for (const payload of payloads) {
    try {
      const res = await axios.get(`${BASE_URL}/api/v1/personal/search?q=${encodeURIComponent(payload)}`, {
        timeout: TIMEOUT,
      });
      
      // Si responde con 200, podría ser vulnerable (depende del resultado)
      if (res.status === 200) {
        logWarn(`Posible SQLi con payload: ${payload}`);
        vulnerable++;
      } else {
        logPass(`Protegido contra: ${payload}`);
      }
    } catch (err) {
      // Si da error, probablemente está protegido
      logPass(`Protegido contra: ${payload}`);
    }
  }
  
  return vulnerable === 0;
}

// ============================================
// 5. PATH TRAVERSAL
// ============================================
async function checkPathTraversal() {
  logTitle('Path Traversal');
  
  const payloads = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\win.ini',
    '%2e%2e%2fetc%2fpasswd',
    '....//....//....//etc/passwd',
  ];
  
  let vulnerable = 0;
  
  // Primero necesitamos un token
  let token;
  try {
    const login = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
      email: 'admin@local.com',
      password: 'admin1234',
    });
    token = login.data.data.accessToken;
  } catch {
    logFail('No se pudo obtener token para path traversal');
    return false;
  }
  
  for (const payload of payloads) {
    try {
      const res = await axios.get(`${BASE_URL}/api/v1/documents/1/file?path=${encodeURIComponent(payload)}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: TIMEOUT,
      });
      
      if (res.status === 200) {
        logFail(`VULNERABLE a path traversal con: ${payload}`);
        vulnerable++;
      } else {
        logPass(`Protegido contra: ${payload}`);
      }
    } catch (err) {
      if (err.response && err.response.status === 404) {
        logPass(`Protegido contra: ${payload}`);
      } else {
        logWarn(`Error inesperado con ${payload}: ${err.message}`);
      }
    }
  }
  
  return vulnerable === 0;
}

// ============================================
// 6. RATE LIMITING
// ============================================
async function checkRateLimit() {
  logTitle('Rate Limiting');
  
  const requests = [];
  for (let i = 0; i < 100; i++) {
    requests.push(axios.get(`${BASE_URL}/health`, { timeout: 1000 }).catch(() => null));
  }
  
  const start = Date.now();
  const results = await Promise.all(requests);
  const duration = Date.now() - start;
  
  const rateLimited = results.filter(r => r && r.status === 429).length;
  
  if (rateLimited > 0) {
    logPass(`Rate limit activo: ${rateLimited} requests limitadas en ${duration}ms`);
    return true;
  } else {
    logWarn('No se detectó rate limiting (todas las requests pasaron)');
    return false;
  }
}

// ============================================
// 7. INFORMACIÓN SENSIBLE EN RESPUESTAS
// ============================================
async function checkInfoLeak() {
  logTitle('Fuga de información');
  
  const sensitivePatterns = [
    /stack trace/i,
    /at [a-zA-Z0-9_.]+ \(/,
    /error: /i,
    /internal server error/i,
    /password/i,
    /token/i,
    /secret/i,
    /database error/i,
  ];
  
  try {
    const res = await axios.get(`${BASE_URL}/api/v1/non-existent-route`, { timeout: TIMEOUT });
    const bodyStr = JSON.stringify(res.data || {});
    
    let leaks = 0;
    for (const pattern of sensitivePatterns) {
      if (pattern.test(bodyStr)) {
        logWarn(`Posible fuga de información: ${pattern}`);
        leaks++;
      }
    }
    
    if (leaks === 0) {
      logPass('No se detectó fuga de información en 404');
    }
    
    return leaks === 0;
    
  } catch (err) {
    if (err.response) {
      const bodyStr = JSON.stringify(err.response.data || {});
      let leaks = 0;
      for (const pattern of sensitivePatterns) {
        if (pattern.test(bodyStr)) {
          logWarn(`Posible fuga de información: ${pattern}`);
          leaks++;
        }
      }
      
      if (leaks === 0) {
        logPass('No se detectó fuga de información en error');
      }
      
      return leaks === 0;
    }
    logFail('No se pudo verificar fuga de información');
    return false;
  }
}

// ============================================
// 8. EJECUTAR ZAP SCAN (si está instalado)
// ============================================
async function runZapScan() {
  logTitle('OWASP ZAP Scan');
  
  try {
    const { stdout, stderr } = await execAsync('zap-cli --help').catch(() => ({ stdout: '', stderr: 'not found' }));
    
    if (stderr.includes('not found')) {
      logWarn('OWASP ZAP no está instalado. Omitiendo...');
      logWarn('  Para instalarlo: https://www.zaproxy.org/download/');
      return null;
    }
    
    logInfo('Ejecutando ZAP spider...');
    await execAsync(`zap-cli quick-scan --self-contained --spider -r ${BASE_URL}`);
    
    logInfo('Ejecutando ZAP active scan...');
    await execAsync(`zap-cli active-scan ${BASE_URL}`);
    
    logInfo('Generando reporte...');
    await execAsync(`zap-cli report -o ${REPORT_DIR}/zap-report.html -f html`);
    
    logPass(`Reporte ZAP guardado en ${REPORT_DIR}/zap-report.html`);
    return true;
    
  } catch (err) {
    logWarn(`Error ejecutando ZAP: ${err.message}`);
    return null;
  }
}

// ============================================
// 9. GENERAR REPORTE FINAL
// ============================================
function generateReport(results) {
  const report = {
    timestamp: new Date().toISOString(),
    target: BASE_URL,
    results,
    summary: {
      total: Object.keys(results).length,
      passed: Object.values(results).filter(r => r === true).length,
      failed: Object.values(results).filter(r => r === false).length,
      warnings: Object.values(results).filter(r => r === null).length,
    },
  };
  
  const reportPath = path.join(REPORT_DIR, `audit-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log(`\n${colors.magenta}═══════════════════════════════════════════`);
  console.log(`📊 RESUMEN DE AUDITORÍA`);
  console.log(`═══════════════════════════════════════════${colors.reset}`);
  console.log(`  ✅ Pasados: ${report.summary.passed}`);
  console.log(`  ❌ Fallidos: ${report.summary.failed}`);
  console.log(`  ⚠️  Advertencias: ${report.summary.warnings}`);
  console.log(`  📁 Reporte: ${reportPath}`);
  console.log(`${colors.magenta}═══════════════════════════════════════════${colors.reset}`);
  
  return report;
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`\n${colors.magenta}🛡️  PERSONALV5 - AUDITORÍA DE SEGURIDAD AUTOMATIZADA`);
  console.log(`═══════════════════════════════════════════${colors.reset}\n`);
  
  const alive = await checkApiAlive();
  if (!alive) {
    logFail('API no disponible. Abortando auditoría.');
    process.exit(1);
  }
  
  const results = {
    securityHeaders: await checkSecurityHeaders(),
    authTests: await checkAuth(),
    sqlInjection: await checkSqlInjection(),
    pathTraversal: await checkPathTraversal(),
    rateLimit: await checkRateLimit(),
    infoLeak: await checkInfoLeak(),
    zapScan: await runZapScan(),
  };
  
  generateReport(results);
  
  if (Object.values(results).filter(r => r === false).length > 0) {
    logFail('❌ Se encontraron vulnerabilidades críticas');
    process.exit(1);
  } else {
    logPass('✅ Auditoría completada sin vulnerabilidades críticas');
  }
}

main().catch(console.error);