# Carga de Stock Critico

Proyecto Farmacia para preparar valores de stock minimo/maximo y alimentar el script de carga web.

## Ambientes

- Dev backend: `http://localhost:4310`
- Dev frontend: `http://localhost:4410`
- Prod backend: `http://localhost:8310`
- Prod frontend: `http://localhost:8410`

Acceso desde la red:

- Dev frontend: `http://192.168.0.21:4410`
- Dev backend: `http://192.168.0.21:4310`
- Prod frontend: `http://192.168.0.21:8410`
- Prod backend: `http://192.168.0.21:8310`

## Bases MySQL

- Dev: `farmacia_stock_dev`
- Prod: `farmacia_stock_prod`

Los usuarios MySQL son exclusivos de esta app y estan configurados en `backend/.env.development` y `backend/.env.production`:

- Dev: `farmacia_stock_dev_app`
- Prod: `farmacia_stock_prod_app`

El usuario MySQL existente de personaldev se usa solo como administrador para crear bases, usuarios y permisos.

## Flujo

1. Login obligatorio.
2. Dashboard por nivel de usuario.
3. Entrar al modulo habilitado.
4. Importar `ReporteStockCritico.xls`.
5. Ver productos con guiones en stock minimo/maximo.
6. Cargar valores nuevos y guardarlos en tabla.
7. Ejecutar el script web para procesar las filas listas contra Farmacia MS.

## Roles

Roles disponibles:

- `admin`: accede a `Carga Stock Critico` y `Usuarios y permisos`.
- `operador`: puede iniciar sesion, pero no accede al modulo de stock critico.
- `lector`: puede iniciar sesion, pero no accede al modulo de stock critico.

La restriccion no es solo visual. El backend exige `admin` para:

- importaciones
- listado y edicion de items
- ejecucion e historial del script
- alta y edicion de usuarios

## Analisis Trimestral

El modulo `Analisis Trimestral` importa los reportes `ConsumosDetallados` (uno por trimestre) desde:

- `D:\FARMACIA\TRIMESTRE`

El trimestre y el anio se derivan del rango de fechas del encabezado (`Reporte de Consumo entre el 01/01/2026 y 31/03/2026` -> anio 2026, trimestre 1).

Calculo sobre el total del trimestre `T` (redondeo hacia arriba):

- `maximo` (semestral, 6 meses) = `T x 2`
- `minimo` (bimestral, 2 meses) = `T x 2 / 3`

Cada carga es unica por hash de archivo. Si ya existe una carga del mismo archivo (hash) o del mismo periodo (`sector + anio + trimestre`), se borra la anterior y se vuelve a cargar todo.

### Sondeo automatico

El backend escanea la carpeta periodicamente e importa solo los Excel nuevos (hash desconocido); los archivos ya cargados se ignoran, y un archivo que reemplaza a un periodo existente pisa la carga anterior. Las cargas automaticas quedan con `creado_por = NULL`.

La pantalla `Analisis Trimestral` ya no importa a mano: es de solo lectura. Muestra el estado del sondeo (carpeta vigilada, intervalo, ultimo control, archivos detectados y cuales ya estan en la tabla) y se autorefresca cada 60s para reflejar lo que el sondeo va cargando.

Variables de entorno (opcionales):

- `TRIMESTRE_SOURCE_DIR`: carpeta a vigilar (default `D:\FARMACIA\TRIMESTRE`).
- `TRIMESTRE_WATCH`: `on` (default) u `off` para apagar el sondeo.
- `TRIMESTRE_WATCH_INTERVAL_MS`: intervalo en milisegundos (default `60000`, minimo `10000`).

## Consumo mensual

El modulo `Consumo mensual` permite importar el reporte `ConsumoMensual`.

Tambien puede tomar los archivos directamente desde:

- `D:\FARMACIA\STOCK`

Formato esperado de esa carpeta:

- `2025.xls`
- `2026.xls`
- un archivo por anio

