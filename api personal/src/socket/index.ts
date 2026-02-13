// src/socket/index.ts
import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { verifyAccessToken } from '../auth/jwt';
import { logger } from '../logging/logger';
import { env } from '../config/env';
import { registerDocumentHandlers } from './handlers/documentos';
import { registerPedidoHandlers } from './handlers/pedidos';
import { registerEventoHandlers } from './handlers/eventos';

export let io: SocketServer | null = null; // ✅ EXPORTADO

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

      logger.info({ msg: 'Socket connected', userId, socketId: socket.id });
      next();
    } catch (err) {
      logger.warn({ msg: 'Socket auth failed', err: String(err) });
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug({ msg: 'Socket connected', socketId: socket.id, userId: socket.data.user?.id });
    registerDocumentHandlers(socket, io!);
    registerPedidoHandlers(socket, io!);
    registerEventoHandlers(socket, io!);

    socket.on('disconnect', () => {
      logger.debug({ msg: 'Socket disconnected', socketId: socket.id, userId: socket.data.user?.id });
    });
  });

  logger.info({ msg: 'Socket.IO server initialized' });
  return io;
}

// ✅ FUNCIONES EXPORTADAS
export function getSocketServer() {
  return io;
}

export function broadcastToUser(userId: number, event: string, data: any) {
  io?.to(`user:${userId}`).emit(event, data);
}

export function broadcastToRole(roleId: number, event: string, data: any) {
  io?.to(`role:${roleId}`).emit(event, data);
}

export function broadcastToAll(event: string, data: any) {
  io?.emit(event, data);
}