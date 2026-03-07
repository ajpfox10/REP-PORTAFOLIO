/**
 * @file domains/personalv5/routes/agentes.routes.ts
 *
 * Rutas de agentes. Incluye el alta atómica que reemplaza las 3 llamadas separadas.
 */

import { Router } from 'express';
import { handleAlta, handleEditar } from '../controllers/agentes.controller';

export function buildAgentesRouterV2(sequelize: any): Router {
  const router = Router();

  router.use((req: any, _res, next) => {
    req.sequelize = sequelize;
    next();
  });

  /**
   * POST /agentes/alta — Alta atómica de agente completo
   *
   * Reemplaza el flujo anterior de 3 llamadas separadas:
   *   POST /personal → POST /agentes → POST /agentes_servicios
   *
   * Ahora todo va en una transacción: si algo falla, nada se guarda.
   * El frontend hace UNA sola llamada.
   */
  router.post('/alta', handleAlta);

  /**
   * PATCH /agentes/:dni — Edición parcial
   *
   * Actualiza personal + agentes en una transacción.
   * Solo modifica los campos que vienen en el body.
   */
  router.patch('/:dni', handleEditar);

  return router;
}
