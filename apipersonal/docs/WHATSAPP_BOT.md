# Bot de WhatsApp (API oficial de Meta) — guía de vinculación

El bot **solo responde** a quien escribe, así que es gratis dentro de las 24 h. Si lo atienden
desde la app o desde WhatsApp Web, también es gratis.

```
Persona escribe → Meta → ngrok → servidor público (/wa/webhook): valida firma y ANOTA en whatsapp_bot_entrada
                                   API interna (cada 2 s): lee la bandeja, valida DNI + celular, arma el PDF /
                                   encola el reseteo → Meta → persona
```

Menú: **1** certificado IOMA (PDF) · **2** resetear clave de Gestiones Personales (robot de la Intranet) ·
**3** hablar con una persona (el bot se calla 12 h en ese chat; `MENU` lo reactiva) · **4** certificado de trabajo (PDF).

Código: `src/services/whatsappWebhook.ts` (lo único que corre en el servidor público) +
`src/services/whatsappBot.ts` (todo lo demás, en la API). Servidor público: `src/publico/turnosPublicoServer.ts`,
puerto 3010 dev / 3011 prod; es lo único que se expone a internet.
Túnel dev: pm2 `wa-tunel-dev` (`C:\ngrok\wa-tunel-dev.config.js`) → https://ribcage-emu-verbally.ngrok-free.dev → 3010.

## Seguridad: el servidor público casi no tiene permisos
El servidor público usa su propio usuario de MySQL (`wa_publico_dev` / `wa_publico`, variables
`PUBLICO_DB_USER` / `PUBLICO_DB_PASSWORD`). Solo puede:
- **anotar** (INSERT, sin poder leer) el cuerpo del webhook en `whatsapp_bot_entrada`;
- leer la vista `v_publico_wa_claves` (clave secreta de la app + token de verificación; NO el token de envío);
- leer la vista `v_publico_agenda_agente` (nombre, ley y ocupación SOLO de quienes recibieron un enlace de turno)
  y las tablas de la agenda (`agenda_*`, `feriados`, columnas puntuales de `gcal_eventos` y `jubilacion_citas`).

No puede leer `personal`, `agentes`, celulares, pedidos, chats, mensajes ni la config del bot, ni crear/modificar tablas.
Las vistas y la bandeja las crea la API al arrancar (también en `scripts/migrations/134__acceso_publico_minimo.sql`).

**Crear el usuario** (pide la clave de root de MySQL; genera la clave nueva, aplica los permisos, comprueba que NO
pueda leer `personal` y recién ahí la guarda):
El administrador (root) está en el `.env` del scanner; pasándolo como 2do parámetro no se pide ni se muestra la clave.
- dev (YA HECHO 16/11): `scripts\crear_usuario_publico.cmd dev C:\apps\personaldev\scanner1\.env` → `.env` de dev →
  `pm2 restart turnos-publico-dev --update-env`
- prod (después del deploy): `scripts\crear_usuario_publico.cmd prod C:\apps\personalprod\scanner1-prod\.env` → `secretos-prod.env` + `.env` de prod →
  `pm2 restart turnos-publico-prod`. Hasta entonces prod hereda `PUBLICO_DB_USER=` vacío (secretos-prod.env) y usa el
  usuario de la API, avisándolo en el log.

---

## 1. Cuenta de Facebook
Con email del trabajo y datos reales. Solo sirve para entrar a Meta: no hace falta publicar nada.

## 2. Portafolio empresarial
business.facebook.com → **Crear portafolio** (nombre del hospital o del área).

## 3. App de desarrollador
developers.facebook.com → **Mis apps → Crear app** → caso de uso **Otro → Business** → elegir el portafolio
→ en la app, **Agregar producto → WhatsApp → Configurar**.

## 4. Conectar el número Business (coexistencia)
WhatsApp → **Configuración de la API → Agregar número de teléfono** → elegir **conectar una app
WhatsApp Business existente** → seguir los pasos y escanear el QR desde el celular
(WhatsApp Business actualizado). El número sigue funcionando en el celular y en WhatsApp Web.
Revisar en ese paso qué funciones de la app quedan disponibles (WhatsApp Web).

## 5. Datos para el .env
| Dato | Dónde está | Variable |
|---|---|---|
| Phone Number ID | WhatsApp → Configuración de la API | `WA_PHONE_NUMBER_ID` |
| App Secret | Configuración de la app → Básica → Clave secreta | `WA_APP_SECRET` |
| Token permanente | Configuración del negocio → Usuarios del sistema → Agregar (Admin) → Asignar activos (la app y la cuenta de WhatsApp) → **Generar token** con permisos `whatsapp_business_messaging` y `whatsapp_business_management` | `WA_TOKEN` |
| Token de verificación | **Lo inventamos nosotros** (una palabra larga cualquiera) | `WA_VERIFY_TOKEN` |

