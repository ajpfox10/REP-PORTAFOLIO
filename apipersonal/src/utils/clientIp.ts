// IP real del cliente. X-Forwarded-For solo vale si hay un proxy de confianza delante
// (TRUST_PROXY=true → express calcula req.ip con ese header). Sin proxy, cualquiera lo
// inventa y saltea el bloqueo de intentos de login por IP (auditoría 08/11).
import { Request } from 'express';
import { env } from '../config/env';

export function clientIp(req: Request): string {
  const ip = env.TRUST_PROXY ? (req.ip || req.socket?.remoteAddress) : (req.socket?.remoteAddress || req.ip);
  return String(ip || '').replace(/^::ffff:/, '');
}
