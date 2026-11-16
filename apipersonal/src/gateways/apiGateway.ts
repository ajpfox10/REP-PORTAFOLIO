/**
 * @file gateways/apiGateway.ts
 * @description API Gateway central.
 *
 * --- Para quien no sabe de sistemas ---
 * El API Gateway es como la recepcion de un edificio de oficinas.
 * Toda visita entra por ahi primero: la recepcion verifica quien es,
 * registra la entrada, aplica reglas de seguridad y despues la manda
 * al piso correcto. Nadie llega directo a las oficinas sin pasar por recepcion.
 *
 * --- Tecnicamente ---
 * Centraliza en un solo lugar:
 *   - Versionado de rutas (/api/v1, /api/v2)
 *   - Rate limiting por endpoint
 *   - Request ID unico por llamada (trazabilidad)
 *   - Logging de entrada/salida
 *   - Manejo uniforme de errores
 *   - CORS y seguridad HTTP
 *   - Autenticacion (authContext antes de cualquier ruta protegida)
 *
 * Patron: todas las rutas de negocio se montan VIA este gateway,
 * nunca directamente en app.ts.
 */

import { Express, Request, Response, NextFunction } from 'express';
import { Sequelize } from 'sequelize';
import { SchemaSnapshot } from '../db/schema/types';
import { authContext } from '../middlewares/authContext';
import { requirePermission, requireAny } from '../middlewares/rbacCrud';
import { buildHealthRouter } from '../routes/health.routes';
import { buildAuthRouter } from '../routes/auth.routes';
import { buildCrudRouter } from '../routes/crud.routes';
import { buildDocumentsRouter } from '../routes/documents.routes';
import { buildDocumentsUploadRouter } from '../routes/documents.upload.routes';
import { buildPersonalRouter } from '../routes/personal.routes';
import { buildAgentesFotoRouter } from '../routes/agentesFoto.routes';
import { buildCertificadosRouter } from '../routes/certificados.routes';
import { buildLegajoRouter }      from '../routes/legajo.routes';
import { buildDesignacionFormRouter } from '../routes/designacionForm.routes';
import { buildGuarderiaDdjjRouter } from '../routes/guarderiaDdjj.routes';
import { buildSamoMinisterioRouter } from '../routes/samoMinisterio.routes';
import { buildEventosRouter } from '../routes/eventos.routes';
import { buildApiKeysRouter } from '../routes/apiKeys.routes';
import { buildWebhooksRouter } from '../routes/webhooks.routes';
import { buildAsistenciaRouter } from '../routes/asistencia.routes';
import { buildSinSalidaRouter }  from '../routes/sinSalida.routes';
import { buildAusentismoRouter } from '../routes/ausentismo.routes';
import { buildScannerRouter } from '../routes/scanner.routes';
import { buildFicheroRouter } from '../routes/fichero.routes';
import { buildFicheroBiometriaLabRouter } from '../routes/ficheroBiometriaLab.routes';
import { buildFicheroSdkAgenteRouter } from '../routes/ficheroSdkAgente.routes';
import { buildIclockAdmsRouter } from '../routes/iclockAdms.routes';
import { buildExamenIngresoRouter } from '../routes/examenIngreso.routes';
import { buildAccidentesPunzoRouter } from '../routes/accidentesPunzo.routes';
import { buildCasosViolenciaRouter } from '../routes/casosViolencia.routes';
import { buildTurnosSaludLaboralRouter } from '../routes/turnosSaludLaboral.routes';
import { buildTareasLivianasRouter } from '../routes/tareasLivianas.routes';
import { buildJuntasMedicasRouter } from '../routes/juntasMedicas.routes';
import { buildSaludLaboralHabilitacionesRouter } from '../routes/saludLaboralHabilitaciones.routes';
import { buildBajasRouter } from '../routes/bajas.routes';
import { buildJubilacionRouter } from '../routes/jubilacion.routes';
import { buildAgendaTurnosRouter } from '../routes/agendaTurnos.routes';
import { buildWhatsappBotRouter } from '../routes/whatsappBot.routes';
import { buildGpAvisosRouter } from '../routes/gpAvisos.routes';
import { buildHerramientasRouter } from '../routes/herramientas.routes';
import { buildComisionesRouter } from '../routes/comisiones.routes';
import { buildVacacionesAdelantadasRouter } from '../routes/vacacionesAdelantadas.routes';
import { buildCargaHorariaLeyRouter } from '../routes/cargaHorariaLey.routes';
import { buildMensajesRelojRouter } from '../routes/mensajesReloj.routes';
import { buildWhatsappRouter } from '../routes/whatsapp.routes';
import { buildUsuariosRouter } from '../routes/usuarios.routes';
import { buildStressRouter }   from '../routes/stress.routes';
import { buildAntiguedadRouter } from '../routes/antiguedad.routes';
import { buildLicenciasRouter } from '../routes/licencias.routes';
import { buildComparacionSiapeRouter } from '../routes/comparacionSiape.routes';
import { buildComparacionV2Router } from '../routes/comparacionV2.routes';
import { buildArticulo26IntranetRouter } from '../routes/articulo26Intranet.routes';
import { buildLicenciasConsultorioRouter } from '../routes/licenciasConsultorio.routes';
import { buildHorariosExtendidosRouter } from '../routes/horariosExtendidos.routes';
import { buildPlusLicenciasRouter } from '../routes/plusLicencias.routes';
import { buildUltimasLicenciasRouter } from '../routes/ultimasLicencias.routes';
import { buildPresentismoSectorRouter } from '../routes/presentismoSector.routes';
import { buildFichajesAgentesRouter, buildFichajesRecienteRouter } from '../routes/fichajesAgentes.routes';
import { buildLicenciasMedicasControlRouter } from '../routes/licenciasMedicasControl.routes';
import { buildIntranetRouter } from '../domains/personalv5/routes/intranet.routes';
import { buildResidentesRouter } from '../routes/residentes.routes';
import { buildRotacionSiapeRouter } from '../routes/rotacionSiape.routes';
import { buildResidenciasRouter } from '../routes/residencias.routes';
import { buildFcCertReemplazosRouter } from '../routes/fcCertReemplazos.routes';
import { buildNombramientoRouter } from '../routes/nombramiento.routes';
import { buildTramitesDocumentalesRouter } from '../routes/tramitesDocumentales.routes';
import { buildJefaturasRouter }      from '../routes/jefaturas.routes';
import { buildAlertasAgenteRouter } from '../routes/alertasAgente.routes';
import { buildCumpleanosAlertasRouter } from '../routes/cumpleanosAlertas.routes';
import { buildReclamosHaberesRouter } from '../routes/reclamosHaberes.routes';
import { buildScriptRunsRouter } from '../routes/scriptRuns.routes';
import { buildResolucionesSinArchivoRouter } from '../routes/resolucionesSinArchivo.routes';
import { buildFeriadosRouter } from '../routes/feriados.routes';
import { buildBecariosArtRouter }   from '../routes/becariosArt.routes';
import { buildDashboardAlertsRouter } from '../routes/dashboardAlerts.routes';
import { buildUserScanMusicRouter } from '../routes/userScanMusic.routes';
import { buildSwaggerRouter } from '../routes/swagger.routes';
import { buildDocsRouter } from '../routes/docs.routes';
import { idempotencyMiddleware } from '../middlewares/idempotency';
import { docsAuth } from '../middlewares/docsAuth';
import { metricsHandler } from '../metrics/metricsHandler';
import { metricsAuth } from '../middlewares/metricsAuth';
import { initWebhookEmitter } from '../webhooks/emitters';
import { auditReadMiddleware } from '../middlewares/auditRead';
import { mountAutoRoutes } from '../routes/auto';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { startArtAltaWorker } from '../services/artAltaQueue';
import { pluginRegistry, PluginContext } from '../core/plugin';
import { clientIp } from '../utils/clientIp';

