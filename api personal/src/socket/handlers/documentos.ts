// src/socket/handlers/documentos.ts
import { Socket } from 'socket.io';
import { Server } from 'socket.io';
import { broadcastToUser, broadcastToRole } from '../index';

export function registerDocumentHandlers(socket: Socket, io: Server) {
  // Unirse a sala de un DNI específico (para seguimiento de documentos)
  socket.on('documents:watch-dni', (dni: number) => {
    socket.join(`documents:dni:${dni}`);
    socket.emit('documents:joined', { dni });
  });

  // Salir de sala de DNI
  socket.on('documents:unwatch-dni', (dni: number) => {
    socket.leave(`documents:dni:${dni}`);
  });
}

// Funciones para emitir desde el backend (llamadas desde controllers)
export function emitDocumentUploaded(dni: number, document: any) {
  // Notificar a la sala del DNI
  broadcastToUser(dni, 'documents:uploaded', document);
  
  // Notificar a sala específica de documentos de ese DNI
  getSocketServer()?.to(`documents:dni:${dni}`).emit('documents:uploaded', document);
  
  // Notificar a admins (rol 1)
  broadcastToRole(1, 'documents:uploaded', {
    ...document,
    _meta: { notify: 'admin', dni }
  });
}

export function emitDocumentDeleted(documentId: number, dni: number) {
  broadcastToUser(dni, 'documents:deleted', { id: documentId, dni });
  getSocketServer()?.to(`documents:dni:${dni}`).emit('documents:deleted', { id: documentId });
}

import { getSocketServer } from '../index';