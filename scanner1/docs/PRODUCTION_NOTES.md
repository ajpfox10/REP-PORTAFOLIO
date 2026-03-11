# Production Notes (what was added)

This repo is a **production-ready architecture scaffold** for a scanning SaaS.

## Implemented improvements
1) Strong structure: api / worker / agent / shared
2) MySQL schema in snake_case with FULLTEXT index for search
3) Redis + BullMQ queues: scan_queue, ocr_queue, ai_queue, index_queue
4) Observability: Prometheus metrics at /metrics (prom-client)
5) Security: rate limiting, JWT auth, tenant header enforcement, upload size limit
6) Storage abstraction: local provider (S3/minio stubs)
7) Antivirus hook: ClamAV INSTREAM (dev fail-open; prod should fail-closed)
8) Scan Profiles module (Feature): dpi/color/autorotate/blank-page/compression
9) Webhooks module (Feature): per-tenant subscriptions
10) Full-text search endpoint /v1/documents/search
11) Error handling: ApiError + global errorHandler + request_id

## The 3 key market features (explained)
### 1) QR Document Separation
When scanning large batches, users place a QR separator page between documents.
Pipeline detects QR and splits the batch into separate document PDFs.

Why it matters:
- saves hours of manual splitting
- reduces operational cost massively
- standard in digitization centers and hospitals

### 2) Scan Profiles
Predefined configurations for different use cases:
- invoices (grayscale, compression)
- ID (color, crop, rotate)
- medical records (OCR on, high DPI)

Why it matters:
- reduces user error
- consistent scan quality across branches
- supports compliance and retention workflows

### 3) Webhook Integrations
External systems receive events:
- scan.completed
- ocr.completed
- ai.extracted

Why it matters:
- turns your product into a platform
- integrates into ERPs / EMR / document managers
- avoids manual exports

## Extra features added (chosen)
A) Antivirus (ClamAV) hook
B) Full-text search (MySQL FULLTEXT)
C) Request tracing via x-request-id
D) AI pipeline interfaces (classify/extract) for future providers
