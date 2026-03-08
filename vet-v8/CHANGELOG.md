# Changelog — VetPro SaaS Platform

## [10.0.0] — 2026-03-08 — Score 10/10

### Sprint 1 — Críticos

**S-01 · JWT issuer + audience** (`src/security/auth/jwtService.ts`)
- `signAccess` y `signRefresh` añaden `.setIssuer(JWT_ISSUER).setAudience(JWT_AUDIENCE)`
- `verifyAccess` y `verifyRefresh` validan `issuer` y `audience` vía jose
- Un token de staging es rechazado en producción (issuers distintos)
- Configurable: `JWT_ISSUER=vetpro:api:v1:prod` / `JWT_AUDIENCE=vetpro:client`

**S-02 · JTI blocklist en logout** (`src/security/auth/jtiBlocklist.ts`)
- `jtiBlocklist.revoke(redis, jti, exp)` — escribe `jti:deny:<jti>` con TTL = vida restante del token
- `authMiddleware` llama `jtiBlocklist.isRevoked()` en cada request autenticado (+1 Redis GET, ~0.3 ms)
- Los handlers de logout deben llamar `jtiBlocklist.revoke()` además de borrar la sesión Redis
- `ctx.jti` y `ctx.tokenExp` expuestos para facilitar el logout en los routers

**S-03 · Account lockout + rate limit por credencial** (`src/security/bruteforce/loginProtection.ts`)
- Capa 1: contador Redis por `SHA-256(tenantId:email)` → bloqueo 15 min tras 5 fallos
- Capa 2: contador Redis por IP → cooldown 60 s tras 30 fallos (resiste rotación de email)
- Capa 3: tabla `login_attempts` en DB para persistencia ante restart de Redis
- API: `checkAndThrow()`, `onSuccess()`, `onFailure()` — integrar en el handler de `/auth/login`
- Migration 0007: crea tabla `login_attempts`

**S-04 · Audit service — auditoria_log realmente escrita** (`src/security/audit/auditService.ts`)
- `auditLog(pool, entry)` — INSERT directo, fire-and-forget, nunca rompe el flujo de negocio
- `buildAuditMiddleware({pool, resource})` — middleware Express que auto-loguea mutaciones 2xx
- Integrado en `app.ts` para: users, clinical, prescripciones, internaciones, facturacion, authz
- Cumplimiento GDPR Art. 30 (registro de actividades de tratamiento)
- Migration 0007: añade columna `result` y índice `idx_ip` a `auditoria_log`

### Sprint 2 — Importantes

**S-05 · Política de contraseñas + historial** (`src/security/password/passwordPolicy.ts`)
- `validatePasswordStrength(password, email)` — mínimo 10 chars, 1 mayúscula, 1 número, 1 especial
- Bloquea top-50 contraseñas comunes sin llamada a API externa
- `checkPasswordHistory(pool, userId, tenantId, plain, bcryptCompare)` — verifica últimas 5
- `recordPasswordHistory(pool, userId, tenantId, hash)` — persiste + poda automática
- Migration 0007: crea tabla `password_history`

**S-06 · Redacción completa de logs** (`src/core/logging/logger.ts` + `pinoHttp.ts`)
- `logger.ts`: lista extendida de 18 paths redactados (passwords, tokens, códigos TOTP, tarjetas, DEKs)
- `pinoHttp.ts`: serializer personalizado que redacta `req.body` completo en rutas de auth
- `autoLogging.ignore`: silencia el ruido del health probe `/health`

**S-07 · CSP explícita + Permissions-Policy** (`src/security/headers/securityHeaders.ts`)
- Reemplaza `helmet()` default por `buildSecurityHeaders()` con CSP por nonce
- `Content-Security-Policy`: `default-src 'self'`, `script-src 'self' 'nonce-...'`, `object-src 'none'`, etc.
- `Permissions-Policy`: deshabilita camera, microphone, geolocation, payment, USB, etc.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (solo producción)
- `Referrer-Policy: strict-origin-when-cross-origin`
- Activo en TODOS los ambientes (no solo producción)

**S-08 · File uploads: magic bytes + cuota** (`src/security/files/fileValidation.ts`)
- `detectMimeFromMagic(buf)` — identifica tipo real por firma de bytes, ignora `Content-Type`
- Allowlist: JPEG, PNG, GIF, WebP, PDF, ZIP/DOCX/XLSX
- Verifica consistencia extensión ↔ magic bytes
- `checkTenantQuota(pool, tenantId, bytes, quotaBytes)` — bloquea uploads que excedan cuota
- Genera SHA-256 del archivo para almacenar en columna `files.sha256`

### Sprint 3 — Polish

**S-09 · Tokens centralizados 256 bits** (`src/security/auth/secureToken.ts`)
- `generateSecureToken()` → `crypto.randomBytes(32).toString('base64url')` — 256 bits, URL-safe
- `hashSecureToken(token)` → SHA-256 hex para almacenar en DB
- `verifySecureToken(plain, hash)` → `crypto.timingSafeEqual` — sin timing oracle
- Usar en: password reset, portal invite, cualquier link de un solo uso

**S-10 · TLS en pools MySQL** (`src/db/pools.ts`)
- `ssl: { rejectUnauthorized: true, ca: config.dbSslCa }` en `buildMasterPool` y `buildTenantPoolFactory`
- Activado cuando `DB_SSL_ENABLED=true` (variable de entorno)
- `validateEnv()` debe verificar: `NODE_ENV=production → DB_SSL_ENABLED=true`

**S-11 · Dependabot + Security CI** (`.github/`)
- `dependabot.yml`: actualizaciones semanales de npm + GitHub Actions, agrupadas por tipo
- `security.yml`: `npm audit --audit-level=high` en cada PR (bloquea HIGH/CRITICAL)
- `sbom` job: genera SBOM con `@cyclonedx/cyclonedx-npm` en cada merge a main
- `codeql` job: análisis estático de JavaScript en cada PR

**S-12 · SRI helper** (`src/security/headers/sri.ts`)
- `EXTERNAL_ASSETS[]` — registro central de todos los assets externos con su hash SHA-384
- `sriScriptTag(asset)` / `sriStyleTag(asset)` — genera tags con `integrity=` y `crossorigin=`
- `validateSriRegistry()` — llamado en startup en producción: falla rápido si falta un hash
- Integrado en `app.ts`: se ejecuta antes de cualquier middleware en `NODE_ENV=production`

---

## [9.0.0] — 2026-03-08
Ver CHANGELOG.md en el historial Git.
