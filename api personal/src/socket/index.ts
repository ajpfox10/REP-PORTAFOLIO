// src/socket/index.ts
import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { verifyAccessToken } from '../auth/jwt';
import { logger } from '../logging/logger';
import { env } from '../config/env';
import { registerDocumentHandlers } from './handlers/documentos';
import { registerPedidoHandlers } from './handlers/pedidos';
import { registerEventoHandlers } from './handlers/eventos';
import {
  wsConnectionsTotal,
  wsConnectionsActive,
  wsMessagesReceived,
  wsMessagesSent,
  wsEventsEmitted,
  startWebSocketMetricsCollection,
} from './metrics';

export let io: SocketServer | null = null;

// Eventos internos de Socket.IO que NO deben contabilizarse en métricas de negocio
const INTERNAL_EVENTS = new Set([
  'connect', 'disconnect', 'disconnecting',
  'error', 'connect_error', 'connect_timeout',
  'ping', 'pong', 'reconnect', 'reconnect_attempt',
  'reconnect_error', 'reconnect_failed', 'newListener',
  'removeListener',
]);

export function initSocketServer(httpServer: HttpServer) {
  if (io) return io;

  io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const o = origin.toLowerCase();
        const deny = env.CORS_DENYLIST.map((x) => x.toLowerCase());
        if (deny.includes(o)) return cb(new Error('CORS blocked'));
        if (env.CORS_ALLOWLIST.length > 0) {
          const allow = env.CORS_ALLOWLIST.map((x) => x.toLowerCase());
          if (!allow.includes(o)) return cb(new Error('CORS not allowed'));
        }
        return cb(null, true);
      },
      credentials: true,
    },
  });

  // Middleware de autenticación
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token || socket.handshake.headers.authorization;
      if (!token) return next(new Error('Authentication required'));

      const bearer = String(token).replace(/^Bearer\s+/i, '');
      const claims = verifyAccessToken(bearer);

      const userId = Number(claims.sub);
      if (!userId || isNaN(userId)) return next(new Error('Invalid token'));

      socket.data.user = { id: userId, roleId: claims.roleId };
      socket.join(`user:${userId}`);
      if (claims.roleId) socket.join(`role:${claims.roleId}`);

      wsConnectionsTotal.inc();
      wsConnectionsActive.inc();

      logger.info({ msg: 'Socket connected', userId, socketId: socket.id });
      next();
    } catch (err) {
      logger.warn({ msg: 'Socket auth failed', err: String(err) });
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug({
      msg: 'Socket connection established',
      socketId: socket.id,
      userId: socket.data.user?.id,
    });

    // Registrar handlers de dominio
    registerDocumentHandlers(socket, io!);
    registerPedidoHandlers(socket, io!);
    registerEventoHandlers(socket, io!);

    // ── Métricas de mensajes salientes (solo eventos de negocio) ──────────────
    // No interceptamos emit directamente para evitar interferir con eventos
    // internos de Socket.IO. En su lugar, los handlers de dominio usan
    // broadcastToUser/broadcastToAll que registran la métrica.

    // ── Métricas de mensajes entrantes (solo eventos de negocio) ─────────────
    // Wrapeamos on() para contar eventos de negocio, NO los internos
    const originalOn = socket.on.bind(socket);
    socket.on = function (event: string, handler: any) {
      if (!INTERNAL_EVENTS.has(event)) {
        const wrapped = (...args: any[]) => {
          wsMessagesReceived.labels(event).inc();
          return handler(...args);
        };
        return originalOn(event, wrapped);
      }
      return originalOn(event, handler);
    };

    socket.on('disconnect', () => {
      wsConnectionsActive.dec();
      logger.debug({
        msg: 'Socket disconnected',
        socketId: socket.id,
        userId: socket.data.user?.id,
      });
    });
  });

  startWebSocketMetricsCollection();

  logger.info({ msg: 'Socket.IO server initialized' });
  return io;
}

export function getSocketServer() {
  return io;
}

export function broadcastToUser(userId: number, event: string, data: any) {
  io?.to(`user:${userId}`).emit(event, data);
  wsMessagesSent.labels(event).inc();
  wsEventsEmitted.labels(event).inc();
}

export function broadcastToRole(roleId: number, event: string, data: any) {
  io?.to(`role:${roleId}`).emit(event, data);
  wsMessagesSent.labels(event).inc();
  wsEventsEmitted.labels(event).inc();
}

export function broadcastToAll(event: string, data: any) {
  io?.emit(event, data);
  wsMessagesSent.labels(event).inc();
  wsEventsEmitted.labels(event).inc();
}
