# Email providers

Estado real a fecha 2026-05-10 para `services/documents`.

## Providers

`gmail`
- Implementado.
- Sincroniza por Gmail API.
- Requiere `clientId`, `clientSecret` y `refreshToken` en `mail_accounts.settings_json`.

`imap`
- Implementado.
- Sincroniza por IMAP polling.
- Requiere `host`, `username` y `password` en `mail_accounts.settings_json`.

`manual`
- Implementado.
- No sincroniza remoto.
- Se usa para importacion manual o upload directo.

`outlook`
- No implementado todavia.
- La API responde `501` con codigo `DOCUMENTS_PROVIDER_NOT_IMPLEMENTED` si se intenta sincronizar.
- El conector pendiente es Microsoft Graph.

## Variables documentadas

`.env.example` y `.env.production.example` ahora incluyen variables de referencia para:

- `GOOGLE_REDIRECT_URI`
- `DOCUMENTS_GMAIL_CLIENT_ID`
- `DOCUMENTS_GMAIL_CLIENT_SECRET`
- `DOCUMENTS_GMAIL_REFRESH_TOKEN`
- `DOCUMENTS_IMAP_HOST`
- `DOCUMENTS_IMAP_PORT`
- `DOCUMENTS_IMAP_SECURE`
- `DOCUMENTS_IMAP_USERNAME`
- `DOCUMENTS_IMAP_PASSWORD`
- `DOCUMENTS_OUTLOOK_TENANT_ID`
- `DOCUMENTS_OUTLOOK_CLIENT_ID`
- `DOCUMENTS_OUTLOOK_CLIENT_SECRET`

Estas variables documentan la configuracion esperada; hoy el servicio usa `mail_accounts.settings_json` como fuente efectiva por cuenta.
