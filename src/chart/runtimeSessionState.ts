import type { ChartRuntimeAddonStateDocument } from './runtimeAddonState';
import type { ChartRuntimeCoreState } from './runtimeHost';

export const CHART_RUNTIME_SESSION_STATE_SCHEMA_VERSION = 1 as const;

/**
 * One parent-storable chart session document.
 *
 * The parent/workspace treats this object as opaque JSON-compatible child state.
 * Chart runtime owns the schema and add-ons continue to own every nested node
 * inside `addons.addons[*].state`.
 */
export interface ChartRuntimeSessionState {
  schemaVersion: typeof CHART_RUNTIME_SESSION_STATE_SCHEMA_VERSION;
  core: ChartRuntimeCoreState;
  addons: ChartRuntimeAddonStateDocument;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createChartRuntimeSessionState(
  core: ChartRuntimeCoreState,
  addons: ChartRuntimeAddonStateDocument,
): ChartRuntimeSessionState {
  return {
    schemaVersion: CHART_RUNTIME_SESSION_STATE_SCHEMA_VERSION,
    core: cloneJson(core),
    addons: cloneJson(addons),
  };
}

export function parseChartRuntimeSessionState(
  value: unknown,
): ChartRuntimeSessionState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<ChartRuntimeSessionState>;
  if (raw.schemaVersion !== CHART_RUNTIME_SESSION_STATE_SCHEMA_VERSION) return undefined;
  if (!raw.core || typeof raw.core !== 'object') return undefined;
  if (!raw.addons || typeof raw.addons !== 'object') return undefined;

  const core = raw.core as ChartRuntimeCoreState;
  if (
    typeof core.code !== 'string'
    || typeof core.period !== 'string'
    || typeof core.scope !== 'string'
    || typeof core.adjusted !== 'boolean'
    || typeof core.volumeRaw !== 'boolean'
  ) return undefined;

  const addons = raw.addons as ChartRuntimeAddonStateDocument;
  if (addons.schemaVersion !== 1 || typeof addons.visualsVisible !== 'boolean') return undefined;
  if (!addons.addons || typeof addons.addons !== 'object') return undefined;

  return createChartRuntimeSessionState(core, addons);
}
