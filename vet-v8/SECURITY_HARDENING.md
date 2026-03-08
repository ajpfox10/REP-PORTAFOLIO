# Security hardening applied

## Main changes
- Strict CORS in production, driven by `CORS_BASE_DOMAIN` and `CORS_ALLOWED_ORIGINS`
- Canonical tenant host validation
- `/metrics` protected with IP allowlist plus dedicated token
- Stateful access-token validation against Redis session state and DB token version
- Password reset requires MFA or recovery code when MFA is enabled
- Strong password policy controlled by env
- Internal API HMAC now includes nonce-based anti-replay
- Internal API can require private network access
- File upload presign flow now validates mime type, purpose, size, and optional sha256
- RLS shared-row behavior is now controlled by `RLS_ALLOW_SHARED_ROWS`
- Support impersonation now requires actor, ticket, long reason, and shorter TTL
- Added tenant migration `0005_security_hardening.sql`

## Important env knobs
See `.env.example` for the full set. The critical ones are:
- `CORS_BASE_DOMAIN`
- `CORS_ALLOWED_ORIGINS`
- `METRICS_PROTECT`
- `METRICS_AUTH_TOKEN`
- `METRICS_IP_ALLOWLIST`
- `INTERNAL_API_SHARED_SECRET`
- `INTERNAL_API_REQUIRE_NONCE`
- `INTERNAL_API_NONCE_TTL_SECONDS`
- `AUTH_PASSWORD_MIN_LENGTH`
- `AUTH_REQUIRE_MFA_ON_RESET`
- `AUTH_REQUIRE_STATEFUL_ACCESS_SESSION`
- `FILES_ALLOWED_MIME_TYPES`
- `FILES_ALLOWED_PURPOSES`
- `FILES_MAX_UPLOAD_BYTES`
- `FILES_REQUIRE_SHA256`
- `RLS_ALLOW_SHARED_ROWS`

## Notes
- Existing tenants should run the new tenant migration before using the hardened file upload metadata columns.
- Password reset links now use URL fragment `#token=...` to reduce token leakage in logs and referrers.
- The codebase still has unrelated pre-existing compile/runtime debt outside the hardened areas; this pass focused on the security controls requested.
