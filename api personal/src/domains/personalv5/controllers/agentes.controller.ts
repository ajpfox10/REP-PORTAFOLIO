/**
 * @file domains/personalv5/controllers/agentes.controller.ts
 * @deprecated Usar agente.controller.ts (clase) en su lugar.
 * Shim de compatibilidad para código legacy que importa de este archivo.
 */

export { AgenteController } from './agente.controller';
import { AgenteController } from './agente.controller';
import { AgenteService } from '../services/agente.service';

// Handler legacy (inyecta sequelize desde req.app.locals o req.sequelize)
export async function handleAlta(req: any, res: any): Promise<void> {
  const sequelize = req.app?.locals?.sequelize ?? req.sequelize;
  const ctrl = new AgenteController(new AgenteService(sequelize));
  return ctrl.alta(req, res);
}

export async function handleEditar(req: any, res: any): Promise<void> {
  const sequelize = req.app?.locals?.sequelize ?? req.sequelize;
  const ctrl = new AgenteController(new AgenteService(sequelize));
  return ctrl.patch(req, res);
}
