# Cómo levantar el Scanner en Windows

## Paso 1 — Crear la base de datos

Abrí una ventana de CMD y ejecutá:

```
mysql -u root -pCuernos2503 -e "CREATE DATABASE IF NOT EXISTS scanner_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

O abrí MySQL Workbench y ejecutá:
```sql
CREATE DATABASE IF NOT EXISTS scanner_saas
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

## Paso 2 — Instalar dependencias del API

Abrí CMD, navegá a la carpeta y ejecutá:

```
cd C:\Users\Administrator\Desktop\scanner_v3\api
npm install
```

## Paso 3 — Levantar el API

```
cd C:\Users\Administrator\Desktop\scanner_v3\api
npm run dev
```

Deberías ver:
```
[api] scanner-api v3 listening on :3001
[api] running migrations...
[api] migrations done
```

Las tablas se crean solas (AUTO_MIGRATE=true en el .env).

## Paso 4 — Crear el primer usuario (una sola vez)

Con el API corriendo, ejecutá en otro CMD:

```
mysql -u root -pCuernos2503 scanner_saas -e "INSERT INTO tenants (id,name,plan,api_key,is_active) VALUES (1,'Municipalidad','pro','scanner-key-local',1) ON DUPLICATE KEY UPDATE name=name; INSERT IGNORE INTO users (tenant_id,email,password_hash,role,token_version,is_active) VALUES (1,'admin@scanner.local','$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGouMcZvUjQ8KGJuJn5Qz4mfJCy','admin',0,1);"
```

Usuario: admin@scanner.local  
Contraseña: Admin1234

## Paso 5 — Obtener token para el frontend

```
curl -X POST http://localhost:3001/v1/auth/login ^
  -H "x-tenant: 1" ^
  -H "content-type: application/json" ^
  -d "{\"email\":\"admin@scanner.local\",\"password\":\"Admin1234\",\"tenant_id\":1}"
```

Copiar el `access_token` de la respuesta.

## Paso 6 — Configurar el frontend

En el `.env` del frontend (api_front), agregar:

```
VITE_SCANNER_API_URL=http://localhost:3001
VITE_SCANNER_TENANT_ID=1
VITE_SCANNER_TOKEN=pegar_el_token_aqui
```

## Paso 7 (opcional) — Levantar el Worker

El worker procesa OCR y clasificación AI en background.
Sin Redis no funciona — si no tenés Redis, el scanner igual
funciona para crear jobs y registrar documentos.

```
cd C:\Users\Administrator\Desktop\scanner_v3\worker
npm install
npm run dev
```

## Paso 8 (opcional) — Levantar el Agent

El agent corre en la PC que tiene el escáner conectado.
Para probar con escáner virtual:

```
cd C:\Users\Administrator\Desktop\scanner_v3\agent
npm install
```

Crear un archivo `.env` en esa carpeta:
```
BASE_URL=http://localhost:3001
AGENT_TENANT_ID=1
AGENT_DEVICE_KEY=device-key-del-dispositivo
SCAN_DRIVER=virtual
```

Luego:
```
npm run dev
```

## Resumen de puertos

| Servicio     | Puerto |
|-------------|--------|
| api_personal | 3000   |
| scanner API  | 3001   |
| Frontend     | 5173   |
| MySQL        | 3306   |

## Comandos Windows CMD (referencia rápida)

```
REM Levantar API scanner
cd C:\Users\Administrator\Desktop\scanner_v3\api && npm run dev

REM En otra ventana — levantar Worker (si tenés Redis)
cd C:\Users\Administrator\Desktop\scanner_v3\worker && npm run dev

REM En otra ventana — levantar Agent (virtual)
cd C:\Users\Administrator\Desktop\scanner_v3\agent && npm run dev
```
