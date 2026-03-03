/**
 * @file domains/personalv5/domain.ts
 * @description Dominio "PersonalV5" - Sistema de Gestion de Personal Hospitalario.
 *
 * Este archivo es el PUNTO DE ENTRADA del dominio.
 * Define las rutas especificas del negocio que van MAS ALLA del CRUD generico.
 *
 * Para crear un nuevo dominio (ej: veterinaria), copia esta carpeta,
 * renombrala y adapta este archivo con las rutas de tu nuevo sistema.
 *
 * TABLAS PRINCIPALES que gestiona este dominio:
 *   - personal        → datos personales de los empleados
 *   - agentes         → datos laborales (ley, planta, categoria, etc.)
 *   - agentes_servicios → servicios/areas de cada agente
 *   - tblarchivos     → documentos digitalizados (PDFs, etc.)
 *   - agentexdni1     → foto del agente
 */

import { Router } from 'express';
import { Domain, PluginContext } from '../../core/plugin';
import { requirePermission } from '../../middlewares/rbacCrud';
import { authContext } from '../../middlewares/authContext';
import { DocumentService } from './services/document.service';
import { AgenteService } from './services/agente.service';
import { DocumentController } from './controllers/document.controller';
import { AgenteController } from './controllers/agente.controller';
import { logger } from '../../logging/logger';

export class PersonalV5Domain implements Domain {
  readonly name = 'personalv5';
  readonly description = 'Sistema de Gestion de Personal Hospitalario - Hospital Interzonal General de Agudos Higa';
  readonly mainTables = ['personal', 'agentes', 'agentes_servicios', 'tblarchivos', 'agentexdni1'];

  mount(ctx: PluginContext): void {
    const { app, sequelize, apiPrefix } = ctx;
    const protect = [authContext(sequelize), requirePermission('api:access')];

    // ── Instanciar servicios ──────────────────────────────────────────────────
    // Los servicios reciben el sequelize y tienen toda la logica de negocio.
    const documentService = new DocumentService(sequelize);
    const agenteService   = new AgenteService(sequelize);

    // ── Instanciar controllers ────────────────────────────────────────────────
    // Los controllers son los handlers de las rutas, llaman a los servicios.
    const documentCtrl = new DocumentController(documentService);
    const agenteCtrl   = new AgenteController(agenteService);

    // ── Registrar rutas del dominio ───────────────────────────────────────────

    // Documentos: rutas del nuevo controller (las rutas legacy en documents.routes.ts
    // se mantienen para compatibilidad; estas son las nuevas con mejor manejo)
    const docRouter = Router();
    docRouter.get('/',         documentCtrl.list);      // Listar documentos
    docRouter.get('/:id/file', documentCtrl.getFile);   // Descargar archivo (FIX del bug)
    docRouter.delete('/:id',   documentCtrl.delete);    // Soft-delete
    app.use(`${apiPrefix}/docs/v2`, ...protect, docRouter);

    // Agentes: endpoint de alta atomica
    const agenteRouter = Router();
    agenteRouter.post('/alta',        agenteCtrl.alta);       // Alta en una transaccion
    agenteRouter.get('/dni/:dni',     agenteCtrl.findByDni);  // Buscar por DNI completo
    agenteRouter.patch('/:dni',       agenteCtrl.patch);      // Actualizar datos laborales
    app.use(`${apiPrefix}/agentes-v2`, ...protect, agenteRouter);

    logger.info({
      msg: `Dominio "${this.name}" montado`,
      rutas: [
        `${apiPrefix}/docs/v2        (documentos v2 con path resolution mejorado)`,
        `${apiPrefix}/agentes-v2/alta (alta atomica de agente)`,
        `${apiPrefix}/agentes-v2/dni/:dni`,
      ],
    });
  }
}
