# Defensa Civil · Gestión de incidentes

[![Defensa Civil CI](https://github.com/ajpfox10/REP-PORTAFOLIO/actions/workflows/defensa-civil-ci.yml/badge.svg)](https://github.com/ajpfox10/REP-PORTAFOLIO/actions/workflows/defensa-civil-ci.yml)

Sistema para registrar y seguir emergencias. La central telefónica carga la llamada y marca el lugar en el mapa. El móvil en la calle informa estado, novedades y ubicación desde el celular. El tablero muestra la situación en tiempo real. Cada acción queda en una auditoría.

![Tablero](docs/screenshots/01-tablero.png)

## Funcionalidades

- **Tablero**: incidentes del día, activos, críticos, personas afectadas y evacuadas, incidentes por día (últimos 14), distribución por estado y por tipo, y una lista de activos ordenada por prioridad.
- **Incidentes**:
  - Listado con búsqueda y filtros por estado, prioridad, tipo, provincia y fechas. Los filtros quedan en la URL.
  - Detalle con datos, personas afectadas, unidades y recursos asignados, mapa e historial de estados.
  - Numeración correlativa por año (`DC-2026-000123`).
- **Central telefónica**: formulario corto pensado para cargar mientras se atiende. Se hace clic en el mapa, se elige el tipo, se describe lo que informa quien llama y se registra.
- **Móvil en calle**: el chofer elige su incidente, cambia el estado, deja una novedad y actualiza la ubicación con el GPS o tocando el mapa.
- **Mapa operativo**: incidentes agrupados por cercanía, con capas de hospitales, cuarteles de bomberos, SAME, bases de Defensa Civil y comisarías.
- **Inundaciones y temporales**: zonas afectadas por agua, con totales de personas afectadas y evacuadas.
- **Infraestructura**: alta, edición y baja de hospitales, cuarteles, bases y comisarías, con ubicación en el mapa.
- **Usuarios y auditoría**: altas, roles, activación y restablecimiento de contraseñas. Hay un registro de quién hizo qué, con los valores anteriores y los nuevos.
- Diseño responsive, modo claro y oscuro, y cambio de contraseña desde el menú del usuario.

| Central telefónica | Móvil en calle |
|---|---|
| ![Central telefónica](docs/screenshots/04-central-telefonica.png) | ![Móvil en calle](docs/screenshots/05-movil-en-calle.png) |

| Detalle de un incidente | Modo oscuro |
|---|---|
| ![Detalle](docs/screenshots/03-detalle.png) | ![Modo oscuro](docs/screenshots/08-tablero-oscuro.png) |

| Listado | Infraestructura | Celular |
|---|---|---|
| ![Incidentes](docs/screenshots/02-incidentes.png) | ![Infraestructura](docs/screenshots/06-infraestructura.png) | ![Celular](docs/screenshots/09-celular-tablero.png) |

## Roles

| Rol | Puede |
|---|---|
| Administrador | Todo, incluidos usuarios, bajas de incidentes y auditoría |
| Operador | Cargar incidentes y editar los propios; administrar infraestructura |
| Telefonista | Registrar llamadas desde la central telefónica |
| Chofer | Informar estado, novedades y ubicación desde el móvil |
| Lector | Consultar tablero, incidentes y mapas |

Los permisos se validan en el servidor. El menú solo oculta lo que cada rol no puede usar.

## Seguridad

- **Sesión en dos partes**:
  - El token de acceso dura 15 minutos y vive solo en la memoria de la página.
  - El de renovación viaja en una cookie `httpOnly` y `SameSite=Strict` que el JavaScript no puede leer. Un script inyectado no tiene de dónde robar la sesión.
- **Rotación con detección de robo**: cada renovación entrega un token nuevo e invalida el anterior. Si un token ya usado vuelve a aparecer, se cierran todas las sesiones de ese usuario.
- **Cambios de cuenta inmediatos**:
  - Si se desactiva un usuario o se le cambia el rol, el cambio rige en la siguiente solicitud, sin esperar a que venza el token.
  - Cambiar o restablecer la contraseña cierra las demás sesiones.
- **Login sin pistas**: un usuario inexistente tarda lo mismo y recibe el mismo mensaje que una contraseña incorrecta, así no se puede adivinar qué usuarios existen. Los intentos fallidos tienen un límite.
- **Siempre queda un administrador**: no se puede desactivar ni quitarle el rol al último administrador activo.
- **Validación de entrada**:
  - Se validan cuerpos, parámetros y filtros.
  - Las coordenadas deben caer dentro de Argentina.
  - La búsqueda trata `%` y `_` como texto.
  - Los errores nunca devuelven detalles internos.
- **Consistencia de datos**:
  - Altas y cambios de estado son transaccionales.
  - La numeración es atómica: dos altas simultáneas nunca reciben el mismo número.
  - Todo cambio de estado queda en el historial, venga de donde venga.
- **Cabeceras de seguridad**: Helmet en la API. CSP, `X-Frame-Options` y `Permissions-Policy` en nginx.

## Arquitectura

```
defensacivil/
├── backend/                Node.js + Express + MySQL
│   ├── src/
│   │   ├── routes/         rutas con validación (express-validator) y control de roles
│   │   ├── controllers/
│   │   ├── models/         consultas SQL parametrizadas
│   │   ├── services/       sesión y tokens
│   │   ├── middleware/     autenticación, roles, auditoría, errores, límites
│   │   └── db/migrations.js  migraciones idempotentes al arrancar
│   ├── database/init/      esquema y datos iniciales (provincias, partidos, localidades, infraestructura, demo)
│   ├── scripts/import-data.js  importador de datos oficiales (GeoRef, REFES, bomberos)
│   └── tests/              Jest + Supertest contra MySQL real
├── frontend/               React 18 + Vite + Leaflet
│   ├── src/pages/          una pantalla por archivo, cargadas bajo demanda
│   ├── src/components/     interfaz común, layout, mapas y gráficos
│   ├── src/lib/            constantes, formatos e íconos
│   └── e2e/                Playwright
├── docker-compose.dev.yml
└── docker-compose.prod.yml
```

## Cómo correrlo

### Con Docker

```bash
cp .env.example .env.prod      # completar claves y secretos
docker compose -f docker-compose.prod.yml up -d --build
```

La aplicación queda en `http://localhost:4072`. MySQL carga el esquema y los datos iniciales la primera vez.

### Sin Docker

Requisitos: Node 20 y MySQL 8.

```bash
# Base de datos
mysql -u root -e "CREATE DATABASE defensacivil CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
for f in backend/database/init/*.sql; do mysql -u root defensacivil < "$f"; done

cp .env.example .env.dev       # completar DB_* y los dos JWT_*

cd backend && npm ci && npm run dev      # API en :4071
cd frontend && npm ci && npm run dev     # interfaz en :4070
```

Usuarios de demostración (contraseña `Admin2503!`): `admin`, `operador1`, `telefonista1`, `chofer1` y `lector1`. En producción hay que cambiar esas contraseñas o borrar esos usuarios.

Si la base no tiene localidades ni infraestructura, el servidor descarga en segundo plano los datos oficiales (GeoRef y Ministerio de Salud). Para desactivarlo: `AUTO_IMPORT_DATA=false`.

### Railway

`backend/` y `frontend/` tienen su `railway.json`. Si se publican como dos servicios en dominios distintos, hay que definir dos variables en la API:

- `CORS_ORIGIN`: el dominio del frontend.
- `COOKIE_SAMESITE=none`: para que la cookie de sesión viaje entre los dos dominios.

## Tests

```bash
# API: 56 tests de integración contra MySQL (crea la base defensacivil_test)
cd backend && npm test

# Navegador: 7 flujos completos con Playwright
cd frontend && npm run e2e
```

Las credenciales de MySQL se toman de las variables `DB_*` o de `.env.test`.

Qué cubren los tests:

- **API**:
  - Sesión: cookie, rotación, reuso de tokens, renovaciones simultáneas y logout.
  - Permisos por rol, y usuarios desactivados o cambiados de rol.
  - Numeración bajo concurrencia, validaciones e historial de estados.
  - Búsqueda con comodines, CRUD de infraestructura y auditoría.
- **E2E**:
  - Login, recarga y cierre de sesión.
  - Una llamada que registra la central y luego actualiza el chofer.
  - Edición, cambio de estado, permisos del lector y alta de usuarios.

El CI de GitHub Actions corre ambos y construye las imágenes de Docker en cada cambio de esta carpeta.
