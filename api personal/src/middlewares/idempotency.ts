// src/middlewares/idempotency.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Sequelize } from 'sequelize';
import { logger } from '../logging/logger';

declare global {
  namespace Express {
    interface Request {
      idempotencyKey?: string;
      idempotencyCached?: boolean;
    }
  }
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

function hashRequest(req: Request): string {
  const payload = {
    method: req.method,
    path: req.originalUrl || req.url,
    body: req.body,
    query: req.query,
    // No incluimos headers porque pueden variar (auth, etc)
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function idempotencyMiddleware(sequelize: Sequelize) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // ✅ SOLO para métodos que modifican datos
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    const key = req.headers['idempotency-key'] as string;
    if (!key) {
      // Si no hay key, seguimos normalmente (no hay protección)
      return next();
    }

    req.idempotencyKey = key;
    const requestHash = hashRequest(req);
    const usuarioId = (req as any).auth?.principalId ?? null;

    try {
      // 1. Buscar si ya existe una respuesta para esta key
      const [rows] = await sequelize.query(
        `SELECT response_json, expires_at 
         FROM idempotency_keys 
         WHERE route = :route AND idem_key = :key
         LIMIT 1`,
        {
          replacements: {
            route: req.originalUrl || req.url,
            key
          }
        }
      );

      const existing = (rows as any[])[0];
      
      if (existing) {
        // ✅ Key ya usada → devolvemos la respuesta cacheada
        req.idempotencyCached = true;
        
        // Verificar que no haya expirado
        const expiresAt = new Date(existing.expires_at);
        if (expiresAt.getTime() < Date.now()) {
          // Expirado: lo borramos y seguimos
          await sequelize.query(
            `DELETE FROM idempotency_keys WHERE route = :route AND idem_key = :key`,
            { replacements: { route: req.originalUrl || req.url, key } }
          );
          return next();
        }

        // Parsear respuesta cacheada
        const cached = JSON.parse(existing.response_json);
        return res.status(cached.status).json(cached.body);
      }

      // 2. No existe → interceptamos la respuesta para cachearla
      const originalJson = res.json;
      const originalSend = res.send;
      const originalEnd = res.end;

      let responseBody: any = null;
      let responseStatus = 200;

      // Override de res.json
      res.json = function(body) {
        responseBody = body;
        responseStatus = res.statusCode;
        return originalJson.call(this, body);
      };

      // Override de res.send
      res.send = function(body) {
        responseBody = body;
        responseStatus = res.statusCode;
        return originalSend.call(this, body);
      };

      // Cuando termina la request, guardamos en DB
      res.once('finish', async () => {
        if (res.statusCode >= 200 && res.statusCode < 300 && responseBody) {
          try {
            await sequelize.query(
              `INSERT INTO idempotency_keys 
               (route, idem_key, request_hash, response_json, expires_at, usuario_id, created_at)
               VALUES (:route, :key, :requestHash, :responseJson, DATE_ADD(NOW(), INTERVAL 24 HOUR), :usuarioId, NOW())`,
              {
                replacements: {
                  route: req.originalUrl || req.url,
                  key,
                  requestHash,
                  responseJson: JSON.stringify({ status: responseStatus, body: responseBody }),
                  usuarioId
                }
              }
            );
            logger.info({ msg: 'Idempotency key stored', key, route: req.originalUrl });
          } catch (err) {
            logger.error({ msg: 'Failed to store idempotency key', key, err });
          }
        }
      });

      next();
    } catch (err) {
      logger.error({ msg: 'Idempotency middleware error', err });
      // Falla seguro: permitimos la request igual
      next();
    }
  };
}