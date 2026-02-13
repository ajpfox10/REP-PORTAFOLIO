// src/middlewares/metricsAuth.ts
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { requirePermission } from './rbacCrud';

/**
 * Middleware de autenticación para métricas.
 * 
 * SOPORTA DOS MODOS:
 * 1. Token simple (x-metrics-token) - para sistemas de monitoreo
 * 2. RBAC (Authorization: Bearer) - para humanos
 */
export function metricsAuth(req: Request, res: Response, next: NextFunction) {
  // Si las métricas no están protegidas, paso libre
  if (!env.METRICS_PROTECT) {
    return next();
  }

  // --- MODO 1: Token simple (para Prometheus/Grafana) ---
  const tokenHeader = req.headers['x-metrics-token'];
  const tokenFromHeader = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  const token = tokenFromHeader || '';

  if (token && token === env.METRICS_TOKEN) {
    return next(); // ✅ Token válido, acceso concedido
  }

  // --- MODO 2: RBAC (para humanos via browser/curl) ---
  const auth = (req as any).auth;
  if (auth) {
    const permissions = auth.permissions || [];
    const hasMetricPerm = 
      permissions.includes('metrics:read') ||
      permissions.includes('crud:*:*') ||
      permissions.includes('admin:*');
    
    if (hasMetricPerm) {
      return next(); // ✅ Usuario autenticado y autorizado
    }
  }

  // --- ACCESO DENEGADO ---
  return res.status(403).json({
    ok: false,
    error: 'Acceso denegado a métricas',
    details: 'Se requiere token de métricas o permiso metrics:read'
  });
}