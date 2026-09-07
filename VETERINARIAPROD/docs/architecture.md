# Arquitectura

## Resumen

VetManager Pro usa un `gateway` Node/Express delante de microservicios Node. El gateway valida auth, aplica controles de seguridad, inyecta contexto de usuario y proxyea a los servicios internos con firma HMAC.

## Diagrama

```mermaid
flowchart LR
  FE[andromeda-front]
  GW[gateway]

  subgraph Services[Microservices]
    AU[auth]
    PA[patients]
    ME[medical]
    BI[billing]
    NO[notifications]
    RE[reports]
    AI[ai]
    TE[telemedicine]
    GR[grooming]
    LA[lab-imaging]
    DO[documents]
    PO[portal]
  end

  subgraph Shared[Shared Platform Layer]
    SB[serviceBase]
    RT[requestContext / tracing / versioning]
    SC[security / internalAuth / jwt / csrf / dlp]
    SE[secrets / config / validation]
    SG[serviceRegistry / serviceTargets]
  end

  subgraph Data[Data and Runtime]
    DB[(MySQL Primary)]
    RR[(MySQL Read Replica)]
    RD[(Redis)]
    MI[(MinIO)]
  end

  subgraph Obs[Observability]
    PR[Prometheus]
    GRF[Grafana]
    TP[Tempo]
    AM[Alertmanager]
  end

  EXT[Stripe / MercadoPago / OpenAI / FCM / Twilio / AFIP / Google]

  FE --> GW
  GW --> AU
  GW --> PA
  GW --> ME
  GW --> BI
  GW --> NO
  GW --> RE
  GW --> AI
  GW --> TE
  GW --> GR
  GW --> LA
  GW --> DO
  GW --> PO

  GW --> PR
  GW --> TP
  GW --> RD

  AU --> DB
  PA --> DB
  ME --> DB
  BI --> DB
  NO --> DB
  RE --> DB
  RE --> RR
  AI --> DB
  TE --> DB
  GR --> DB
  LA --> DB
  DO --> DB
  PO --> DB

  DO --> MI
  PA --> MI
  GR --> MI
  TE --> MI

  BI --> EXT
  AI --> EXT
  NO --> EXT
  TE --> EXT

  SB -.-> AU
  SB -.-> PA
  SB -.-> ME
  SB -.-> BI
  SB -.-> NO
  SB -.-> RE
  SB -.-> AI
  SB -.-> TE
  SB -.-> GR
  SB -.-> LA
  SB -.-> DO
  SB -.-> PO

  RT -.-> GW
  SC -.-> GW
  SE -.-> GW
  SG -.-> GW

  GW --> AM
  PR --> GRF
  PR --> TP
  AM --> GRF
```

## Topologia formal

- `gateway` actua como edge unico y concentra auth, versionado, DLP, CSRF, rate limiting, tracing y proxy.
- Los servicios de dominio resuelven permisos y validaciones por su propia capa shared, no en el gateway.
- `serviceBase` estandariza `health`, `metrics`, `requestId`, `traceId`, validacion OpenAPI y lifecycle.
- `serviceRegistry` y `serviceTargets` resuelven runtime, registry y DNS/health-aware selection.
- Observabilidad queda separada en Prometheus, Grafana, Tempo y Alertmanager.

## Decisiones actuales

- Escrituras van al primario MySQL.
- Lecturas pesadas de reportes pueden ir a `MYSQL_READ_*`.
- Redis se usa para revocacion de JWT, rate limiting, RBAC cache y pub/sub.
- En produccion, la verificacion de revocacion JWT falla cerrada si Redis no esta disponible.
- El discovery ya no depende de una sola fuente: runtime/DNS es la ruta principal y Redis queda como compatibilidad o metadata.
- `eventBus` usa Redis Streams con outbox persistente en MySQL para no perder eventos cuando Redis esta caido.
- Notificaciones fallidas se encolan en `notification_retry_jobs`.
- IA usa circuit breaker para no bloquear toda la consulta cuando falla el proveedor.
- Los servicios documentados hoy incluyen `documents`, que expone inbox, uploads, downloads y presigned URLs.
- La rotacion JWT puede hacerse con `JWT_KEYRING_JSON` y `kid`; `npm run secrets:jwt-rotate` genera el material para un rolling deploy. AWS Secrets Manager o Vault siguen siendo opciones validas para distribuir ese secreto, no un requisito del runtime.

## Riesgos todavia abiertos

- Sin broker dedicado de clase Kafka/RabbitMQ; el outbox MySQL + Redis Streams cubre durabilidad basica de eventos internos.
- Frontend sigue en JavaScript sin TypeScript.
- Hay E2E frontend con Playwright en `andromeda-front/tests/e2e` y job dedicado en CI.
