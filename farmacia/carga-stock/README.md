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

## Ordenes de Compra

El modulo `Ordenes de Compra` (solo `admin`) guarda en la base las O.C. GDEBA (`DOCFI-...-GDEBA-HPDIGAMSALGP.pdf`) y arma el Excel de control de entregas.

Carga de PDF:

- `Subir PDF desde mi PC`: se eligen uno o varios PDF desde la PC que usa la pagina (por ejemplo de Descargas).
- `Importar carpeta`: toma los PDF de una carpeta del servidor (default `D:\FARMACIA\ORDENES COMPRA`, variable `ORDENES_COMPRA_DIR`), con boton `Elegir` para navegar carpetas.
- Duplicados: por contenido (hash, aunque cambie el nombre) y por numero de O.C. Un PDF ya recibido se informa como `Ya estaba`; otra copia de una O.C. ya cargada como `Duplicado`.
- Cada O.C. se valida: la suma de los renglones tiene que dar el `SubTotal` del PDF.

En la pantalla se completa por renglon: cantidad entregada, completo (SI/NO), N° de ingreso y observacion. La orden queda `COMPLETA` cuando todos sus renglones tienen SI. `Eliminar` borra la O.C. y permite volver a subir su PDF.

Excel (el usuario elige el destino):

- `Descargar a mi PC`: se baja a la carpeta Descargas de la PC que usa la pagina.
- `Guardar en una carpeta del servidor`: si ya existe un Excel con ese nombre y tiene datos cargados a mano, primero se pasan a la base (solo renglones vacios en la base) y despues se regenera.
- Hoja `CONTROL O.C.`: FECHA DE VENCIMIENTO, N° O.C + proveedor, RENGLON, CODIGO, DESCRIPCION, CANTIDAD, CANTIDAD ENTREGADA, FALTA (formula), COMPLETO, N° DE INGRESO, OBSERVACION, COMPLETA / INCOMPLETA. Hoja `ARCHIVOS`: resumen por O.C. y PDF duplicados.

Tablas (se crean solas al arrancar el backend): `oc_ordenes`, `oc_renglones`, `oc_archivos`.

Codigo: `backend/src/ordenesCompraExcel.js` (lectura de PDF y Excel con `exceljs`), `backend/src/ordenesCompraDb.js` (base) y rutas `/api/ordenes-compra/*` en `server.js`.

### Archivo en Google Drive

Ademas del Excel descargable, las O.C. se sincronizan con un archivo de Google Drive: un **Excel (.xlsx) guardado en Drive** o una **Planilla de Google** (se detecta solo). Con un .xlsx el sistema lo baja, agrega/actualiza filas y lo sube como nueva version del mismo archivo (mismo link).

Destino (se elige en la pantalla `Ordenes de Compra`, seccion 3, solo `admin`; se guarda en `oc_drive_config`, uno por ambiente):

- Archivo: se pega el link o se elige de la lista de archivos compartidos con el robot.
- Pestaña: `Una pestaña por año` (default: `O.C 2026`, `O.C 2027`... segun el año de la O.C.; si no existe se crea con encabezado) o `Siempre en la misma pestaña` (existente o nueva).
- `Probar destino` simula sin escribir: cuantos renglones se agregarian, cuantos ya estaban y se vinculan, etc.
- `Pausar` / `Reanudar` la sincronizacion automatica.
- Dev (:4410) y prod (:8410) tienen bases separadas, asi que cada uno su destino: en dev se prueba con una copia del archivo y en prod se elige el real.

Cambiar a otro archivo (boton `Cambiar destino`): elegir el archivo en `Compartidos` (si no aparece, compartirlo antes con el robot como Editor), elegir las pestañas, `Probar destino` y `Guardar destino`. El archivo anterior queda como esta (no se borra nada, deja de recibir actualizaciones); en el nuevo se vinculan las O.C. ya escritas sin duplicar y se agregan las que faltan; el backup arranca de cero (el ultimo del anterior queda en la carpeta de backup). Se puede volver al anterior igual. Se trabaja con un solo archivo a la vez. La pantalla tiene un boton `Ayuda` con estas instrucciones.

Reglas:

- Cada O.C. nueva se agrega al final de su pestaña (mismas columnas A-L + columna `ID` oculta en M). Nunca se borran filas ni se cambia el formato de las existentes.
- Si una O.C. ya estaba escrita a mano (N° de O.C. en la col B y renglon en la col C), no se duplica: se vincula y lo cargado ahi pasa a la base.
- Entregada, Completo, N° de ingreso y Observacion se cargan en la pagina o en el archivo; se sincroniza cada 60s (y al cargar/editar). Si cambio lo mismo en los dos lados, queda lo del archivo.
- Si alguien guardo el Excel mientras se sincronizaba, no se pisa: se reintenta en la vuelta siguiente.

Backup (solo cuando hay algo para escribir):

- Excel: la version anterior al cambio se marca en Drive como `Conservar para siempre` (Drive → clic derecho → Administrar versiones) y ademas se guarda una copia en `OC_BACKUP_DIR` (default `D:\FARMACIA\ORDENES COMPRA\backup`). En la actualizacion siguiente se descarta el backup anterior: siempre queda uno, el estado previo al ultimo cambio.
- Planilla de Google: copia .xlsx en el servidor + el historial de versiones propio de Google.
- `Restaurar backup` (Excel): vuelve el archivo al backup; lo que tenia queda como backup nuevo (se puede deshacer) y la sincronizacion queda en pausa.
- Cada actualizacion queda en `oc_drive_historial` (se ve en la pantalla).

Configuracion de Google (una sola vez):

1. En https://console.cloud.google.com, en el proyecto, habilitar `Google Drive API` y `Google Sheets API` y crear una `Cuenta de servicio` con una clave JSON.
2. Guardar el JSON en el servidor (`C:\apps\farmacia\secrets\google-oc.json`, fuera de la app; el deploy no lo copia) y en `backend/.env.production` / `.env.development`:

```
OC_GOOGLE_KEY_FILE=C:\apps\farmacia\secrets\google-oc.json
```

3. Compartir el archivo de Drive con el mail de la cuenta de servicio (`...@...iam.gserviceaccount.com`) como `Editor`.
4. Reiniciar el backend y elegir el destino desde la pantalla.

Codigo: `backend/src/ordenesCompraDrive.js` (sincronizacion, destino, backup) y `backend/src/ordenesCompraXlsx.js` (edicion del .xlsx).
