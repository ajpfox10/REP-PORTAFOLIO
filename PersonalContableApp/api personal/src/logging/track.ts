// src/logging/track.ts
// Tracking de acciones para auditoría en backend
// NO CONFUNDIR con el track.ts del frontend
import { logger } from './logger';
import { getRequestId } from '../middlewares/requestId';

export type TrackEvent = {
  action: string;
  actor?: {
    id?: number;
    type?: string;
    email?: string;
  };
  entity?: {
    type: string;
    id?: string | number;
  };
  details?: any;
  timestamp: Date;
  requestId?: string;
};

/**
 * Registra una acción de usuario para auditoría.
 * Versión BACKEND - escribe en logs estructurados.
 */
export function trackAction(
  action: string,
  details?: any,
  actor?: { id?: number; type?: string; email?: string },
  entity?: { type: string; id?: string | number }
) {
  const event: TrackEvent = {
    action,
    actor,
    entity,
    details,
    timestamp: new Date(),
    requestId: getRequestId()
  };

  // Log estructurado
  logger.info({
    msg: 'ACTION_TRACK',
    ...event
  });
}

/**
 * Versión simplificada para casos rápidos
 */
export function trackSimple(action: string, details?: any) {
  trackAction(action, details, undefined, undefined);
}