**Lo más simple: cargarlos en la app → Herramientas → 🤖 Bot de WhatsApp → 🔌 Conexión con Meta**
(ahí también se genera el token de verificación, se arma la URL del webhook y está el botón "Probar conexión").
Menú, textos, horario, encendido/apagado, pedidos y conversaciones se manejan desde esa misma página.

Alternativa: agregarlos al `.env` de apipersonal (lo cargado en la página tiene prioridad):
```
WA_TOKEN=...
WA_PHONE_NUMBER_ID=...
WA_APP_SECRET=...
WA_VERIFY_TOKEN=...
# opcional
WA_BOT_HUMANO_HORAS=12
WA_BOT_TEXTO_CLAVE=🔑 *Clave del sistema de sueldos*\n\nPasos: ...\n\nSi no podés, escribí *3*.
```
Sin `WA_TOKEN`/`WA_PHONE_NUMBER_ID` (o con `WA_BOT_SIMULAR=1`) el bot **no envía nada**: registra las
respuestas en `whatsapp_bot_mensajes` con estado SIMULADO y guarda los PDF en `logs/whatsapp-bot/`.
Después de cambiar el .env hay que reiniciar el servidor público.

## 6. ngrok (dirección pública gratis)
Ojo: el túnel de Cloudflare que ya usa la Agenda de turnos (turnos-tunel-prod) es **temporal**: cambia de
dirección cada vez que se reinicia, y habría que volver a cargarla en Meta. Para el bot conviene una dirección fija.

1. ngrok.com → crear cuenta (email, sin Facebook) → **Domains** → reclamar el dominio fijo gratis.
2. Instalar ngrok y cargar el authtoken: `ngrok config add-authtoken <TOKEN>`
3. Levantar el túnel al servidor público: `ngrok http --url=<tu-dominio>.ngrok-free.app 3010`
   (3010 = dev, 3011 = prod).

## 7. Webhook en Meta
App → WhatsApp → **Configuración** → Webhook:
- URL de devolución de llamada: `https://<tu-dominio>.ngrok-free.app/wa/webhook`
- Token de verificación: el mismo `WA_VERIFY_TOKEN`
- **Verificar y guardar** → en *Campos del webhook* suscribirse a **messages**.

## 8. Probar
Desde otro celular escribir "hola" al número Business → tiene que llegar el menú.
Si no llega nada:
- revisar el log del servidor público (`wabot` en los mensajes);
- si Meta no llama al webhook con mensajes reales, pasar la app a modo **Activo/Live**
  (pide una URL de política de privacidad);
- si la respuesta da error de Meta, queda en `whatsapp_bot_mensajes` (estado ERROR, columna error).

## Identificación: SIEMPRE DNI + celular registrado
Toda opción "solo agentes" (certificado IOMA, reseteo de clave, textos marcados así) pide el **DNI** en el chat y
solo sigue si el número desde el que escriben es uno de los celulares cargados en `personal.telefono` de ese DNI
y el agente está activo. Nunca se identifica solo por teléfono ni solo por DNI. Si no coincide, no se dice si
falló el DNI o el celular; a los 3 intentos (configurable) el chat queda bloqueado 60 min (configurable).
Se pide el DNI cada vez que elige una de esas opciones.

## Reseteo de clave de Gestiones Personales (opción 2)
Acción `RESET_GP`: el bot pide confirmación ("SI"), anota el pedido en `gp_reset_cola` y el API (vigía cada
20 s) lanza el robot **intranet_gp_resetear** (`scripts/resetear_clave_gp.py`, página Robots). El robot busca la
cuenta por DNI en Administrador de Gestiones Personales → "Resetear clave" (si está A CONFIRMAR, la confirma):
la clave provisoria queda en el **número de documento**. Al terminar, el bot le avisa a la persona.
- Solo agentes activos identificados por su celular; un reseteo por día por DNI.
- De verdad SOLO con la base de prod (`personalv5`); en dev simula aunque el comando diga `--resetear`.
- Usa el perfil de Chrome de la Intranet y espera su turno como los demás robots de la Intranet.
- Para que el robot abra Chrome en la sesión de Windows, crear su tarea desde la página Robots
  (cualquier horario sirve: el bot la dispara con "ejecutar ahora"; el horario queda como barrido de respaldo).
- Seguimiento: pestaña 🔑 Reseteos de clave (estado, detalle del robot, si se avisó, reintentar).

## Pendiente
- Correr `scripts\crear_usuario_publico.cmd` (dev) y, después del deploy, con `prod`.
- Los certificados (IOMA y de trabajo) llevan **firma y sello del funcionario certificante**: el PDF sale sin firmar.
- El primer PDF después de reiniciar la API puede tardar ~1 min (Word arrancando).
- Deploy (API + servidor público) y túnel a prod (3011).
