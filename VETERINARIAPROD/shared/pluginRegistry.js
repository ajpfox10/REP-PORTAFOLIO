'use strict';
/**
 * Plugin Registry — sistema de hooks/eventos para extensibilidad.
 *
 * Los plugins se registran en el arranque del servicio.
 * Los servicios emiten eventos ("patient.created", "invoice.paid", etc.).
 * Los plugins suscriben handlers a esos eventos.
 *
 * Tipos de hooks:
 *   - before: se ejecuta ANTES del handler de route (puede abortar)
 *   - after:  se ejecuta DESPUÉS de la respuesta (fire-and-forget)
 *   - on:     suscripción a eventos de negocio
 *
 * Activación por org: los plugins se activan/desactivan por org en DB/Redis.
 * Cache de activación: Redis, TTL 5 minutos.
 */

const EventEmitter = require('events');
const cache  = require('./cache');
const db     = require('./db');
const logger = require('./logger');

const PLUGIN_CACHE_TTL = 300; // 5 minutos
const BEFORE_TIMEOUT_MS = parseInt(process.env.PLUGIN_BEFORE_TIMEOUT_MS || '100');

class PluginRegistry extends EventEmitter {
  constructor() {
    super();
    this._plugins    = new Map(); // pluginId → { meta, handlers }
    this._before     = [];        // [{ pluginId, handler }]
    this._after      = [];        // [{ pluginId, handler }]
    this._orgCache   = new Map(); // orgId → Set<pluginId> (memoria local corta)
  }

  /**
   * Registra un plugin con sus metadata y handlers.
   * @param {Object} plugin - { id, name, version, description, hooks }
   */
  register(plugin) {
    if (!plugin.id) throw new Error('Plugin must have an id');

    this._plugins.set(plugin.id, {
      id:          plugin.id,
      name:        plugin.name        || plugin.id,
      version:     plugin.version     || '1.0.0',
      description: plugin.description || '',
    });

    // Registrar hooks
    if (plugin.hooks) {
      for (const [event, handler] of Object.entries(plugin.hooks)) {
        if (event === 'before') {
          this._before.push({ pluginId: plugin.id, handler });
        } else if (event === 'after') {
          this._after.push({ pluginId: plugin.id, handler });
        } else {
          // Evento de negocio (patient.created, invoice.paid, etc.)
          this.on(event, async (data) => {
            try {
              const active = await this._isActiveForOrg(plugin.id, data?.orgId);
              if (!active) return;
              await handler(data);
            } catch (err) {
              logger.warn(`[plugin:${plugin.id}] Error in handler for '${event}'`, { err: err.message });
            }
          });
        }
      }
    }

    logger.info(`[pluginRegistry] Registered plugin: ${plugin.id} v${plugin.version || '1.0.0'}`);
  }

  /**
   * Verifica si un plugin está activo para un org dado.
   * Usa caché en memoria (30s) → Redis (5min) → DB.
   */
  async _isActiveForOrg(pluginId, orgId) {
    if (!orgId) return true; // sin org → activo por defecto (servicios internos)

    // Caché en memoria
    const memKey = `${orgId}:${pluginId}`;
    if (this._orgCache.has(memKey)) {
      const { value, ts } = this._orgCache.get(memKey);
      if (Date.now() - ts < 30_000) return value;
    }

    // Redis
    try {
      const rc  = await cache.getClient();
      const key = `plugin:${orgId}:${pluginId}`;
      const val = await rc.get(key);
      if (val !== null) {
        const active = val === '1';
        this._orgCache.set(memKey, { value: active, ts: Date.now() });
        return active;
      }
    } catch { /* ignorar */ }

    // DB
    try {
      const row = await db.queryOne(
        'SELECT is_active FROM org_plugins WHERE org_id = :orgId AND plugin_id = :pluginId',
        { orgId, pluginId },
      );
      const active = row ? Boolean(row.is_active) : false;
      // Guardar en Redis
      try {
        const rc = await cache.getClient();
        await rc.setEx(`plugin:${orgId}:${pluginId}`, PLUGIN_CACHE_TTL, active ? '1' : '0');
      } catch { /* ignorar */ }
      this._orgCache.set(memKey, { value: active, ts: Date.now() });
      return active;
    } catch {
      return false;
    }
  }

  /**
   * Express middleware: ejecuta hooks 'before' con timeout.
   * Si un hook retorna { abort: true }, corta el request.
   */
  beforeMiddleware() {
    return async (req, res, next) => {
      const orgId = req.user?.orgId;

      for (const { pluginId, handler } of this._before) {
        try {
          const active = await this._isActiveForOrg(pluginId, orgId);
          if (!active) continue;

          const result = await Promise.race([
            handler(req, res),
            new Promise(resolve => setTimeout(() => resolve(null), BEFORE_TIMEOUT_MS)),
          ]);

          if (result?.abort) {
            return res.status(result.status || 403).json({
              success: false,
              error: { message: result.message || 'Request blocked by plugin', code: 'SVC_004' },
            });
          }
        } catch (err) {
          logger.warn(`[plugin:${pluginId}] before hook error`, { err: err.message });
          // No bloquear por error de plugin
        }
      }

      next();
    };
  }

  /**
   * Express middleware: ejecuta hooks 'after' como fire-and-forget.
   */
  afterMiddleware() {
    return (req, res, next) => {
      const orgId = req.user?.orgId;

      res.on('finish', () => {
        for (const { pluginId, handler } of this._after) {
          this._isActiveForOrg(pluginId, orgId).then(active => {
            if (!active) return;
            return handler(req, res);
          }).catch(err => {
            logger.warn(`[plugin:${pluginId}] after hook error`, { err: err.message });
          });
        }
      });

      next();
    };
  }

  /**
   * Emite un evento de negocio a todos los plugins suscritos.
   * Fire-and-forget — no bloquea el flujo principal.
   */
  emitEvent(eventName, data) {
    setImmediate(() => {
      try {
        this.emit(eventName, data);
      } catch (err) {
        logger.warn(`[pluginRegistry] Error emitting '${eventName}'`, { err: err.message });
      }
    });
  }

  /**
   * Lista todos los plugins registrados.
   */
  listPlugins() {
    return [...this._plugins.values()];
  }

  /**
   * Invalida el caché de activación de plugins para un org.
   */
  async invalidateOrgCache(orgId) {
    for (const key of this._orgCache.keys()) {
      if (key.startsWith(`${orgId}:`)) this._orgCache.delete(key);
    }
    try {
      // No hay glob delete fácil en Redis — dejar expirar el TTL
      logger.info('[pluginRegistry] Cache invalidated for org', { orgId });
    } catch { /* ignorar */ }
  }
}

// Singleton — un registry por proceso
const registry = new PluginRegistry();

module.exports = registry;
