import type {
  IndicatorChartState,
  IndicatorInstanceConfig,
  IndicatorParameterDef,
  IndicatorParameterValue,
  IndicatorParams,
  IndicatorPlugin,
  IndicatorPluginModule,
  IndicatorSeriesStyle,
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
  const ordinals = new Map<string, number>();

  for (const plugin of plugins.values()) {
    for (const item of plugin.defaultInstances ?? []) {
      const ordinal = nextOrdinal(ordinals, plugin.id);
      indicators.push({
        instanceId: item.instanceId,
        indicatorId: plugin.id,
        pluginVersion: plugin.version,
        enabled: true,
        params: normalizeParams(plugin, {
          ...defaultParams(plugin),
          ...(item.params ?? {}),
        }),
        style: mergeStyle(paletteStyle(plugin, ordinal), item.style),
        order: indicators.length,
      });
    }
  }

  return { schemaVersion: 2, indicators };
}

export function normalizeIndicatorState(raw: unknown): IndicatorChartState {
  if (!raw || typeof raw !== 'object') return createDefaultIndicatorState();

  const input = raw as Record<string, unknown>;
  const rawRows = Array.isArray(input.indicators) ? input.indicators : [];
  const rows = rawRows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => requestedOrder(a.row, a.index) - requestedOrder(b.row, b.index));

  const indicators: IndicatorInstanceConfig[] = [];
  const ordinals = new Map<string, number>();

  for (const entry of rows) {
    const row = entry.row;
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const indicatorId = String(item.indicatorId ?? '').trim();
    const instanceId = String(item.instanceId ?? '').trim();
    if (!indicatorId || !instanceId) continue;

    const ordinal = nextOrdinal(ordinals, indicatorId);
    const plugin = plugins.get(indicatorId);
    const rawParams = isRecord(item.params) ? item.params : {};
    const fromVersion = Math.max(1, Math.trunc(Number(item.pluginVersion) || 1));
    const paneHeight = normalizedPaneHeight(item.paneHeight);

    if (!plugin) {
      indicators.push({
        instanceId,
        indicatorId,
        pluginVersion: fromVersion,
        enabled: item.enabled !== false,
        params: primitiveParams(rawParams),
        pane: item.pane === 'own' ? 'own' : item.pane === 'main' ? 'main' : undefined,
        style: isRecord(item.style)
          ? cloneStyle(item.style as IndicatorSeriesStyle)
          : undefined,
        order: indicators.length,
        paneHeight,
      });
      continue;
    }

    let migrated = primitiveParams(rawParams);
    if (fromVersion !== plugin.version && plugin.migrateParams) {
      migrated = plugin.migrateParams(migrated, fromVersion);
    }

    const explicitStyle = isRecord(item.style)
      ? item.style as IndicatorSeriesStyle
      : undefined;

    indicators.push({
      instanceId,
      indicatorId,
      pluginVersion: plugin.version,
      enabled: item.enabled !== false,
      params: normalizeParams(plugin, migrated),
      pane: item.pane === 'own' ? 'own' : item.pane === 'main' ? 'main' : undefined,
      style: mergeStyle(paletteStyle(plugin, ordinal), explicitStyle),
      order: indicators.length,
      paneHeight,
    });
  }

  return { schemaVersion: 2, indicators };
}

function requestedOrder(row: unknown, fallback: number): number {
  if (!row || typeof row !== 'object') return fallback;
  const n = Number((row as Record<string, unknown>).order);
  return Number.isFinite(n) ? n : fallback;
}

function normalizedPaneHeight(value: unknown): number | undefined {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 30) return undefined;
  return Math.min(2000, n);
}

function nextOrdinal(ordinals: Map<string, number>, id: string): number {
  const current = ordinals.get(id) ?? 0;
  ordinals.set(id, current + 1);
  return current;
}

function paletteStyle(
  plugin: IndicatorPlugin,
  ordinal: number,
): IndicatorSeriesStyle | undefined {
  const palette = plugin.stylePalette;
  if (!palette?.length) return undefined;
  return palette[ordinal % palette.length];
}

function mergeStyle(
  base: IndicatorSeriesStyle | undefined,
  override: IndicatorSeriesStyle | undefined,
): IndicatorSeriesStyle | undefined {
  if (!base && !override) return undefined;
  const out: IndicatorSeriesStyle = {};
  for (const source of [base, override]) {
    if (!source) continue;
    for (const [outputId, options] of Object.entries(source)) {
      out[outputId] = { ...(out[outputId] ?? {}), ...options };
    }
  }
  return out;
}

function cloneStyle(style: IndicatorSeriesStyle | undefined): IndicatorSeriesStyle | undefined {
  return mergeStyle(undefined, style);
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
