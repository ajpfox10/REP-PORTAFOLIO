/**
 * @file domains/personalv5/routes/agente.routes.ts
 * Rutas de agentes. Define endpoints, delega al controller.
 */
import { Router } from 'express';
import type { Sequelize } from 'sequelize';
import { AgenteController } from '../controllers/agente.controller';
import { AgenteService } from '../services/agente.service';
import { requirePermission } from '../../../middlewares/rbacCrud';

export function buildAgenteRoutes(sequelize: Sequelize): Router {
  const router = Router();
  const ctrl = new AgenteController(new AgenteService(sequelize));

  /**
   * POST /agentes/alta
   * Alta atomica: crea personal + agente + servicios en una transaccion.
   */
  router.post('/alta',      requirePermission('personal:write'), ctrl.alta);
  router.get('/dni/:dni',   requirePermission('personal:read'),  ctrl.findByDni);

  return router;
}
