// src/middlewares/auditRead.ts
import { Request, Response, NextFunction } from 'express';
import { Sequelize } from 'sequelize';
import { logger } from '../logging/logger';

export function auditReadMiddleware(sequelize: Sequelize) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();

    const originalJson = res.json;
    const auth = (req as any).auth;
    const actorId = auth?.principalId ?? null;
    const actorType = auth?.principalType ?? null;

    res.json = function(body) {
      if (body?.ok && body?.data) {
        const table = req.params.table;
        const id = req.params.id;
        
        setImmediate(async () => {
          try {
            await sequelize.query(
              `INSERT INTO audit_log 
               (action, table_name, record_pk, actor_type, actor_id, ip, user_agent, created_at, request_id, method, route)
               VALUES
               ('read', :table, :id, :actorType, :actorId, :ip, :userAgent, NOW(), :requestId, 'GET', :route)`,
              {
                replacements: {
                  table: table || null,
                  id: id || null,
                  actorType,
                  actorId,
                  ip: req.ip || req.socket.remoteAddress,
                  userAgent: req.headers['user-agent'] || null,
                  requestId: (req as any).requestId,
                  route: req.originalUrl
                }
              }
            );
          } catch (err) {
            logger.warn({ msg: 'Failed to audit read', err });
          }
        });
      }
      return originalJson.call(this, body);
    };

    next();
  };
}