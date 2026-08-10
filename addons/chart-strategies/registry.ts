import type { StrategyPlugin } from './types';

const plugins = new Map<string, StrategyPlugin>();
const listeners = new Set<() => void>();

function validatePlugin(plugin: StrategyPlugin): void {
  const id = String(plugin?.id ?? '').trim();
  if (!id) throw new Error('Strategy plugin id is required.');
  if (!Number.isInteger(plugin.version) || plugin.version < 1) {
    throw new Error(`Strategy plugin ${id} version must be a positive integer.`);
  }
  if (!String(plugin.label ?? '').trim()) {
    throw new Error(`Strategy plugin ${id} label is required.`);
  }
  if (!Array.isArray(plugin.parameters)) {
    throw new Error(`Strategy plugin ${id} parameters must be an array.`);
  }
  if (typeof plugin.create !== 'function') {
    throw new Error(`Strategy plugin ${id} create() is required.`);
  }
}

function notify(): void {
  for (const listener of Array.from(listeners)) {
    try { listener(); } catch { /* one consumer must not break the registry */ }
  }
}

/**
 * Public strategy registration port.
 *
 * Local plugins may still be auto-discovered by catalog.ts, while an external
 * add-on can register a StrategyPlugin through this function without touching
 * ChartForm, StrategyHost, or a central switch statement.
 *
 * The returned disposer unregisters only the exact plugin instance that was
 * registered by this call, so independently loaded add-ons can be removed.
 */
export function registerStrategyPlugin(plugin: StrategyPlugin): () => void {
  validatePlugin(plugin);
  const existing = plugins.get(plugin.id);
  if (existing) throw new Error(`Duplicate strategy plugin id: ${plugin.id}`);

  plugins.set(plugin.id, plugin);
  notify();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (plugins.get(plugin.id) !== plugin) return;
    plugins.delete(plugin.id);
    notify();
  };
}

export function getRegisteredStrategyPlugin(id: string): StrategyPlugin | undefined {
  return plugins.get(id);
}

export function listRegisteredStrategyPlugins(): StrategyPlugin[] {
  return Array.from(plugins.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'));
}

/** Subscribe to runtime plugin add/remove changes. */
export function onStrategyPluginsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
