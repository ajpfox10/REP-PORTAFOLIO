# Verificacion de Cobertura de Salud

Proyecto monolitico con backend C# ASP.NET Core, frontend Vue y MySQL.

## Puertos

- Dev backend: `http://localhost:4510`
- Dev frontend: `http://localhost:4610`
- Prod monolitico: `http://localhost:8510`
- Prod red: `http://192.168.0.21:8510`

## Bases MySQL

- Dev: `cobertura_salud_dev`
- Prod: `cobertura_salud_prod`

El usuario MySQL de `personaldev` se usa solo para crear bases, usuarios y permisos. La app usa usuarios propios:

- Dev: `cobertura_salud_dev_app`
- Prod: `cobertura_salud_prod_app`

## Roles

- `admin`: consulta, ve historial general y administra usuarios/roles.
- `user`: consulta y ve sus propias consultas.

## Tablas

- `usuarios`
- `consultas`
- `consulta_pasos`
- `auditoria`

Cada consulta guarda fecha/hora, usuario, dato ingresado, pasos recorridos, texto detectado, estado por pagina y decision final.

## Comandos

Backend dev:

```powershell
cd C:\apps\cobertura-salud\backend
dotnet run --no-build
```

Frontend dev:

```powershell
cd C:\apps\cobertura-salud\frontend
npm run dev
```

Build frontend dentro del backend:

```powershell
cd C:\apps\cobertura-salud\frontend
npm run build
```

Produccion monolitica:

```powershell
cd C:\apps\cobertura-salud\backend
$env:ASPNETCORE_ENVIRONMENT='Production'
dotnet run --no-build
```
