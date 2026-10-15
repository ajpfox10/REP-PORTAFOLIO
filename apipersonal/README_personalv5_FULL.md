# personalv5-enterprise-api
Documentación completa – **de cero a producción, sin magia**

---

## Qué es este proyecto (explicado fácil)

Este proyecto es una **API backend** hecha con:

- Node.js
- TypeScript
- Express

Su objetivo es **exponer datos y funcionalidades vía HTTP** de forma:
- ordenada
- segura
- controlada
- predecible

**Idea clave:**  
Nada se ejecuta solo.  
Nada se oculta.  
Todo se puede explicar con un dibujo.

---

## Principios del diseño (lo más importante)

Este proyecto se apoya en **5 principios**:

1. **Claridad antes que “magia”**
2. **Nada rompe lo que ya funciona**
3. **Producción solo arranca si todo está bien**
4. **Las rutas nuevas no tocan las viejas**
5. **Si algo falla → se corta antes**

Si entendés estos 5 puntos, entendés todo el sistema.

---

## Estructura general del proyecto

```
api_personal/
│
├─ src/                # Código real de la aplicación
││
│├─ app.ts             # Configuración de Express
│├─ server.ts          # Arranque del servidor
││
│├─ routes/             # Endpoints HTTP
││ ├─ index.ts          # Router principal (estable)
││ ├─ auto/             # Sistema de rutas automáticas
││ │ ├─ index.ts        # Monta las auto-routes
││ │ ├─ auto.manifest.ts# (GENERADO) lista de rutas
││ │ └─ *.routes.ts     # Rutas nuevas
││ hookup
││
│├─ controllers/        # Lógica HTTP (req / res)
│├─ services/           # Lógica de negocio
│├─ middlewares/        # Auth, validaciones, etc.
│├─ utils/              # Helpers
│└─ config/             # Configuración
│
├─ scripts/             # Scripts de control
│├─ arranque.mjs        # Wizard interactivo
│└─ routes/
│  └─ genAutoRoutesManifest.mjs
│
├─ dist/                # Build compilado (GENERADO)
├─ .cache/              # Cache interna (GENERADO)
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

## src/ (el corazón)

### app.ts
Configura Express:
- middlewares
- JSON
- seguridad básica

No levanta el servidor.

### server.ts
- Importa `app`
- Hace `listen()`
- Solo se ejecuta cuando corresponde

---

## src/routes/

### routes/index.ts (rutas “viejas”)
- Contiene rutas ya existentes
- Está probado
- **NO se toca automáticamente**

Esto evita romper producción.

---

## Sistema de auto-rutas (`src/routes/auto/`)

Este es el **sistema nuevo**, incremental.

### Qué problema resuelve
Evita:
- tocar el router principal
- conflictos
- merges peligrosos

### Cómo funciona (en palabras simples)

1. Vos creás un archivo:
   `algo.routes.ts`
2. El sistema lo detecta
3. Lo agrega automáticamente
4. Se monta sin romper nada

---

### Formato de una auto-route

```ts
export const basePath = "/algo";

export function buildRouter(ctx) {
  const router = Router();
  router.get("/", ...);
  return router;
}
```

---

### auto.manifest.ts
**NO TOCAR**

- Se genera solo
- Lista las rutas
- Siempre está tipado
- Puede estar vacío sin romper nada

---

## Scripts (quién hace qué)

### arranque.mjs
Wizard interactivo.

```bash
npm run arranque
```

Te deja elegir:
1. dev
2. tests
3. build
4. producción

Nada corre sin preguntar.

---

### genAutoRoutesManifest.mjs
- Busca `*.routes.ts`
- Genera el manifest
- Evita errores TS

Nunca corre solo.

---

## Flujo completo (diagrama mental)

```
DESARROLLO
   │
   ├─ npm run dev
   │
   ▼
BUILD
   │
   ├─ gen:routes
   ├─ tsc
   │
   ▼
PRODUCCIÓN (opción 5)
   │
   ├─ clean
   ├─ build
   ├─ start
   ├─ probe
   │
   ▼
SERVIDOR ARRANCADO
```

Si algo falla → se corta.

---

## Qué se controla antes de producción

1. TypeScript compila
2. Las rutas existen
3. No hay duplicados
4. El servidor responde
5. Health / Ready OK

---

## Preguntas clave

### ¿Las rutas viejas cuentan como auto-routes?
No.
Solo las que están en `routes/auto/*.routes.ts`.

### ¿Por qué?
Para no romper nada existente.

### ¿Puedo migrarlas?
Sí, con wrappers.

---

## Regla de oro

> “Producción no es un experimento.”

Nada entra si:
- no compila
- no responde
- no está claro

---
### Controles de calidad

- Herramientas instaladas (lint, formateo automático y hooks de Git).
- La ejecución estricta puede estar temporalmente deshabilitada.
- La activación definitiva queda para la etapa de estabilización.

---

### Tests

- Infraestructura de testing presente.
- Cobertura incompleta en algunos módulos.
- Los tests no bloquean commits ni pushes.

---

### Documentación OpenAPI

- OpenAPI funcional.
- Sin una úníca fuente de verdad definitiva.
- Convivencia de versión base y generada.

---

### Despliegue

- No incluye Docker.
- No existe guía de despliegue final.

---

### Higiene del repositorio

- Pueden existir logs.
- Pueden existir archivos generados.
- Pueden existir restos de debugging.

---

### Regla importante

Nada de lo anterior rompe el proyecto ni impide avanzar.
Lo que falta no es rehacer, es cerrar.

## Resumen final

- Proyecto **predecible**
- Arquitectura **explicable**
- Producción **protegida**
- Rutas **ordenadas**
- Cero magia

Si alguien entiende este README,
entiende el proyecto completo.

Fin.
