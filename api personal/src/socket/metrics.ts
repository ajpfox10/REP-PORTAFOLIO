// src/socket/metrics.ts
import { io } from './index';
import client from 'prom-client';

export const wsConnectionsTotal = new client.Counter({
  name: 'ws_connections_total',
  help: 'Número total de conexiones WebSocket',
  registers: [client.register]
});

export const wsConnectionsActive = new client.Gauge({
  name: 'ws_connections_active',
  help: 'Conexiones WebSocket activas actualmente',
  registers: [client.register]
});

export const wsMessagesReceived = new client.Counter({
  name: 'ws_messages_received_total',
  help: 'Total de mensajes recibidos por WebSocket',
  labelNames: ['event'],
  registers: [client.register]
});

export const wsMessagesSent = new client.Counter({
  name: 'ws_messages_sent_total',
  help: 'Total de mensajes enviados por WebSocket',
  labelNames: ['event'],
  registers: [client.register]
});

export const wsEventsEmitted = new client.Counter({
  name: 'ws_events_emitted_total',
  help: 'Total de eventos emitidos a clientes',
  labelNames: ['event'],
  registers: [client.register]
});

export const wsRoomsActive = new client.Gauge({
  name: 'ws_rooms_active',
  help: 'Número de salas activas',
  registers: [client.register]
});

export function startWebSocketMetricsCollection() {
  setInterval(() => {
    if (!io) return;
    
    // ✅ Conexiones activas
    wsConnectionsActive.set(io.engine.clientsCount);
    
    // ✅ Salas activas (excluyendo IDs de sockets individuales)
    const rooms = io.sockets.adapter.rooms;
    const socketsSet = io.sockets.sockets;
    
    const roomCount = [...rooms.keys()].filter(key => 
      !socketsSet.has(key) && !key.startsWith('/')
    ).length;
    
    wsRoomsActive.set(roomCount);
    
  }, 5000);
}