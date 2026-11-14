// src/publico/turnosPublicoServer.ts
// Servidor PÚBLICO de la Agenda de turnos: es lo ÚNICO que se publica en internet (túnel de Cloudflare).
// Proceso aparte de la API (otro puerto, escucha por defecto solo en 127.0.0.1): no monta nada del
// resto del sistema, solo la página del turno y 4 rutas que trabajan con el token del enlace.
//
//   GET  /t/:token                    → página (HTML) que abre el agente desde WhatsApp
//   GET  /api/t/:token                → estado del enlace (nombre del agente, agenda, turno si ya tiene)
//   GET  /api/t/:token/disponibles    → días y horarios libres
//   POST /api/t/:token/reservar       → { fecha, hora, telefono? }
//   POST /api/t/:token/cancelar
//
// Variables (.env): TURNOS_PUBLICO_PORT (3010), TURNOS_PUBLICO_HOST (127.0.0.1).
// Arranque: dev `npx ts-node --transpile-only src/publico/turnosPublicoServer.ts`, prod `node dist/publico/turnosPublicoServer.js`.

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createSequelize } from '../db/sequelize';
import { logger } from '../logging/logger';
import { PAGINA_HTML, PAGINA_JS, PAGINA_CSS } from './turnoPagina';
import {
  AgendaError, ensureAgendaTablas, estadoEnlace, disponiblesEnlace, reservarEnlace, cancelarEnlace, tokenValido, icsEnlace,
} from '../services/agendaTurnos';

// prod 3011 / dev 3010 sin depender de variables de pm2 (el deploy regenera el .env de prod desde el de dev)
const PORT = Number(process.env.TURNOS_PUBLICO_PORT || (process.env.NODE_ENV === 'production' ? 3011 : 3010));
const HOST = process.env.TURNOS_PUBLICO_HOST || '127.0.0.1';

const sequelize = createSequelize();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// IP real del visitante: el túnel de Cloudflare la manda en cf-connecting-ip
const ipDe = (req: Request) => String(req.headers['cf-connecting-ip'] || req.ip || 'x');
const limite = (windowMs: number, max: number, extra: Partial<Parameters<typeof rateLimit>[0]> = {}) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false, keyGenerator: ipDe,
  handler: (_req, res) => res.status(429).json({ ok: false, error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' }),
  ...extra,
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"], objectSrc: ["'none'"],
    },
  },
  referrerPolicy: { policy: 'no-referrer' },   // el token va en la URL
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));
app.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Cache-Control', 'no-store'); next(); });
app.use(limite(60_000, 120));
app.use(express.json({ limit: '4kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
app.get('/t.js', (_req, res) => res.type('application/javascript').send(PAGINA_JS));
app.get('/t.css', (_req, res) => res.type('text/css').send(PAGINA_CSS));
app.get('/t/:token', (req, res) => {
  if (!tokenValido(req.params.token)) return res.status(404).type('text/plain').send('Enlace inválido');
  return res.type('html').send(PAGINA_HTML);
});

// Enlaces inexistentes: se cuentan solo los fallos (para frenar a quien prueba tokens al azar)
const fallos = limite(15 * 60_000, 30, { skipSuccessfulRequests: true });
const acciones = limite(10 * 60_000, 15);

const responder = (fn: (req: Request) => Promise<any>) => async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await ensureAgendaTablas(sequelize);
    return res.json({ ok: true, data: await fn(req) });
  } catch (err: any) {
    if (err instanceof AgendaError) return res.status(err.status).json({ ok: false, error: err.message, code: err.code });
    logger.error({ msg: 'turnos_publico', path: req.path, error: err?.message });
    return res.status(500).json({ ok: false, error: 'No se pudo completar. Probá de nuevo en un rato.' });
  }
};

app.get('/api/t/:token', fallos, responder(req => estadoEnlace(sequelize, req.params.token)));
app.get('/api/t/:token/disponibles', fallos, responder(req => disponiblesEnlace(sequelize, req.params.token)));
app.get('/api/t/:token/turno.ics', fallos, async (req, res) => {
  try {
    const ics = await icsEnlace(sequelize, req.params.token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="turno.ics"');
    return res.send(ics);
  } catch (err: any) {
    return res.status(err instanceof AgendaError ? err.status : 500).type('text/plain').send('No hay un turno para agregar');
  }
});
app.post('/api/t/:token/reservar', fallos, acciones,
  responder(req => reservarEnlace(sequelize, req.params.token, req.body?.fecha, req.body?.hora, req.body?.telefono)));
app.post('/api/t/:token/cancelar', fallos, acciones, responder(req => cancelarEnlace(sequelize, req.params.token)));

app.use((_req, res) => res.status(404).type('text/plain').send('No encontrado'));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ msg: 'turnos_publico error', error: err?.message });
  res.status(err?.status === 400 ? 400 : 500).json({ ok: false, error: 'Pedido inválido' });
});

(async () => {
  await sequelize.authenticate();
  await ensureAgendaTablas(sequelize);
  app.listen(PORT, HOST, () => logger.info({ msg: `Turnos público escuchando en http://${HOST}:${PORT}` }));
})().catch((err) => {
  logger.error({ msg: 'turnos_publico no arrancó', error: err?.message });
  process.exit(1);
});
