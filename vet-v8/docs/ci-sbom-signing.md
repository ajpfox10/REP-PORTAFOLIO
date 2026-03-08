# CI: SBOM + Signed artifacts

## SBOM
- Generar SBOM con Syft (cyclonedx o spdx).
- Escaneo con Trivy (fs + image).

## Firma
- Firmar imagen Docker con Cosign.
- Verificar firma en deploy.

## Policy gates
- Bloquear merges si Trivy encuentra HIGH/CRITICAL (según tu política).
- Mantener allowlist de CVEs aceptadas (con expiración).
