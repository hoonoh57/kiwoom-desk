import type {
  StrategyChartState,
  StrategyInstanceConfig,
  StrategyParamValue,
  StrategyParameterDef,
  StrategyParams,
  StrategyPlugin,
  StrategyPluginModule,
} from './types';

const modules = import.meta.glob<StrategyPluginModule>(
  './plugins/*.ts',
  { eager: true },
);

const plugins = new Map<string, StrategyPlugin>();

for (const [path, module] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
  const plugin = module.default;
  if (!plugin?.id) throw new Error(`Strategy plugin id missing: ${path}`);
  if (plugins.has(plugin.id)) throw new Error(`Duplicate strategy plugin id: ${plugin.id}`);
  plugins.set(plugin.id, plugin);
}

export function listStrategyPlugins(): StrategyPlugin[] {
  return Array.from(plugins.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'));
}

export function getStrategyPlugin(id: string): StrategyPlugin | undefined {
  return plugins.get(id);
}

export function defaultStrategyParams(plugin: StrategyPlugin): StrategyParams {
  return Object.fromEntries(plugin.parameters.map(p => [p.key, p.default]));
}

export function normalizeStrategyParams(
  plugin: StrategyPlugin,
  raw: Record<string, unknown> | undefined,
): StrategyParams {
  const out: StrategyParams = {};
  for (const def of plugin.parameters) out[def.key] = normalizeParam(def, raw?.[def.key]);
  return out;
}

export function createDefaultStrategyState(): StrategyChartState {
  return { schemaVersion: 1, strategies: [] };
}

export function normalizeStrategyState(raw: unknown): StrategyChartState {
  if (!raw || typeof raw !== 'object') return createDefaultStrategyState();
  const input = raw as Record<string, unknown>;
  const rows = (Array.isArray(input.strategies) ? input.strategies : [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => requestedOrder(a.row, a.index) - requestedOrder(b.row, b.index));

  const strategies: StrategyInstanceConfig[] = [];
  for (const entry of rows) {
    if (!entry.row || typeof entry.row !== 'object') continue;
    const item = entry.row as Record<string, unknown>;
    const strategyId = String(item.strategyId ?? '').trim();
    const instanceId = String(item.instanceId ?? '').trim();
    if (!strategyId || !instanceId) continue;

    const plugin = plugins.get(strategyId);
    const rawParams = isRecord(item.params) ? item.params : {};
    const execution = isRecord(item.execution) ? item.execution : {};
    const mode = execution.mode === 'paper' || execution.mode === 'broker' ? execution.mode : 'signal';
    const exchange = execution.exchange === 'KRX' || execution.exchange === 'NXT' ? execution.exchange : 'SOR';
    const qty = Math.max(1, Math.min(1_000_000, Math.trunc(Number(execution.qty) || 1)));
    const orderType = String(execution.orderType ?? '3').trim() || '3';

    strategies.push({
      instanceId,
      strategyId,
      pluginVersion: plugin?.version ?? Math.max(1, Math.trunc(Number(item.pluginVersion) || 1)),
      enabled: item.enabled !== false,
      params: plugin ? normalizeStrategyParams(plugin, rawParams) : primitiveParams(rawParams),
      execution: { mode, qty, exchange, orderType },
      showMarkers: item.showMarkers !== false,
      order: strategies.length,
    });
  }

  return { schemaVersion: 1, strategies };
}

function requestedOrder(row: unknown, fallback: number): number {
  if (!row || typeof row !== 'object') return fallback;
  const n = Number((row as Record<string, unknown>).order);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeParam(def: StrategyParameterDef, raw: unknown): StrategyParamValue {
  if (def.type === 'boolean') return typeof raw === 'boolean' ? raw : Boolean(def.default);
  if (def.type === 'select') {
    const value = String(raw ?? def.default);
    return def.options?.some(x => x.value === value) ? value : String(def.default);
  }

  let value = Number(raw);
  if (!Number.isFinite(value)) value = Number(def.default);
  if (def.type === 'integer') value = Math.trunc(value);
  if (def.min !== undefined) value = Math.max(def.min, value);
  if (def.max !== undefined) value = Math.min(def.max, value);
  return value;
}

function primitiveParams(raw: Record<string, unknown>): StrategyParams {
  const out: StrategyParams = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
