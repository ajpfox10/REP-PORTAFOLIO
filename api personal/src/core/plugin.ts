/**
 * @file core/plugin.ts
 * @description Sistema de plugins y dominios intercambiables.
 *
 * --- Para quien no sabe de sistemas ---
 * Imaginate un edificio con estructura de hormigon (el "core").
 * En cada piso podes poner distintos negocios (gym, peluqueria, veterinaria).
 * Si el gym cierra, installas otro negocio SIN tocar el hormigon del edificio.
 * La API es el edificio, los "dominios" (personalv5, veterinaria) son los negocios.
 *
 * --- Tecnicamente ---
 * Desacopla el nucleo (auth, seguridad, logs, cache, health) de la logica de negocio.
 * Para crear una nueva API:
 *   1. Copiar src/domains/personalv5/ -> src/domains/mi_dominio/
 *   2. Implementar la interface Domain
 *   3. Registrar en src/gateways/apiGateway.ts
 * Todo el resto (JWT, rate limiting, audit log, metricas) funciona solo.
 */

import type { Express } from 'express';
import type { Sequelize } from 'sequelize';
import type { SchemaSnapshot } from '../db/schema/types';

export interface PluginContext {
  app: Express;
  sequelize: Sequelize;
  schema: SchemaSnapshot;
  apiVersion: string;
  apiPrefix: string;
}

export interface Plugin {
  readonly name: string;
  mount(ctx: PluginContext): void | Promise<void>;
  unmount?(): void | Promise<void>;
}

export interface Domain extends Plugin {
  readonly description: string;
  readonly mainTables: string[];
}

export class PluginRegistry {
  private domain: Domain | null = null;
  private plugins: Plugin[] = [];

  setDomain(domain: Domain): this {
    this.domain = domain;
    return this;
  }

  getDomain(): Domain | null {
    return this.domain;
  }

  addPlugin(plugin: Plugin): this {
    this.plugins.push(plugin);
    return this;
  }

  async mountAll(ctx: PluginContext): Promise<void> {
    if (this.domain) {
      try { await this.domain.mount(ctx); }
      catch (err: any) { throw new Error(`[Domain:${this.domain.name}] mount() fallo: ${err?.message || err}`); }
    }
    for (const plugin of this.plugins) {
      try { await plugin.mount(ctx); }
      catch (err: any) { throw new Error(`[Plugin:${plugin.name}] mount() fallo: ${err?.message || err}`); }
    }
  }

  async unmountAll(): Promise<void> {
    const allReversed = [...this.plugins, this.domain].filter(Boolean).reverse();
    for (const p of allReversed as Plugin[]) {
      if (p.unmount) { try { await p.unmount(); } catch { /* no rompe el shutdown */ } }
    }
  }

  getAll(): Plugin[] {
    return [this.domain, ...this.plugins].filter(Boolean) as Plugin[];
  }
}

export const pluginRegistry = new PluginRegistry();
