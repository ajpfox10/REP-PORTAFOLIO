import { type Plugin, type PluginContext, type PluginHook } from "./types.js";

/**
 * Hybrid plugin system:
 * - Metadata in DB (per tenant enable/disable)
 * - Code plugins loaded from a registry (safe allowlist, no arbitrary code execution)
 *
 * NOTE: For "sandboxed code" plugins, use a separate runtime (e.g., isolated-vm / wasm / external service).
 */
export function buildPluginRegistry(opts: { plugins: Plugin[] }) {
  const map = new Map(opts.plugins.map(p => [p.id, p]));

  async function runHook(pluginIds: string[], ctx: PluginContext, hook: PluginHook) {
    for (const id of pluginIds) {
      const p = map.get(id);
      if (!p?.onHook) continue;
      await p.onHook(ctx, hook);
    }
  }

  return { runHook };
}
