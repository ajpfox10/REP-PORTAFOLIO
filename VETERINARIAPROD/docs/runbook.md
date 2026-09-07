# Runbook

## Baselines

- Indice central: [BASELINES_INDEX.txt](./BASELINES_INDEX.txt)
- Usalo como mapa de entrada para secretos, alerting, chaos, expansion y convenciones compartidas.

## 1. MySQL caido

- Verificar `GET /health/ready` del servicio afectado.
- Revisar conectividad a `MYSQL_HOST` y credenciales.
- Confirmar si la replica tambien esta degradada.
- Si el primario volvio, los pools reintentan warm-up al reiniciar proceso.
- Si hubo failover externo, actualizar `MYSQL_*` y `MYSQL_READ_*`.

## 2. Redis caido

- El sistema entra en modo degradado:
  - revocacion de JWT puede bloquear con `503` si `DEPENDENCY_MODE_AUTH_REVOCATION=strict`,
  - RBAC dinamico puede quedar solo con permisos base,
  - usage limits costosos pueden bloquear con `503` si estan en modo `strict`,
  - pub/sub de notificaciones se degrada y los fallos de consumo deben ir a DLQ.
- Recuperar Redis y reiniciar gateway/auth/notifications si hace falta recalentar cache.
- Verificar metricas:
  - `dependency_degradations_total`
  - `service_registry_operations_total`
  - `event_bus_messages_total`

## 3. Falla de refresh token

- Revisar cookies `refreshToken` y `accessToken`.
- Confirmar `SameSite`, `secure` y path `/api/v1/auth/refresh`.
- Buscar eventos `AUTH_005` o `AUTH_006`.
- Si hubo replay, revocar sesiones del usuario.

## 4. OpenAI/IA degradado

- Revisar estado del breaker en `/api/v1/health/services`.
- Si esta `OPEN`, esperar el timeout configurado o reiniciar el servicio AI tras resolver credenciales/red.
- El flujo clinico debe seguir sin depender del diagnostico asistido.

## 5. Notificaciones fallidas

- Consultar `GET /notifications/retries`.
- Confirmar credenciales Twilio/FCM/SMTP.
- Los jobs reintentan automaticamente con backoff.
- Si un job queda `failed`, reprocesarlo manualmente reenqueuandolo.

## 6. Disco lleno

- Limpiar `logs/` y verificar rotacion.
- Revisar tamano de backups locales.
- Verificar tablas `audit_logs`, `notification_logs`, `message_logs`.

## 7. Staging deploy fallo

- Revisar workflow `CI` en GitHub Actions.
- Verificar secretos `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY`.
- Repetir deploy desde el commit estable anterior si el ultimo quedo inconsistente.

## 8. Auth interna degradada

- Verificar `INTERNAL_SECRET` y `INTERNAL_AUTH_MODE`.
- En produccion debe operar en `strict`.
- Si aparece `INTERNAL_AUTH_UNAVAILABLE`, revisar sincronizacion de secretos entre gateway y servicios.

## 9. DLQ del event bus creciendo

- Revisar `EVENT_BUS_DLQ_STREAM`.
- Inspeccionar el `topic`, `consumer` y `error` de los mensajes fallidos.
- Corregir el consumer y reprocesar antes de vaciar la DLQ.
