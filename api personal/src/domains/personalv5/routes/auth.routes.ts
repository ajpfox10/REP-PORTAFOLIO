/**
 * @file domains/personalv5/routes/auth.routes.ts
 *
 * Rutas de autenticación (todas públicas excepto /logout que requiere token).
 */

import { Router } from 'express';
import { authLimiter }     from '../../../middlewares/rateLimiters';
import { authContext }     from '../../../middlewares/authContext';
import {
  login, refresh, logout,
  handleRequestAccess, handleConfirmCode,
  forgotPassword, resetPassword,
} from '../controllers/auth.controller';

export function buildAuthRouterV2(sequelize: any): Router {
  const router = Router();

  // Todas las rutas de auth tienen rate limiting estricto
  router.use(authLimiter);

  router.post('/login',                login);
  router.post('/refresh',              refresh);
  router.post('/logout',               authContext(sequelize), logout);
  router.post('/forgot-password',      forgotPassword);
  router.post('/reset-password',       resetPassword);
  router.post('/request-access',       handleRequestAccess);
  router.post('/confirm-access-code',  handleConfirmCode);

  return router;
}
