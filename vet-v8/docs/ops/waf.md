# WAF + Hardening perimetral - Day 1

## AWS WAF (recomendado)
- Managed rules: CommonRuleSet + KnownBadInputs + SQLi + BotControl (si aplica).
- Rate limit a nivel edge por IP (protege antes de llegar a la app).
- Geo rules si necesitás.

## /api/internal
- Mantener IP allowlist + firma HMAC (INTERNAL_API_SHARED_SECRET).
- Ideal: mTLS en ALB/NLB (opcional), y Security Group restrictivo.

## Headers / TLS
- TLS 1.2+.
- HSTS (si tenés dominio estable).
- Helmet ya está activo en la app.
