import type {
  IndicatorChartState,
  IndicatorInstanceConfig,
  IndicatorParameterDef,
  IndicatorParameterValue,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPluginModule,
} from './types';

const modules = import.meta.glob<IndicatorPluginModule>(
  './plugins/*.ts',
  { eager: true },
);

const plugins = new Map<string, IndicatorPlugin>();

for (const [path, module] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
  const plugin = module.default;
  if (!plugin?.id) throw new Error(`Indicator plugin id missing: ${path}`);
  if (plugins.has(plugin.id)) throw new Error(`Duplicate indicator plugin id: ${plugin.id}`);
  plugins.set(plugin.id, plugin);
}

export function listIndicatorPlugins(): IndicatorPlugin[] {
  return Array.from(plugins.values()).sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'));
}

export function getIndicatorPlugin(id: string): IndicatorPlugin | undefined {
  return plugins.get(id);
}

export function defaultParams(plugin: IndicatorPlugin): IndicatorParams {
  return Object.fromEntries(
    plugin.parameters.map(p => [p.key, p.default]),
  );
}

export function normalizeParams(
  plugin: IndicatorPlugin,
  raw: Record<string, unknown> | undefined,
): IndicatorParams {
  const out: IndicatorParams = {};
  for (const def of plugin.parameters) {
    out[def.key] = normalizeParam(def, raw?.[def.key]);
  }
  return out;
}

export function createDefaultIndicatorState(): IndicatorChartState {
  const indicators: IndicatorInstanceConfig[] = [];

  for (const plugin of plugins.values()) {
    for (const item of plugin.defaultInstances ?? []) {
      indicators.push({
        instanceId: item.instanceId,
        indicatorId: plugin.id,
        pluginVersion: plugin.version,
        enabled: true,
        params: normalizeParams(plugin, {
          ...defaultParams(plugin),
          ...(item.params ?? {}),
        }),
        style: item.style,
      });
    }
  }

  return { schemaVersion: 1, indicators };
}

export function normalizeIndicatorState(raw: unknown): IndicatorChartState {
  if (!raw || typeof raw !== 'object') return createDefaultIndicatorState();

  const input = raw as Record<string, unknown>;
  const rows = Array.isArray(input.indicators) ? input.indicators : [];
  const indicators: IndicatorInstanceConfig[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const indicatorId = String(item.indicatorId ?? '').trim();
    const instanceId = String(item.instanceId ?? '').trim();
    if (!indicatorId || !instanceId) continue;

    const plugin = plugins.get(indicatorId);
    const rawParams = isRecord(item.params) ? item.params : {};
    const fromVersion = Math.max(1, Math.trunc(Number(item.pluginVersion) || 1));

    if (!plugin) {
      indicators.push({
        instanceId,
        indicatorId,
        pluginVersion: fromVersion,
        enabled: item.enabled !== false,
        params: primitiveParams(rawParams),
        pane: item.pane === 'own' ? 'own' : item.pane === 'main' ? 'main' : undefined,
        style: isRecord(item.style) ? item.style as Record<string, Record<string, unknown>> : undefined,
      });
      continue;
    }

    let migrated = primitiveParams(rawParams);
    if (fromVersion !== plugin.version && plugin.migrateParams) {
      migrated = plugin.migrateParams(migrated, fromVersion);
    }

    indicators.push({
      instanceId,
      indicatorId,
      pluginVersion: plugin.version,
      enabled: item.enabled !== false,
      params: normalizeParams(plugin, migrated),
      pane: item.pane === 'own' ? 'own' : item.pane === 'main' ? 'main' : undefined,
      style: isRecord(item.style) ? item.style as Record<string, Record<string, unknown>> : undefined,
    });
  }

  return { schemaVersion: 1, indicators };
}

function normalizeParam(
  def: IndicatorParameterDef,
  raw: unknown,
): IndicatorParameterValue {
  if (def.type === 'boolean') {
    return typeof raw === 'boolean' ? raw : Boolean(def.default);
  }

  if (def.type === 'select') {
    const value = String(raw ?? def.default);
    const allowed = def.options?.some(x => x.value === value) ?? false;
    return allowed ? value : String(def.default);
  }

  let value = Number(raw);
  if (!Number.isFinite(value)) value = Number(def.default);
  if (def.type === 'integer') value = Math.trunc(value);
  if (def.min !== undefined) value = Math.max(def.min, value);
  if (def.max !== undefined) value = Math.min(def.max, value);
  return value;
}

function primitiveParams(raw: Record<string, unknown>): IndicatorParams {
  const out: IndicatorParams = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      out[key] = value;
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
