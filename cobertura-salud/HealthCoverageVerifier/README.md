# HealthCoverageVerifier

Proyecto unificado que integra:

- **Backend ASP.NET Core** para verificación de cobertura de salud (SSS, ARCA, ANSES, SISA/PUCO, IOMA, PAMI, Servicio Doméstico).
- **Motor OCR con Tesseract** para resolución automática de captchas.
- **Automatización con Playwright** para navegación asistida por operador.

## Estructura

```
HealthCoverageVerifier/
├── Program.cs                    # Entry point
├── appsettings.json
├── .env.development              # Variables de entorno (ejemplo)
├── HealthCoverageVerifier.csproj # Proyecto
├── Models/
│   ├── CaptchaModels.cs        # CaptchaResult, OcrResult
│   ├── PatientInput.cs
│   ├── UserModels.cs
│   ├── RequestModels.cs
│   ├── ConsultaModels.cs
│   ├── PasoModels.cs
│   └── SssModels.cs
├── Services/
│   ├── CaptchaSolverService.cs  # OCR pipeline
│   ├── ImageProcessor.cs        # Preprocesamiento de imágenes
│   ├── OcrEngine.cs             # Tesseract wrapper
│   ├── SssService.cs            # Consulta asistida SSS
│   └── CoverageWorkflow.cs      # Workflow Playwright
├── Data/
│   └── Db.cs                    # MySQL + migraciones
└── Helpers/
    ├── AppSettings.cs
    └── AuthHelpers.cs
```

## Requisitos

- .NET 8 SDK
- MySQL 8.0+
- Google Chrome (para Playwright)
- Tesseract OCR + datos de entrenamiento (`tessdata/eng.traineddata`)

## Instalación

1. Clonar y entrar al directorio.
2. Copiar `.env.development` y completar las variables.
3. Crear carpeta `tessdata/` y descargar `eng.traineddata`.
4. Restaurar paquetes:
   ```bash
   dotnet restore
   ```
5. Ejecutar:
   ```bash
   dotnet run
   ```

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Login JWT |
| GET | `/api/auth/me` | Usuario actual |
| GET | `/api/usuarios` | Listar usuarios (admin) |
| POST | `/api/usuarios` | Crear usuario (admin) |
| PATCH | `/api/usuarios/{id}` | Editar usuario (admin) |
| POST | `/api/consultas` | Crear consulta de cobertura |
| GET | `/api/consultas` | Listar consultas |
| GET | `/api/consultas/{id}` | Ver consulta |
| PATCH | `/api/consultas/{id}/decision` | Cerrar consulta |
| POST | `/api/sss/iniciar` | Iniciar sesión SSS (devuelve captcha) |
| POST | `/api/sss/resolver` | Resolver SSS con código captcha |
| POST | `/api/captcha/solve` | Resolver captcha vía OCR |

## Notas

- El workflow de Playwright abre Chrome en modo visible (`Headless = false`) para que el operador pueda interactuar con captchas y logins.
- El endpoint `/api/captcha/solve` permite subir una imagen de captcha y obtener el texto vía OCR (Tesseract) como utilidad adicional.
