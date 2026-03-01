import { logEvent } from './clientLogger';

// Track de acciones de UI (auditoría liviana en el front).
// NO reemplaza el log de backend, pero ayuda a saber qué intentó el usuario.
export function trackAction(what: string, details?: any, where?: string) {
  logEvent({
    level: 'info',
    what,
    where: where || window.location?.pathname,
    details,
  });
}
