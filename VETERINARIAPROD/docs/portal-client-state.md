# Portal cliente

Estado real a fecha 2026-05-10.

## Lo que ya existe

- Login propio para dueños de mascotas.
- Sesión con `accessToken` y `refreshToken` en el frontend.
- Consulta de mascotas.
- Consulta de turnos.
- Consulta y pago de facturas.
- Consulta de notificaciones.
- Flujo de telemedicina.
- Registro FCM.

## Lo que no es cierto afirmar hoy

- No es solo una pantalla informativa.
- No está limitado a “ver datos”; tiene acciones operativas reales.

## Contratos usados

- `portal/auth/login`
- `portal/auth/register`
- `portal/auth/refresh`
- `portal/me`
- `portal/pets`
- `portal/appointments`
- `portal/invoices`
- `portal/notifications`
- `portal/telemedicine`

## Riesgos operativos

- La autenticación del portal depende de refresh token válido.
- El flujo de pago depende de MercadoPago y del estado de la factura.
- Los datos mostrados dependen del scoping del backend por organización y dueño.