export interface GatewayOptions {
  sequelize: Sequelize;
  schema: SchemaSnapshot;
  apiVersion?: string;
}

/**
 * Monta todas las rutas en la app Express a traves del gateway.
 * Este es el unico lugar donde se registran rutas - ningun otro archivo
 * debe llamar app.use() directamente.
 */
export async function mountApiGateway(app: Express, opts: GatewayOptions): Promise<void> {
  const { sequelize, schema } = opts;
  const apiVersion = opts.apiVersion || env.API_VERSION || 'v1';
  const apiPrefix = `/api/${apiVersion}`;

  logger.info({ msg: 'API Gateway arrancando', apiPrefix, domain: pluginRegistry.getDomain()?.name || 'sin dominio' });

  // ── Health (siempre publico, sin autenticacion) ───────────────────────────
  app.use(buildHealthRouter(sequelize));
  // Aliases bajo /api/v1/ para clientes que los necesiten
  app.get(`${apiPrefix}/health`, (_req, res) => res.json({ ok: true, status: 'up' }));

  // ── My-IP (público — usado por el frontend para detección de kiosco) ───────
  app.get(`${apiPrefix}/my-ip`, async (req, res) => {
    const ip = clientIp(req);

    let hostname = '';
    if (ip) {
      try {
        const { reverse } = await import('dns/promises');
        const names = await reverse(ip);
        // Tomamos solo la parte antes del primer punto (nombre de PC sin dominio)
        hostname = (names[0] ?? '').split('.')[0].toLowerCase();
      } catch { /* sin PTR record — hostname queda vacío */ }
    }

    res.json({ ok: true, ip, hostname });
  });

  app.get(`${apiPrefix}/ready`, async (_req, res) => {
    try {
      await sequelize.query('SELECT 1');
      return res.json({ ok: true, status: 'ready', db: 'up' });
    } catch {
      return res.status(503).json({ ok: false, status: 'not-ready', db: 'down' });
    }
  });


  // ADMS/ZKTeco push protocol. Public by design: biometric devices do not send JWT.
  app.use('/iclock', buildIclockAdmsRouter());
  // Anuncio de agentes SDK de relojes (otra PC). Sin JWT: valida su propia clave compartida.
  app.use(`${apiPrefix}/fichero-sdk-agente`, buildFicheroSdkAgenteRouter());
  // ── Swagger / OpenAPI Docs ────────────────────────────────────────────────
  if (env.DOCS_ENABLE) {
    const docsPath = env.DOCS_PATH || '/docs';
    app.use(docsPath, authContext(sequelize), docsAuth, buildSwaggerRouter());
    app.use(docsPath, authContext(sequelize), docsAuth, buildDocsRouter());
  }

  // ── Metricas Prometheus ───────────────────────────────────────────────────
  if (env.METRICS_ENABLE) {
    app.get(env.METRICS_PATH, authContext(sequelize), metricsAuth, metricsHandler);
  }

  // ── Auth (NO requiere token - es el endpoint para obtener el token) ────────
  app.use(`${apiPrefix}/auth`, buildAuthRouter(sequelize));

  // ── Idempotency (evita duplicados por doble-click o reintentos) ────────────
  app.use(apiPrefix, idempotencyMiddleware(sequelize));

  // ── Rutas protegidas (todas requieren token JWT valido) ────────────────────
  const protect = [authContext(sequelize), requirePermission('api:access')];

  // Permisos por router = los mismos que pide el front para entrar a la pantalla que lo usa
  // (auditoría 08/11: estos routers solo pedían estar logueado).
  const ADMIN = 'crud:*:*';
  const GESTION = ['crud:agentexdni1:read', ADMIN];
  /** GET/HEAD con `lectura`, el resto con `escritura`. */
  const lecturaEscritura = (lectura: string[], escritura: string[]) => {
    const l = requireAny(lectura), e = requireAny(escritura);
    return (req: Request, res: Response, next: NextFunction) =>
      (req.method === 'GET' || req.method === 'HEAD' ? l : e)(req, res, next);
  };
  /** Exige `perms` salvo en las rutas `libres` (las protege otra cosa, p.ej. x-api-key). */
  const salvo = (perms: string[], libres: string[]) => {
    const g = requireAny(perms);
    return (req: Request, res: Response, next: NextFunction) =>
      (libres.includes(req.path) ? next() : g(req, res, next));
  };
  /** Exige `perms` salvo en las rutas libres [metodo, regex] (las usa cualquier usuario logueado). */
  const salvoRutas = (perms: string[], libres: Array<[string, RegExp]>) => {
    const g = requireAny(perms);
    return (req: Request, res: Response, next: NextFunction) =>
      (libres.some(([m, re]) => req.method === m && re.test(req.path)) ? next() : g(req, res, next));
  };
  /** Exige `perms` solo en las rutas que matchean `re` (el prefijo se comparte con el CRUD genérico). */
  const soloEn = (re: RegExp, perms: string[]) => {
    const g = requireAny(perms);
    return (req: Request, res: Response, next: NextFunction) =>
      (re.test(req.path) ? g(req, res, next) : next());
  };

  app.use(`${apiPrefix}/documents`, ...protect, buildDocumentsRouter(sequelize));
  app.use(`${apiPrefix}/documents`, ...protect, buildDocumentsUploadRouter(sequelize));
  app.use(`${apiPrefix}/personal`,  ...protect, buildPersonalRouter(sequelize));
  app.use(`${apiPrefix}/agentes`,   ...protect, soloEn(/^\/[^/]+\/foto\/?$/, ['app:atencion:access', ...GESTION]), buildAgentesFotoRouter());
  app.use(`${apiPrefix}/certificados`, ...protect, requireAny(GESTION), buildCertificadosRouter(sequelize));
  app.use(`${apiPrefix}/legajo`,       ...protect, buildLegajoRouter(sequelize));
  app.use(`${apiPrefix}/designaciones-form`, ...protect, buildDesignacionFormRouter(sequelize));
  app.use(`${apiPrefix}/guarderia-ddjj`, ...protect, buildGuarderiaDdjjRouter(sequelize));
  app.use(`${apiPrefix}/samo-ministerio`, ...protect, buildSamoMinisterioRouter(sequelize));
  app.use(`${apiPrefix}/ultimas-licencias`, ...protect, requireAny(GESTION), buildUltimasLicenciasRouter(sequelize));
  app.use(`${apiPrefix}/eventos`,   ...protect, buildEventosRouter(sequelize));
  app.use(`${apiPrefix}/api-keys`,  ...protect, buildApiKeysRouter(sequelize));
  app.use(`${apiPrefix}/usuarios`,  ...protect, buildUsuariosRouter(sequelize));
  app.use(`${apiPrefix}/webhooks`,  ...protect, buildWebhooksRouter(sequelize));
  app.use(`${apiPrefix}/asistencia`, ...protect, requireAny(['crud:asistencia:read', 'app:residentes:access', ADMIN]), buildAsistenciaRouter(sequelize));
  app.use(`${apiPrefix}/sin-salida`, ...protect, requireAny([ADMIN]), buildSinSalidaRouter(sequelize));
  app.use(`${apiPrefix}/ausentismo`, ...protect, buildAusentismoRouter(sequelize));
  app.use(`${apiPrefix}/fichero`,          ...protect, requireAny([ADMIN]), buildFicheroRouter());
  app.use(`${apiPrefix}/fichero-biometria-lab`, ...protect, requireAny([ADMIN]), buildFicheroBiometriaLabRouter(sequelize));
  app.use(`${apiPrefix}/examen-ingreso`,   ...protect, buildExamenIngresoRouter(sequelize));
  app.use(`${apiPrefix}/accidentes-punzo`, ...protect, buildAccidentesPunzoRouter(sequelize));
  app.use(`${apiPrefix}/casos-violencia`, ...protect, buildCasosViolenciaRouter(sequelize));
  app.use(`${apiPrefix}/turnos-salud-laboral`, ...protect, requireAny(['app:jefe_servicio:access', ADMIN]), buildTurnosSaludLaboralRouter(sequelize));
  app.use(`${apiPrefix}/tareas-livianas`,  ...protect, buildTareasLivianasRouter(sequelize));
  app.use(`${apiPrefix}/juntas-medicas`,   ...protect, buildJuntasMedicasRouter(sequelize));
  app.use(`${apiPrefix}/salud-laboral-habilitaciones`, ...protect, buildSaludLaboralHabilitacionesRouter(sequelize));
  app.use(`${apiPrefix}/bajas-estructura`, ...protect, buildBajasRouter(sequelize));
  app.use(`${apiPrefix}/jubilacion`,       ...protect, buildJubilacionRouter(sequelize));
  // Agenda de turnos (oficina). La página pública del agente es otro proceso: publico/turnosPublicoServer.ts
  app.use(`${apiPrefix}/agenda-turnos`,    ...protect, requireAny(GESTION), buildAgendaTurnosRouter(sequelize));
  // avisos WhatsApp de usuarios confirmados en Gestiones Personales (card del dashboard)
  app.use(`${apiPrefix}/gp-avisos`,        ...protect, requireAny(GESTION), buildGpAvisosRouter(sequelize));
  app.use(`${apiPrefix}/herramientas`,     ...protect, requireAny([ADMIN]), buildHerramientasRouter(sequelize));
  app.use(`${apiPrefix}/comisiones`,       ...protect, buildComisionesRouter(sequelize));
  app.use(`${apiPrefix}/vacaciones-adelantadas`, ...protect, buildVacacionesAdelantadasRouter(sequelize));
  app.use(`${apiPrefix}/carga-horaria-ley`, ...protect, buildCargaHorariaLeyRouter(sequelize));
  app.use(`${apiPrefix}/whatsapp`,         ...protect, buildWhatsappRouter(sequelize));
  // Bot de WhatsApp (API oficial): configuración. El webhook vive en publico/turnosPublicoServer.ts
  app.use(`${apiPrefix}/whatsapp-bot`,     ...protect, requireAny([ADMIN]), buildWhatsappBotRouter(sequelize));
  app.use(`${apiPrefix}/stress`,           ...protect, buildStressRouter(sequelize));
  app.use(`${apiPrefix}/antiguedad`,       ...protect, requireAny([ADMIN]), buildAntiguedadRouter(sequelize));
  app.use(`${apiPrefix}/licencias`,          ...protect, buildLicenciasRouter(sequelize));
  app.use(`${apiPrefix}/licencias-medicas-control`, ...protect, buildLicenciasMedicasControlRouter(sequelize));
  app.use(`${apiPrefix}/comparacion-siape`, ...protect, buildComparacionSiapeRouter(sequelize));
  app.use(`${apiPrefix}/comparacion-v2`,    ...protect, buildComparacionV2Router(sequelize));
  app.use(`${apiPrefix}/articulo-26-intranet`, ...protect, buildArticulo26IntranetRouter(sequelize));
  app.use(`${apiPrefix}/licencias-consultorio`, ...protect, requireAny(['app:licencias-consultorio:access', 'crud:*:*']), buildLicenciasConsultorioRouter(sequelize));
  app.use(`${apiPrefix}/horarios-extendidos`, ...protect, requireAny(['app:horarios-extendidos:access', 'crud:*:*']), buildHorariosExtendidosRouter());
  app.use(`${apiPrefix}/plus-licencias`,    ...protect, requireAny(['app:normativa:access', 'crud:*:*']), buildPlusLicenciasRouter(sequelize));
  // /reciente va antes del montaje restringido: lo usa la ficha de Gestión (usuarios de Gestión + admin)
  app.use(`${apiPrefix}/fichajes-agentes/reciente`, ...protect, requireAny(GESTION), buildFichajesRecienteRouter(sequelize));
  // Mensajes al reloj desde Gestión: mismos permisos que la pantalla (usuarios de Gestión + admin).
  app.use(`${apiPrefix}/mensajes-reloj`, ...protect, requireAny(['crud:agentexdni1:read', 'crud:*:*']), buildMensajesRelojRouter(sequelize));
  app.use(`${apiPrefix}/fichajes-agentes`, ...protect, requireAny(['crud:*:*']), buildFichajesAgentesRouter(sequelize));
  app.use(`${apiPrefix}/presentismo-sector`, ...protect, requireAny(['app:jefe_servicio:access', 'crud:*:*']), buildPresentismoSectorRouter(sequelize));
  // Solo admin: estas rutas lanzan scripts en el servidor (pantallas Carga SIAPE / Historial Estructura, ya solo admin en el front).
  app.use(`${apiPrefix}/intranet`,          ...protect, requireAny(['crud:*:*']), buildIntranetRouter(sequelize));
  app.use(`${apiPrefix}/residentes`,         ...protect, requireAny(['app:residentes:access', 'crud:residentes_rotacion:read', ADMIN]), buildResidentesRouter(sequelize));
  app.use(`${apiPrefix}/rotacion-siape`,     ...protect, requireAny(['crud:residentes_rotacion:read', ADMIN]), buildRotacionSiapeRouter(sequelize));
  app.use(`${apiPrefix}/residencias`,        ...protect, requireAny([ADMIN]), buildResidenciasRouter(sequelize));
  app.use(`${apiPrefix}/fc-cert-reemplazos`, ...protect, buildFcCertReemplazosRouter(sequelize));
  app.use(`${apiPrefix}/nombramiento`,       ...protect, requireAny([ADMIN]), buildNombramientoRouter(sequelize));
  app.use(`${apiPrefix}/tramites-documentales`, ...protect, requireAny(['documents:read', ADMIN]), buildTramitesDocumentalesRouter(sequelize));
  app.use(`${apiPrefix}/script-runs`,        ...protect, buildScriptRunsRouter(sequelize));
  app.use(`${apiPrefix}/resoluciones-sin-archivo`, ...protect, requireAny(['crud:resoluciones:read', ADMIN]), buildResolucionesSinArchivoRouter(sequelize));
  app.use(`${apiPrefix}/feriados`,           ...protect, buildFeriadosRouter(sequelize));

  // ── Scanner API integration (recibe webhooks del scanner independiente) ───
  // Auth: acepta JWT del usuario (operador desde UI) o X-Api-Key (scanner microservicio)
  app.use(`${apiPrefix}/scanner`, ...protect, salvo(['crud:*:read', ADMIN], ['/document-ready']), buildScannerRouter(sequelize));

  // ── Audit reads (registra lecturas sensibles) ─────────────────────────────
  app.use(apiPrefix, authContext(sequelize), auditReadMiddleware(sequelize));

  // ── Preferencias de música de escaneo por usuario ────────────────────────
  app.use(`${apiPrefix}/user-scan-music`, authContext(sequelize), buildUserScanMusicRouter(sequelize));

  // ── Alertas por agente (RRHH interno) ────────────────────────────────────
  app.use(`${apiPrefix}/alertas-agente`, ...protect, salvoRutas(['crud:alertas_agente:read', ADMIN], [['GET', /^\/agente\/[^/]+\/?$/], ['POST', /^\/\d+\/(ver|cerrar)\/?$/]]), buildAlertasAgenteRouter(sequelize));
  app.use(`${apiPrefix}/alertas-cumpleanos`, ...protect, buildCumpleanosAlertasRouter(sequelize));
  app.use(`${apiPrefix}/reclamos-haberes`, ...protect, requireAny([ADMIN]), buildReclamosHaberesRouter(sequelize));
  app.use(`${apiPrefix}/dashboard-alerts`, ...protect, buildDashboardAlertsRouter(sequelize));
  app.use(`${apiPrefix}/becarios-art`,   ...protect, requireAny(['crud:becarios_art:read', ADMIN]), buildBecariosArtRouter(sequelize));

  // ── Jefaturas (custom: enriquece con nombre real desde personal) ─────────
  app.use(`${apiPrefix}/jefaturas`, ...protect, lecturaEscritura(['app:jefe_servicio:access', 'crud:jefedeptos:read', ADMIN], ['crud:jefedeptos:read', ADMIN]), buildJefaturasRouter(sequelize));

  // ── Catálogos (pestaña de Admin) ──────────────────────────────────────────
  // Mismo router CRUD montado bajo /catalogos, pero exigiendo 'admin:catalogos'.
  // Va por prefijo propio porque /tables y el CRUD genérico los comparten
  // Reportes y el resto de los módulos: no se les puede pedir este permiso.
  // Desde CATALOGOS_DESDE (lunes 24/08/2026) el permiso pasa a ser obligatorio.
  const CATALOGOS_DESDE = Date.parse('2026-08-24T00:00:00-03:00');
  const guardCatalogos = requirePermission('admin:catalogos');
  const catalogosGate = (req: any, res: any, next: any) =>
    Date.now() < CATALOGOS_DESDE ? next() : guardCatalogos(req, res, next);
  app.use(`${apiPrefix}/catalogos`, ...protect, catalogosGate, buildCrudRouter(sequelize, schema));

  // ── CRUD dinamico (genera rutas para TODAS las tablas de la BD) ───────────
  app.use(apiPrefix, ...protect, buildCrudRouter(sequelize, schema));

  // ── Auto-routes (DX: rutas definidas en src/routes/auto/) ────────────────
  await mountAutoRoutes(app, sequelize, schema);

  // ── Inicializar emisor de webhooks ────────────────────────────────────────
  initWebhookEmitter(sequelize);

  await startArtAltaWorker(sequelize).catch((err) => {
    logger.error({ msg: '[artAltaQueue] no se pudo iniciar', err: err?.message || String(err) });
  });

  // ── Montar dominio + plugins registrados ──────────────────────────────────
  const ctx: PluginContext = { app, sequelize, schema, apiVersion, apiPrefix };
  await pluginRegistry.mountAll(ctx);

  logger.info({
    msg: 'API Gateway montado',
    apiPrefix,
    rutas: [
      `${apiPrefix}/auth`,
      `${apiPrefix}/documents`,
      `${apiPrefix}/personal`,
      `${apiPrefix}/agentes`,
      `${apiPrefix}/eventos`,
      `${apiPrefix}/certificados`,
      `${apiPrefix}/api-keys`,
      `${apiPrefix}/webhooks`,
      `${apiPrefix}/usuarios`,
      `${apiPrefix}/:tabla (CRUD dinamico)`,
    ],
  });
}
