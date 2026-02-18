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
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function idempotencyMiddleware(sequelize: Sequelize) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Solo para métodos que modifican datos
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    const key = req.headers['idempotency-key'] as string;
    if (!key) {
      return next(); // Sin key: no hay protección, request pasa igual
    }

    req.idempotencyKey = key;
    const requestHash = hashRequest(req);
    const usuarioId = (req as any).auth?.principalId ?? null;
    const route = req.originalUrl || req.url;

    try {
      // 1. Buscar si ya existe una respuesta para esta key
      const [rows] = await sequelize.query(
        `SELECT response_json, expires_at
         FROM idempotency_keys
         WHERE route = :route AND idem_key = :key
         LIMIT 1`,
        { replacements: { route, key } }
      );

      const existing = (rows as any[])[0];

      if (existing) {
        req.idempotencyCached = true;

        // Verificar que no haya expirado
        const expiresAt = new Date(existing.expires_at);
        if (expiresAt.getTime() < Date.now()) {
          // Expirado: lo borramos y seguimos normalmente
          await sequelize.query(
            `DELETE FROM idempotency_keys WHERE route = :route AND idem_key = :key`,
            { replacements: { route, key } }
          );
          return next();
        }

        // Devolver respuesta cacheada
        const cached = JSON.parse(existing.response_json);
        return res.status(cached.status).json(cached.body);
      }

      // 2. No existe → capturamos la respuesta para persistirla
      let responseBody: any = null;
      let responseStatus = 200;
      let bodyWasCaptured = false;

      // Override res.json (ruta más común)
      const originalJson = res.json;
      res.json = function (body) {
        if (!bodyWasCaptured) {
          responseBody = body;
          responseStatus = res.statusCode;
          bodyWasCaptured = true;
        }
        return originalJson.call(this, body);
      };

      // Override res.send (ruta alternativa)
      const originalSend = res.send;
      res.send = function (body) {
        if (!bodyWasCaptured && body !== undefined) {
          // Intentar parsear si es string JSON
          try {
            responseBody = typeof body === 'string' ? JSON.parse(body) : body;
          } catch {
            responseBody = body;
          }
          responseStatus = res.statusCode;
          bodyWasCaptured = true;
        }
        return originalSend.call(this, body);
      };

      // Override res.end (cubre stream/pipe y respuestas sin body explícito)
      const originalEnd = res.end;
      res.end = function (chunk?: any, ...args: any[]) {
        if (!bodyWasCaptured && chunk) {
          try {
            const raw = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            responseBody = JSON.parse(raw);
            responseStatus = res.statusCode;
            bodyWasCaptured = true;
          } catch {
            // Si no es JSON parseble, no cacheamos (ej: streams de archivos)
          }
        }
        return (originalEnd as any).call(this, chunk, ...args);
      };

      // Cuando termina la request, persistimos si corresponde
      res.once('finish', async () => {
        if (res.statusCode >= 200 && res.statusCode < 300 && bodyWasCaptured && responseBody) {
          try {
            await sequelize.query(
              `INSERT INTO idempotency_keys
               (route, idem_key, request_hash, response_json, expires_at, usuario_id, created_at)
               VALUES (:route, :key, :requestHash, :responseJson, DATE_ADD(NOW(), INTERVAL 24 HOUR), :usuarioId, NOW())`,
              {
                replacements: {
                  route,
                  key,
                  requestHash,
                  responseJson: JSON.stringify({ status: responseStatus, body: responseBody }),
                  usuarioId,
                },
              }
            );
            logger.info({ msg: 'Idempotency key stored', key, route });
          } catch (err) {
            logger.error({ msg: 'Failed to store idempotency key', key, err });
          }
        }
      });

      next();
    } catch (err) {
      logger.error({ msg: 'Idempotency middleware error', err });
      next(); // Fail open: permitimos la request igual
    }
  };
}
