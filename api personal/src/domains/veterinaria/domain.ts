/**
 * @file domains/veterinaria/domain.ts
 * @description Dominio "Veterinaria" - Sistema de Gestion de Clinica Veterinaria.
 *
 * Este es un EJEMPLO de como crear un dominio totalmente diferente
 * usando el mismo nucleo (core) de la API.
 *
 * Pasos para activar este dominio en lugar de personalv5:
 *   1. En src/gateways/apiGateway.ts cambiar:
 *        pluginRegistry.setDomain(new PersonalV5Domain());
 *      por:
 *        pluginRegistry.setDomain(new VeterinariaDomail());
 *   2. Apuntar DOCUMENTS_BASE_DIR a la carpeta de imagenes/radiografias
 *   3. En .env: DOMAIN=veterinaria
 *
 * TODO el nucleo (JWT, RBAC, audit log, rate limiting, webhooks, cache,
 * metricas Prometheus, OpenAPI, health checks, CRUD dinamico) funciona
 * exactamente igual. Solo cambia la logica de negocio.
 *
 * TABLAS PRINCIPALES de este dominio:
 *   - pacientes       → animales registrados
 *   - duenos          → propietarios de los animales
 *   - consultas       → historial de consultas medicas
 *   - vacunas         → vacunas aplicadas
 *   - internaciones   → animales internados
 */

import { Router } from 'express';
import { Domain, PluginContext } from '../../core/plugin';
import { requirePermission } from '../../middlewares/rbacCrud';
import { authContext } from '../../middlewares/authContext';
import { PacienteService } from './services/paciente.service';
import { PacienteController } from './controllers/paciente.controller';
import { logger } from '../../logging/logger';

export class VeterinariaDomail implements Domain {
  readonly name = 'veterinaria';
  readonly description = 'Sistema de Gestion de Clinica Veterinaria';
  readonly mainTables = ['pacientes', 'duenos', 'consultas', 'vacunas', 'internaciones'];

  mount(ctx: PluginContext): void {
    const { app, sequelize, apiPrefix } = ctx;
    const protect = [authContext(sequelize), requirePermission('api:access')];

    // Servicios del dominio veterinaria
    const pacienteService = new PacienteService(sequelize);
    const pacienteCtrl    = new PacienteController(pacienteService);

    // Rutas del dominio veterinaria
    const pacienteRouter = Router();
    pacienteRouter.get('/',                 pacienteCtrl.list);
    pacienteRouter.get('/:id',              pacienteCtrl.getById);
    pacienteRouter.post('/',                pacienteCtrl.create);
    pacienteRouter.put('/:id',              pacienteCtrl.update);
    pacienteRouter.get('/:id/historial',    pacienteCtrl.historial);
    pacienteRouter.post('/:id/vacunas',     pacienteCtrl.addVacuna);
    pacienteRouter.post('/:id/internacion', pacienteCtrl.internar);

    app.use(`${apiPrefix}/pacientes`, ...protect, pacienteRouter);

    logger.info({
      msg: `Dominio "${this.name}" montado`,
      rutas: [
        `${apiPrefix}/pacientes (GET, POST)`,
        `${apiPrefix}/pacientes/:id (GET, PUT)`,
        `${apiPrefix}/pacientes/:id/historial`,
        `${apiPrefix}/pacientes/:id/vacunas`,
        `${apiPrefix}/pacientes/:id/internacion`,
      ],
    });
  }
}