Desde la pantalla se puede elegir:

- Excel fuente
- `1er semestre`: Enero a Junio
- `2do semestre`: Julio a Diciembre
- `Todo el anio`: Enero a Diciembre
- `Ultimos 6 con datos`

Columnas esperadas:

- `Codigo de Articulo`
- `Nombre Generico`
- `Concentracion`
- `Presentacion`
- `Forma`
- `Sector`
- meses de `Enero` a `Diciembre`

Calculo aplicado por producto:

- Para semestres o ultimos 6 con datos:
  - `maximo_sugerido = suma de los 6 meses / 6`
  - `minimo_sugerido = suma de los 6 meses / 3`
- Para todo el anio:
  - `maximo_sugerido = suma de los 12 meses / 12`
  - `minimo_sugerido = suma de los 12 meses / 6`

Tambien guarda los meses con consumo minimo y maximo dentro de la ventana de seis meses.

El boton `Aplicar sugeridos` cruza el consumo contra la importacion seleccionada de `Stock Critico`, aplica solo productos con guiones y deja esos articulos en `stock_valores_carga.estado = listo` para que los tome el script.

## Separacion de actualizaciones

Cada Excel importado crea una `stock_importaciones.id`. Todos los productos de esa carga quedan en `stock_items.importacion_id`.

La carga de `Stock Critico` es automatica desde:

- `D:\FARMACIA\CRITICO`

El backend sondea esa carpeta e importa solo los `.xls`, `.xlsx` o `.html` nuevos (por hash en `stock_importaciones.archivo_hash`); los ya cargados se ignoran. Las cargas automaticas quedan con `creado_por = NULL` y la ruta en `stock_importaciones.source_path`. La pantalla `Carga Stock Critico` ya no importa a mano: muestra el estado del sondeo y los archivos detectados (cuales ya estan en la tabla), se autorefresca cada 60s, y desde ahi se elige la importacion a trabajar y se corre el script.

Variables de entorno del sondeo de critico (opcionales): `CRITICO_WATCH` (`on`/`off`) y `CRITICO_WATCH_INTERVAL_MS` (default `60000`, o el de trimestre si esta seteado).

Los modulos viejos `Consumo mensual` y `Comparar años` quedaron reemplazados por `Analisis Trimestral` y se sacaron del menu.

El estado operativo esta en `stock_valores_carga.estado`:

- `pendiente`: producto con guion, todavia sin valores nuevos guardados.
- `listo`: ya tiene minimo/maximo nuevo y el script puede cargarlo.
- `en_proceso`: el script lo esta intentando cargar.
- `cargado`: el script lo cargo.
- `error`: el script intento cargarlo y fallo.

Ademas `stock_valores_carga.tipo_operacion` separa el motivo:

- `carga_inicial`: producto que venia con guion y se prepara por primera vez.
- `actualizacion`: producto ya cargado que se edita otra vez, o producto sin guion que se decide actualizar manualmente.

El boton `Cargar por script` ejecuta solo la importacion seleccionada en el combo, no todas las importaciones. Cada corrida queda registrada en `stock_script_runs.importacion_id`.

## Comandos

Backend:

```powershell
cd C:\apps\farmacia\carga-stock\backend
npm run migrate:dev
npm run dev
npm run migrate:prod
npm run prod
```

Frontend:

```powershell
cd C:\apps\farmacia\carga-stock\frontend
npm run dev
npm run build
npm run prod
```

Script de carga web:

```powershell
cd C:\apps\farmacia\carga-stock\backend
npm run script:dev
npm run script:prod
```

Las credenciales del portal Farmacia MS se leen desde `backend/.env.development` y `backend/.env.production`:

- `FARMACIA_WEB_USER`
- `FARMACIA_WEB_PASSWORD`
- `FARMACIA_WEB_SECTOR`

El login del portal propio usa `ADMIN_USERNAME` y `ADMIN_PASSWORD` desde esos mismos archivos.
