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
  startWebSocketMetricsCollection
} from './metrics';

export let io: SocketServer | null = null;

export function initSocketServer(httpServer: HttpServer) {
  if (io) return io;

  io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const o = origin.toLowerCase();
        const deny = env.CORS_DENYLIST.map(x => x.toLowerCase());
        if (deny.includes(o)) return cb(new Error('CORS blocked'));
        if (env.CORS_ALLOWLIST.length > 0) {
          const allow = env.CORS_ALLOWLIST.map(x => x.toLowerCase());
          if (!allow.includes(o)) return cb(new Error('CORS not allowed'));
        }
        return cb(null, true);
      },
      credentials: true
    }
  });

  // Middleware de autenticación
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
      if (!token) return next(new Error('Authentication required'));

      const bearer = token.replace('Bearer ', '');
      const claims = verifyAccessToken(bearer);
      
      const userId = Number(claims.sub);
      if (!userId || isNaN(userId)) return next(new Error('Invalid token'));

      socket.data.user = { id: userId, roleId: claims.roleId };
      socket.join(`user:${userId}`);
      if (claims.roleId) socket.join(`role:${claims.roleId}`);

      // ✅ Métricas
      wsConnectionsTotal.inc();
      wsConnectionsActive.inc();

      logger.info({ msg: 'Socket connected', userId, socketId: socket.id });
      next();
    } catch (err) {
      logger.warn({ msg: 'Socket auth failed', err: String(err) });
      next(new Error('Authentication failed'));
    }
  });

  // Registrar handlers
  io.on('connection', (socket) => {
    logger.debug({ msg: 'Socket connected', socketId: socket.id, userId: socket.data.user?.id });

    // Registrar handlers por módulo
    registerDocumentHandlers(socket, io!);
    registerPedidoHandlers(socket, io!);
    registerEventoHandlers(socket, io!);

    // ✅ Interceptar mensajes para métricas
    const originalEmit = socket.emit;
    socket.emit = function(event: string, ...args: any[]) {
      wsMessagesSent.labels(event).inc();
      return originalEmit.call(this, event, ...args);
    };

    const originalOn = socket.on;
    socket.on = function(event: string, handler: any) {
      const wrappedHandler = (...args: any[]) => {
        wsMessagesReceived.labels(event).inc();
        return handler(...args);
      };
      return originalOn.call(this, event, wrappedHandler);
    };

    socket.on('disconnect', () => {
      wsConnectionsActive.dec();
      logger.debug({ msg: 'Socket disconnected', socketId: socket.id, userId: socket.data.user?.id });
    });
  });

  // ✅ Iniciar colección de métricas
  startWebSocketMetricsCollection();

  logger.info({ msg: 'Socket.IO server initialized' });
  return io;
}

export function getSocketServer() {
  return io;
}

export function broadcastToUser(userId: number, event: string, data: any) {
  io?.to(`user:${userId}`).emit(event, data);
  wsEventsEmitted.labels(event).inc();
}

export function broadcastToRole(roleId: number, event: string, data: any) {
  io?.to(`role:${roleId}`).emit(event, data);
  wsEventsEmitted.labels(event).inc();
}

export function broadcastToAll(event: string, data: any) {
  io?.emit(event, data);
  wsEventsEmitted.labels(event).inc();
}