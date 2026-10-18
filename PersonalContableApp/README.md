# Personal Contable

[![Personal Contable CI](https://github.com/ajpfox10/REP-PORTAFOLIO/actions/workflows/personal-contable-ci.yml/badge.svg)](https://github.com/ajpfox10/REP-PORTAFOLIO/actions/workflows/personal-contable-ci.yml)

Aplicación de escritorio para Windows que administra la planta de personal de una empresa: altas, bajas y modificaciones, búsqueda, sueldos y una **liquidación estimada** con aportes, neto a cobrar y costo laboral. Está hecha en **C# con WPF sobre .NET 8**, con arquitectura MVVM.

## Funcionalidades

- **Resumen** de la planta: cantidad de personas, masa salarial bruta, neto a pagar, costo laboral, sueldo promedio y antigüedad promedio.
- **Listado** ordenable con búsqueda que no distingue acentos ni mayúsculas ("martinez" encuentra "Martínez"), filtros por puesto y categoría, y contador de resultados.
- **Formulario lateral** de alta y edición, con validación mientras se escribe y el mensaje de error debajo de cada campo:
  - CUIL con verificación del dígito verificador y sin duplicados.
  - Código postal de 4 dígitos o CPA (`C1425ABC`).
  - Las 24 provincias, fecha de ingreso con calendario e importes con formato argentino (`850.000,50`).
- **Vista previa de la liquidación** mientras se escribe el sueldo: aportes de jubilación (11 %), Ley 19.032 (3 %) y obra social (3 %), neto a cobrar y costo para la empresa. La contribución patronal y el tope de la base imponible son configurables.
- **Distribución** de la masa salarial por puesto y por categoría.
- **Exportación a CSV** lista para Excel en español: separador `;`, coma decimal, acentos bien codificados y protección contra inyección de fórmulas.
- **Atajos de teclado**:

  | Atajo | Acción |
  |---|---|
  | `Ctrl+N` | Nueva persona |
  | `Ctrl+S` | Guardar |
  | `Ctrl+E` | Exportar |
  | `Enter` o doble clic | Editar la persona seleccionada |
  | `Supr` | Eliminar la persona seleccionada |
  | `Esc` | Cerrar el formulario |

## Datos seguros

- Los datos se guardan en `%LOCALAPPDATA%\PersonalContable\personal.json`, no junto al `.exe`, donde Windows puede no dar permiso de escritura.
- **Escritura atómica**: primero se escribe un archivo temporal y después se reemplaza el original, dejando una copia `.bak`. Si se corta la luz a mitad del guardado, el archivo anterior queda intacto.
- Si el archivo está dañado **no se sobrescribe**: se guarda una copia con fecha y hora y la app avisa.
- Si falla el guardado (disco lleno, archivo bloqueado), el cambio se deshace en pantalla, así lo que se ve coincide con lo guardado.
- **Migración automática** desde la versión anterior: lee el archivo viejo, convierte el año de ingreso en fecha y conserva todos los registros.

## Arquitectura

```
PersonalContableApp/
├── src/
│   ├── PersonalContable.Core/     net8.0 — sin dependencias de Windows
│   │   ├── Modelos/               Personal, puestos, categorías, provincias
│   │   ├── Servicios/             CUIL, validaciones, liquidación, resumen, CSV
│   │   ├── Datos/                 almacenamiento JSON con migración
│   │   └── ViewModels/            lógica de pantalla (MVVM con CommunityToolkit.Mvvm)
│   └── PersonalContableApp/       net8.0-windows — WPF
│       ├── Vistas/                ventana principal (XAML)
│       ├── Temas/                 estilos, colores y plantillas
│       ├── Conversores/           conversores de binding
│       └── Servicios/             diálogos de Windows
└── tests/
    └── PersonalContable.Tests/    xUnit
```

Toda la lógica vive en `PersonalContable.Core`, que no depende de WPF. La interfaz solo enlaza datos y comandos. Los diálogos (confirmar, informar, elegir archivo) llegan a los ViewModels a través de una interfaz (`IDialogos`), así que la lógica de pantalla se prueba sin abrir ventanas y los tests corren en cualquier sistema operativo.

## Cómo correrlo

Requisitos: Windows 10 u 11 y el [SDK de .NET 8](https://dotnet.microsoft.com/download/dotnet/8.0). También se puede abrir `PersonalContableApp.sln` con Visual Studio 2022.

```bash
dotnet run --project src/PersonalContableApp
```

Para generar un ejecutable:

```bash
dotnet publish src/PersonalContableApp -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o publicado
```

Cada corrida del CI deja el ejecutable listo para descargar en la pestaña *Actions*.

## Tests

```bash
dotnet test tests/PersonalContable.Tests
```

Hay 49 tests sobre el validador de CUIL, la liquidación (redondeo y tope), las validaciones del formulario, la persistencia (escritura atómica, archivo dañado, migración del formato anterior), la exportación CSV y los ViewModels (alta, edición, baja con confirmación, búsqueda y filtros, y recuperación ante errores de guardado).

## Aclaración

La liquidación es una **estimación** con las alícuotas generales del régimen de relación de dependencia. No contempla convenios colectivos, adicionales ni deducciones particulares, y no reemplaza la liquidación oficial.
