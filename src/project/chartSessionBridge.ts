import {
  ChartRuntimeServiceIds,
  registerChartPlugin,
  type ChartRuntimeStateService,
} from '../chart/runtimeHost';
import {
  createChartRuntimeSessionState,
  parseChartRuntimeSessionState,
  type ChartRuntimeSessionState,
} from '../chart/runtimeSessionState';

export const CHART_SESSION_STATE_BRIDGE_ID = 'chart.session-state';

interface ChartSessionParentParams {
  chartState?: unknown;
  onChartStateChange?: (state: unknown) => void;
}

/**
 * Generic parent/child state bridge.
 *
 * The parent supplies/receives one opaque chartState value. This bridge alone
 * understands the chart envelope. It never interprets any add-on id or nested
 * add-on state property.
 */
export function registerChartSessionStateBridge(): void {
  registerChartPlugin(CHART_SESSION_STATE_BRIDGE_ID, runtime => {
    const params = runtime.services.get<ChartSessionParentParams>(
      ChartRuntimeServiceIds.CHART_PARAMS,
    );
    const coreState = runtime.services.get<ChartRuntimeStateService>(
      ChartRuntimeServiceIds.CHART_STATE,
    );

    const restored = parseChartRuntimeSessionState(params?.chartState);
    if (restored && coreState) {
      coreState.apply(restored.core);
      runtime.addonState.replace(restored.addons);
    }

    const publish = (): void => {
      if (!coreState || typeof params?.onChartStateChange !== 'function') return;
      const snapshot: ChartRuntimeSessionState = createChartRuntimeSessionState(
        coreState.read(),
        runtime.addonState.snapshot(),
      );
      params.onChartStateChange(snapshot);
    };

    const unsubscribeCore = coreState?.subscribe(() => publish()) ?? (() => undefined);
    const unsubscribeAddons = runtime.addonState.subscribeDocument(() => publish());

    // Parent receives one canonical snapshot after any initial restore completed.
    publish();

    return {
      dispose() {
        unsubscribeCore();
        unsubscribeAddons();
      },
    };
  });
}
