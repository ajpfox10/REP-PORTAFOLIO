// src/socket/handlers/pedidos.ts
import { Socket } from 'socket.io';
import { Server } from 'socket.io';
import { broadcastToUser, broadcastToRole } from '../index';
import { getSocketServer } from '../index';

export function registerPedidoHandlers(socket: Socket, io: Server) {
  // Unirse a sala de pedidos por DNI
  socket.on('pedidos:watch-dni', (dni: number) => {
    socket.join(`pedidos:dni:${dni}`);
  });

  socket.on('pedidos:unwatch-dni', (dni: number) => {
    socket.leave(`pedidos:dni:${dni}`);
  });
}

// Funciones para emitir desde el backend (llamadas desde CRUD)
export function emitPedidoCreated(dni: number, pedido: any) {
  broadcastToUser(dni, 'pedidos:created', pedido);
  getSocketServer()?.to(`pedidos:dni:${dni}`).emit('pedidos:created', pedido);
  broadcastToRole(1, 'pedidos:created', { ...pedido, _meta: { dni } });
}

export function emitPedidoUpdated(dni: number, pedido: any) {
  broadcastToUser(dni, 'pedidos:updated', pedido);
  getSocketServer()?.to(`pedidos:dni:${dni}`).emit('pedidos:updated', pedido);
}

export function emitPedidoDeleted(dni: number, pedidoId: number) {
  broadcastToUser(dni, 'pedidos:deleted', { id: pedidoId, dni });
  getSocketServer()?.to(`pedidos:dni:${dni}`).emit('pedidos:deleted', { id: pedidoId });
}