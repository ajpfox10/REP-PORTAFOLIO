// src/socket/handlers/eventos.ts
import { Socket } from 'socket.io';
import { Server } from 'socket.io';
import { broadcastToUser } from '../index';

export function registerEventoHandlers(socket: Socket, io: Server) {
  socket.on('eventos:watch-dni', (dni: number) => {
    socket.join(`eventos:dni:${dni}`);
  });

  socket.on('eventos:unwatch-dni', (dni: number) => {
    socket.leave(`eventos:dni:${dni}`);
  });
}

export function emitEventoCreated(dni: number, evento: any) {
  broadcastToUser(dni, 'eventos:created', evento);
  getSocketServer()?.to(`eventos:dni:${dni}`).emit('eventos:created', evento);
}

export function emitEventoUpdated(dni: number, evento: any) {
  broadcastToUser(dni, 'eventos:updated', evento);
  getSocketServer()?.to(`eventos:dni:${dni}`).emit('eventos:updated', evento);
}

import { getSocketServer } from '../index';