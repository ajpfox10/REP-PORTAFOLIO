# Nueva Esperanza · Supermercado online

[![Nueva Esperanza CI](https://github.com/ajpfox10/REP-PORTAFOLIO/actions/workflows/nueva-esperanza-ci.yml/badge.svg)](https://github.com/ajpfox10/REP-PORTAFOLIO/actions/workflows/nueva-esperanza-ci.yml)

Tienda online para un supermercado de barrio. Los clientes recorren el catálogo, aprovechan las ofertas de la semana, arman el carrito y hacen el pedido con envío a domicilio o retiro en el local, y pagan al recibir. El negocio administra productos, stock y pedidos desde un panel propio con métricas de ventas.

![Inicio](docs/screenshots/inicio.png)

## Funcionalidades

**Para clientes**
- Catálogo con 8 categorías, búsqueda, filtro de ofertas, orden por precio o nombre y paginación.
- Ficha de producto con precio de oferta, porcentaje de ahorro, stock disponible y productos relacionados.
- Carrito lateral que se guarda en el navegador. Los precios, el stock y el envío los confirma el servidor, y una barra muestra cuánto falta para el envío gratis.
- Checkout en tres pasos: forma de entrega, forma de pago y resumen.
- Cuenta personal con historial de pedidos, seguimiento por estado y cancelación mientras el pedido no se empezó a preparar.
- Diseño responsive, modo claro y oscuro, y navegación accesible con teclado.

**Para el negocio**
- Resumen con ventas del día y de la semana, ticket promedio, ventas por día, más vendidos y alertas de stock bajo.
- Pedidos filtrados por estado. Cada pedido avanza con un clic (preparar → despachar → entregar); si se cancela, el stock se devuelve solo.
- ABM de productos con precio de oferta, publicación y ajuste rápido de stock.

| Catálogo | Carrito |
|---|---|
| ![Catálogo](docs/screenshots/catalogo.png) | ![Carrito](docs/screenshots/carrito.png) |

| Panel: resumen | Panel: pedido |
|---|---|
| ![Resumen](docs/screenshots/admin-resumen.png) | ![Pedido](docs/screenshots/admin-pedido.png) |

| Modo oscuro | Celular |
|---|---|
| ![Modo oscuro](docs/screenshots/inicio-oscuro.png) | ![Celular](docs/screenshots/movil.png) |

## Stack

| Capa | Tecnologías |
|---|---|
| Frontend | React 18, TypeScript, Vite, React Router, Lucide |
| API | Node.js 20, Express, Zod, JWT en cookie httpOnly, bcrypt |
| Datos | MySQL 8 con migraciones versionadas |
| Calidad | Jest + Supertest contra MySQL real, Playwright, GitHub Actions |
| Despliegue | Imagen Docker única (la API sirve el frontend) y Docker Compose |

```
nuevaesperanza/
├── backend/          API Express
│   ├── migrations/   esquema SQL versionado
│   ├── scripts/      migraciones, catálogo de ejemplo y datos de demo
│   ├── src/          rutas, middlewares, servicios de precios y pedidos
│   └── tests/        tests de integración contra MySQL
├── frontend/         React + TypeScript
│   ├── src/          páginas, componentes y contextos (sesión, carrito)
│   └── e2e/          recorridos de punta a punta con Playwright
├── Dockerfile
└── docker-compose.yml
```

## Decisiones técnicas

- **El precio lo decide el servidor.** El carrito vive en el navegador para que sea instantáneo, pero el presupuesto y el pedido se recalculan siempre con los precios y el stock de la base. Un cliente no puede cambiar lo que paga editando el carrito.
- **Sin sobreventa.** El pedido se crea en una transacción que bloquea las filas de los productos (`SELECT … FOR UPDATE`, en orden de id para evitar deadlocks). Si dos personas compran a la vez la última unidad, una se queda con ella y la otra recibe un aviso para revisar su carrito. Hay un test que lo comprueba.
- **Plata en centavos.** Los totales se calculan en centavos enteros para no arrastrar errores de punto flotante.
- **Precios congelados en el pedido.** Cada línea guarda el nombre, el precio pagado y el precio de lista del momento, así el historial no cambia cuando cambian los precios.
- **El stock vuelve al cancelar.** Cancelar devuelve el stock reservado dentro de la misma transacción.

## Seguridad

- Sesión en cookie `httpOnly` y `SameSite=Strict`: el JavaScript de la página nunca ve el token.
- Protección CSRF con double-submit y comparación en tiempo constante.
- Contraseñas con bcrypt (costo 12) y política mínima. El login responde lo mismo, y tarda lo mismo, exista o no el email.
- Límite de intentos en registro y login; límite general por IP en la API.
- Validación de toda entrada con Zod, consultas siempre parametrizadas y comodines de `LIKE` escapados.
- Headers de seguridad con Helmet y Content Security Policy estricta, sin scripts de terceros (la tipografía se sirve desde el mismo dominio).
- Los errores internos nunca llegan al cliente: el usuario ve un mensaje genérico y el detalle queda en el log del servidor.
- El panel de administración verifica el rol en el servidor, y el usuario se vuelve a leer de la base en cada pedido para que una baja o un cambio de rol tengan efecto inmediato.

## Cómo correrlo

### Con Docker

```bash
docker compose up --build
```

Abrí http://localhost:4000. El administrador inicial es `admin@nuevaesperanza.test` / `Admin.Nueva2026`; cambialo con las variables `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

### En desarrollo

Requisitos: Node.js 20 y MySQL 8.

```bash
# API
cd backend
cp .env.example .env        # completar DB_*, SESSION_SECRET y ADMIN_*
npm install
npm run migrate
npm run seed:demo           # catálogo, administrador y pedidos de ejemplo
npm run dev                 # http://localhost:4000

# Frontend (otra terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Con `seed:demo` también se crean clientes de prueba, por ejemplo `lucia@cliente.test` / `Cliente.2026`.

### Tests

```bash
cd backend && npm test      # API contra la base nueva_esperanza_test (se recrea en cada corrida)
cd frontend && npm run e2e  # recorridos en el navegador contra la API real
```

## Licencia

Proyecto de portafolio. Las marcas de los productos son ficticias.
